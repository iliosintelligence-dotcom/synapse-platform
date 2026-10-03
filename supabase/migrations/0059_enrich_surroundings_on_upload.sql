-- 0059_enrich_surroundings_on_upload.sql
--
-- Look up a property's surroundings the moment it is uploaded, not when
-- somebody finally asks.
--
-- property_places (0056) and the property-intelligence function both existed,
-- and nothing ever called either. An agent could upload a listing with perfect
-- coordinates and its surroundings stayed empty until a curl was run by hand.
-- The first visitor to open that listing then paid a 25-second OpenStreetMap
-- lookup, and so did every visitor after them, because nothing was stored.
--
-- Now the agent uploads and, by the time a buyer opens the page, the answer is
-- already in the database.
--
-- A QUEUE, NOT AN HTTP CALL INSIDE THE TRIGGER. Calling a geocoder in the same
-- transaction that inserts a property would make listing creation as slow as
-- the slowest provider, and as reliable as the least reliable one. Uploading a
-- property must never depend on Google being up. This mirrors message_outbox
-- and the social publish queue, both already proven in this codebase.

create table if not exists public.property_enrichment_queue (
  property_id     uuid primary key references public.properties(id) on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending','running','done','failed','skipped')),
  attempts        integer not null default 0,
  max_attempts    integer not null default 4,
  last_error      text,
  queued_at       timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  next_attempt_at timestamptz not null default now()
);

create index if not exists property_enrichment_queue_due
  on public.property_enrichment_queue (next_attempt_at)
  where status in ('pending','running');

comment on table public.property_enrichment_queue is
  'One row per property whose surroundings need looking up. Written by a trigger on upload; drained on a schedule by enrich_due_properties().';

alter table public.property_enrichment_queue enable row level security;
revoke all on public.property_enrichment_queue from anon, authenticated;
grant all on public.property_enrichment_queue to service_role;

-- ── the trigger ─────────────────────────────────────────────────────────────
create or replace function public.queue_property_enrichment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  -- No coordinates, nothing to look up. Not an error: the listing form allows
  -- saving without a pin, and property_places would rather be absent than wrong.
  if new.latitude is null or new.longitude is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.latitude is not distinct from new.latitude
     and old.longitude is not distinct from new.longitude then
    return new;                                  -- moved nothing; leave the queue alone
  end if;

  -- A moved pin means the stored places describe somewhere else.
  if tg_op = 'UPDATE' then
    delete from property_places where property_id = new.id;
  end if;

  insert into property_enrichment_queue (property_id, status, attempts, next_attempt_at)
  values (new.id, 'pending', 0, now())
  on conflict (property_id) do update
    set status = 'pending', attempts = 0, last_error = null,
        queued_at = now(), next_attempt_at = now(), finished_at = null;

  return new;
exception when others then
  -- Enrichment is a nicety; uploading a property is not. Never fail the insert.
  raise warning 'queue_property_enrichment: %', sqlerrm;
  return new;
end;
$fn$;

drop trigger if exists properties_queue_enrichment on public.properties;
create trigger properties_queue_enrichment
  after insert or update of latitude, longitude on public.properties
  for each row execute function public.queue_property_enrichment();

-- ── the drain ───────────────────────────────────────────────────────────────
-- Reads the service key from Vault rather than carrying it in the cron
-- definition, where anyone able to list jobs could read it. pg_net keeps the
-- HTTP call outside the caller's transaction.
--
-- Requires: create extension pg_net; and two Vault secrets, project_url and
-- service_role_key.
create or replace function public.enrich_due_properties(p_limit integer default 5)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $fn$
declare
  v_key text; v_url text; r record; n integer := 0;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;

  if v_key is null or v_url is null then
    raise warning 'enrich_due_properties: service_role_key or project_url missing from vault';
    return 0;
  end if;

  for r in
    select q.property_id from property_enrichment_queue q
    where q.status in ('pending','failed')
      and q.attempts < q.max_attempts
      and q.next_attempt_at <= now()
    order by q.queued_at
    limit greatest(1, least(coalesce(p_limit, 5), 25))
  loop
    update property_enrichment_queue
       set status = 'running', attempts = attempts + 1, started_at = now(),
           -- Widening backoff, so a provider outage is not hammered.
           next_attempt_at = now() + (interval '5 minutes' * power(3, attempts))
     where property_id = r.property_id;

    perform net.http_post(
      url     := v_url || '/functions/v1/property-intelligence',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'Authorization','Bearer ' || v_key),
      body    := jsonb_build_object('property_id', r.property_id),
      timeout_milliseconds := 120000
    );
    n := n + 1;
  end loop;
  return n;
end;
$fn$;

revoke all on function public.enrich_due_properties(integer) from public, anon, authenticated;
grant execute on function public.enrich_due_properties(integer) to service_role;

-- ── settling ────────────────────────────────────────────────────────────────
-- Whether a property is enriched is observable: it either has rows in
-- property_places or it does not. So the queue settles from the evidence rather
-- than trusting a caller to report back. That also means a backfill run by hand,
-- or any future writer that knows nothing about this queue, still marks the work
-- finished.
create or replace function public.settle_enrichment_queue()
returns integer
language sql
security definer
set search_path to 'public'
as $fn$
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
  )
  select (select count(*) from settled) + (select count(*) from exhausted);
$fn$;

revoke all on function public.settle_enrichment_queue() from public, anon, authenticated;
grant execute on function public.settle_enrichment_queue() to service_role;

-- ── schedules ───────────────────────────────────────────────────────────────
-- Drain on even minutes, settle on odd, so a property enriched on one tick is
-- marked on the next rather than retried needlessly. Both are live on this
-- project. Left commented because cron.schedule is not idempotent and a second
-- apply would create duplicate jobs.
--
--   select cron.schedule('enrich-property-surroundings', '*/2 * * * *',
--                        'select public.enrich_due_properties(5)');
--   select cron.schedule('settle-enrichment-queue', '1-59/2 * * * *',
--                        'select public.settle_enrichment_queue()');

-- Verified against the live database (2026-08-18):
--   trigger fires on a coordinate change   -> row enqueued
--   six existing listings backfilled       -> 6 pending
--   pg_net + pg_cron enabled               -> yes
--   project_url in vault                   -> yes
--   service_role_key in vault              -> NO. The drain warns and returns 0
--                                             until it is set: deliberately
--                                             loud rather than quietly idle.
