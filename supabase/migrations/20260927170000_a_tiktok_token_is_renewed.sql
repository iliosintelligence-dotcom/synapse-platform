-- A TikTok token is renewed, not re-granted.
--
-- TikTok's access token lives 24 hours; its refresh token 365 days, and a
-- refresh may hand back a NEW refresh token that replaces the old one. Meta's
-- tokens here are long-lived and were stored once and read forever, so the
-- storage had a way in (connect_social_account) and a way to read the access
-- token (social_account_token), and no way to read the refresh token or to
-- write either back.
--
-- These two are that. social-publish renews a TikTok token when it is within
-- fifteen minutes of expiring, just before it posts, and writes the result back
-- to the same Vault secrets -- so the social_accounts row, and every post that
-- names it, keeps pointing at a working credential.
--
-- Service role only, like the rest of the token plumbing: a browser never
-- holds or sees one of these.

create or replace function public.social_account_refresh_token(p_account_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare
  v_ref uuid;
  v_tok text;
begin
  select refresh_token_ref into v_ref
  from social_accounts
  where id = p_account_id and deleted_at is null and is_active;
  if v_ref is null then return null; end if;
  select decrypted_secret into v_tok from vault.decrypted_secrets where id = v_ref;
  return v_tok;
end;
$$;
revoke all on function public.social_account_refresh_token(uuid) from public, anon, authenticated;
grant execute on function public.social_account_refresh_token(uuid) to service_role;

create or replace function public.update_social_account_tokens(
  p_account_id    uuid,
  p_access_token  text,
  p_refresh_token text default null,
  p_expires_at    timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare
  v_agency uuid; v_platform text; v_access uuid; v_refresh uuid; v_tag text;
begin
  if p_access_token is null or length(btrim(p_access_token)) = 0 then
    raise exception 'No access token supplied' using errcode = 'invalid_parameter_value';
  end if;

  select agency_id, platform::text, access_token_ref, refresh_token_ref
    into v_agency, v_platform, v_access, v_refresh
  from social_accounts
  where id = p_account_id and deleted_at is null and is_active;
  if v_agency is null then return false; end if;   -- disconnected meanwhile: keep nothing

  v_tag := 'social:' || v_platform || ':' || v_agency::text || ':';

  if v_access is null then
    v_access := vault.create_secret(p_access_token, v_tag || 'access:' || gen_random_uuid()::text, 'Social access token');
  else
    perform vault.update_secret(v_access, p_access_token);
  end if;

  /* A refresh that hands back the same refresh token, or none, leaves the
     stored one alone; a new one replaces it, because TikTok may retire the
     old one when it issues the new. */
  if p_refresh_token is not null and length(btrim(p_refresh_token)) > 0 then
    if v_refresh is null then
      v_refresh := vault.create_secret(p_refresh_token, v_tag || 'refresh:' || gen_random_uuid()::text, 'Social refresh token');
    else
      perform vault.update_secret(v_refresh, p_refresh_token);
    end if;
  end if;

  update social_accounts
     set access_token_ref  = v_access,
         refresh_token_ref = v_refresh,
         token_expires_at  = p_expires_at,
         updated_at        = now()
   where id = p_account_id;
  return true;
end;
$$;
revoke all on function public.update_social_account_tokens(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.update_social_account_tokens(uuid, text, text, timestamptz) to service_role;
