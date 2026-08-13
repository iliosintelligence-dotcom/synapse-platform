-- 0049_remove_columns_nothing_can_honestly_fill.sql
--
-- Subtraction. Every object dropped here was verified empty of real data and
-- unread by any code in either repository before removal.
--
-- The reason to drop rather than leave dormant: a column called
-- `nearest_school_name` is an invitation. Someone will fill it, because it
-- looks like an oversight that it is empty. Removing it makes the decision
-- explicit and survives the person who made it.
--
-- Verified before running:
--   property_enrichment  0 rows   -> dropping its columns loses nothing
--   consumer_profiles    employer NULL on all 24 rows
--   code readers         0 files across Synapse/ and synapse-platform/

-- ── 1. the fictional amenities ──────────────────────────────────────────────
-- 373 template-generated venues that do not exist: "FreshMart Ajah",
-- "General Hospital Apo", "Apo Greenfield Academy" -- name, coordinates,
-- rating and opening hours all produced by seed_rand in twin_seed.sql. The
-- table structure is kept, because a real POI load (OpenStreetMap) belongs in
-- it later. The fiction does not.
delete from public.amenity_places;

comment on table public.amenity_places is
  'EMPTY BY DECISION. Previously held 373 generated placeholder venues whose names and coordinates were fabricated. Only load real, attributable POI data here (e.g. OpenStreetMap, ODbL). Nothing user-facing may cite a row that is not a real place.';

-- ── 2. proximity columns that cannot be truthfully produced ────────────────
-- Fed exclusively from the table emptied above. Lagos had ten schools in that
-- dataset; naming "the nearest school" from a ten-row sample would print a
-- school that is not there, to a person choosing where to raise children.
alter table public.property_enrichment
  drop column if exists nearest_school_minutes,
  drop column if exists nearest_school_name,
  drop column if exists nearest_hospital_minutes,
  drop column if exists nearest_hospital_name,
  drop column if exists nearest_supermarket_minutes,
  drop column if exists nearest_supermarket_name;

-- ── 3. commute in minutes ──────────────────────────────────────────────────
-- Straight-line minutes to Victoria Island is routinely two to three hours at
-- peak, and the line from the mainland crosses the lagoon, so even the
-- distance understates the journey. Minutes derived from it are fiction
-- squared. Distance, explicitly labelled straight-line, is honest and useful;
-- it will be added when the deterministic producer is built.
alter table public.property_enrichment
  drop column if exists commute_to_vi_minutes,
  drop column if exists commute_to_ikeja_minutes,
  drop column if exists commute_to_lekki_phase1_minutes;

-- ── 4. a forecast with no history behind it ────────────────────────────────
-- No historical price data exists anywhere in this system, so there is no
-- input from which a five-year appreciation figure could be computed. Any
-- surface showing it would be showing invention. It is also an opinion of
-- value on an identified property, which is regulated work in Nigeria.
alter table public.property_enrichment
  drop column if exists appreciation_5yr_estimate_pct;

-- ── 5. persona scores with no consumer ─────────────────────────────────────
-- toju-demo reads exactly four archetype columns (investment, student,
-- young_professional, family). These three are read by nothing, anywhere.
alter table public.property_enrichment
  drop column if exists retirement_score,
  drop column if exists luxury_score,
  drop column if exists budget_score;

-- ── 6. the index that indexes nothing ──────────────────────────────────────
-- ivfflat at lists=100 trains its centroids from the data; with zero rows
-- there is nothing to train on, and it is tuned for an inventory of roughly a
-- thousand listings that does not exist. The embedding columns stay (dropping
-- them is churn, and re-adding is trivial); when embeddings are eventually
-- justified, the replacement should be HNSW, which has no training-set
-- problem.
drop index if exists public.idx_enrichment_embedding;

-- ── 7. profile fields we should not collect ────────────────────────────────
-- `employer` is the most identifying free-text field on the table and buys
-- nothing that `work_location` does not; it was empty on all 24 rows.
-- `healthcare_priority` pairs with no property or neighbourhood column, so it
-- could never influence a single result -- it held seeded values only.
alter table public.consumer_profiles
  drop column if exists employer,
  drop column if exists healthcare_priority;

-- Verified after running (2026-08-13):
--   amenity_places        373 -> 0 rows
--   property_enrichment    31 -> 18 columns
--   consumer_profiles      35 -> 33 columns
--   idx_enrichment_embedding  gone
--   the four archetype columns toju-demo reads  still present
--   live toju-demo still returns real matches with the enrichment join intact
