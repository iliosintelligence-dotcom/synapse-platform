-- The hourly rollup over click_events.
--
-- click_events is append-only and will stay that way. When a bot signature
-- turns up three weeks late you reclassify by RE-READING the log, never by
-- rewriting it -- which is the replay property a log-structured pipeline is
-- usually bought for, obtained here from a table and a cron job.
--
-- WHY NOT KAFKA, SAID ONCE AND PROPERLY. The canonical answer to click
-- aggregation is a broker, a stream processor, windowed aggregates and replay.
-- That design earns its complexity at millions of events an hour. This product
-- has six published posts and, today, zero real clicks. The PROPERTIES that
-- matter -- at-least-once made idempotent, immutable raw rows, derived
-- aggregates that can be thrown away and rebuilt -- are all obtainable in
-- Postgres, and they are what actually carry the weight.

-- ── the derived table ─────────────────────────────────────────────────────
-- Every column here is a fact about click_events and nothing else. Dropping
-- this table loses no information: rebuild_click_rollup() reconstructs it in
-- full from the log. That is the whole point of keeping the two separate.
create table if not exists public.click_rollup_hourly (
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null,
  channel     public.attribution_channel not null,
  hour        timestamptz not null,
  clicks      integer not null default 0,   -- every fetch, whatever made it
  humans      integer not null default 0,   -- ua_class = 'human' only
  previews    integer not null default 0,   -- someone SHARED it: real, not a click
  bots        integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (agency_id, property_id, channel, hour)
);

create index if not exists click_rollup_hourly_agency_hour
  on public.click_rollup_hourly (agency_id, hour desc);

-- `previews` is counted rather than discarded because it answers a different
-- question than `humans` does, and it is the one an agency actually asks
-- second: "did anyone pass this on?" A preview fetch means the link was pasted
-- somewhere -- into WhatsApp, into a group, into a DM. That is a share, and a
-- share is worth more than a click. Folding it into `bots` would throw it away.

-- ── the rollup ────────────────────────────────────────────────────────────
create or replace function public.rollup_click_events(p_hours integer default 26)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_since timestamptz;
  v_due   integer;
  v_rows  integer;
begin
  -- A TRAILING WINDOW, RECOMPUTED, rather than a watermark advanced past work
  -- already done. Three reasons, in order of how much they matter:
  --
  --   * it is idempotent by construction -- the upsert below SETS counts read
  --     from the log, it never increments, so running this twice in the same
  --     minute produces the same table as running it once;
  --   * it is self-healing -- a run that is missed, or that dies halfway, is
  --     repaired by the next one with no operator involvement and no state to
  --     reconcile;
  --   * it absorbs late rows. A click written during the previous run's
  --     transaction is invisible to it and would sit forever on the far side
  --     of a watermark.
  --
  -- 26 hours rather than 24: a full day plus room for clock skew and for a
  -- couple of missed runs, still bounded and still cheap.
  v_since := date_trunc('hour', now()) - make_interval(hours => greatest(1, least(coalesce(p_hours, 26), 720)));

  -- DUE WORK FIRST, exactly as drain_social_queue does. A job that wakes every
  -- hour to be told "nothing" 24 times a day should cost one count, not a full
  -- aggregate and an upsert over an empty set.
  select count(*) into v_due from click_events where occurred_at >= v_since;
  if v_due = 0 then
    return 0;
  end if;

  insert into click_rollup_hourly as r
    (agency_id, property_id, channel, hour, clicks, humans, previews, bots, computed_at)
  select ce.agency_id,
         ce.property_id,
         ce.channel,
         date_trunc('hour', ce.occurred_at),
         count(*),
         count(*) filter (where ce.ua_class = 'human'),
         count(*) filter (where ce.ua_class = 'preview'),
         count(*) filter (where ce.ua_class = 'bot'),
         now()
    from click_events ce
   where ce.occurred_at >= v_since
   group by 1, 2, 3, 4
  on conflict (agency_id, property_id, channel, hour) do update
     set clicks      = excluded.clicks,     -- SET, never r.clicks + excluded.clicks:
         humans      = excluded.humans,     -- the recomputed value IS the answer, and
         previews    = excluded.previews,   -- adding would double every bucket on the
         bots        = excluded.bots,       -- second pass over the same window.
         computed_at = excluded.computed_at;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

-- ── the proof that the aggregate is disposable ────────────────────────────
-- Not a convenience. If this cannot be run, then click_rollup_hourly has
-- quietly become the system of record and the append-only log underneath it is
-- decoration. Reclassifying three weeks of bot traffic is exactly this call.
create or replace function public.rebuild_click_rollup()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_rows integer;
begin
  delete from click_rollup_hourly;
  -- 720 hours is the cap rollup_click_events accepts; for a log this size it is
  -- the whole of it. If the log ever outgrows that, this becomes a loop over
  -- windows rather than a bigger number.
  select public.rollup_click_events(720) into v_rows;
  return v_rows;
end;
$function$;

-- ── who may read it ───────────────────────────────────────────────────────
alter table public.click_rollup_hourly enable row level security;

drop policy if exists click_rollup_select on public.click_rollup_hourly;
create policy click_rollup_select on public.click_rollup_hourly
  for select using (public.is_agency_member(agency_id));

-- No insert, update or delete policy, deliberately. The only writer is
-- rollup_click_events, which is SECURITY DEFINER and needs none. A rollup any
-- client could write into is not a measurement.

-- PUBLIC has to be named. Postgres grants EXECUTE to PUBLIC by default and anon
-- inherits it, so revoking anon alone removes a grant that was never the one
-- doing the work -- the mistake 0095 shipped and 0095's follow-up corrected.
revoke all on function public.rollup_click_events(integer) from public, anon, authenticated;
revoke all on function public.rebuild_click_rollup()      from public, anon, authenticated;

-- ── the schedule ──────────────────────────────────────────────────────────
-- Hourly, on the hour, and not more often. The bucket IS an hour, so a
-- five-minute tick would rewrite the same open bucket twelve times to produce a
-- number nobody reads between refreshes of a dashboard. The current hour stays
-- partial until it closes, which is a property of hourly buckets rather than a
-- defect -- and short_links.click_count, updated on the click itself, is what
-- answers "how is this post doing right now".
select cron.schedule('rollup-click-events', '0 * * * *',
                     $$select public.rollup_click_events()$$);
