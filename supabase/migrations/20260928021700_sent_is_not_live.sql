-- SENT IS NOT LIVE.
--
-- A post that goes out through trypost is marked 'published' the moment
-- trypost accepts it. trypost then publishes from its own queue, and on
-- 27 September an Instagram carousel accepted at 10:10 UTC appeared on
-- Instagram hours later -- while the pipeline card said Published throughout.
--
-- post-metrics now has a delivery check (action 'delivery') that asks trypost
-- what actually happened to each post and records it: live with the real time,
-- still waiting, or failed with trypost's reason. This schedules it.
--
-- Same shape as refresh_social_metrics: count what is waiting, and only then
-- spend a request. Every two minutes, because a card that says "not live yet"
-- should change soon after the post appears, and the count makes a quiet tick
-- free. Rows from the last three days only, matching the function.

create or replace function public.confirm_social_delivery()
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
    and provider = 'trypost'
    and platform_post_id is not null
    and published_at > now() - interval '3 days'
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
    body    := jsonb_build_object('action', 'delivery', 'limit', 30),
    timeout_milliseconds := 120000
  );

  return v_waiting;
end;
$function$;

comment on function public.confirm_social_delivery() is
  'Asks post-metrics whether trypost posts marked published have actually gone '
  'live (or failed). Scheduled every 2 minutes; calls out only while one is waiting.';

revoke all on function public.confirm_social_delivery() from public;
revoke all on function public.confirm_social_delivery() from anon;
revoke all on function public.confirm_social_delivery() from authenticated;

do $$
begin
  perform cron.unschedule('confirm-social-delivery');
exception when others then
  null;   -- not scheduled yet: nothing to remove
end $$;

select cron.schedule(
  'confirm-social-delivery',
  '*/2 * * * *',
  $$select public.confirm_social_delivery()$$
);

-- Watched like every other job (see 20260927235841).
insert into public.cron_expectations (jobname, max_silence, note) values
  ('confirm-social-delivery', interval '30 minutes', 'every 2 minutes')
on conflict (jobname) do update
  set max_silence = excluded.max_silence, note = excluded.note;
