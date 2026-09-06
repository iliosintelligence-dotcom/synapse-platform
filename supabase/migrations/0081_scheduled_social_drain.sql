-- "Scheduled" was a label on a row and nothing else.
--
-- social_posts has scheduled_at, claim_social_batch respects it, and
-- social-publish drains it properly. But that function required a signed-in
-- agency member and drained only that member's agency, and no cron job
-- touched the queue at all. So a post scheduled for 9am published when a
-- human opened the portal and pressed a button. That is a reminder, not a
-- schedule, and a row could sit at status='scheduled' forever.
--
-- Two pieces here: a claim that spans agencies for a caller that belongs to
-- none, and the job that calls the publisher.

-- ── the cross-agency claim ────────────────────────────────────────────────
-- Same body as claim_social_batch minus the agency filter: atomic, skip
-- locked, and it reclaims a row stranded by a drain that died mid-flight.
-- Ordered by scheduled_at so the most overdue post goes first.
create or replace function public.claim_social_due_any(p_limit integer default 10)
returns setof social_posts
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update social_posts o
     set status   = 'publishing',
         attempts = o.attempts + 1
   where o.id in (
     select id from social_posts
      where deleted_at is null
        and attempts < max_attempts
        and (
          (status = 'scheduled' and scheduled_at <= now())
          or (status = 'publishing' and updated_at < now() - interval '5 minutes')
        )
      order by scheduled_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 10), 50))
     )
  returning o.*;
$function$;

-- Nobody signs in as "every agency". This is for the scheduler alone, and
-- social-publish reaches it with the service role key.
revoke all on function public.claim_social_due_any(integer) from public;
revoke all on function public.claim_social_due_any(integer) from anon;
revoke all on function public.claim_social_due_any(integer) from authenticated;

-- ── the job ───────────────────────────────────────────────────────────────
-- Follows enrich_due_properties exactly: vault for the key and the URL, then
-- net.http_post. It checks for due work FIRST and only calls out when there
-- is some -- a minute-by-minute schedule that woke an edge function 1,440
-- times a day to be told "nothing" would be a silly thing to build.
create or replace function public.drain_social_queue()
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
    and attempts < max_attempts
    and (
      (status = 'scheduled' and scheduled_at <= now())
      or (status = 'publishing' and updated_at < now() - interval '5 minutes')
    );

  if v_due = 0 then
    return 0;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url' limit 1;

  if v_key is null or v_url is null then
    raise warning 'drain_social_queue: service_role_key or project_url missing from vault';
    return 0;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/social-publish',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('limit', 25),
    timeout_milliseconds := 120000
  );

  return v_due;
end;
$function$;

revoke all on function public.drain_social_queue() from public;
revoke all on function public.drain_social_queue() from anon;
revoke all on function public.drain_social_queue() from authenticated;

-- Every minute. Scheduling exists so a post lands at the hour the agency
-- chose; a five-minute tick would make "best time to post" advice that this
-- product gives elsewhere into a lie it tells itself.
select cron.schedule('drain-social-queue', '* * * * *', $$select public.drain_social_queue()$$);
