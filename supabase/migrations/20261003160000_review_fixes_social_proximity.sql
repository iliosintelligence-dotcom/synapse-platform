-- Greptile's focused review (synapse-platform PR #6): the real findings.
--
-- 1. A post being published is held for 20 minutes, not 5. An Instagram
--    video may take five minutes to process; a second drain reclaiming the
--    row inside that window published the same post twice. (The function
--    bodies below are 20260926120000's, with only the lease changed.)
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
          or (sp.status = 'publishing' and sp.updated_at < now() - interval '20 minutes')
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
          or (sp.status = 'publishing' and sp.updated_at < now() - interval '20 minutes')
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
      or (sp.status = 'publishing' and sp.updated_at < now() - interval '20 minutes')
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


-- 2. A buyer's alerts are theirs. An anonymous watch is held by a secret
--    only the browser that made it knows (sha-256 stored, never the secret).
alter table geofence_watches add column if not exists secret_hash text;

-- 3. The daily cap holds under concurrency. Picking the homes and recording
--    the alerts happen in ONE transaction with the watch row locked, so two
--    position reports arriving together cannot both spend the same slots.
create or replace function public.claim_proximity_alerts(p_watch_id uuid)
returns table (notification_id uuid, property_id uuid, title text, distance_m double precision, is_verified boolean)
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
#variable_conflict use_column
declare
  w public.geofence_watches%rowtype;
begin
  select * into w from public.geofence_watches where id = p_watch_id for update;
  if not found or not w.enabled then return; end if;
  return query
  with c as (select * from public.proximity_candidates(p_watch_id)),
  ins as (
    insert into public.notifications (recipient_id, visitor_id, channel, kind, side, route, property_id, payload, status)
    select w.user_id, case when w.user_id is null then w.visitor_id end, 'push', 'proximity_match', 'customer',
           '/app/property.html?id=' || c.property_id, c.property_id,
           jsonb_build_object(
             'kind', 'proximity_match',
             'title', case when c.is_verified then 'A verified home, right here' else 'A home right where you are' end,
             'body', c.title || ' · ' || round(c.distance_m)::int || 'm away · '
                     || case when c.is_verified then 'verified by Synapse' else 'not yet verified' end,
             'route', '/app/property.html?id=' || c.property_id,
             'propertyId', c.property_id,
             'verified', c.is_verified is true),
           'pending'
    from c
    returning public.notifications.id as nid, public.notifications.property_id as pid
  )
  select ins.nid, ins.pid, c.title, c.distance_m, c.is_verified is true
    from ins join c on c.property_id = ins.pid;
end;
$$;
revoke all on function public.claim_proximity_alerts(uuid) from public, anon, authenticated;
grant execute on function public.claim_proximity_alerts(uuid) to service_role;
