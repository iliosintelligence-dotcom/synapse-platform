-- 0061_property_places_drive_by_time_of_day.sql
--
-- Drive time at the hours people actually travel.
--
-- The property page used to carry morning / midday / evening buttons, and they
-- multiplied an invented number by another invented number (1.55 and 1.75). I
-- removed them for that reason, which was right, and then left nothing in their
-- place, which was not: "how bad is this at rush hour" is the question a buyer
-- is actually asking, and the answer exists.
--
-- Google's Routes API answers it. computeRouteMatrix takes a departureTime and
-- routingPreference TRAFFIC_AWARE, so a 7:30am figure and a 6pm figure are two
-- measurements rather than one measurement and two guesses. Three columns, one
-- per departure, stored beside the free-flow number already here.
--
-- NULL means we did not measure it -- never a multiple of another column.

alter table public.property_places
  add column if not exists drive_seconds_morning integer,
  add column if not exists drive_seconds_midday  integer,
  add column if not exists drive_seconds_evening integer;

comment on column public.property_places.drive_seconds_morning is
  'Driving time leaving at 07:30 local, traffic-aware, from Google Routes. NULL means unmeasured -- never derived from another column.';
comment on column public.property_places.drive_seconds_midday is
  'Driving time leaving at 13:00 local, traffic-aware.';
comment on column public.property_places.drive_seconds_evening is
  'Driving time leaving at 18:00 local, traffic-aware.';

-- The page reads through this, so it has to carry the new figures.
drop function if exists public.property_surroundings(uuid, integer);

create function public.property_surroundings(p_property_id uuid, p_limit integer default 12)
returns table (
  name text, category text, distance_m integer,
  drive_seconds integer,
  drive_seconds_morning integer, drive_seconds_midday integer, drive_seconds_evening integer,
  drive_text text,
  lat double precision, lon double precision,
  rating numeric, ratings_count integer, fetched_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select pp.name, pp.category, pp.distance_m,
         pp.drive_seconds,
         pp.drive_seconds_morning, pp.drive_seconds_midday, pp.drive_seconds_evening,
         pp.drive_text, pp.lat, pp.lon, pp.rating, pp.ratings_count, pp.fetched_at
  from property_places pp
  where pp.property_id = p_property_id
  order by pp.distance_m nulls last, pp.ratings_count desc nulls last
  limit greatest(1, least(coalesce(p_limit, 12), 60));
$$;

grant execute on function public.property_surroundings(uuid, integer) to anon, authenticated;

-- Applied live as 20260819101304. Recorded here after the fact, which is the
-- drift this file exists to close.
