-- Distance from the home to the nearest modelled flood water (within 3.5 km), for a flood risk score
-- that can tell "right beside a flood zone" from "nowhere near one". Null = none within 3.5 km, or
-- not yet measured (the function fills it in the next time it is asked).
alter table public.property_flood add column if not exists nearest_flood_m integer;
alter table public.property_flood add column if not exists measured boolean not null default false;
