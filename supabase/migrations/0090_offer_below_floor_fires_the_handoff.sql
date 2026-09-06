-- An offer under the floor is the moment Tayo has to stop and a person has to
-- start. That is what handoff_negotiation_limit is for, and this is what makes
-- it fire.

-- Money as an agent reads it. The template says "offered {{2}}", so the value
-- has to arrive already looking like money -- 2,700,000 rather than
-- 2700000.00, and with the listing's own currency rather than an assumed one.
create or replace function public.format_money(p_amount numeric, p_currency text)
returns text
language sql
immutable
set search_path to 'pg_temp'
as $function$
  select case upper(coalesce(p_currency, 'NGN'))
           when 'NGN' then '₦'
           when 'USD' then '$'
           when 'GBP' then '£'
           when 'EUR' then '€'
           else upper(coalesce(p_currency, '')) || ' '
         end
      || trim(to_char(p_amount, 'FM999,999,999,999,990'));
$function$;

create or replace function public.record_offer(
  p_lead_id uuid, p_amount numeric, p_offered_by text default 'buyer'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lead   record;
  v_cur    text;
  v_id     uuid;
begin
  select l.id, l.agency_id, l.property_id into v_lead
  from leads l where l.id = p_lead_id and l.deleted_at is null;

  if v_lead.id is null then
    raise exception 'Lead not found' using errcode = 'no_data_found';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'An offer has to be a positive amount'
      using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(currency, 'NGN') into v_cur
  from properties where id = v_lead.property_id;

  insert into negotiation_offers (lead_id, property_id, agency_id, amount,
                                  currency, offered_by)
  values (p_lead_id, v_lead.property_id, v_lead.agency_id, p_amount,
          coalesce(v_cur, 'NGN'), coalesce(p_offered_by, 'buyer'))
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.record_offer(uuid, numeric, text) from public;
revoke all on function public.record_offer(uuid, numeric, text) from anon;
grant execute on function public.record_offer(uuid, numeric, text) to authenticated, service_role;

-- ── the handoff ──────────────────────────────────────────────────────────
create or replace function public.notify_agent_of_offer()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_floor   numeric;
  v_active  boolean;
  v_phone   text;
  v_name    text;
  v_listing text;
  v_agent   uuid;
  v_vars    jsonb;
  v_already int;
begin
  select floor_amount, is_active into v_floor, v_active
  from listing_negotiation_authority where property_id = new.property_id;

  -- Stamped now, while the floor is what it was. Changing the floor later
  -- must not rewrite the history of whether an offer was acceptable.
  new.below_floor := (v_floor is not null and v_active is true and new.amount < v_floor);

  -- A counter from the agency's own side is not something to notify them
  -- about, and an offer at or above the floor is Tayo doing its job.
  if new.offered_by = 'agent' or new.below_floor is not true then
    return new;
  end if;

  -- Once per lead. A buyer who tries 2.5, then 2.6, then 2.65 is one
  -- negotiation, not three, and an agent who has already been told is
  -- already in the conversation.
  select count(*) into v_already
  from message_outbox
  where lead_id = new.lead_id
    and template_key = 'handoff_negotiation_limit'
    and status in ('queued', 'sending', 'sent');
  if v_already > 0 then
    return new;
  end if;

  select l.assigned_agent_id, coalesce(nullif(btrim(l.consumer_name), ''), 'A buyer')
    into v_agent, v_name
  from leads l where l.id = new.lead_id;

  v_phone := public.handoff_phone_for(v_agent, new.agency_id);
  if v_phone is null then
    return new;
  end if;

  select coalesce(nullif(btrim(pr.title), ''), 'one of your listings')
    into v_listing from properties pr where pr.id = new.property_id;
  v_listing := coalesce(v_listing, 'one of your listings');

  v_vars := jsonb_build_object(
    'buyer_name', v_name,
    'offer',      public.format_money(new.amount, new.currency),
    'listing',    v_listing);

  begin
    insert into message_outbox (agency_id, lead_id, to_phone, body,
                                template_key, template_vars)
    values (new.agency_id, new.lead_id, v_phone,
            public.render_whatsapp_template('handoff_negotiation_limit', v_vars),
            'handoff_negotiation_limit', v_vars);
  exception when others then
    -- The offer is the record that matters. Losing it to protect its
    -- notification would be the same mistake as losing a lead.
    raise warning 'notify_agent_of_offer: % (offer %)', sqlerrm, new.id;
  end;

  return new;
end;
$function$;

-- BEFORE, because it stamps below_floor onto the row it is judging.
drop trigger if exists negotiation_offers_notify on public.negotiation_offers;
create trigger negotiation_offers_notify
  before insert on public.negotiation_offers
  for each row execute function public.notify_agent_of_offer();
