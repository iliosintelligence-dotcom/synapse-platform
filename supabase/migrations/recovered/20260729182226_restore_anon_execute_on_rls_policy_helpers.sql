-- REGRESSION FIX for revoke_public_execute_on_privileged_functions.
--
-- That migration revoked EXECUTE from PUBLIC on ten SECURITY DEFINER functions.
-- Five of them are referenced from inside RLS policy expressions, and Postgres
-- evaluates those expressions with the QUERYING role's privileges — so once
-- anon lost EXECUTE, every anonymous read of `properties` began failing with
--   401  permission denied for function is_agency_member
-- which broke public property browsing across the whole app.
--
-- Re-grant EXECUTE to anon for the five policy helpers only. This costs almost
-- nothing in exposure: each one tests the CALLER's own membership/access via
-- auth.uid(), so an anonymous caller invoking them directly learns nothing
-- about anybody else — they simply return false/null.
--
-- The five that stay revoked are the ones that actually matter, because they
-- take an arbitrary ID and either mutate or disclose another tenant's data:
--   move_lead_stage, supersede_document, channel_first_touch_revenue,
--   partner_is_live, proximity_matches
--
-- Verified by query: exactly these five appear in pg_policies expressions.

grant execute on function public.is_agency_member(uuid) to anon;
grant execute on function public.agency_role(uuid) to anon;
grant execute on function public.can_access_lead(uuid) to anon;
grant execute on function public.can_access_document(public.document_entity_type, uuid) to anon;
grant execute on function public.can_read_financial_identity(uuid) to anon;
