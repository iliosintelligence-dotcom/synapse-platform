-- Layer 5 · Systems 7 + 8 + 9 — growth analytics, marketplace liquidity,
-- viral loops. Pre-aggregated snapshots only; dashboards never compute from
-- raw rows. Extends the Layer 2 event_type enum with Layer 5 events.

create type price_trend as enum ('rising','stable','falling');
create type market_health_status as enum ('healthy','oversupplied','undersupplied','illiquid');
create type viral_loop_type as enum ('content_loop','transaction_loop','agency_content_loop');

-- ──────────────── growth_metrics (daily snapshots) ────────────────
create table growth_metrics (
  id              uuid primary key default uuid_generate_v4(),
  metric_category text not null,   -- acquisition|activation|retention|revenue|referral|geographic
  metric_name     text not null,
  metric_value    numeric(18,2) not null default 0,
  dimension       jsonb not null default '{}',
  snapshot_date   date not null,
  created_at      timestamptz not null default now(),
  unique (metric_category, metric_name, dimension, snapshot_date)
);
create index idx_growth_metrics on growth_metrics (metric_category, snapshot_date desc);

-- ──────────────── marketplace_health (weekly snapshots) ────────────────
create table marketplace_health (
  id                    uuid primary key default uuid_generate_v4(),
  city                  text not null,
  neighbourhood         text,
  listing_count         integer not null default 0,
  search_volume         integer not null default 0,
  lead_rate_per_listing numeric(8,2) not null default 0,
  avg_days_on_market    numeric(8,2) not null default 0,
  inventory_turnover_rate numeric(8,2) not null default 0,
  price_trend           price_trend not null default 'stable',
  demand_score          numeric(6,2) not null default 0,
  supply_demand_ratio   numeric(8,2) not null default 0,
  health_status         market_health_status not null default 'healthy',
  snapshot_date         date not null,
  created_at            timestamptz not null default now(),
  unique (city, neighbourhood, snapshot_date)
);
create index idx_marketplace_health on marketplace_health (city, snapshot_date desc);

-- ──────────────── viral_loop_events (append-only funnel) ────────────────
create table viral_loop_events (
  id          uuid primary key default uuid_generate_v4(),
  loop_type   viral_loop_type not null,
  step_name   text not null,
  entity_id   uuid not null,
  entity_type text not null,
  session_id  text,
  occurred_at timestamptz not null default now()
);
create index idx_viral_loop_events on viral_loop_events (loop_type, step_name, occurred_at desc);
create trigger viral_loop_events_no_mutate before update or delete on viral_loop_events
  for each row execute function reject_mutation();

-- ──────────────── extend the Layer 2 event_type enum ────────────────
-- Distribution events flow into the existing append-only `events` table.
alter type event_type add value if not exists 'property_published';
alter type event_type add value if not exists 'content_generated';
alter type event_type add value if not exists 'content_approved';
alter type event_type add value if not exists 'social_post_published';
alter type event_type add value if not exists 'campaign_launched';
alter type event_type add value if not exists 'campaign_completed';
alter type event_type add value if not exists 'user_entered_geofence';
alter type event_type add value if not exists 'proximity_alert_triggered';
alter type event_type add value if not exists 'proximity_alert_tapped';
alter type event_type add value if not exists 'discovery_feed_generated';
alter type event_type add value if not exists 'referral_link_created';
alter type event_type add value if not exists 'referral_activated';
alter type event_type add value if not exists 'referral_transacted';
alter type event_type add value if not exists 'reward_issued';
alter type event_type add value if not exists 'marketplace_snapshot_generated';

-- ──────────────── weekly marketplace aggregation ────────────────
-- Computes supply/demand health per city. Idempotent per (city, date).
create or replace function aggregate_marketplace_health(p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into marketplace_health as m (
    city, neighbourhood, listing_count, search_volume, lead_rate_per_listing,
    supply_demand_ratio, demand_score, health_status, snapshot_date
  )
  select
    p.city, null,
    count(distinct p.id) filter (where p.is_active and p.status = 'live'),
    coalesce((select count(*) from chat_sessions cs where cs.pref_city ilike p.city), 0),
    coalesce(count(distinct l.id)::numeric / nullif(count(distinct p.id), 0), 0),
    coalesce(count(distinct l.id)::numeric / nullif(count(distinct p.id), 0), 0),
    coalesce(count(distinct l.id), 0),
    'healthy',
    p_date
  from properties p
  left join leads l on l.property_id = p.id and l.created_at > now() - interval '30 days'
  group by p.city
  on conflict (city, neighbourhood, snapshot_date) do update set
    listing_count = excluded.listing_count,
    search_volume = excluded.search_volume,
    lead_rate_per_listing = excluded.lead_rate_per_listing,
    supply_demand_ratio = excluded.supply_demand_ratio,
    demand_score = excluded.demand_score;

  -- classify health from the supply/demand ratio (search vs listings)
  update marketplace_health set health_status = case
    when listing_count = 0 then 'illiquid'
    when search_volume < 3 then 'illiquid'
    when search_volume::numeric / nullif(listing_count, 0) > 1.5 then 'undersupplied'
    when search_volume::numeric / nullif(listing_count, 0) < 0.5 then 'oversupplied'
    else 'healthy'
  end
  where snapshot_date = p_date;
end;
$$;

select cron.schedule(
  'synapse-marketplace-weekly',
  '0 3 * * 1',
  $$select aggregate_marketplace_health((now())::date)$$
);
