-- A social account records how it was connected.
--
-- Instagram can be reached two ways, BOTH of which we need:
--
--   Instagram Login    a standalone professional account with no Facebook
--                      Page. Token from api.instagram.com, accepted only by
--                      graph.instagram.com.
--   Facebook Login     the professional account LINKED to a Facebook Page.
--                      The token is the PAGE's, from graph.facebook.com, and
--                      graph.instagram.com rejects it.
--
-- Same platform, same table, same publishing code -- and a token from one
-- host is simply refused by the other, with an auth error that says nothing
-- about the real cause. social_accounts had nowhere to record which, because
-- only one path existed when it was written.
--
-- This column is what lets both exist at once. Greenlight's Instagram is
-- linked to a Page, so theirs arrives through Facebook Login -- one dialog,
-- both accounts. An agency with Instagram and no Page still gets the
-- standalone flow, which is already written and needs only the Instagram
-- product configured.
--
-- DEFAULT 'instagram_login' is the honest default for the only code that
-- existed when the column was added, and there are no rows to migrate:
-- social_accounts is empty. Defaulting to facebook_login would be a guess
-- about a history that never happened.

alter table public.social_accounts
  add column if not exists auth_source text not null default 'instagram_login'
    check (auth_source in ('instagram_login', 'facebook_login'));

comment on column public.social_accounts.auth_source is
  'Which OAuth flow issued this token, and therefore which Graph host accepts '
  'it. instagram_login -> graph.instagram.com. facebook_login -> '
  'graph.facebook.com with a Page token. The publisher reads this; sending a '
  'token to the wrong host fails with an error that does not mention the host.';

-- ── connect_social_account gains the parameter ───────────────────────────
--
-- The body below is 0055's, unchanged except for the new argument and the two
-- lines that carry it. It is repeated in full because CREATE OR REPLACE takes
-- a whole function, and reproducing it is the only way to keep the vault
-- handling, the owner/admin check and the soft-delete-then-insert exactly as
-- they are. Every one of those is load-bearing:
--
--   · the token goes to vault.create_secret and only a REF is stored
--   · the guard is narrower than membership -- owners and admins only,
--     because a social account is a credential for the whole agency
--   · reconnecting soft-deletes the old row first, so two rows never hold a
--     live token for one account
--
-- A rewrite from memory would have dropped all three. This one did, in draft,
-- before the original was read.

create or replace function public.connect_social_account(
  p_agency_id       uuid,
  p_platform        social_platform,
  p_account_id      text,
  p_username        text,
  p_access_token    text,
  p_refresh_token   text default null,
  p_expires_at      timestamptz default null,
  p_scopes          text[] default '{}',
  p_connected_by    uuid default null,
  p_auth_source     text default 'instagram_login'
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

  if p_auth_source not in ('instagram_login', 'facebook_login') then
    raise exception 'Unknown auth source: %', p_auth_source
      using errcode = 'invalid_parameter_value';
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
    is_active, connected_at, connected_by, auth_source)
  values (
    p_agency_id, p_platform, p_account_id, p_username,
    v_access_ref, v_refresh_ref, p_expires_at, coalesce(p_scopes, '{}'), true, now(), v_actor,
    p_auth_source)
  returning id into v_id;

  return v_id;
end;
$$;

-- The 9-argument signature is now shadowed by the 10-argument one. Dropped for
-- the same reason 0055 dropped the 8: one connect path, not an old one still
-- callable and now missing the column that decides which Graph host is used.
drop function if exists public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[], uuid);

revoke all on function public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[], uuid, text) from public, anon, authenticated;
grant execute on function public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[], uuid, text) to service_role;
