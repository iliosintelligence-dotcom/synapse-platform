-- ARCHIVE THE SEEDED LISTINGS (Eden, 2026-10-11: "we do not have 516 live listings. delete them").
-- 500 of the 516 live listings belong to "Desire Agency" (id de51e000-...-0001), a seed agency created
-- 2026-09-08 with no members, no leads and no saves. They are taken off the site by archiving, not
-- hard-deleting: status becomes 'archived' and deleted_at is set, so every public read stops showing
-- them and nothing is lost if one turns out to matter. A hard delete can follow once nobody wants
-- them back. The ten real listings (Laurel Homes, JAK, Greenlight and others) and the demo agency
-- Lekki Prime Realty are not touched.
update public.properties
   set status = 'archived', deleted_at = coalesce(deleted_at, now())
 where agency_id = 'de51e000-0000-4000-8000-000000000001'
   and status = 'live';
