-- 0058_consumer_places.sql
--
-- Where a person actually goes, so a listing can be measured against their life.
--
-- RECORDED AFTER THE FACT. This table and my_places() were applied to the live
-- database without a migration, so the repo and the database had drifted. This
-- file is written from the live definitions rather than from memory, and is
-- idempotent so re-running it against the existing database is a no-op.
--
-- WHY IT EXISTS
-- consumer_profiles stores work_location as free text. Of 24 profiles, 17 hold
-- the literal string "city centre" and 7 are blank. You cannot measure a
-- distance to "city centre", so the question a buyer actually asks -- "how far
-- is this from my office?" -- had no data behind it, and the property page
-- answered with a hardcoded paragraph instead. There was no gym field and no
-- school field at all.
--
-- A TABLE, NOT COLUMNS. The list is open-ended: work, gym, school, church, a
-- parent's house. Columns would mean a migration every time Toju learns to ask
-- about one more thing, and most people will name two or three, not all of them.
--
-- lat/lon are nullable on purpose. Someone says "I work at Dugbe" in chat long
-- before anything resolves that to a point, and a half-known place is still
-- worth keeping -- it is what lets Toju ask "which Dugbe?" later.

create table if not exists public.consumer_places (
  id                 uuid primary key default gen_random_uuid(),
  consumer_id        uuid not null references public.profiles(id) on delete cascade,

  kind               text not null,     -- workplace | school | gym | worship | family | other
  label              text not null,     -- what they called it, verbatim

  lat                double precision,
  lon                double precision,
  geocode_source     text,              -- 'nominatim' today; 'google' if a key is ever set
  geocoded_at        timestamptz,
  -- 'exact' | 'approximate' | 'failed'. A failure is STORED rather than thrown
  -- away: knowing we tried and could not place "near my mum's" is worth more
  -- than a null that invites another attempt on every page load.
  geocode_confidence text,
  -- What the geocoder actually matched, so "why is my office pinned to a
  -- clinic" is answerable without re-running the lookup.
  geocode_query      text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- One entry per person per kind per name. Someone with two gyms uses 'other'.
  unique (consumer_id, kind, label)
);

create index if not exists consumer_places_by_consumer
  on public.consumer_places (consumer_id, kind);

comment on table public.consumer_places is
  'Where a person goes regularly, geocoded once at save time. Replaces consumer_profiles.work_location, which is free text and reads "city centre" for 17 of 24 profiles.';
comment on column public.consumer_places.geocode_confidence is
  'exact | approximate | failed. my_places() withholds failed and un-geocoded rows, so nothing downstream can measure against a coordinate we do not believe.';

-- ── RLS: your places are yours ──────────────────────────────────────────────
alter table public.consumer_places enable row level security;

drop policy if exists consumer_places_own_select on public.consumer_places;
create policy consumer_places_own_select on public.consumer_places
  for select to authenticated using (consumer_id = auth.uid());

drop policy if exists consumer_places_own_insert on public.consumer_places;
create policy consumer_places_own_insert on public.consumer_places
  for insert to authenticated with check (consumer_id = auth.uid());

drop policy if exists consumer_places_own_update on public.consumer_places;
create policy consumer_places_own_update on public.consumer_places
  for update to authenticated using (consumer_id = auth.uid());

drop policy if exists consumer_places_own_delete on public.consumer_places;
create policy consumer_places_own_delete on public.consumer_places
  for delete to authenticated using (consumer_id = auth.uid());

grant select, insert, update, delete on public.consumer_places to authenticated;
revoke all on public.consumer_places from anon;

-- ── what the property page reads ────────────────────────────────────────────
-- SECURITY INVOKER (the default, stated here because it matters): RLS decides
-- whose places these are, so this cannot be used to read somebody else's life.
-- Rows without a coordinate, and rows whose geocode failed, are withheld
-- entirely -- a caller cannot accidentally measure from a point we do not have.
create or replace function public.my_places()
returns table (kind text, label text, lat double precision, lon double precision, geocode_confidence text)
language sql
stable
set search_path to 'public'
as $$
  select cp.kind, cp.label, cp.lat, cp.lon, cp.geocode_confidence
  from consumer_places cp
  where cp.consumer_id = auth.uid()
    and cp.lat is not null and cp.lon is not null
    and coalesce(cp.geocode_confidence, '') <> 'failed'
  order by cp.kind, cp.label;
$$;

grant execute on function public.my_places() to authenticated;

-- Verified against the live database (2026-08-18):
--   table present, 0 rows                    -> nobody has named a place yet
--   unique (consumer_id, kind, label)        -> matches save-place's upsert target
--   my_places() is SECURITY INVOKER          -> RLS scopes it to the caller
--   save-place deployed                      -> until 2026-08-18 it was not, so
--                                               nothing could ever write here
