-- 0056_property_places_real_surroundings.sql
--
-- Real places around a real property, stored.
--
-- The property page shipped with "Neighbourhood intelligence -- Lekki Phase 1"
-- written into the HTML: six invented score bars and a note about a rising
-- corridor with ₦8.5M rents, rendered identically on every listing in the
-- database. A one-bedroom flat at 13 Aafin Iyanu, Ologuneru, in Ibadan carried
-- Lekki's numbers, 130km away.
--
-- Rewriting that text would only have moved the problem. There was nowhere for
-- per-property surroundings to live: `neighbourhoods` holds area-level data and
-- has exactly two Ibadan rows, both synthetic_seed and unverified;
-- `property_enrichment` holds scores and prose but nothing spatial. So the page
-- had no true answer available, and used a hardcoded one.
--
-- This is the missing table. One row per real place near one property, fetched
-- from Google Places by the property-intelligence edge function and written
-- with the service role. The client only ever reads it, which means:
--   · the Google key never reaches a browser, where it would be world-readable
--   · one fetch per listing, not one per visitor -- which is what keeps the bill finite
--   · every visitor sees the same answer, and it survives the provider being down
--   · "4 schools within 2km" becomes a count over real rows, not a typed sentence
--
-- A house in Benin City gets Benin City's places, because every lookup is driven
-- by that property's own coordinates. Nothing here is city-specific.

create table if not exists public.property_places (
  id                uuid primary key default gen_random_uuid(),
  property_id       uuid not null references public.properties(id) on delete cascade,

  -- Google's stable id for the place, so a refresh updates rather than duplicates.
  provider_place_id text not null,
  name              text not null,
  category          text not null,          -- hospital | school | market | supermarket | transit | university | mall | pharmacy | bank | park
  lat               double precision,
  lon               double precision,

  -- Straight-line, always computable. Driving figures come from Distance Matrix
  -- and stay NULL when it could not answer -- never estimated from distance,
  -- which is how the old panel produced "Lekki Phase 1 gate, 6 min".
  distance_m        integer,
  drive_seconds     integer,
  drive_text        text,

  -- Google's own signal for whether a place actually matters locally. A market
  -- with 2,000 ratings is a landmark; one with three is a shopfront.
  rating            numeric(2,1),
  ratings_count     integer,

  source            text not null default 'google_places',
  fetched_at        timestamptz not null default now(),

  unique (property_id, provider_place_id)
);

create index if not exists property_places_by_property
  on public.property_places (property_id, category, distance_m);

comment on table public.property_places is
  'Real named places near a specific property, from Google Places, written server-side. Replaces the hardcoded neighbourhood block on the property page.';
comment on column public.property_places.drive_seconds is
  'Driving time from Distance Matrix. NULL means we could not measure it -- never infer one from distance.';
comment on column public.property_places.ratings_count is
  'How many people have rated this place on Google. Used to rank landmarks above shopfronts.';

-- ── who may read ────────────────────────────────────────────────────────────
alter table public.property_places enable row level security;

-- Anyone who can see the listing can see what is around it. Scoped through the
-- property so a draft or deleted listing does not leak its surroundings.
drop policy if exists property_places_public_read on public.property_places;
create policy property_places_public_read on public.property_places
  for select to anon, authenticated
  using (exists (
    select 1 from public.properties p
    where p.id = property_places.property_id
      and p.deleted_at is null
      and p.is_active
      and p.status = 'live'
  ));

-- Writes are the fetcher's alone. No client path creates or edits a place.
revoke all on public.property_places from anon, authenticated;
grant select on public.property_places to anon, authenticated;
grant all on public.property_places to service_role;

-- ── what the page asks for ──────────────────────────────────────────────────
-- One call, ordered the way the card renders: nearest first, landmarks ahead of
-- shopfronts where distances tie.
create or replace function public.property_surroundings(p_property_id uuid, p_limit integer default 12)
returns table (
  name text, category text, distance_m integer,
  drive_seconds integer, drive_text text,
  rating numeric, ratings_count integer, fetched_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select pp.name, pp.category, pp.distance_m, pp.drive_seconds, pp.drive_text,
         pp.rating, pp.ratings_count, pp.fetched_at
  from property_places pp
  where pp.property_id = p_property_id
  order by pp.distance_m nulls last, pp.ratings_count desc nulls last
  limit greatest(1, least(coalesce(p_limit, 12), 60));
$$;

grant execute on function public.property_surroundings(uuid, integer) to anon, authenticated;

-- Verified against the live database (2026-08-17):
--   rows written as the fetcher writes them   -> readable through the RPC
--   ordering                                  -> nearest first, ties by ratings
--   property page reads it                    -> UCH Ibadan 15 min, Bodija
--                                                Market 13 min, University of
--                                                Ibadan 21 min, sourced to Google
--   probe rows removed                        -> 0 rows remaining
-- The function returns 503 until GOOGLE_MAPS_API_KEY is set, and writes nothing.
