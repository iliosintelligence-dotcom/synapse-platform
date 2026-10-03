-- WhatsApp is for Toju-to-agent handoffs, and for nothing else.
--
-- queue_lead_message read leads.consumer_phone: every message this platform
-- could send on WhatsApp went to a BUYER. That is now out of scope. The queue,
-- the retry ladder, the atomic claim and the drain are all fine and stay --
-- what changes is who receives, and that is a one-function change.

-- ── who a handoff actually goes to ───────────────────────────────────────
-- The assigned agent, and failing that whoever owns the agency. Named as a
-- function of its own so the UI can say who will receive a message BEFORE it
-- is queued -- "this goes to Bola" is the difference between a considered
-- send and a hopeful one.
--
-- Returns no phone number. The caller does not need it and should not have
-- it: an agency admin can already see their own team, but a phone number
-- handed to the browser is a phone number in a page.
create or replace function public.lead_handoff_target(p_lead_id uuid)
returns table (recipient_name text, source text, reachable boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_agency uuid;
  v_agent  uuid;
begin
  select agency_id, assigned_agent_id into v_agency, v_agent
  from leads where id = p_lead_id and deleted_at is null;

  if v_agency is null then
    raise exception 'Lead not found' using errcode = 'no_data_found';
  end if;
  if coalesce(agency_role(v_agency)::text, '') not in
     ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot see this agency''s leads'
      using errcode = 'insufficient_privilege';
  end if;

  if v_agent is not null then
    return query
      select coalesce(p.full_name, 'The assigned agent'), 'assigned_agent',
             coalesce(btrim(p.phone), '') <> ''
      from profiles p where p.id = v_agent;
    if found then return; end if;
  end if;

  -- nobody assigned: the owner is the one who has to pick it up
  return query
    select coalesce(p.full_name, 'The agency owner'), 'agency_owner',
           coalesce(btrim(p.phone), '') <> ''
    from profiles p
    join agency_members m on m.profile_id = p.id
    where m.agency_id = v_agency
      and m.role = 'agency_owner'
      and m.deleted_at is null
    limit 1;
end;
$function$;

-- ── the handoff itself ───────────────────────────────────────────────────
create or replace function public.queue_agent_handoff(p_lead_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_agency uuid;
  v_agent  uuid;
  v_phone  text;
  v_id     uuid;
begin
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'Message body is empty' using errcode = 'invalid_parameter_value';
  end if;
  if length(p_body) > 1000 then
    raise exception 'Message is too long (max 1000 characters)' using errcode = 'invalid_parameter_value';
  end if;

  select agency_id, assigned_agent_id into v_agency, v_agent
  from leads where id = p_lead_id and deleted_at is null;

  if v_agency is null then
    raise exception 'Lead not found' using errcode = 'no_data_found';
  end if;

  -- coalesce: agency_role() is NULL for a non-member, and NULL compared with
  -- anything is NULL, which would skip a negative guard entirely.
  if coalesce(agency_role(v_agency)::text, '') not in
     ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot message this agency''s team'
      using errcode = 'insufficient_privilege';
  end if;

  -- The agent's own number, from profiles. Never the lead's.
  if v_agent is not null then
    select btrim(p.phone) into v_phone from profiles p where p.id = v_agent;
  end if;

  if v_phone is null or v_phone = '' then
    select btrim(p.phone) into v_phone
    from profiles p
    join agency_members m on m.profile_id = p.id
    where m.agency_id = v_agency
      and m.role = 'agency_owner'
      and m.deleted_at is null
      and coalesce(btrim(p.phone), '') <> ''
    limit 1;
  end if;

  if v_phone is null or v_phone = '' then
    raise exception 'Nobody on this team has a phone number on file, so there is no one to hand this lead to'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into message_outbox (agency_id, lead_id, to_phone, body, created_by)
  values (v_agency, p_lead_id, v_phone, btrim(p_body), auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

-- ── the buyer path, closed ───────────────────────────────────────────────
-- Left in place and made to refuse rather than dropped. Dropping it would
-- give a caller "function does not exist", which reads like a deployment
-- fault and invites someone to recreate it. This says what happened and why.
create or replace function public.queue_lead_message(p_lead_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  raise exception 'Synapse does not send WhatsApp messages to buyers. WhatsApp carries Toju-to-agent handoffs only -- use queue_agent_handoff(), which sends to the assigned agent.'
    using errcode = 'insufficient_privilege';
end;
$function$;

revoke all on function public.queue_lead_message(uuid, text) from public;
revoke all on function public.queue_lead_message(uuid, text) from anon;
