-- A PIN SHOULD SAY HOW SURE IT IS.
--
-- Listings are geocoded from their address down a ladder: the address as
-- typed, the address minus a leading house number, the area, then the city.
-- Nigerian OSM holds streets but almost no house numbers, and plenty of real
-- streets are not mapped at all, so most listings land on the AREA rung —
-- "Agbowo, Ibadan" rather than a doorstep.
--
-- That is the right answer. A pin in the correct neighbourhood is worth far
-- more than no pin: it puts the home in the part of town a buyer is choosing
-- between, which is the question the map answers. What is NOT right is drawing
-- it as though it were surveyed. Two listings geocoded to Agbowo currently get
-- the identical centroid and render as two precise dots on the same spot, and
-- a buyer has no way to tell that from two homes genuinely next door.
--
-- latitude and longitude cannot carry that distinction — a number is a number.
-- So the rung is recorded beside them:
--
--   address   the full address matched. A real position.
--   street    matched after dropping the house number. The right street.
--   area      the neighbourhood centroid. Right part of town, not the house.
--   city      the city centre. Honest last resort; barely a location.
--   manual    somebody typed the coordinates. Beats everything, never
--             overwritten by any automatic pass.
--
-- NULL means the pin predates this column or was seeded, which is most of the
-- table today: 501 of 503 live listings came from twin_seed with coordinates
-- written directly, and nothing knows how precise those were. NULL therefore
-- reads as "unknown", never as "exact" — anything that draws a precision
-- indicator must treat NULL as no-claim rather than as a fifth level.

alter table public.properties
  add column if not exists geo_precision text;

-- Free text would drift into 'Area', 'AREA' and 'approx' within a month, and
-- every reader would then need its own spelling list. NOT VALID so the check
-- applies to new and updated rows without demanding a full-table scan on a
-- live table; every existing row is NULL, which the constraint allows anyway.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'properties_geo_precision_known'
      and conrelid = 'public.properties'::regclass
  ) then
    alter table public.properties
      add constraint properties_geo_precision_known
      check (geo_precision is null
             or geo_precision in ('address', 'street', 'area', 'city', 'manual'))
      not valid;
  end if;
end $$;

comment on column public.properties.geo_precision is
  'Which rung of the geocoding ladder placed this listing: address, street, '
  'area, city, or manual when a human typed the coordinates. NULL means '
  'unknown — seeded or pre-dating the column — and must never be read as exact.';
