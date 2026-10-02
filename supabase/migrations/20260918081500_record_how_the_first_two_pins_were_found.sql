-- The two listings placed before geo_precision existed, labelled.
--
-- Both were geocoded by geocode-listings earlier today, and the run reported
-- which rung each landed on. The column did not exist yet, so the answer was
-- in a log rather than in the row. It is written down here rather than left
-- for a re-run, because geocode-listings only revisits rows with NO
-- coordinates — these have them, so nothing will ever come back for them.
--
--   "Number 4, Ekiti street, Bodija"  -> street  7.416356, 3.902644
--        matched after dropping "Number 4,"; Ekiti Street, Old Bodija is real
--        and mapped, so this pin is on the right street.
--
--   "5 Aafin Iyanu"                   -> city    7.3783681, 3.8972331
--        Aafin Iyanu is not in OpenStreetMap at any spelling and the listing
--        has no area set, so this fell all the way to the Ibadan centroid. It
--        is the weakest pin on the map and should now look like one. Setting
--        the area on that listing would let a re-geocode tighten it.
--
-- Matched on the address rather than a uuid so the intent is legible, and
-- guarded on geo_precision being null so re-running cannot relabel a pin that
-- somebody has since corrected by hand.

update public.properties
   set geo_precision = 'street'
 where btrim(address) = 'Number 4, Ekiti street, Bodija'
   and geo_precision is null
   and latitude is not null;

update public.properties
   set geo_precision = 'city'
 where btrim(address) = '5 Aafin Iyanu'
   and geo_precision is null
   and latitude is not null;
