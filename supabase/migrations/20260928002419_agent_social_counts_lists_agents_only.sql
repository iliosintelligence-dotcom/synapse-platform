-- agent_social_counts returned a row for every live profile -- buyers
-- included -- so anyone with the anon key could list every account's id and
-- count the accounts. It now returns agents only, defined as
-- listing_agent_cards defines them: an active agency membership with role
-- 'agent'. Those are the only profiles the site offers a follow or like button
-- for, and on 27 September every follow and like belonged to one of them, so no
-- count is lost. Agency owners who are not also agents drop out of it; the team
-- roster (agency-listings.js) prints "—" for a member the view has no row for.
--
-- The body is the live definition (pg_get_viewdef, verified by md5 before
-- editing) with only the WHERE clause extended. Same columns and options, so
-- CREATE OR REPLACE keeps the grants: SELECT-only for anon and authenticated
-- since 20260928001207.

create or replace view public.agent_social_counts
with (security_invoker = false) as
 SELECT id AS agent_id,
    ( SELECT count(*) AS count
           FROM agent_follows f
          WHERE (f.agent_id = p.id)) AS followers,
    ( SELECT count(*) AS count
           FROM agent_likes l
          WHERE (l.agent_id = p.id)) AS likes
   FROM profiles p
  WHERE ((deleted_at IS NULL) AND (EXISTS ( SELECT 1
           FROM agency_members m
          WHERE ((m.profile_id = p.id) AND (m.deleted_at IS NULL) AND (m.role = 'agent'::user_role)))));
