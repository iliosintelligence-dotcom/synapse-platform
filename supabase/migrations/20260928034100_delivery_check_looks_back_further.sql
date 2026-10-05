-- THE DELIVERY CHECK, LOOKING FURTHER BACK, ONCE.
--
-- confirm_social_delivery (20260928021700) asks trypost whether posts it
-- accepted actually went live, for the last three days. Every Synapse X post
-- before 26 September is marked published on the strength of trypost
-- ACCEPTING it; the two since then that were checked had both failed. Eden
-- wants X working rather than switched off, so the first thing needed is the
-- truth about the older ones: did any X post ever go out, and what did
-- trypost say about the ones that did not (the check now keeps trypost's
-- whole platform record on a failure).
--
-- The function gains a look-back in days (the schedule keeps its default of
-- 3) and a batch size, and is called once here for 30 days.

drop function if exists public.confirm_social_delivery();

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
    and provider = 'trypost'
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

comment on function public.confirm_social_delivery(integer, integer) is
  'Asks post-metrics whether trypost posts marked published have actually gone '
  'live (or failed), looking back p_days (default 3). Scheduled every 2 minutes '
  'with the defaults; calls out only while one is waiting.';

revoke all on function public.confirm_social_delivery(integer, integer) from public;
revoke all on function public.confirm_social_delivery(integer, integer) from anon;
revoke all on function public.confirm_social_delivery(integer, integer) from authenticated;

-- The one-off look back. The scheduled job ("select public.confirm_social_delivery()")
-- keeps running with the defaults.
select public.confirm_social_delivery(30, 60);
