-- A listing states its electricity band.
--
-- Under NERC's Service-Based Tariff every feeder in Nigeria is banded by the
-- minimum hours of supply it is committed to, and the band is one of the first
-- questions a Nigerian buyer or tenant asks about a home:
--
--   Band A   at least 20 hours a day
--   Band B   at least 16
--   Band C   at least 12
--   Band D   at least 8
--   Band E   at least 4
--
-- It is not a nice-to-have detail here the way "utilities included" is
-- elsewhere. The difference between Band A and Band D is the difference
-- between a generator being a backup and a generator being the supply, and it
-- changes the real monthly cost of living in the place by more than most of
-- the charges the listing already itemises.
--
-- An enum rather than free text, for the same reason amenities stopped being
-- free text: a band is a fixed, externally-defined vocabulary, and "Band A",
-- "band a" and "A" must never become three different answers to one question.
--
-- Nullable, and null means the agency has not stated it. Deliberately NOT
-- defaulted to anything: guessing a band would be inventing a utility
-- commitment on a distribution company's behalf.
--
-- The band belongs to the FEEDER, not the building, so it is ultimately a
-- property of the area rather than of the listing -- see the backlog note on
-- mapping bands to neighbourhoods. Stating it per listing is the right first
-- step regardless: the agency knows the answer today, and a per-area map has
-- to be checked against something.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'electricity_band_kind') then
    create type electricity_band_kind as enum ('A', 'B', 'C', 'D', 'E');
  end if;
end $$;

alter table properties
  add column if not exists electricity_band electricity_band_kind;

comment on column properties.electricity_band is
  'NERC Service-Based Tariff band of the feeder serving this property. A>=20h/day, B>=16, C>=12, D>=8, E>=4. Null means the agency has not stated it; never guessed.';
