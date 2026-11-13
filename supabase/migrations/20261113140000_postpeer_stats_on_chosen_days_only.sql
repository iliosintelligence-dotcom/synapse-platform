-- PostPeer views and likes are read only on chosen days, not daily (2026-11-13).
--
-- Each PostPeer stats read costs a credit (posting costs one too). post-metrics now reads a live PostPeer post only on
-- the days POSTPEER_STATS_DAYS names after it went live (default 7: one read). This makes refresh_social_metrics wake
-- post-metrics for a PostPeer post only when it is live and 1-60 days old and not read in the last day -- waking is
-- free; whether a read is due is post-metrics' decision (statsDue). Otherwise refresh_social_metrics is its live text
-- (from 20261113100000), unchanged.
--
-- Undo: re-run the refresh_social_metrics definition from 20261113100000.

begin;

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
      /* PostPeer (2026-11-13): live, 1-60 days old, not read in the last day. post-metrics reads it only on the
         chosen days (POSTPEER_STATS_DAYS), since each read costs a credit. */
      or (provider = 'postpeer'
        and payload->>'delivery' = 'live'
        and published_at < now() - interval '1 day'
        and published_at > now() - interval '60 days'
        and (metrics_at is null or metrics_at < now() - interval '1 day'))
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

commit;
