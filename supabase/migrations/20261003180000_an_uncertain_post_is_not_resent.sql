-- A post that may have gone out is never sent a second time on its own.
--
-- Greptile's audit: a row is 'publishing' while a worker holds it. If the
-- provider accepted the post but the database save then failed (or the
-- worker died after the provider took it), the row stayed 'publishing' and,
-- twenty minutes later, was claimed again and published AGAIN -- a duplicate
-- public post under an agency's name.
--
-- Whether it went out cannot be known from here, so the system no longer
-- guesses: a row that has been 'publishing' for twenty minutes becomes
-- 'failed' with a plain reason, and shows in the agency's Needs attention
-- with its Retry. A person looks at the channel and decides. A post that
-- genuinely failed still retries by itself, as before: only the uncertain
-- case is taken out of the automatic loop.
--
-- (The claim functions below are the previous definitions with the
-- 'publishing again after the lease' branch removed, and drain_social_queue
-- settles stale rows before counting what is due.)
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
     select sp.id from social_posts sp
      where sp.deleted_at is null
        and sp.attempts < sp.max_attempts
        and (
          (sp.status = 'scheduled' and sp.scheduled_at <= now())
        )
        /* HELD, NOT FAILED. A post under a paused campaign is skipped here
           and stays 'scheduled' with its attempts untouched, so resuming the
           campaign needs no repair. */
        and not exists (
          select 1 from campaigns c
           where c.id = sp.campaign_id and c.status = 'paused'
        )
      order by sp.scheduled_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 10), 50))
     )
  returning o.*;
$function$;

comment on function public.claim_social_due_any(integer) is
  'Claims due posts across every agency for the scheduler. Skips posts under '
  'a PAUSED campaign, leaving them scheduled with attempts untouched -- the '
  'Pause button wrote a status that nothing read until this.';

revoke all on function public.claim_social_due_any(integer) from public, anon, authenticated;


-- The same gate on the per-agency claim, which is what "Post now" reaches.
-- Leaving it out would mean a paused campaign publishes the moment somebody
-- presses a button, which is the same lie in a narrower place.
create or replace function public.claim_social_batch(p_agency_id uuid, p_limit integer default 10)
returns setof public.social_posts
language sql
security definer
set search_path to 'public'
as $$
  update social_posts o
     set status   = 'publishing',
         attempts = o.attempts + 1
   where o.id in (
     select sp.id from social_posts sp
      where sp.agency_id = p_agency_id
        and sp.deleted_at is null
        and sp.attempts < sp.max_attempts
        and (
          (sp.status = 'scheduled' and sp.scheduled_at <= now())
          -- a drain that died mid-flight: reclaim rather than strand the row
        )
        and not exists (
          select 1 from campaigns c
           where c.id = sp.campaign_id and c.status = 'paused'
        )
      order by sp.scheduled_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 10), 50))
     )
  returning o.*;
$$;

revoke all on function public.claim_social_batch(uuid, integer) from public, anon, authenticated;


-- ── and the count the drain spends a request on ──────────────────────────
--
-- drain_social_queue counts due work before calling out, so an idle platform
-- costs nothing. Without the same condition it would count paused posts as
-- due, wake social-publish every minute, and the claim would hand back
-- nothing -- an idle loop that looks busy in every log.
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
  /* Settle the uncertain ones first (see the header of this file). */
  update social_posts
     set status = 'failed',
         failure_reason = 'We could not confirm this post went out. Check the channel, then retry it from Needs attention if it is not there.'
   where status = 'publishing' and deleted_at is null
     and updated_at < now() - interval '20 minutes';

  select count(*) into v_due
  from social_posts sp
  where sp.deleted_at is null
    and sp.attempts < sp.max_attempts
    and (
      (sp.status = 'scheduled' and sp.scheduled_at <= now())
    )
    -- THE ONLY CHANGE. 0081's body is otherwise reproduced exactly, including
    -- the request it sends: limit 25 and no `live` flag. A first draft of this
    -- invented both, which would have quietly changed what the scheduler asks
    -- the publisher to do -- the same mistake connect_social_account taught
    -- earlier this week, caught the same way: read the original first.
    and not exists (
      select 1 from campaigns c
       where c.id = sp.campaign_id and c.status = 'paused'
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

comment on function public.drain_social_queue() is
  'Wakes social-publish when there is due work, counting it first so an idle '
  'platform costs nothing. Paused campaigns are excluded from the count as '
  'well as from the claim -- otherwise the drain fires every minute for posts '
  'the claim will refuse to hand over.';

revoke all on function public.drain_social_queue() from public, anon, authenticated;

create index if not exists social_posts_claimable
  on public.social_posts (scheduled_at)
  where deleted_at is null and status in ('scheduled', 'publishing');


