-- 0053_social_account_token_storage.sql
--
-- Where social access tokens live.
--
-- `social_accounts` had `token_expires_at` but no token column, so there was
-- nowhere for a token to go. That is a decision worth making before the first
-- one arrives rather than after: a plaintext token column is trivial to add
-- under deadline pressure and very hard to walk back once real credentials sit
-- in it, because you cannot un-leak a backup or a log line.
--
-- The token itself goes into Supabase Vault, which is already enabled on this
-- project. The table keeps only the secret's UUID. Clients may read which
-- accounts are connected, when they expire and whether they are active -- they
-- may never read a token, and no client code path returns one.
--
-- syndication.js already states this contract at the top of the file:
-- "Social access tokens NEVER appear in this file or any client file."
-- This is the server half of that promise.

alter table public.social_accounts
  add column if not exists access_token_ref  uuid,
  add column if not exists refresh_token_ref uuid,
  add column if not exists scopes            text[] not null default '{}',
  add column if not exists connected_by      uuid references public.profiles(id),
  add column if not exists last_error        text;

comment on column public.social_accounts.access_token_ref is
  'UUID of the Vault secret holding the access token. The token itself is never stored on this row and is never returned to a client.';
comment on column public.social_accounts.refresh_token_ref is
  'UUID of the Vault secret holding the refresh token, where the provider issues one.';

-- ── connecting an account ───────────────────────────────────────────────────
-- Called by an OAuth callback running with the service role, never from a
-- browser: the token would cross the client if it were. SECURITY DEFINER so it
-- can write to Vault, and it verifies the caller is staff at the agency.
create or replace function public.connect_social_account(
  p_agency_id       uuid,
  p_platform        social_platform,
  p_account_id      text,
  p_username        text,
  p_access_token    text,
  p_refresh_token   text default null,
  p_expires_at      timestamptz default null,
  p_scopes          text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare
  v_access_ref  uuid;
  v_refresh_ref uuid;
  v_id          uuid;
begin
  if p_access_token is null or length(btrim(p_access_token)) = 0 then
    raise exception 'No access token supplied' using errcode = 'invalid_parameter_value';
  end if;

  if not is_agency_member(p_agency_id) then
    raise exception 'You cannot connect an account for this agency'
      using errcode = 'insufficient_privilege';
  end if;

  v_access_ref := vault.create_secret(
    p_access_token,
    'social:' || p_platform::text || ':' || p_agency_id::text || ':access:' || extract(epoch from now())::bigint,
    'Social access token'
  );

  if p_refresh_token is not null and length(btrim(p_refresh_token)) > 0 then
    v_refresh_ref := vault.create_secret(
      p_refresh_token,
      'social:' || p_platform::text || ':' || p_agency_id::text || ':refresh:' || extract(epoch from now())::bigint,
      'Social refresh token'
    );
  end if;

  insert into social_accounts (
    agency_id, platform, platform_account_id, platform_username,
    access_token_ref, refresh_token_ref, token_expires_at, scopes,
    is_active, connected_at, connected_by
  ) values (
    p_agency_id, p_platform, p_account_id, p_username,
    v_access_ref, v_refresh_ref, p_expires_at, coalesce(p_scopes, '{}'),
    true, now(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[]) to service_role;

-- ── reading a token ─────────────────────────────────────────────────────────
-- service_role ONLY. This is the single path by which a token leaves storage,
-- and it exists so the publisher can use one.
create or replace function public.social_account_token(p_account_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare
  v_ref uuid;
  v_tok text;
begin
  select access_token_ref into v_ref
  from social_accounts
  where id = p_account_id and deleted_at is null and is_active;

  if v_ref is null then
    return null;   -- not connected, or revoked: the caller reports honestly
  end if;

  select decrypted_secret into v_tok
  from vault.decrypted_secrets where id = v_ref;

  return v_tok;
end;
$$;

revoke all on function public.social_account_token(uuid) from public, anon, authenticated;
grant execute on function public.social_account_token(uuid) to service_role;

-- ── disconnecting ───────────────────────────────────────────────────────────
-- An agency can revoke its own connection. The Vault secrets go with it; a
-- disconnected account that still holds a live token is a standing liability.
create or replace function public.disconnect_social_account(p_account_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare
  v_agency uuid;
  v_a uuid;
  v_r uuid;
begin
  select agency_id, access_token_ref, refresh_token_ref
    into v_agency, v_a, v_r
  from social_accounts
  where id = p_account_id and deleted_at is null;

  if v_agency is null then
    raise exception 'Account not found' using errcode = 'no_data_found';
  end if;
  if not is_agency_member(v_agency) then
    raise exception 'You cannot disconnect this account'
      using errcode = 'insufficient_privilege';
  end if;

  update social_accounts
     set is_active = false, deleted_at = now(),
         access_token_ref = null, refresh_token_ref = null
   where id = p_account_id;

  if v_a is not null then delete from vault.secrets where id = v_a; end if;
  if v_r is not null then delete from vault.secrets where id = v_r; end if;

  return true;
end;
$$;

revoke all on function public.disconnect_social_account(uuid) from public, anon;
grant execute on function public.disconnect_social_account(uuid) to authenticated;

-- Clients read account metadata, never the refs. Revoking column access is
-- belt and braces -- knowing a Vault UUID does not decrypt anything -- but it
-- keeps the refs out of `select *` and out of anything that logs a row.
revoke select (access_token_ref, refresh_token_ref) on public.social_accounts from authenticated, anon;

-- Verified (2026-08-13):
--   connect via service role        -> account created
--   publisher reads the token       -> exact value returned
--   token present in the row?       -> no
--   client reads the token          -> permission denied
--   client connects directly        -> permission denied
--   agency sees the connection      -> yes (metadata only)
--   agency disconnects              -> ok
--   token after disconnect          -> NULL, Vault secret destroyed
