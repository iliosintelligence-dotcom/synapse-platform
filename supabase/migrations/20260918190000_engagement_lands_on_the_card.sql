-- COMMENTS AND LIKES, ON THE CARD, WITHOUT ANYBODY OPENING A PANEL.
--
-- post-metrics already asks trypost for engagement, but only when a browser
-- asks it to, and it keeps nothing. So a post's comment count existed only for
-- as long as a panel was open, and the pipeline card -- the thing an agency
-- actually looks at -- could never show it. Reported as "I'm not seeing any
-- notifications for comments".
--
-- WHAT CAN AND CANNOT BE HAD. trypost's webhooks are seven post-lifecycle
-- events and its own documentation is explicit: "There are no events for
-- comments, mentions, social-account disconnects, or team changes." So nothing
-- can be pushed to us. What IS available is GET /api/posts/{id}/metrics, which
-- reports Likes, Comments and Shares per platform, cached five minutes.
--
-- That means counts, on a poll. "You have three comments" is buildable and is
-- most of the value. The comment TEXT, who wrote it, and DMs are not available
-- through trypost at all -- those need the Meta Graph API against a connected
-- account, and no agency account is connected yet.
--
-- Stored on the row rather than in a side table: the pipeline already reads
-- social_posts for every card, so this costs no extra query, and engagement on
-- a post is a property of that post rather than a history anybody has asked to
-- keep.

alter table public.social_posts
  add column if not exists likes       integer,
  add column if not exists comments    integer,
  add column if not exists shares      integer,
  add column if not exists metrics_at  timestamptz;

comment on column public.social_posts.comments is
  'Comment count from the platform, via trypost metrics. NULL means never '
  'fetched -- which is not the same as zero, and the card must not render it '
  'as "no comments".';
comment on column public.social_posts.metrics_at is
  'When engagement was last fetched. NULL means never. Used to spread the '
  'sweep rather than re-asking about the same post every run.';

-- Oldest-first is how the sweep picks its batch, and it runs every few
-- minutes over a growing table.
create index if not exists social_posts_metrics_due
  on public.social_posts (metrics_at nulls first)
  where deleted_at is null and status = 'published' and platform_post_id is not null;


/* THE SWEEP. Same shape as drain_social_queue: count what is due, and only
   then spend a request. pg_net posts to the function with the service role,
   which is the only caller post-metrics will let write. */
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
    and provider = 'trypost'
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

comment on function public.refresh_social_metrics() is
  'Asks post-metrics to refresh engagement for published trypost posts not '
  'fetched in the last hour. Scheduled; also safe to call by hand.';

revoke all on function public.refresh_social_metrics() from public;
revoke all on function public.refresh_social_metrics() from anon;
revoke all on function public.refresh_social_metrics() from authenticated;


-- Every fifteen minutes. The drain runs every minute because a post landing at
-- the hour an agency chose is the whole point of scheduling; engagement is not
-- like that. Comment counts on a property post move over hours, trypost caches
-- them for five minutes anyway, and the sweep itself only asks about posts not
-- refreshed in the last hour -- so a faster tick would spend rate limit
-- redrawing the same number.
--
-- Unscheduled first because cron.schedule is NOT idempotent: calling it twice
-- with the same name leaves two jobs, and two sweeps racing each other is how
-- the same post gets asked about twice a tick. The delete is guarded so this
-- migration still applies on a database that has never seen the job.
do $$
begin
  perform cron.unschedule('refresh-social-metrics');
exception when others then
  null;   -- not scheduled yet: nothing to remove
end $$;

select cron.schedule(
  'refresh-social-metrics',
  '*/15 * * * *',
  $$select public.refresh_social_metrics()$$
);
