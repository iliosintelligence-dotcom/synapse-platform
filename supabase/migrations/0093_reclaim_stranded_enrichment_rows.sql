-- A row that went 'running' and produced no places was stranded forever.
--
-- enrich_due_properties picks up status in ('pending','failed') and never
-- 'running'. settle_enrichment_queue fails a 'running' row only when
-- attempts >= max_attempts. But attempts is incremented ONLY by the drainer,
-- which will not touch a 'running' row. So a row at attempts=1 of 4 could
-- never be retried (wrong status) and never be failed (too few attempts).
-- Twenty-three properties sat in that limbo for a day while the cron ran
-- every two minutes doing nothing about them.
--
-- The missing piece is a lease. Claiming work has to expire, or a worker that
-- dies takes the row with it. Fifteen minutes is comfortably longer than the
-- 120s http timeout the drainer allows, so this can only catch genuinely
-- abandoned claims, never one still in flight.
--
-- Reclaimed rows go to 'failed', not straight back to 'pending', because
-- 'failed' is the status the drainer already retries WITH the backoff in
-- next_attempt_at. Nothing needs to learn a new state.
create or replace function public.settle_enrichment_queue()
 returns integer
 language sql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with settled as (
    update property_enrichment_queue q
       set status = 'done', finished_at = now(), last_error = null
     where q.status in ('pending','running','failed')
       and exists (select 1 from property_places pp where pp.property_id = q.property_id)
    returning 1
  ),
  exhausted as (
    update property_enrichment_queue q
       set status = 'failed',
           last_error = coalesce(q.last_error,
             'No places found after ' || q.attempts || ' attempts. Usually means '
             || 'GOOGLE_MAPS_API_KEY is unset, or nothing is mapped near this address.')
     where q.status = 'running'
       and q.attempts >= q.max_attempts
       and not exists (select 1 from property_places pp where pp.property_id = q.property_id)
    returning 1
  ),
  -- The lease. Disjoint from `exhausted` by the attempts predicate, so a row
  -- is only ever touched by one of the two.
  reclaimed as (
    update property_enrichment_queue q
       set status = 'failed',
           last_error = 'Claimed at ' || coalesce(q.started_at::text, 'unknown')
             || ' and never finished; lease expired, returned for retry.'
     where q.status = 'running'
       and q.attempts < q.max_attempts
       and coalesce(q.started_at, q.queued_at) < now() - interval '15 minutes'
       and not exists (select 1 from property_places pp where pp.property_id = q.property_id)
    returning 1
  )
  select (select count(*) from settled)
       + (select count(*) from exhausted)
       + (select count(*) from reclaimed);
$function$;
