-- The map was capped in three places and this was the last one.
--
-- property-intelligence kept 14 of the places it fetched; the page asked for
-- 60; and this function silently reduced anything larger back to 60 again --
-- least(coalesce(p_limit, 12), 60). A caller asking for 500 got 60 and no
-- indication that it had been trimmed.
--
-- A survey is now several hundred places per listing (508 for the Agbowo
-- flat), and a map is a description of what is physically there: you filter
-- it for display, you do not delete it at the source. The guard stays, because
-- an unbounded limit from a browser is a denial-of-service waiting to happen,
-- but it sits above any real survey rather than underneath it.
create or replace function public.property_surroundings(
  p_property_id uuid, p_limit integer default 12
)
returns table (
  name text, category text, distance_m integer, drive_seconds integer,
  drive_seconds_morning integer, drive_seconds_midday integer,
  drive_seconds_evening integer, drive_text text, lat double precision,
  lon double precision, rating numeric, ratings_count integer,
  fetched_at timestamp with time zone
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select pp.name, pp.category, pp.distance_m,
         pp.drive_seconds,
         pp.drive_seconds_morning, pp.drive_seconds_midday, pp.drive_seconds_evening,
         pp.drive_text, pp.lat, pp.lon, pp.rating, pp.ratings_count, pp.fetched_at
  from property_places pp
  where pp.property_id = p_property_id
  order by pp.distance_m nulls last, pp.ratings_count desc nulls last
  limit greatest(1, least(coalesce(p_limit, 12), 1500));
$function$;
