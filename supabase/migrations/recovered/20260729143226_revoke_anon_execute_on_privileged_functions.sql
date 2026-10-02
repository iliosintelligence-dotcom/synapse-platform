-- Close the anonymous attack surface on SECURITY DEFINER business functions.
--
-- WHY: these run with the definer's privileges and were EXECUTE-able by the
-- `anon` role, meaning anyone holding the publishable key (which ships in the
-- client by design) could call them straight over /rest/v1/rpc/. The worst of
-- them are mutating or disclose other tenants' data:
--   move_lead_stage             — moves ANY lead to ANY stage
--   supersede_document          — supersedes ANY document
--   can_read_financial_identity — financial identity disclosure check
--   can_access_lead / can_access_document / is_agency_member / agency_role
--                               — tenancy oracles, usable to enumerate access
--   channel_first_touch_revenue — another agency's revenue attribution
--   proximity_matches           — unbuilt feature, no reason to expose
--
-- Nothing in the app calls these anonymously (verified: zero /rpc/ references
-- in the client and in the toju-demo edge function), so this is a no-op for
-- the product and removes the whole anonymous surface.
--
-- `authenticated` deliberately KEEPS execute: several of these are called from
-- inside RLS policy expressions, which Postgres evaluates with the querying
-- user's privileges — revoking there would break row access for signed-in
-- users. Tightening those further belongs with the RLS work, not here.
--
-- PostGIS's st_estimatedextent is intentionally left alone: it is engine
-- internals, not business logic, and revoking risks breaking spatial queries.

revoke execute on function public.move_lead_stage(uuid, public.lead_stage, text) from anon;
revoke execute on function public.supersede_document(uuid) from anon;
revoke execute on function public.can_read_financial_identity(uuid) from anon;
revoke execute on function public.can_access_lead(uuid) from anon;
revoke execute on function public.can_access_document(public.document_entity_type, uuid) from anon;
revoke execute on function public.is_agency_member(uuid) from anon;
revoke execute on function public.agency_role(uuid) from anon;
revoke execute on function public.channel_first_touch_revenue(uuid) from anon;
revoke execute on function public.partner_is_live(uuid) from anon;
revoke execute on function public.proximity_matches(double precision, double precision, numeric, numeric, public.listing_type, text) from anon;
