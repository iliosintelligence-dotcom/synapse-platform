-- Erasure anonymises: the account survives, the person in it does not.
--
-- DECISION (Eden, 2026-09-19): keep personal data, not sensitive personal
-- data. Email and login stay. Agency details and the legal documents filed
-- for verification stay. Everything else becomes anonymous.
--
-- That is a coherent policy and it is NOT what the previous version did --
-- erase_personal_data() deleted the profiles row and let the cascades take
-- everything with it. This replaces that with anonymisation, and adds a mode
-- for the case the policy does not cover.
--
-- ── what is kept ─────────────────────────────────────────────────────────
--
--   auth.users            email and login, untouched. Note profiles has no
--                         email column at all -- it lives in auth.users, so
--                         "keep the email" costs nothing here and always did.
--   profiles.id, role     the shell the account hangs on
--   agencies, documents,  business records with their own basis. An agency's
--   agency_verification*  verification file is evidence we did the checks we
--                         publish, and it is not the agent's private life.
--   leads (the row)       the agency's record that an introduction happened:
--                         which property, which agency, when, what stage.
--
-- ── what goes ────────────────────────────────────────────────────────────
--
-- Sensitive, purged outright rather than blanked, because a row of nulls in
-- consumer_profiles still says "this person answered our questions":
--
--   consumer_profiles      income, occupation, age, marital status, children,
--                          future children, elderly dependents, school budget
--   affordability_analyses declared income, debts, monthly expenses
--   consumer_places        home and work coordinates -- and kind='worship',
--                          which is religious belief and is sensitive
--                          personal data in its own right under the NDPA
--   financial_identities   trust and reliability scores (cascades into
--                          score_component_history, which is append-only and
--                          needs the erasure flag)
--   chat_sessions          the transcripts, which contain every category
--                          above in the person's own words. Anonymising the
--                          columns around them and leaving the conversation
--                          would be theatre.
--
-- Identifying, blanked on rows that must survive:
--
--   profiles               full_name, phone, whatsapp, avatar_url
--   leads                  consumer_name, consumer_phone, preferences,
--                          budget_range, budget_min, budget_max
--
-- ── the part worth being plain about ─────────────────────────────────────
--
-- Keeping the email means the person is still identifiable to us. Under NDPA
-- s.34 a data subject asking to be erased is, in the ordinary case, asking
-- for that too -- and "we kept your login" is not an answer to it unless
-- another lawful basis covers the account itself. The policy above is a
-- sound DEFAULT and it is not a complete answer to every request.
--
-- So there are two modes rather than one, and the statutory route stays open:
--
--   'anonymise'  the default and the policy: account kept, person removed
--   'full'       everything, including the profiles row and its cascades
--
-- A page offering only the first must not call it deletion. your-data.html
-- is being reworded in the same change.

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
      avatar_url = null
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

/* The three-argument signature replaces the two-argument one rather than
   sitting beside it: two overloads would let an old caller quietly get the
   old behaviour, and the old behaviour is the policy we just changed. */
drop function if exists erase_personal_data(uuid, text);

revoke all on function erase_personal_data(uuid, text, text) from public;
revoke execute on function erase_personal_data(uuid, text, text) from anon;
grant execute on function erase_personal_data(uuid, text, text) to authenticated;

comment on function erase_personal_data(uuid, text, text) is
  'Honours an erasure request. Default mode ''anonymise'' keeps the account '
  '(email and login live in auth.users) and the agency''s record that an '
  'introduction happened, and removes every sensitive category and every '
  'identifier attached to the person. Mode ''full'' deletes the profile and '
  'its cascades, which is what NDPA s.34 asks for in the ordinary case. '
  'Neither mode touches auth.users -- that needs the Auth admin API.';
