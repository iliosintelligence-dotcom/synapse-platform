-- 0070_provision_agency_for_oauth_signups.sql
--
-- THE GAP THIS CLOSES
-- handle_new_user reads the intended role from raw_user_meta_data, which the
-- email signup form supplies. An OAuth signup cannot: signInWithOAuth has no
-- way to pass user metadata, and what Google returns is a name, an email and a
-- picture. So `role` is absent, the trigger's else-branch fires, and every
-- business signing in with Google becomes a `consumer` with no agencies row
-- and no membership.
--
-- The result is an agency that owns nothing: the portal's role gate refuses
-- them, no listing can be attributed to them, and nothing in the product can
-- repair it. Until now the only fix was an admin editing rows by hand.
--
-- This is the repair, and it is deliberately a one-way door that can only be
-- walked by somebody who has nowhere else to stand.
--
-- WHY IT IS SAFE TO EXPOSE TO `authenticated`
-- It is security definer, so it must assume the caller is hostile. Three
-- guards, all server-side:
--   1. It acts only on auth.uid(). No id is taken from the caller.
--   2. It refuses if the caller is already a member of ANY agency. An agent at
--      one agency therefore cannot use it to mint a second agency, and calling
--      it twice is a no-op error rather than a second agency.
--   3. It only ever grants agency_owner OF THE AGENCY IT JUST CREATED. There
--      is no argument naming an existing agency, so it cannot be used to join
--      one, and platform_admin is unreachable through it.
--
-- The name is the one thing taken from the caller, because it is the one thing
-- only they know -- exactly as the email path already does.

create or replace function public.provision_agency_for_current_user(
  p_agency_name text,
  p_city        text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text := nullif(btrim(coalesce(p_agency_name, '')), '');
  v_exists int;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in' using errcode = 'insufficient_privilege';
  end if;

  if v_name is null then
    raise exception 'An agency name is required' using errcode = 'invalid_parameter_value';
  end if;

  -- Guard 2. Membership of ANY agency disqualifies: this exists to give an
  -- account its FIRST agency, never a second one.
  select count(*) into v_exists
  from agency_members
  where profile_id = v_uid and deleted_at is null;

  if v_exists > 0 then
    raise exception 'This account already belongs to an agency'
      using errcode = 'unique_violation';
  end if;

  -- Owning one without a membership row would be a half-provisioned account
  -- from some earlier bug; treat it the same way rather than adding a second.
  select count(*) into v_exists from agencies where owner_id = v_uid and deleted_at is null;
  if v_exists > 0 then
    raise exception 'This account already owns an agency'
      using errcode = 'unique_violation';
  end if;

  -- The profile may not exist yet if this is called in the same instant the
  -- account is created; upsert rather than assume ordering.
  insert into profiles (id, role, full_name)
  values (v_uid, 'agency_owner'::user_role, '')
  on conflict (id) do update set role = 'agency_owner'::user_role;

  insert into agencies (owner_id, name, city)
  values (v_uid, v_name, coalesce(nullif(btrim(coalesce(p_city, '')), ''), ''))
  returning id into v_id;

  insert into agency_members (agency_id, profile_id, role)
  values (v_id, v_uid, 'agency_owner');

  return v_id;
end;
$$;

revoke all on function public.provision_agency_for_current_user(text, text) from public, anon;
grant execute on function public.provision_agency_for_current_user(text, text) to authenticated;

comment on function public.provision_agency_for_current_user(text, text) is
  'Gives the CURRENT user their first agency, for signups that could not carry '
  'role metadata (OAuth). Refuses if they already belong to or own one. Grants '
  'agency_owner only over the agency it creates.';
