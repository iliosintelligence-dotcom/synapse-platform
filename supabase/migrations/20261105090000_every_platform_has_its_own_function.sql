-- Every platform has its own function (2026-11-05).
--
-- social-publish held every platform's adapter in one file. Each platform now
-- has its own edge function -- social-facebook, social-instagram,
-- social-telegram, social-tiktok, social-x, social-youtube, social-linkedin --
-- on one shared process (_shared/social/core.ts), and social-publish only
-- claims and dispatches. This migration is what the database needs for that:
--
--   1. connect_social_account accepts the new sign-ins (auth_source), and the
--      column's check agrees with it. Body otherwise reproduced exactly.
--   2. oauth_verifiers: the PKCE verifier for a sign-in in progress, kept
--      fifteen minutes and taken once. X requires PKCE; Google accepts it.
--   3. stash_connect_pick_for: the Facebook "which of these is yours" hold,
--      for any platform (LinkedIn company pages first). The Facebook chooser
--      now only reads Facebook holds (social-connect).
--   4. social_sync_cursors: where a read-back sweep got to (X mentions).
--   5. The Synapse autopilot and mirroring include the Facebook Pages the
--      studio connects (meta_page_id). They filtered on a Telegram chat or a
--      TryPost account, so since TryPost was retired on 24 October they have
--      fed Telegram only. Bodies otherwise reproduced exactly.
--   7. A short lease on an account while its token is renewed, so two
--      callers never renew the same account at once (X retires the old
--      refresh token on every renewal; the loser would fail its post).
--   6. Two scheduled jobs: tokens renewed before they end whether or not a
--      post is due (refresh-social-tokens, hourly), and engagement read back
--      for X, YouTube and LinkedIn (sweep-social-platforms, every 30 minutes,
--      and only for a platform with recent posts -- X charges per read).

-- ── 1. the new sign-ins ──────────────────────────────────────────────────
alter table public.social_accounts drop constraint if exists social_accounts_auth_source_check;
alter table public.social_accounts add constraint social_accounts_auth_source_check
  check (auth_source in ('instagram_login', 'facebook_login', 'tiktok_login', 'telegram_bot',
                         'x_oauth2', 'google_oauth2', 'linkedin_oauth2'));

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

  if p_auth_source not in ('instagram_login', 'facebook_login', 'tiktok_login', 'telegram_bot',
                           'x_oauth2', 'google_oauth2', 'linkedin_oauth2') then
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
  -- Widened from owner/admin to any member: the same three roles
  -- queue_social_post accepts to publish. connected_by records who did it, and
  -- disconnect_social_account has always accepted any member, so an agent
  -- could already remove an account they cannot add -- which was the wrong way
  -- round.
  if coalesce(v_role, '') not in ('agent', 'agency_admin', 'agency_owner') then
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

  -- Reconnecting must not leave a second row holding a live token. Keyed on
  -- platform_account_id, which is why a SECOND account has always been able to
  -- sit beside the first rather than replacing it.
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
revoke all on function public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[], uuid, text) from public, anon, authenticated;
grant execute on function public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[], uuid, text) to service_role;

-- ── 2. PKCE verifiers ────────────────────────────────────────────────────
create table if not exists public.oauth_verifiers (
  nonce      text primary key,
  platform   text not null,
  verifier   text not null,
  expires_at timestamptz not null default now() + interval '15 minutes'
);
alter table public.oauth_verifiers enable row level security;
revoke all on public.oauth_verifiers from public, anon, authenticated;
comment on table public.oauth_verifiers is
  'The PKCE code verifier of a sign-in in progress, keyed on the nonce in its signed state. '
  'Never sent to the browser; taken once by the callback. Service role only.';

create or replace function public.stash_oauth_verifier(p_nonce text, p_platform text, p_verifier text)
returns void language sql security definer set search_path to 'public', 'pg_temp' as $$
  delete from oauth_verifiers where expires_at < now();
  insert into oauth_verifiers (nonce, platform, verifier) values (p_nonce, p_platform, p_verifier);
$$;

create or replace function public.take_oauth_verifier(p_nonce text, p_platform text)
returns text language sql security definer set search_path to 'public', 'pg_temp' as $$
  delete from oauth_verifiers
   where nonce = p_nonce and platform = p_platform and expires_at > now()
  returning verifier;
$$;

revoke all on function public.stash_oauth_verifier(text, text, text) from public, anon, authenticated;
revoke all on function public.take_oauth_verifier(text, text) from public, anon, authenticated;
grant execute on function public.stash_oauth_verifier(text, text, text) to service_role;
grant execute on function public.take_oauth_verifier(text, text) to service_role;

-- ── 3. a choice held for any platform ────────────────────────────────────
create or replace function public.stash_connect_pick_for(
  p_platform   text,
  p_agency_id  uuid,
  p_profile_id uuid,
  p_pages      jsonb,
  p_tokens     jsonb,
  p_scopes     text[]
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'vault', 'pg_temp'
as $function$
declare
  v_ref uuid;
  v_id  uuid;
begin
  v_ref := vault.create_secret(p_tokens::text, 'connect_pick_' || gen_random_uuid()::text,
                               'Tokens awaiting a choice (social_connect_picks)');
  insert into social_connect_picks (agency_id, profile_id, platform, pages, granted_scopes, token_ref)
  values (p_agency_id, p_profile_id, p_platform, coalesce(p_pages, '[]'::jsonb), coalesce(p_scopes, '{}'), v_ref)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.stash_connect_pick_for(text, uuid, uuid, jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.stash_connect_pick_for(text, uuid, uuid, jsonb, jsonb, text[]) to service_role;

-- ── 4. read-back cursors ─────────────────────────────────────────────────
create table if not exists public.social_sync_cursors (
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  platform   text not null,
  since_id   text,
  updated_at timestamptz not null default now(),
  primary key (account_id, platform)
);
alter table public.social_sync_cursors enable row level security;
revoke all on public.social_sync_cursors from public, anon, authenticated;
comment on table public.social_sync_cursors is
  'Where a read-back sweep got to for one account (X: the newest mention seen). Moved only after a successful write.';

-- ── 5. the autopilot and mirroring reach studio Facebook Pages ───────────
create or replace function public.feed_city_channels()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r        public.city_channels;
  v_now    timestamptz := now();
  v_hour   integer := extract(hour from (now() at time zone 'Africa/Lagos'))::integer;
  v_today  date := (now() at time zone 'Africa/Lagos')::date;
  v_pid    uuid;
  v_agency uuid;
  v_id     uuid;
  v_caption text;
  v_url    text;
  v_n      integer := 0;
begin
  for r in
    select * from city_channels
     where is_active and autopilot
       and (chat_id is not null or meta_page_id is not null)
  loop
    if v_hour < r.window_start or v_hour >= r.window_end then continue; end if;

    if (select count(*) from social_posts
         where city_channel_id = r.id and deleted_at is null and twin_of is null
           and (scheduled_at at time zone 'Africa/Lagos')::date = v_today) >= r.daily_cap then
      continue;
    end if;

    if exists (select 1 from social_posts
                where city_channel_id = r.id and deleted_at is null and twin_of is null
                  and scheduled_at > v_now - r.min_gap) then
      continue;
    end if;

    /* Never posted to this channel first, then the one posted longest ago;
       within each, the newest listing. Live, one this channel's routing rules
       accept (city, kind, bedrooms, price, area), not expired, with a photograph. */
    v_pid := null; v_agency := null;
    select p.id, p.agency_id into v_pid, v_agency
      from properties p
     where p.deleted_at is null
       and p.status = 'live'
       and p.is_active
       and (p.expires_at is null or p.expires_at > v_now)
       and public.city_channel_accepts(r, p)
       and exists (select 1 from property_media m where m.property_id = p.id)
       and not exists (
         select 1 from social_posts sp
          where sp.city_channel_id = r.id and sp.property_id = p.id
            and sp.deleted_at is null and sp.twin_of is null
            and sp.scheduled_at > v_now - r.repost_after)
     order by (select max(sp.scheduled_at) from social_posts sp
                where sp.city_channel_id = r.id and sp.property_id = p.id and sp.twin_of is null) asc nulls first,
              p.listed_at desc nulls last
     limit 1;
    if v_pid is null then continue; end if;

    v_caption := public.city_channel_caption(v_pid);
    if v_caption is null then continue; end if;

    insert into social_posts (
      property_id, agency_id, platform, caption, media_urls,
      status, scheduled_at, dry_run, leg, city_channel_id
    ) values (
      v_pid, v_agency, r.platform, v_caption, public.listing_gallery(v_pid, 1),
      'scheduled', v_now, false, 'synapse', r.id
    )
    returning id into v_id;

    begin
      v_url := public.city_short_link(v_pid, v_id, r.platform);
      if v_url is not null then
        update social_posts
           set caption = public.caption_with_link(r.platform::text, v_caption, v_url)
         where id = v_id;
      end if;
    exception when others then
      raise warning 'feed_city_channels: no short link for % (%)', v_id, sqlerrm;
    end;

    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.feed_city_channels() from public, anon, authenticated;

create or replace function public.queue_synapse_twins(
  p_property_id  uuid,
  p_agency_id    uuid,
  p_caption      text,
  p_media_urls   text[],
  p_scheduled_at timestamptz,
  p_dry_run      boolean,
  p_source_post  uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_channel record;
  v_id      uuid;
  v_caption text;
  v_url     text;
  v_media   text[];
  v_city    text;
  v_prop    public.properties;
  v_src     text;
  v_at      timestamptz := coalesce(p_scheduled_at, now());
  v_n       integer := 0;
begin
  /* OFF UNLESS SWITCHED ON. Since 2026-09-27 this is a switch in the Synapse
     studio (platform_settings.synapse_twins). */
  if coalesce((select (value->>'enabled')::boolean
                 from platform_settings where key = 'synapse_twins'), false) is not true then
    return 0;
  end if;

  select platform::text into v_src from social_posts where id = p_source_post;
  select * into v_prop from properties where id = p_property_id;
  if not found then return 0; end if;
  v_city := v_prop.city;

  /* Both kinds of channel in one pass: the original per-platform channels
     (synapse_channels, city_channel_id null) and the studio's channels that
     asked to receive agencies' posts. */
  for v_channel in
    select platform, null::uuid as city_channel_id
      from synapse_channels where is_active
       and (v_src is null or platform::text = v_src)
    union all
    select c.platform, c.id
      from city_channels c
     where c.is_active and c.mirror_agency_posts
       and (v_src is null or c.platform::text = v_src)
       and (c.chat_id is not null or c.meta_page_id is not null)
       and public.city_channel_accepts(c, v_prop)
    order by 1
  loop
    if exists (
      select 1 from social_posts
      where property_id = p_property_id
        and platform    = v_channel.platform
        and leg         = 'synapse'
        and deleted_at is null
        and city_channel_id is not distinct from v_channel.city_channel_id
        and scheduled_at between v_at - interval '1 hour' and v_at + interval '1 hour'
    ) then
      continue;
    end if;

    v_caption := 'Spotted on Synapse' || E'\n\n' || btrim(coalesce(p_caption, ''));
    v_media := (coalesce(p_media_urls, '{}'))[1:media_cap_for(v_channel.platform::text)];

    v_id := null;
    insert into social_posts (
      property_id, agency_id, platform, caption, media_urls,
      status, scheduled_at, dry_run, created_by, leg, twin_of, city_channel_id
    ) values (
      p_property_id, p_agency_id, v_channel.platform,
      v_caption, v_media,
      'scheduled', v_at, coalesce(p_dry_run, true),
      auth.uid(), 'synapse', p_source_post, v_channel.city_channel_id
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      continue;
    end if;

    begin
      select l.url into v_url
      from public.create_short_link(
        p_property_id,
        (case lower(v_channel.platform::text)
           when 'instagram' then 'instagram'
           when 'facebook'  then 'facebook'
           when 'tiktok'    then 'tiktok'
           when 'whatsapp'  then 'whatsapp_campaign'
           when 'telegram'  then 'telegram'
           else 'organic'
         end)::public.attribution_channel,
        v_id) l;

      update social_posts
         set caption = public.caption_with_link(v_channel.platform::text, v_caption, v_url)
       where id = v_id;
    exception when others then
      raise warning 'queue_synapse_twins: no short link for % (%)', v_id, sqlerrm;
    end;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;

-- ── 6. tokens renewed on a schedule, engagement read back ────────────────
create or replace function public.refresh_social_tokens()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $function$
declare
  v_key text; v_url text; r record; v_n integer := 0;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if v_key is null or v_url is null then
    raise warning 'refresh_social_tokens: service_role_key or project_url missing from vault';
    return 0;
  end if;
  /* Each platform renews within its own window: Instagram (sixty-day tokens)
     ten days ahead, LinkedIn three, the hourly and daily tokens (X, YouTube,
     TikTok) ninety minutes ahead -- so a token is fresh whenever a post is
     due, and an account nobody posts from does not quietly die. */
  for r in
    select id, platform::text as platform from social_accounts
     where is_active and deleted_at is null and token_expires_at is not null
       and token_expires_at > now()
       and (refresh_token_ref is not null or (platform = 'instagram' and auth_source = 'instagram_login'))
       and token_expires_at < now() + case platform::text
             when 'instagram' then interval '10 days'
             when 'linkedin'  then interval '3 days'
             else interval '90 minutes' end
     order by token_expires_at
     limit 25
  loop
    perform net.http_post(
      url := v_url || '/functions/v1/social-' || r.platform,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('action', 'refresh', 'account_id', r.id),
      timeout_milliseconds := 30000);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
revoke all on function public.refresh_social_tokens() from public, anon, authenticated;

create or replace function public.sweep_social_platforms()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $function$
declare
  v_key text; v_url text; p text; v_n integer := 0;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if v_key is null or v_url is null then return 0; end if;
  /* Facebook and Instagram are read by post-metrics (refresh-social-metrics). */
  foreach p in array array['x', 'youtube', 'linkedin'] loop
    if exists (select 1 from social_posts
                where provider = p and status = 'published' and deleted_at is null
                  and published_at > now() - interval '30 days') then
      perform net.http_post(
        url := v_url || '/functions/v1/social-' || p,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('action', 'sweep', 'limit', 20),
        timeout_milliseconds := 60000);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;
revoke all on function public.sweep_social_platforms() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'refresh-social-tokens') then
    perform cron.schedule('refresh-social-tokens', '17 * * * *', 'select public.refresh_social_tokens()');
  end if;
  if not exists (select 1 from cron.job where jobname = 'sweep-social-platforms') then
    perform cron.schedule('sweep-social-platforms', '*/30 * * * *', 'select public.sweep_social_platforms()');
  end if;
end $$;

insert into public.cron_expectations (jobname, max_silence, note) values
  ('refresh-social-tokens',  interval '3 hours',    'hourly at :17'),
  ('sweep-social-platforms', interval '90 minutes', 'every 30 minutes')
on conflict (jobname) do nothing;


-- ── 7. one renewal per account at a time ─────────────────────────────────
alter table public.social_accounts add column if not exists token_refresh_lease timestamptz;
comment on column public.social_accounts.token_refresh_lease is
  'Held while a token is being renewed (refreshGuarded in _shared/social/core.ts). Expires on its own after 60 seconds.';

create or replace function public.take_token_refresh_lease(p_account_id uuid)
returns boolean language sql security definer set search_path to 'public', 'pg_temp' as $$
  with taken as (
    update social_accounts set token_refresh_lease = now() + interval '60 seconds'
     where id = p_account_id and (token_refresh_lease is null or token_refresh_lease < now())
    returning id)
  select exists (select 1 from taken);
$$;

create or replace function public.release_token_refresh_lease(p_account_id uuid)
returns void language sql security definer set search_path to 'public', 'pg_temp' as $$
  update social_accounts set token_refresh_lease = null where id = p_account_id;
$$;

revoke all on function public.take_token_refresh_lease(uuid) from public, anon, authenticated;
revoke all on function public.release_token_refresh_lease(uuid) from public, anon, authenticated;
grant execute on function public.take_token_refresh_lease(uuid) to service_role;
grant execute on function public.release_token_refresh_lease(uuid) to service_role;
