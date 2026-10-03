-- Layer 1 · schema
-- Every table: uuid pk, created_at, updated_at, soft delete via deleted_at.

-- ───────────────────────── enums ─────────────────────────
create type user_role as enum ('consumer','agent','agency_admin','agency_owner','platform_admin');
create type verification_tier as enum ('unverified','basic','verified','gold');
create type property_type as enum ('apartment','house','duplex','terrace','penthouse','bungalow','land','commercial');
create type listing_type as enum ('sale','rent','shortlet');
create type price_period as enum ('total','per_year','per_month','per_night');
create type property_status as enum ('draft','pending_review','live','under_offer','sold','rented','archived');
create type verification_status as enum ('unverified','in_progress','verified');
create type title_type as enum ('c_of_o','governors_consent','registered_deed','excision','gazette','allocation');
create type media_type as enum ('image','video','floor_plan','document');
create type viewing_status as enum ('requested','confirmed','completed','cancelled','no_show');

-- ─────────────────── updated_at trigger fn ───────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ───────────────────────── profiles ─────────────────────────
-- Extends auth.users 1:1. Auto-created on signup (see trigger below).
create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        user_role not null default 'consumer',
  full_name   text not null default '',
  phone       text,
  whatsapp    text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- Auto-create profile on signup. Role + name read from signup metadata.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'consumer'),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ───────────────────────── agencies ─────────────────────────
create table agencies (
  id                 uuid primary key default uuid_generate_v4(),
  owner_id           uuid not null references profiles (id) on delete restrict,
  name               text not null,
  logo_url           text,
  cac_number         text,
  verification_tier  verification_tier not null default 'unverified',
  whatsapp_number    text,
  city               text not null,
  address            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create trigger agencies_updated_at before update on agencies
  for each row execute function set_updated_at();
create index idx_agencies_city on agencies (city);
create index idx_agencies_owner on agencies (owner_id);

-- ─────────────────────── agency_members ───────────────────────
create table agency_members (
  id          uuid primary key default uuid_generate_v4(),
  agency_id   uuid not null references agencies (id) on delete cascade,
  profile_id  uuid not null references profiles (id) on delete cascade,
  role        user_role not null check (role in ('agent','agency_admin','agency_owner')),
  joined_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (agency_id, profile_id)
);
create trigger agency_members_updated_at before update on agency_members
  for each row execute function set_updated_at();
create index idx_agency_members_profile on agency_members (profile_id);
create index idx_agency_members_agency on agency_members (agency_id);

-- Membership lookup used by RLS policies. SECURITY DEFINER so policies
-- can check membership without recursive RLS evaluation.
create or replace function is_agency_member(p_agency_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from agency_members
    where agency_id = p_agency_id
      and profile_id = auth.uid()
      and deleted_at is null
  );
$$;

create or replace function agency_role(p_agency_id uuid)
returns user_role language sql security definer stable set search_path = public as $$
  select role from agency_members
  where agency_id = p_agency_id
    and profile_id = auth.uid()
    and deleted_at is null
  limit 1;
$$;

-- ───────────────────────── properties ─────────────────────────
-- Designed for future AI, geospatial and verification features without
-- schema changes: jsonb for nodes/tco, PostGIS geography, score columns.
create table properties (
  id                   uuid primary key default uuid_generate_v4(),
  agency_id            uuid not null references agencies (id) on delete cascade,
  title                text not null,
  description          text not null default '',
  property_type        property_type not null,
  listing_type         listing_type not null,
  price                numeric(16,2) not null check (price >= 0),
  price_period         price_period not null default 'total',
  move_in_cost         numeric(16,2),
  bedrooms             smallint,
  bathrooms            smallint,
  area_sqm             numeric(10,2),
  address              text not null,
  city                 text not null,
  state                text not null,
  country              text not null default 'Nigeria',
  latitude             double precision,
  longitude            double precision,
  -- geography column maintained from lat/lng for proximity queries
  location             geography(point, 4326),
  status               property_status not null default 'draft',
  amenities            text[] not null default '{}',
  tco_breakdown        jsonb,
  verification_status  verification_status not null default 'unverified',
  trust_score          smallint check (trust_score between 0 and 100),
  verification_nodes   jsonb not null default '[]',
  yield_pct            numeric(5,2),
  expires_at           timestamptz,
  is_active            boolean not null default true,
  service_charge       numeric(16,2),
  title_type           title_type,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create trigger properties_updated_at before update on properties
  for each row execute function set_updated_at();

-- Keep geography in sync with lat/lng
create or replace function sync_property_location()
returns trigger language plpgsql as $$
begin
  if new.latitude is not null and new.longitude is not null then
    new.location = st_setsrid(st_makepoint(new.longitude, new.latitude), 4326)::geography;
  else
    new.location = null;
  end if;
  return new;
end;
$$;
create trigger properties_sync_location before insert or update on properties
  for each row execute function sync_property_location();

create index idx_properties_city on properties (city);
create index idx_properties_verification on properties (verification_status);
create index idx_properties_active on properties (is_active);
create index idx_properties_trust on properties (trust_score desc nulls last);
create index idx_properties_created on properties (created_at desc);
create index idx_properties_agency on properties (agency_id);
create index idx_properties_location on properties using gist (location);
create index idx_properties_latlng on properties (latitude, longitude);

-- ─────────────────────── property_media ───────────────────────
create table property_media (
  id                    uuid primary key default uuid_generate_v4(),
  property_id           uuid not null references properties (id) on delete cascade,
  url                   text not null,
  cloudinary_public_id  text not null,
  media_type            media_type not null default 'image',
  display_order         smallint not null default 0,
  width                 integer,
  height                integer,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create trigger property_media_updated_at before update on property_media
  for each row execute function set_updated_at();
create index idx_property_media_property on property_media (property_id, display_order);

-- ─────────────────────── saved_properties ───────────────────────
create table saved_properties (
  id           uuid primary key default uuid_generate_v4(),
  consumer_id  uuid not null references profiles (id) on delete cascade,
  property_id  uuid not null references properties (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (consumer_id, property_id)
);
create trigger saved_properties_updated_at before update on saved_properties
  for each row execute function set_updated_at();
create index idx_saved_properties_consumer on saved_properties (consumer_id);

-- ───────────────────────── viewings ─────────────────────────
create table viewings (
  id            uuid primary key default uuid_generate_v4(),
  property_id   uuid not null references properties (id) on delete cascade,
  consumer_id   uuid not null references profiles (id) on delete cascade,
  agency_id     uuid not null references agencies (id) on delete cascade,
  scheduled_at  timestamptz not null,
  status        viewing_status not null default 'requested',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger viewings_updated_at before update on viewings
  for each row execute function set_updated_at();
create index idx_viewings_consumer on viewings (consumer_id);
create index idx_viewings_agency on viewings (agency_id);
create index idx_viewings_property on viewings (property_id);
create index idx_viewings_created on viewings (created_at desc);
