-- Layer 5 · Systems 3 + 4 — campaigns & proximity marketing
-- Campaigns coordinate distribution across properties/channels/time.
-- Proximity uses PostGIS geofences + the Layer 3 intelligence graph to alert
-- matched users who physically pass a matching verified property.

create type campaign_type as enum (
  'property_showcase','area_focus','property_type','investment_focus','price_range'
);
create type campaign_status as enum ('draft','active','paused','completed');
create type proximity_event_type as enum ('entered','alert_sent','alert_tapped','alert_suppressed');

-- ──────────────── campaigns ────────────────
create table campaigns (
  id                          uuid primary key default uuid_generate_v4(),
  agency_id                   uuid not null references agencies (id) on delete cascade,
  name                        text not null,
  campaign_type               campaign_type not null,
  status                      campaign_status not null default 'draft',
  start_date                  date not null,
  end_date                    date not null,
  target_platforms            text[] not null default '{}',
  target_audience_description text,
  budget_naira                numeric(16,2),
  total_impressions           integer not null default 0,
  total_reach                 integer not null default 0,
  total_inquiries             integer not null default 0,
  total_viewings              integer not null default 0,
  total_closes                integer not null default 0,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz
);
create trigger campaigns_updated_at before update on campaigns
  for each row execute function set_updated_at();
create index idx_campaigns_agency on campaigns (agency_id, status);

-- ──────────────── campaign_assets ────────────────
create table campaign_assets (
  id           uuid primary key default uuid_generate_v4(),
  campaign_id  uuid not null references campaigns (id) on delete cascade,
  property_id  uuid not null references properties (id) on delete cascade,
  content_id   uuid references generated_content (id) on delete set null,
  platform     social_platform not null,
  asset_status social_post_status not null default 'draft',
  created_at   timestamptz not null default now()
);
create index idx_campaign_assets on campaign_assets (campaign_id);

-- Campaign attribution lives in the Layer 2 lead_attribution.campaign_id
-- column already present — no schema change needed here.

-- ──────────────── geofences (PostGIS) ────────────────
create table geofences (
  id            uuid primary key default uuid_generate_v4(),
  property_id   uuid not null references properties (id) on delete cascade,
  agency_id     uuid not null references agencies (id) on delete cascade,
  centre_lat    double precision not null,
  centre_lon    double precision not null,
  radius_metres integer not null default 500,
  -- geography point for ST_DWithin proximity queries
  centre        geography(point, 4326),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (property_id)
);
create trigger geofences_updated_at before update on geofences
  for each row execute function set_updated_at();

create or replace function sync_geofence_centre()
returns trigger language plpgsql as $$
begin
  new.centre = st_setsrid(st_makepoint(new.centre_lon, new.centre_lat), 4326)::geography;
  return new;
end;
$$;
create trigger geofences_sync_centre before insert or update on geofences
  for each row execute function sync_geofence_centre();
create index idx_geofences_centre on geofences using gist (centre);
create index idx_geofences_active on geofences (is_active) where is_active;

-- ──────────────── proximity_events (append-only) ────────────────
create table proximity_events (
  id                 uuid primary key default uuid_generate_v4(),
  user_id            uuid not null references profiles (id) on delete cascade,
  property_id        uuid not null references properties (id) on delete cascade,
  geofence_id        uuid not null references geofences (id) on delete cascade,
  event_type         proximity_event_type not null,
  suppression_reason text,
  occurred_at        timestamptz not null default now()
);
create index idx_proximity_events_user on proximity_events (user_id, occurred_at desc);
create index idx_proximity_events_property on proximity_events (property_id, occurred_at desc);
create trigger proximity_events_no_mutate before update or delete on proximity_events
  for each row execute function reject_mutation();

-- ──────────────── proximity_alert_outcomes ────────────────
create table proximity_alert_outcomes (
  id             uuid primary key default uuid_generate_v4(),
  alert_id       uuid not null,
  user_id        uuid not null references profiles (id) on delete cascade,
  property_id    uuid not null references properties (id) on delete cascade,
  was_tapped     boolean not null default false,
  tapped_at      timestamptz,
  led_to_viewing boolean not null default false,
  led_to_deal    boolean not null default false,
  created_at     timestamptz not null default now()
);
create index idx_proximity_outcomes_user on proximity_alert_outcomes (user_id);

-- Find matching geofences within range of a point, respecting the user's
-- intelligence graph (budget/type/city). Caller passes the user's prefs.
-- SECURITY DEFINER so it can read active verified properties + geofences.
create or replace function proximity_matches(
  p_lat double precision,
  p_lon double precision,
  p_budget_min numeric default null,
  p_budget_max numeric default null,
  p_listing_type listing_type default null,
  p_city text default null
) returns table (
  property_id uuid, geofence_id uuid, distance_metres double precision,
  property_type property_type, bedrooms smallint, city text, price numeric
) language sql security definer set search_path = public as $$
  select p.id, g.id,
         st_distance(g.centre, st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography),
         p.property_type, p.bedrooms, p.city, p.price
  from geofences g
  join properties p on p.id = g.property_id
  where g.is_active
    and p.is_active and p.verification_status = 'verified' and p.status = 'live'
    and st_dwithin(g.centre, st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography, g.radius_metres)
    and (p_budget_min is null or p.price >= p_budget_min)
    and (p_budget_max is null or p.price <= p_budget_max)
    and (p_listing_type is null or p.listing_type = p_listing_type)
    and (p_city is null or p.city ilike p_city)
  order by 3 asc;
$$;
