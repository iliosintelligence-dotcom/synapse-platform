-- The other handoffs: a viewing booked, and a lead handed to someone new.
--
-- handoff_negotiation_limit is deliberately NOT wired. It needs an offer to
-- compare against a floor the agency authorised, and no such column exists --
-- floor_level, total_floors and floor_size_sqm are all about buildings. The
-- template is written and ready; when the negotiator stores a floor, the call
-- is queue_agent_handoff_template(lead, 'handoff_negotiation_limit', ...).
-- Inventing a trigger over data that does not exist would produce a handoff
-- that either never fires or fires on the wrong thing.

-- ── one place that decides who a handoff reaches ─────────────────────────
-- notify_agent_of_new_lead had this inline. Three triggers resolving a
-- recipient three times is three chances to drift, and the drift would be
-- silent: a message that goes to the wrong person still looks delivered.
create or replace function public.handoff_phone_for(p_agent_id uuid, p_agency_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_phone text;
begin
  if p_agent_id is not null then
    select nullif(btrim(p.phone), '') into v_phone
    from profiles p where p.id = p_agent_id;
  end if;

  if v_phone is null then
    select nullif(btrim(p.phone), '') into v_phone
    from profiles p
    join agency_members m on m.profile_id = p.id
    where m.agency_id = p_agency_id
      and m.role = 'agency_owner'
      and m.deleted_at is null
      and nullif(btrim(p.phone), '') is not null
    limit 1;
  end if;

  return v_phone;
end;
$function$;

-- ── a viewing was booked ─────────────────────────────────────────────────
create or replace function public.notify_agent_of_viewing()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_phone   text;
  v_name    text;
  v_listing text;
  v_when    text;
  v_vars    jsonb;
begin
  -- Only a viewing that is still ahead of somebody. completed, cancelled and
  -- no_show are records of something that already happened, and an agency
  -- logging last month's viewings should not fire a month of notifications.
  if new.status not in ('requested', 'scheduled', 'confirmed') then
    return new;
  end if;

  -- The viewing carries its own agent, which is more specific than the one on
  -- the lead: whoever is actually showing the property is the person who has
  -- to be at the door.
  v_phone := public.handoff_phone_for(
    coalesce(new.agent_id, (select l.assigned_agent_id from leads l where l.id = new.lead_id)),
    new.agency_id);
  if v_phone is null then
    return new;
  end if;

  select coalesce(nullif(btrim(l.consumer_name), ''), 'A buyer')
    into v_name from leads l where l.id = new.lead_id;
  v_name := coalesce(v_name, 'A buyer');

  select coalesce(nullif(btrim(pr.title), ''), 'one of your listings')
    into v_listing from properties pr where pr.id = new.property_id;
  v_listing := coalesce(v_listing, 'one of your listings');

  -- Lagos time, because that is where the person has to be. A UTC timestamp
  -- would send somebody to a house an hour early.
  if new.scheduled_at is null then
    v_when := 'a time still to be agreed';
  else
    v_when := trim(to_char(new.scheduled_at at time zone 'Africa/Lagos',
                           'FMDay FMDD FMMonth, FMHH12:MIam'));
  end if;

  v_vars := jsonb_build_object('buyer_name', v_name, 'listing', v_listing, 'when', v_when);

  begin
    insert into message_outbox (agency_id, lead_id, to_phone, body,
                                template_key, template_vars)
    values (new.agency_id, new.lead_id, v_phone,
            public.render_whatsapp_template('handoff_viewing_booked', v_vars),
            'handoff_viewing_booked', v_vars);
  exception when others then
    -- A booking is worth more than its notification, same as a lead.
    raise warning 'notify_agent_of_viewing: % (viewing %)', sqlerrm, new.id;
  end;

  return new;
end;
$function$;

drop trigger if exists viewings_notify_agent on public.viewings;
create trigger viewings_notify_agent
  after insert on public.viewings
  for each row execute function public.notify_agent_of_viewing();

-- ── a lead was handed to someone ─────────────────────────────────────────
create or replace function public.notify_agent_of_assignment()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_phone   text;
  v_name    text;
  v_listing text;
  v_vars    jsonb;
begin
  -- UPDATE only, and only a real change of hands. A lead is auto-assigned as
  -- it is created and handoff_new_lead already covers that moment -- firing
  -- here as well would tell the same person the same thing twice.
  if new.assigned_agent_id is null
     or new.assigned_agent_id is not distinct from old.assigned_agent_id then
    return new;
  end if;

  -- The NEW owner, and only them. The agency owner is not a fallback here:
  -- "a lead has been assigned to you" is untrue of somebody who was not
  -- assigned it, and the assignment is the whole subject of the message.
  select nullif(btrim(p.phone), '') into v_phone
  from profiles p where p.id = new.assigned_agent_id;
  if v_phone is null then
    return new;
  end if;

  v_name := coalesce(nullif(btrim(new.consumer_name), ''), 'A buyer');

  select coalesce(nullif(btrim(pr.title), ''), 'one of your listings')
    into v_listing from properties pr where pr.id = new.property_id;
  v_listing := coalesce(v_listing, 'one of your listings');

  v_vars := jsonb_build_object('buyer_name', v_name, 'listing', v_listing);

  begin
    insert into message_outbox (agency_id, lead_id, to_phone, body,
                                template_key, template_vars)
    values (new.agency_id, new.id, v_phone,
            public.render_whatsapp_template('handoff_lead_assigned', v_vars),
            'handoff_lead_assigned', v_vars);
  exception when others then
    raise warning 'notify_agent_of_assignment: % (lead %)', sqlerrm, new.id;
  end;

  return new;
end;
$function$;

drop trigger if exists leads_notify_assignment on public.leads;
create trigger leads_notify_assignment
  after update of assigned_agent_id on public.leads
  for each row execute function public.notify_agent_of_assignment();

-- ── and the first one, using the shared resolver ─────────────────────────
create or replace function public.notify_agent_of_new_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_phone   text;
  v_name    text;
  v_listing text;
  v_budget  text;
  v_vars    jsonb;
begin
  v_phone := public.handoff_phone_for(new.assigned_agent_id, new.agency_id);

  -- Nobody reachable. The lead is still a lead: it is visible in the CRM and
  -- can be worked. Refusing the insert because an agent has not filled in a
  -- phone number would throw away the enquiry to protect the notification,
  -- which is exactly backwards.
  if v_phone is null then
    return new;
  end if;

  v_name := coalesce(nullif(btrim(new.consumer_name), ''), 'A buyer');

  select coalesce(nullif(btrim(pr.title), ''), 'one of your listings')
    into v_listing from properties pr where pr.id = new.property_id;
  v_listing := coalesce(v_listing, 'one of your listings');

  -- budget_range is what a person typed; the numbers are the fallback.
  v_budget := nullif(btrim(coalesce(new.budget_range, '')), '');
  if v_budget is null and new.budget_max is not null then
    v_budget := trim(to_char(new.budget_max, 'FM999,999,999,999'));
    if new.budget_min is not null then
      v_budget := trim(to_char(new.budget_min, 'FM999,999,999,999')) || ' to ' || v_budget;
    end if;
  end if;
  v_budget := coalesce(v_budget, 'not stated');

  v_vars := jsonb_build_object('buyer_name', v_name, 'listing', v_listing, 'budget', v_budget);

  begin
    insert into message_outbox (agency_id, lead_id, to_phone, body,
                                template_key, template_vars)
    values (new.agency_id, new.id, v_phone,
            public.render_whatsapp_template('handoff_new_lead', v_vars),
            'handoff_new_lead', v_vars);
  exception when others then
    raise warning 'notify_agent_of_new_lead: % (lead %)', sqlerrm, new.id;
  end;

  return new;
end;
$function$;

-- 13 September 2026 is a Sunday. The sample said Saturday -- harmless in
-- itself, and exactly the kind of inconsistency a reviewer stops on.
update public.whatsapp_templates
   set variables = '[{"name":"buyer_name","example":"Chinaza Obi"},
                     {"name":"listing","example":"Bodija Park 3-Bedroom Flat"},
                     {"name":"when","example":"Saturday 12 September, 11:00am"}]'::jsonb
 where key = 'handoff_viewing_booked' and status = 'draft';
