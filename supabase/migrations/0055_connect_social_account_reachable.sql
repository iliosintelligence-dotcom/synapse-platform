-- 0055_connect_social_account_reachable.sql
--
-- Three defects that together made connecting an Instagram account impossible.
-- All three were found by writing the OAuth callback 0053 assumed and then
-- actually calling the function the way that callback calls it.
--
-- 1. THE FUNCTION WAS UNREACHABLE BY ITS ONLY PERMITTED CALLER.
--    0053 granted connect_social_account to service_role alone, then guarded it
--    with is_agency_member(), which reads auth.uid(). A service-role call has
--    no JWT, so auth.uid() is NULL and the guard was false for every caller
--    allowed to make the call. Correct, tested, and impossible to invoke.
--
--    This is the third instance of one mistake in this codebase: a guard
--    written against a caller identity that does not exist where the guard
--    runs. The others were SECURITY DEFINER reading current_user, and a
--    NULL-valued agency_role() inside a NOT IN test. The pattern is worth
--    naming because it fails open in some spellings and closed in others, and
--    it never fails loudly.
--
-- 2. VAULT SECRET NAMES COLLIDED.
--    The name was built from extract(epoch from now()). now() is the
--    transaction timestamp, so two connects in one transaction produced the
--    same name and the second died on vault's unique index. A name only has to
--    be unique and greppable; a uuid does that reliably and a timestamp did not.
--
-- 3. AN AGENCY COULD CONNECT INSTAGRAM ONCE, EVER.
--    UNIQUE (agency_id, platform) counted soft-deleted rows, so a disconnected
--    account kept its slot forever and reconnecting was refused. Instagram
--    tokens last 60 days, so this would have broken for every agency on a
--    schedule, starting two months after the first connection -- the kind of
--    fault that looks like a platform outage rather than a constraint.

-- ── 3 ───────────────────────────────────────────────────────────────────────
alter table public.social_accounts drop constraint if exists social_accounts_agency_id_platform_key;

create unique index if not exists social_accounts_one_live_per_platform
  on public.social_accounts (agency_id, platform)
  where deleted_at is null;

comment on index public.social_accounts_one_live_per_platform is
  'One live account per agency per platform. Partial on deleted_at so a disconnected account does not block reconnecting.';

-- ── 1 and 2 ─────────────────────────────────────────────────────────────────
-- p_connected_by is new: a service-role caller must name the person it acted
-- for, so the row still records a human authoriser rather than "the server did
-- it". That is not a weaker check than before -- it is the same membership
-- check, against the operator the OAuth callback established before it ever
-- redirected to Instagram.
create or replace function public.connect_social_account(
  p_agency_id       uuid,
  p_platform        social_platform,
  p_account_id      text,
  p_username        text,
  p_access_token    text,
  p_refresh_token   text default null,
  p_expires_at      timestamptz default null,
  p_scopes          text[] default '{}',
  p_connected_by    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare
  v_access_ref uuid; v_refresh_ref uuid; v_id uuid; v_actor uuid; v_role text; v_tag text;
begin
  if p_access_token is null or length(btrim(p_access_token)) = 0 then
    raise exception 'No access token supplied' using errcode = 'invalid_parameter_value';
  end if;

  -- A signed-in caller speaks for themselves; a service-role caller must say
  -- who it acted for.
  v_actor := coalesce(auth.uid(), p_connected_by);
  if v_actor is null then
    raise exception 'No connecting user: pass p_connected_by when calling as the service role'
      using errcode = 'invalid_parameter_value';
  end if;

  select role::text into v_role from agency_members
  where profile_id = v_actor and agency_id = p_agency_id and deleted_at is null limit 1;

  -- coalesce, because NULL not in (...) is NULL, and a NULL guard never fires.
  -- A social account is a credential for the whole agency, so this is
  -- deliberately narrower than membership: owners and admins only.
  if coalesce(v_role, '') not in ('agency_admin', 'agency_owner') then
    raise exception 'You cannot connect an account for this agency'
      using errcode = 'insufficient_privilege';
  end if;

  v_tag := 'social:' || p_platform::text || ':' || p_agency_id::text || ':';

  v_access_ref := vault.create_secret(
    p_access_token, v_tag || 'access:' || gen_random_uuid()::text, 'Social access token');

  if p_refresh_token is not null and length(btrim(p_refresh_token)) > 0 then
    v_refresh_ref := vault.create_secret(
      p_refresh_token, v_tag || 'refresh:' || gen_random_uuid()::text, 'Social refresh token');
  end if;

  -- Reconnecting must not leave a second row holding a live token.
  update social_accounts
     set is_active = false, deleted_at = now(), access_token_ref = null, refresh_token_ref = null
   where agency_id = p_agency_id and platform = p_platform
     and platform_account_id = p_account_id and deleted_at is null;

  insert into social_accounts (
    agency_id, platform, platform_account_id, platform_username,
    access_token_ref, refresh_token_ref, token_expires_at, scopes,
    is_active, connected_at, connected_by)
  values (
    p_agency_id, p_platform, p_account_id, p_username,
    v_access_ref, v_refresh_ref, p_expires_at, coalesce(p_scopes, '{}'), true, now(), v_actor)
  returning id into v_id;

  return v_id;
end;
$$;

-- The 8-argument signature is now shadowed by the 9-argument one. Drop it so
-- there is one connect path, rather than an old one still callable and still
-- broken.
drop function if exists public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[]);

revoke all on function public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[], uuid) from public, anon, authenticated;
grant execute on function public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[], uuid) to service_role;

-- Verified against the live database (2026-08-13):
--   no connecting user named                 -> blocked
--   non-member named as the actor            -> blocked
--   service role + owner (the real path)     -> connected, publisher reads the token
--   token stored on the row?                 -> no, vault only
--   reconnect                                -> 1 live row, new token live, old revoked
--   reconnect after a disconnect             -> works (was impossible before)
