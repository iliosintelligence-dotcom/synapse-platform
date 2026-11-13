-- PostPeer: agencies connect Instagram, TikTok and YouTube through PostPeer's already-approved apps (2026-11-13).
--
-- PostPeer (postpeer.dev) holds the platform login; we hold only its integration id. Nothing here changes how any
-- existing account or post behaves: it only makes room for the new kind.
--
-- 1. social_accounts.auth_source may now be 'postpeer'. Such a row has no token in Vault (access_token_ref stays null);
--    platform_account_id carries PostPeer's integration id, which is what a post is addressed to.
-- 2. postpeer_profiles: one PostPeer profile per agency, so each agency's connections are grouped on PostPeer's side.
--    Service role only.
-- 3. refresh_social_metrics also wakes post-metrics for PostPeer posts, but only once a day per post and only for
--    posts from the last 30 days: every stats read costs a PostPeer credit. Otherwise its live text, unchanged.
-- 4. confirm_social_delivery also counts PostPeer posts still waiting to go live. PostPeer's webhook normally settles
--    them within a minute; this is the backstop for a missed webhook. Otherwise its live text, unchanged.
--
-- Undo: undo-postpeer.sql beside this repo.

begin;

-- ── 1 ──
alter table public.social_accounts drop constraint if exists social_accounts_auth_source_check;
alter table public.social_accounts add constraint social_accounts_auth_source_check
  check (auth_source = any (array['instagram_login'::text, 'facebook_login'::text, 'postpeer'::text]));

comment on column public.social_accounts.auth_source is
  'Which login issued this connection: instagram_login / facebook_login (our own Meta apps, token in Vault), or '
  'postpeer (PostPeer holds the login; platform_account_id is PostPeer''s integration id; no token here).';

-- ── 2 ──
create table if not exists public.postpeer_profiles (
  agency_id  uuid primary key references public.agencies(id) on delete cascade,
  profile_id text not null unique,
  created_at timestamptz not null default now()
);
comment on table public.postpeer_profiles is
  'The PostPeer profile that groups one agency''s PostPeer connections. Written by social-connect. Service role only.';
alter table public.postpeer_profiles enable row level security;
revoke all on table public.postpeer_profiles from public;
revoke all on table public.postpeer_profiles from anon;
revoke all on table public.postpeer_profiles from authenticated;

-- ── 3 ──
create or replace function public.refresh_social_metrics()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $function$
declare
  v_key text;
  v_url text;
  v_due integer;
begin
  /* Due = published, has a platform id to ask about, and either never fetched
     or fetched over an hour ago. An hour because trypost caches metrics for
     five minutes and engagement on a property post moves slowly -- asking more
     often spends rate limit to redraw the same number. */
  select count(*) into v_due
  from social_posts
  where deleted_at is null
    and status = 'published'
    and platform_post_id is not null
    and (
      (provider in ('trypost', 'instagram', 'facebook')   -- direct posts too (2026-11-10)
        and (metrics_at is null or metrics_at < now() - interval '1 hour'))
      /* PostPeer (2026-11-13): each read costs a credit, so once a day, last 30 days only. */
      or (provider = 'postpeer'
        and published_at > now() - interval '30 days'
        and (metrics_at is null or metrics_at < now() - interval '24 hours'))
    );

  if v_due = 0 then
    return 0;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url' limit 1;

  if v_key is null or v_url is null then
    raise warning 'refresh_social_metrics: service_role_key or project_url missing from vault';
    return 0;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/post-metrics',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('action', 'sweep', 'limit', 20),
    timeout_milliseconds := 120000
  );

  return v_due;
end;
$function$;

-- ── 4 ──
create or replace function public.confirm_social_delivery(p_days integer default 3, p_limit integer default 30)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $function$
declare
  v_key text;
  v_url text;
  v_waiting integer;
begin
  select count(*) into v_waiting
  from social_posts
  where deleted_at is null
    and status = 'published'
    and provider in ('trypost', 'postpeer')   -- PostPeer too (2026-11-13)
    and platform_post_id is not null
    and published_at > now() - make_interval(days => greatest(1, least(p_days, 60)))
    and coalesce(payload->>'delivery', 'pending') = 'pending';

  if v_waiting = 0 then
    return 0;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url' limit 1;

  if v_key is null or v_url is null then
    raise warning 'confirm_social_delivery: service_role_key or project_url missing from vault';
    return 0;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/post-metrics',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('action', 'delivery',
                                  'limit', greatest(1, least(p_limit, 60)),
                                  'days', greatest(1, least(p_days, 60))),
    timeout_milliseconds := 120000
  );

  return v_waiting;
end;
$function$;

commit;
