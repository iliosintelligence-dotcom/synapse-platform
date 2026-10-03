-- agent_social_counts and listing_agent_cards were granted to anon and
-- authenticated for SELECT only (0064, 0065), but Supabase's default privileges
-- on the public schema had already given both roles everything on them:
-- INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES.
--
-- On agent_social_counts that is a hole, not a formality. It is a definer-
-- rights view (security_invoker = false, owned by postgres) over a single
-- table, so Postgres makes it automatically updatable -- and writes through
-- it reach public.profiles with the owner's rights, which RLS does not
-- restrict. Anyone holding the public anon key could delete every profile
-- with one REST call:  DELETE /rest/v1/agent_social_counts?agent_id=not.is.null
-- Live on 27 September: profiles is owned by postgres (BYPASSRLS), RLS not
-- forced, all 72 rows reachable through the view. Reproduced on a local copy
-- with a non-superuser owner; not tried against production.
--
-- listing_agent_cards joins three tables, so it is not updatable and the extra
-- privileges did nothing there; they go too, so neither view depends on its
-- shape to stay read-only. The clients only ever read them (app/property.html,
-- app/agency-listings.js in the site repo).
--
-- cron_health lost these roles entirely in 20260927235517. geography_columns
-- and geometry_columns carry the same default grant but belong to PostGIS
-- (owned by supabase_admin) and are left alone, as 0068 leaves extension
-- objects alone.
revoke all on public.agent_social_counts, public.listing_agent_cards
  from anon, authenticated;
grant select on public.agent_social_counts, public.listing_agent_cards
  to anon, authenticated;
