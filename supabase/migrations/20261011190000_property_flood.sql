-- RIVER FLOOD EXPOSURE PER LISTING (Eden, 2026-10-11: layer hazard data for safety).
-- Source: JRC / Copernicus GloFAS global river flood hazard maps v2.1.2 (90 m, free to use), the
-- 100-year and 10-year return-period flood DEPTH rasters, read at the listing's exact pin by the
-- property-flood function. It is a RIVER flood model only: it does not cover heavy-rain drainage
-- flooding or coastal and lagoon surge, which is most of Lagos' flooding. The page says so beside
-- every result; "outside the zone" is never shown as "safe".
-- Not a government map: there is no public Nigerian flood-hazard layer we could source.
create table if not exists public.property_flood (
  property_id  uuid primary key references public.properties(id) on delete cascade,
  in_zone_100  boolean not null,                 -- inside the modelled 100-year river flood extent
  depth_100_m  numeric(5,2),                     -- modelled depth there, metres (null when outside)
  in_zone_10   boolean not null default false,   -- also flooded in a 10-year event (frequent)
  depth_10_m   numeric(5,2),
  covered      boolean not null default true,    -- false when the pin is outside the tiles we read
  source       text not null default 'JRC GloFAS v2.1.2',
  checked_at   timestamptz not null default now()
);
alter table public.property_flood enable row level security;
-- Derived from the already-public (rounded) area; safe to read. Writes belong to the function (service role).
drop policy if exists property_flood_read on public.property_flood;
create policy property_flood_read on public.property_flood for select to anon, authenticated using (true);
revoke insert, update, delete on public.property_flood from anon, authenticated;
