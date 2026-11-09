-- Engagement for every platform (contract: users see views, likes and what performs best).
--
-- 1. social_posts.views: how many times a post was seen, where the platform tells us (YouTube today).
-- 2. refresh_social_metrics woke post-metrics only for posts that went out through TryPost (provider = 'trypost').
--    TryPost was disconnected on 2026-10-23 and Facebook / Instagram now publish directly (provider 'facebook' /
--    'instagram'), which post-metrics reads but this never woke it for -- so their likes and comments stopped
--    refreshing (last: Facebook 2026-10-30, Instagram 2026-10-09). The due-check now counts direct posts too; the
--    function is otherwise its live text (md5 a952e103...) unchanged.
-- 3. refresh_youtube_metrics + a job at :10 and :40: wakes the youtube-metrics function when a YouTube post is due.
-- 4. record_telegram_reactions: the Telegram bot hears each channel post's reaction total (Telegram gives bots no view
--    counts); this stores it as the post's likes. Service role only.

begin;

alter table public.social_posts add column if not exists views integer;
comment on column public.social_posts.views is
  'Times the post was seen, as the platform reports it (YouTube viewCount). Null where the platform gives no count.';

-- ── 2 ──
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
    and provider in ('trypost', 'instagram', 'facebook')   -- direct posts too (2026-11-10)
    and (metrics_at is null or metrics_at < now() - interval '1 hour');

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

-- ── 3 ──
create or replace function public.refresh_youtube_metrics()
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
  select count(*) into v_due
  from social_posts
  where deleted_at is null
    and status = 'published'
    and platform = 'youtube'
    and platform_post_id is not null
    and (metrics_at is null or metrics_at < now() - interval '1 hour');

  if v_due = 0 then
    return 0;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url' limit 1;

  if v_key is null or v_url is null then
    raise warning 'refresh_youtube_metrics: service_role_key or project_url missing from vault';
    return 0;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/youtube-metrics',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('limit', 200),
    timeout_milliseconds := 120000
  );

  return v_due;
end;
$function$;

revoke all on function public.refresh_youtube_metrics() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-youtube-metrics') then
    perform cron.unschedule('refresh-youtube-metrics');
  end if;
  perform cron.schedule('refresh-youtube-metrics', '10,40 * * * *', 'select public.refresh_youtube_metrics()');
end $$;

-- ── 4 ──
create or replace function public.record_telegram_reactions(p_chat_id text, p_message_id text, p_total integer)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n integer;
begin
  update social_posts sp
     set likes = greatest(coalesce(p_total, 0), 0), metrics_at = now()
   where sp.platform = 'telegram'
     and sp.status = 'published'
     and sp.deleted_at is null
     and sp.platform_post_id = btrim(p_message_id)
     and (
       exists (select 1 from social_accounts a
                where a.platform = 'telegram' and a.platform_account_id = btrim(p_chat_id)
                  and (a.id = sp.social_account_id
                       or (sp.social_account_id is null and a.agency_id = sp.agency_id and a.deleted_at is null)))
       or exists (select 1 from city_channels c where c.id = sp.city_channel_id and c.chat_id = btrim(p_chat_id))
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

comment on function public.record_telegram_reactions(text, text, integer) is
  'telegram-webhook: a channel post''s reaction total becomes its likes. Matched by chat and message id.';

revoke all on function public.record_telegram_reactions(text, text, integer) from public, anon, authenticated;
grant execute on function public.record_telegram_reactions(text, text, integer) to service_role;

commit;
