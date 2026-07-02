-- Digital-twin spec: agencies carry a full business profile; agents get a
-- public professional profile (bio, performance, coverage).
alter table agencies
  add column if not exists description text,
  add column if not exists brand_color text,
  add column if not exists founded_year smallint,
  add column if not exists specialties text[] not null default '{}',
  add column if not exists avg_response_minutes smallint,
  add column if not exists rating numeric(3,2),
  add column if not exists closed_deals integer,
  add column if not exists business_hours text,
  add column if not exists social jsonb not null default '{}'::jsonb;

create table if not exists agent_profiles (
  profile_id uuid primary key references profiles(id) on delete cascade,
  bio text,
  years_experience smallint,
  languages text[] not null default '{}',
  specializations text[] not null default '{}',
  areas_covered text[] not null default '{}',
  response_rate_pct smallint,
  closed_deals integer,
  avg_rating numeric(3,2),
  certifications text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table agent_profiles enable row level security;
drop policy if exists "agent_profiles_public_read" on agent_profiles;
create policy "agent_profiles_public_read" on agent_profiles for select using (true);
