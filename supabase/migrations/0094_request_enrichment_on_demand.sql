-- ENRICH WHAT SOMEBODY ACTUALLY OPENS.
--
-- Backfilling every listing costs 38 Places calls each -- roughly 18,900 for
-- the 498 that have none -- for homes most of which nobody will ever open.
-- This turns that around: a property is surveyed the first time a person
-- looks at it, and the cost follows the attention.
--
-- The viewer does not wait for it. property.html already answers instantly
-- from Overpass when nothing is stored; this only queues the better survey so
-- the NEXT visitor gets it. Nobody pays with their time for the upgrade.
--
-- Callable by anon on purpose: the people opening listings are not signed in.
-- What stops that being a spending hole is that every branch below is a
-- refusal except one, and the one that queues does so exactly once per
-- property. Beyond it the drainer still takes 5 every 2 minutes and Google's
-- daily quota is still the ceiling.
create or replace function public.request_enrichment(p_property_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_status text;
begin
  if p_property_id is null then return 'unknown'; end if;

  -- A real, live listing or nothing. An id that is not one is not an error
  -- worth reporting to a browser; there is simply nothing to do.
  perform 1 from properties p
   where p.id = p_property_id
     and p.status = 'live'
     and p.is_active
     and p.location is not null;
  if not found then return 'unknown'; end if;

  -- Already surveyed. The page would have used the stored rows and never
  -- called this, so reaching here means something raced; either way, no.
  if exists (select 1 from property_places pp where pp.property_id = p_property_id) then
    return 'already';
  end if;

  select q.status into v_status
    from property_enrichment_queue q
   where q.property_id = p_property_id;

  -- Never seen: this is the one branch that spends anything.
  if v_status is null then
    insert into property_enrichment_queue (property_id, status, next_attempt_at)
    values (p_property_id, 'pending', now())
    on conflict (property_id) do nothing;
    return 'queued';
  end if;

  -- A DELIBERATE HOLD STAYS A HOLD. The 475 rows parked at 'skipped' are the
  -- Desire Agency seed, and they are most of the catalogue -- releasing one
  -- every time a visitor browsed a demo listing would spend real money on
  -- data for homes that exist to be deleted after testing. Releasing them is
  -- a decision, not a side effect of someone scrolling.
  if v_status = 'skipped' then return 'held'; end if;

  if v_status in ('pending', 'running', 'done') then return v_status; end if;

  -- Failed with attempts left: a real visit is a fair reason to try again
  -- now rather than wait out the backoff.
  if v_status = 'failed' then
    update property_enrichment_queue
       set status = 'pending', next_attempt_at = least(next_attempt_at, now())
     where property_id = p_property_id
       and attempts < max_attempts;
    if found then return 'requeued'; end if;
    return 'exhausted';
  end if;

  return v_status;
end;
$function$;

revoke all on function public.request_enrichment(uuid) from public;
grant execute on function public.request_enrichment(uuid) to anon, authenticated;
