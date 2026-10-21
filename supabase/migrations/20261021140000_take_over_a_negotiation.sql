-- TAKE OVER A NEGOTIATION (Eden, 2026-10-21).
--
-- "Take over" on a Tayo Deal Report was a button that changed its own label and did nothing else: nothing saved,
-- nothing sent. It now hands the lead to the agent who pressed it, returns the handover summary (the buyer's phone,
-- email and social handle, what Tayo agreed, and how it got there), and queues the same summary on WhatsApp to THAT
-- agent. WhatsApp still goes to the agent only, never to the buyer (0082).
--
-- WHERE EACH THING COMES FROM
--   phone   leads.consumer_phone, else the buyer's profile (phone, then whatsapp)
--   email   auth.users, read here on the server for a member of the lead's own agency. It is not copied anywhere.
--   handle  profiles.social_handle, which the buyer adds themselves on Tayo's handover card (set_my_social_handle).
--           Nothing asked for one before, so no buyer has one yet.
-- Whatever the buyer has not given is left out of the message; it is never invented.
--
-- SENDING. The message waits in message_outbox like every other handoff. It leaves once the template below is approved
-- by Meta, Twilio is set up, and the agent has a phone number on file. Until then the portal still shows the summary.

-- ── 1. the buyer's social handle ──────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists social_handle text;
alter table public.profiles drop constraint if exists profiles_social_handle_shape;
alter table public.profiles add constraint profiles_social_handle_shape
  check (social_handle is null or char_length(social_handle) between 2 and 80);

-- Stored the way an agent would type it: a pasted profile link becomes the handle, a bare handle gets its @.
-- Clearing it is allowed. Written through here, not straight to the table, so every path normalises the same way.
create or replace function public.set_my_social_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  v := btrim(coalesce(p_handle, ''));
  v := regexp_replace(v, '^(https?://)?(www\.)?(instagram\.com|tiktok\.com|facebook\.com|x\.com|twitter\.com)/', '', 'i');
  v := btrim(regexp_replace(v, '[/?#].*$', ''));

  if v = '' then
    update profiles set social_handle = null where id = auth.uid();
    return null;
  end if;

  -- no control characters or markup, and a length a person could actually type. A WhatsApp template variable may not
  -- contain a newline either, so one is refused here rather than at the provider.
  if v ~ '[[:cntrl:]<>{}]' or char_length(v) > 80 then
    raise exception 'That does not look like a social media handle'
      using errcode = 'invalid_parameter_value';
  end if;

  if v ~ '^[A-Za-z0-9._]{2,40}$' then
    v := '@' || v;
  end if;

  update profiles set social_handle = v where id = auth.uid();
  return v;
end;
$function$;

revoke all on function public.set_my_social_handle(text) from public;
revoke all on function public.set_my_social_handle(text) from anon;
grant execute on function public.set_my_social_handle(text) to authenticated;

-- ── 2. the WhatsApp template (a draft until Meta approves it) ──────────────────────────────────────────────
-- {{4}} is the buyer's contact as one line: phone, email and handle, whichever exist.
insert into public.whatsapp_templates (key, category, language, body, variables, status)
values (
  'handoff_negotiation_taken_over', 'UTILITY', 'en',
  'You took over the negotiation with {{1}} for {{2}}. Tayo reached {{3}}. Their contact: {{4}}. Open Synapse for the full report.',
  '[{"name":"buyer_name","example":"Chinaza Obi"},
    {"name":"listing","example":"Bodija Park 3-Bedroom Flat"},
    {"name":"agreed","example":"N48,000,000 (listed N52,000,000)"},
    {"name":"contact","example":"+2348031234567, chinaza@example.com, @chinaza.homes"}]'::jsonb,
  'draft')
on conflict (key) do nothing;

-- ── 3. the take-over ────────────────────────────────────────────────────────────────────────────────────────────
-- Silences the generic "a lead was assigned to you" message for the assignment this function makes, because the message
-- this function queues says more and goes to the same person. Everything else about that trigger is unchanged.
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
  -- take_over_lead() sends its own, fuller message to the same person for this assignment.
  if current_setting('synapse.take_over', true) = 'on' then
    return new;
  end if;

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


-- A lead's take-over. Callable by a member of the lead's agency; an agent may not take a lead a teammate already holds (an
-- admin or the owner may). Returns the handover summary so the portal can show it at once, and says what happened to the WhatsApp.
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

-- ── 4. erasure removes the handle too ─────────────────────────────────────────────────────────────────────
-- The same function as before with one more field cleared. (In 'full' mode the whole profile row is deleted.)
create or replace function erase_personal_data(
  p_profile_id uuid,
  p_reason     text default 'data subject request (NDPA s.34)',
  p_mode       text default 'anonymise'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   text;
  v_exists  boolean;
  v_counts  jsonb;
  n_cp int := 0; n_aa int := 0; n_pl int := 0; n_fi int := 0;
  n_cs int := 0; n_ld int := 0; n_px int := 0;
begin
  if p_mode not in ('anonymise', 'full') then
    raise exception 'Unknown erasure mode: %', p_mode
      using hint = 'Use ''anonymise'' (default) or ''full''.';
  end if;

  if auth.uid() is not null and auth.uid() = p_profile_id then
    v_actor := 'self';
  elsif auth.role() = 'service_role' then
    v_actor := 'service_role';
  else
    raise exception 'Not permitted to erase that subject'
      using hint = 'Only the data subject or the service role may call this.';
  end if;

  select exists(select 1 from profiles where id = p_profile_id) into v_exists;
  if not v_exists then
    return jsonb_build_object('erased', false, 'reason', 'no such subject');
  end if;

  perform set_config('synapse.erasure', 'on', true);

  /* ── the sensitive categories, removed in both modes ──────────────── */
  delete from consumer_profiles      where consumer_id = p_profile_id;
  get diagnostics n_cp = row_count;
  delete from affordability_analyses where user_id     = p_profile_id;
  get diagnostics n_aa = row_count;
  delete from consumer_places        where consumer_id = p_profile_id;
  get diagnostics n_pl = row_count;
  delete from financial_identities   where id          = p_profile_id;
  get diagnostics n_fi = row_count;
  delete from chat_sessions          where consumer_id = p_profile_id;
  get diagnostics n_cs = row_count;
  delete from proximity_events       where user_id     = p_profile_id;
  get diagnostics n_px = row_count;

  if p_mode = 'full' then
    /* The statutory route. One delete; the cascades do the rest, and the
       flag above is what lets them through the append-only triggers. */
    delete from profiles where id = p_profile_id;
    v_counts := jsonb_build_object(
      'mode', 'full', 'consumer_profiles', n_cp, 'affordability_analyses', n_aa,
      'consumer_places', n_pl, 'financial_identities', n_fi,
      'chat_sessions', n_cs, 'proximity_events', n_px, 'profile_deleted', 1);
  else
    /* ── the policy: the record of the introduction survives, the person
       in it does not. An agency keeps which property, which agency, when
       and what stage; it does not keep who, or what they could afford. */
    update leads set
      consumer_name  = 'Removed at request',
      consumer_phone = null,
      preferences    = null,
      budget_range   = null,
      budget_min     = null,
      budget_max     = null
    where consumer_id = p_profile_id;
    get diagnostics n_ld = row_count;

    /* The shell stays so the login still resolves to something. role is
       kept because it is about the account, not the person. */
    update profiles set
      full_name  = 'Removed at request',
      phone      = null,
      whatsapp   = null,
      avatar_url = null,
      social_handle = null
    where id = p_profile_id;

    v_counts := jsonb_build_object(
      'mode', 'anonymise', 'consumer_profiles', n_cp, 'affordability_analyses', n_aa,
      'consumer_places', n_pl, 'financial_identities', n_fi,
      'chat_sessions', n_cs, 'proximity_events', n_px, 'leads_anonymised', n_ld,
      'account_kept', true);
  end if;

  insert into erasure_log (subject_hash, actor, reason, row_counts)
  values (encode(sha256(p_profile_id::text::bytea), 'hex'), v_actor, p_reason, v_counts);

  return jsonb_build_object('erased', true, 'counts', v_counts);
end;
$$;
