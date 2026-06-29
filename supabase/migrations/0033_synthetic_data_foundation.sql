-- 0033 · Foundation for the AI-ready synthetic dataset (Lagos lifestyle-reasoning).
-- Adds the intelligence layer the synthetic-data seed needs: neighbourhood +
-- amenity geography, per-property enrichment, consumer life profiles, activity,
-- pgvector embeddings, and the property fields the richer listings require.
-- Everything is RLS-enabled at creation; reference/intelligence tables are
-- readable by any signed-in user, personal data is owner-scoped, and all writes
-- go through the service-role seed/pipeline.

create extension if not exists vector;

-- ───────────────────────── enums ─────────────────────────
create type price_trend_kind as enum ('rising', 'stable', 'softening');
create type amenity_kind as enum (
  'school','hospital','clinic','supermarket','restaurant','cafe','bank','gym',
  'park','mall','coworking','pharmacy','fuel_station','church','mosque'
);
create type price_tier_kind as enum ('budget','mid','premium');
create type furnished_kind as enum ('fully','semi','unfurnished');
create type property_condition_kind as enum ('brand_new','excellent','good','fair','needs_work');

-- extend existing enums for the wider Lagos catalogue
alter type property_type add value if not exists 'detached';
alter type property_type add value if not exists 'shared';
alter type lead_source add value if not exists 'social_instagram';
alter type lead_source add value if not exists 'social_tiktok';
alter type lead_source add value if not exists 'social_facebook';
alter type lead_source add value if not exists 'direct';
alter type lead_source add value if not exists 'search';
alter type lead_source add value if not exists 'referral';

-- ───────────────────────── neighbourhoods ─────────────────────────
create table neighbourhoods (
  id                  uuid primary key default uuid_generate_v4(),
  name                text not null unique,
  area_zone           text not null,
  lat                 double precision not null,
  lon                 double precision not null,
  location            geography(point, 4326),
  vibe                text[] not null default '{}',
  best_for            text[] not null default '{}',
  not_ideal_for       text[] not null default '{}',
  safety_score        smallint, family_score smallint, student_score smallint,
  investment_score    smallint, walkability_score smallint, nightlife_score smallint,
  luxury_score        smallint, noise_score smallint, green_space_score smallint,
  power_reliability   smallint, water_reliability smallint, internet_quality smallint,
  road_quality        smallint, flood_risk smallint,
  avg_rent_1bed       numeric(16,2), avg_rent_2bed numeric(16,2), avg_rent_3bed numeric(16,2),
  avg_sale_price_sqm  numeric(16,2),
  rental_demand       smallint,
  price_trend         price_trend_kind not null default 'stable',
  investment_yield_pct numeric(5,2),
  toju_summary        text,
  investment_thesis   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create or replace function sync_neighbourhood_location()
returns trigger language plpgsql set search_path = public as $$
begin
  new.location = st_setsrid(st_makepoint(new.lon, new.lat), 4326)::geography;
  return new;
end;
$$;
create trigger neighbourhoods_sync_location before insert or update on neighbourhoods
  for each row execute function sync_neighbourhood_location();
create trigger neighbourhoods_updated_at before update on neighbourhoods
  for each row execute function set_updated_at();
create index idx_neighbourhoods_location on neighbourhoods using gist (location);
create index idx_neighbourhoods_zone on neighbourhoods (area_zone);

-- ───────────────────────── amenity_places ─────────────────────────
create table amenity_places (
  id                uuid primary key default uuid_generate_v4(),
  neighbourhood_id  uuid not null references neighbourhoods (id) on delete cascade,
  name              text not null,
  type              amenity_kind not null,
  lat               double precision,
  lon               double precision,
  location          geography(point, 4326),
  rating            numeric(2,1),
  price_tier        price_tier_kind,
  school_type       text,
  school_curriculum text,
  school_annual_fee numeric(16,2),
  opening_hours     text,
  parking           boolean not null default false,
  family_friendly   boolean not null default false,
  walk_from_centre_minutes smallint,
  created_at        timestamptz not null default now()
);
create index idx_amenity_neighbourhood on amenity_places (neighbourhood_id, type);
create index idx_amenity_location on amenity_places using gist (location);

-- ───────────── properties: richer listing fields + neighbourhood link ─────────────
alter table properties
  add column neighbourhood_id  uuid references neighbourhoods (id) on delete set null,
  add column toilets           smallint,
  add column parking_spaces    smallint,
  add column floor_level       smallint,
  add column total_floors      smallint,
  add column year_built        smallint,
  add column is_negotiable     boolean not null default false,
  add column furnished         furnished_kind,
  add column property_condition property_condition_kind;
create index idx_properties_neighbourhood on properties (neighbourhood_id);

-- ───────────────────────── property_enrichment ─────────────────────────
create table property_enrichment (
  property_id                 uuid primary key references properties (id) on delete cascade,
  investment_score            smallint, family_score smallint, young_professional_score smallint,
  student_score               smallint, retirement_score smallint, luxury_score smallint, budget_score smallint,
  rental_yield_estimate_pct   numeric(5,2),
  appreciation_5yr_estimate_pct numeric(5,2),
  total_cost_of_ownership_yearly numeric(16,2),
  commute_to_vi_minutes       smallint,
  commute_to_ikeja_minutes    smallint,
  commute_to_lekki_phase1_minutes smallint,
  nearest_school_minutes      smallint, nearest_school_name text,
  nearest_hospital_minutes    smallint, nearest_hospital_name text,
  nearest_supermarket_minutes smallint, nearest_supermarket_name text,
  toju_summary                text,
  investment_thesis           text,
  who_this_suits              text,
  what_to_watch               text,
  lifestyle_tags              text[] not null default '{}',
  buyer_personas              text[] not null default '{}',
  search_keywords             text[] not null default '{}',
  embedding_text              text,
  embedding                   vector(1536),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create trigger property_enrichment_updated_at before update on property_enrichment
  for each row execute function set_updated_at();
create index idx_enrichment_embedding on property_enrichment using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ───────────────────────── consumer_profiles ─────────────────────────
-- 1:1 life profile for a consumer (profiles row). Synthetic consumers and real
-- ones share the same shape; this is the depth Toju reasons over.
create table consumer_profiles (
  consumer_id              uuid primary key references profiles (id) on delete cascade,
  archetype                text,
  age                      smallint,
  occupation               text,
  employer                 text,
  monthly_income           numeric(16,2),
  marital_status           text,
  children_count           smallint not null default 0,
  future_children          boolean not null default false,
  elderly_dependents       smallint not null default 0,
  pets                     boolean not null default false,
  looking_for              text,
  budget_min               numeric(16,2),
  budget_max               numeric(16,2),
  preferred_neighbourhoods text[] not null default '{}',
  min_bedrooms             smallint,
  move_in_timeline         text,
  work_arrangement         text,
  work_location            text,
  max_commute_minutes      smallint,
  vehicle_count            smallint not null default 0,
  uses_ride_hailing        boolean not null default false,
  school_budget_yearly     numeric(16,2),
  preferred_school_curriculum text,
  healthcare_priority      smallint,
  power_reliability_priority smallint,
  security_priority        smallint,
  lifestyle_tags           text[] not null default '{}',
  nightlife_interest       boolean not null default false,
  green_space_importance   smallint,
  long_term_goal           text,
  embedding_text           text,
  embedding                vector(1536),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger consumer_profiles_updated_at before update on consumer_profiles
  for each row execute function set_updated_at();

-- ───────────────────────── user activity ─────────────────────────
create table property_views (
  id                      uuid primary key default uuid_generate_v4(),
  consumer_id             uuid not null references profiles (id) on delete cascade,
  property_id             uuid not null references properties (id) on delete cascade,
  source                  text not null,
  session_duration_seconds integer,
  scroll_depth_pct        smallint,
  viewed_at               timestamptz not null default now()
);
create index idx_property_views_consumer on property_views (consumer_id, viewed_at desc);
create index idx_property_views_property on property_views (property_id, viewed_at desc);

create table property_searches (
  id            uuid primary key default uuid_generate_v4(),
  consumer_id   uuid not null references profiles (id) on delete cascade,
  query         text not null,
  filters       jsonb not null default '{}',
  results_count integer not null default 0,
  searched_at   timestamptz not null default now()
);
create index idx_property_searches_consumer on property_searches (consumer_id, searched_at desc);

-- ───────────────────────── RLS ─────────────────────────
alter table neighbourhoods enable row level security;
alter table amenity_places enable row level security;
alter table property_enrichment enable row level security;
alter table consumer_profiles enable row level security;
alter table property_views enable row level security;
alter table property_searches enable row level security;

-- Intelligence/reference data: readable by any signed-in user (consumer surfaces
-- need it); writes are service-role only (seed + enrichment pipeline).
create policy neighbourhoods_select on neighbourhoods for select using (auth.uid() is not null);
create policy amenity_places_select on amenity_places for select using (auth.uid() is not null);
create policy property_enrichment_select on property_enrichment for select using (auth.uid() is not null);

-- Personal data: the consumer owns their own.
create policy consumer_profiles_select_own on consumer_profiles for select using (consumer_id = auth.uid());
create policy property_views_own on property_views for all using (consumer_id = auth.uid()) with check (consumer_id = auth.uid());
create policy property_searches_own on property_searches for all using (consumer_id = auth.uid()) with check (consumer_id = auth.uid());
