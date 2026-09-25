-- Pausing a campaign actually pauses it.
--
-- Eden: "are you done with the campaign page?" Not quite, and this is why.
--
-- The card has a "Pause campaign" button. It writes campaigns.status =
-- 'paused' and toasts "Campaign paused". Nothing anywhere reads that status
-- when publishing: social-publish does not mention campaigns at all, and
-- neither claim function has ever heard of them. So a paused campaign's
-- scheduled posts go out on time, exactly as if it were running.
--
-- That is the same defect as the invented creatives removed this morning -- a
-- control that reports an outcome it does not produce -- and it is worse in
-- one respect. A fabricated CTR misleads; a pause button that does not pause
-- publishes an agency's listing after they told it not to.
--
-- ── the gate goes in the claim, not in the publisher ────────────────────
--
-- Two reasons. The claim is the single narrow point every post passes
-- through -- the cron drain and the portal's "Post now" both reach the
-- platform through these two functions -- so one condition here covers every
-- route. And a post that is skipped at claim time is left untouched at
-- 'scheduled': resuming the campaign needs no repair, because nothing was
-- ever marked as attempted.
--
-- Filtering in the publisher instead would mean claiming a row, incrementing
-- attempts, and then deciding not to send it -- which burns a retry and
-- eventually exhausts max_attempts on a post whose only fault was being
-- paused.
--
-- ── what counts as paused ────────────────────────────────────────────────
--
-- Only 'paused'. campaign_status also has 'draft' and 'completed', and
-- neither should hold a post:
--
--   draft      a campaign being written. Its posts are scheduled deliberately
--              and holding them would be a surprise.
--   completed  the campaign has run its course. A post still queued under it
--              was scheduled on purpose and the agency can remove it.
--
-- NULL campaign_id is untouched, which is nearly every post in the system.
-- A post belonging to no campaign cannot be paused by one.

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
          or (sp.status = 'publishing' and sp.updated_at < now() - interval '5 minutes')
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
          or (sp.status = 'publishing' and sp.updated_at < now() - interval '5 minutes')
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
  select count(*) into v_due
  from social_posts sp
  where sp.deleted_at is null
    and sp.attempts < sp.max_attempts
    and (
      (sp.status = 'scheduled' and sp.scheduled_at <= now())
      or (sp.status = 'publishing' and sp.updated_at < now() - interval '5 minutes')
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
