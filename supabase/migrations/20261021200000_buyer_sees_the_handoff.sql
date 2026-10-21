-- THE BUYER SEES THE HANDOFF (Eden, 2026-10-21; idea from the Sendbird review: show the handoff state in the chat).
--
-- Until now a buyer who reached the handover card heard nothing more: whether the agency had the lead, whether an agent had
-- picked it up, was visible only on the agency's side. This adds the one fact that was missing (when an agent took over) and a
-- read for the signed-in buyer's own leads. Only the agency's name is returned, never the agent's: buyers see the agency (the
-- agent identity gap is a known, separate decision).

alter table public.leads add column if not exists taken_over_at timestamptz;

-- take_over_lead is unchanged except for the one stamp marked below.
create or replace function public.take_over_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me      uuid := auth.uid();
  v_lead    record;
  v_role    text;
  v_prop    record;
  v_prof    record;
  v_email   text;
  v_phone   text;
  v_handle  text;
  v_my_phone text;
  v_neg     jsonb;
  v_offer   numeric;
  v_cur     text;
  v_listed  text;
  v_agreed  text;
  v_bits    text[] := '{}';
  v_contact text;
  v_vars    jsonb;
  v_text    text;
  v_wa      text := 'not_queued';
  v_assigned_to_me boolean;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_lead from leads where id = p_lead_id and deleted_at is null;
  if v_lead.id is null then
    raise exception 'Lead not found' using errcode = 'no_data_found';
  end if;

  v_role := coalesce(agency_role(v_lead.agency_id)::text, '');
  if v_role not in ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot take over this agency''s leads' using errcode = 'insufficient_privilege';
  end if;

  if v_lead.assigned_agent_id is not null and v_lead.assigned_agent_id <> v_me and v_role = 'agent' then
    raise exception 'This lead is with a teammate. Ask an admin to reassign it to you.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 1. the lead is now this agent's
  v_assigned_to_me := v_lead.assigned_agent_id is not distinct from v_me;
  if not v_assigned_to_me then
    perform set_config('synapse.take_over', 'on', true);
    update leads set assigned_agent_id = v_me where id = p_lead_id;
    perform set_config('synapse.take_over', 'off', true);
  end if;
  -- the buyer is told someone has picked this up: stamped once, the first time it happens
  update leads set taken_over_at = coalesce(taken_over_at, now()) where id = p_lead_id;

  -- 2. what is known about the buyer
  select coalesce(nullif(btrim(title), ''), 'the listing') as title, price, coalesce(currency, 'NGN') as currency
    into v_prop from properties where id = v_lead.property_id;
  select full_name, phone, whatsapp, social_handle into v_prof from profiles where id = v_lead.consumer_id;
  select email into v_email from auth.users where id = v_lead.consumer_id;

  v_phone  := coalesce(nullif(btrim(v_lead.consumer_phone), ''), nullif(btrim(v_prof.phone), ''), nullif(btrim(v_prof.whatsapp), ''));
  v_email  := nullif(btrim(coalesce(v_email, '')), '');
  v_handle := nullif(btrim(coalesce(v_prof.social_handle, '')), '');

  if v_phone  is not null then v_bits := v_bits || v_phone;  end if;
  if v_email  is not null then v_bits := v_bits || v_email;  end if;
  if v_handle is not null then v_bits := v_bits || v_handle; end if;
  v_contact := case when cardinality(v_bits) = 0 then 'none on file yet' else array_to_string(v_bits, ', ') end;

  -- 3. what Tayo reached
  v_neg := v_lead.preferences -> 'negotiation';
  v_cur := coalesce(v_prop.currency, 'NGN');
  if v_neg is not null and (v_neg ->> 'offer') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_offer := (v_neg ->> 'offer')::numeric;
  end if;
  v_listed := case when v_prop.price is not null then public.format_money(v_prop.price, v_cur) end;
  v_agreed := case
    when v_offer is not null and v_listed is not null then public.format_money(v_offer, v_cur) || ' (listed ' || v_listed || ')'
    when v_offer is not null then public.format_money(v_offer, v_cur)
    else 'no agreed price yet' end;

  v_vars := jsonb_build_object(
    'buyer_name', coalesce(nullif(btrim(v_lead.consumer_name), ''), 'the buyer'),
    'listing',    v_prop.title,
    'agreed',     v_agreed,
    'contact',    v_contact);
  v_text := public.render_whatsapp_template('handoff_negotiation_taken_over', v_vars);

  -- 4. the WhatsApp: to the agent who took over, and to nobody else. No number on file means no message, said plainly.
  select nullif(btrim(phone), '') into v_my_phone from profiles where id = v_me;
  if v_my_phone is null then
    v_wa := 'no_phone';
  elsif exists (select 1 from message_outbox
                 where lead_id = p_lead_id and template_key = 'handoff_negotiation_taken_over'
                   and to_phone = v_my_phone and status in ('queued', 'sending', 'sent')) then
    v_wa := 'already_queued';
  else
    begin
      insert into message_outbox (agency_id, lead_id, to_phone, body, template_key, template_vars, created_by)
      values (v_lead.agency_id, p_lead_id, v_my_phone, v_text, 'handoff_negotiation_taken_over', v_vars, v_me);
      v_wa := 'queued';
    exception when others then
      raise warning 'take_over_lead: % (lead %)', sqlerrm, p_lead_id;
      v_wa := 'failed';
    end;
  end if;

  return jsonb_build_object(
    'lead_id',   p_lead_id,
    'buyer',     jsonb_build_object('name', coalesce(nullif(btrim(v_lead.consumer_name), ''), 'Unnamed buyer'),
                                    'phone', v_phone, 'email', v_email, 'handle', v_handle),
    'listing',   v_prop.title,
    'listed',    v_listed,
    'agreed',    case when v_offer is not null then public.format_money(v_offer, v_cur) end,
    'advice',    v_neg ->> 'advice',
    'draft',     v_neg ->> 'draft',
    'whatsapp',  v_wa,
    'message',   v_text);
end;
$function$;

revoke all on function public.take_over_lead(uuid) from public;
revoke all on function public.take_over_lead(uuid) from anon;
grant execute on function public.take_over_lead(uuid) to authenticated;

create or replace function public.my_handoff_status()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(x order by (x->>'since') desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'lead_id',  l.id,
      'listing',  coalesce(nullif(btrim(p.title), ''), 'a home'),
      'agency',   coalesce(nullif(btrim(a.name), ''), 'the agency'),
      'stage',    case when l.taken_over_at is not null then 'taken_over'
                       when l.assigned_agent_id is not null then 'with_agent'
                       else 'sent' end,
      'since',    coalesce(l.taken_over_at, l.created_at)) as x
    from leads l
    left join properties p on p.id = l.property_id
    left join agencies a on a.id = l.agency_id
    where l.consumer_id = auth.uid() and l.deleted_at is null
    order by l.created_at desc
    limit 5
  ) s;
$function$;

revoke all on function public.my_handoff_status() from public;
revoke all on function public.my_handoff_status() from anon;
grant execute on function public.my_handoff_status() to authenticated;
