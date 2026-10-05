-- 0030 · Fix: enable RLS on financial_admin_access_log.
-- Caught by the security advisor after the initial push. This append-only
-- audit table (created in 0023) is written and read ONLY by the service role
-- in Edge Functions — it was meant to be locked down like every other
-- internal-only Layer 6 table (fraud_flags, growth_metrics, …), but the
-- enable-RLS statement was omitted in 0023/0028.
--
-- Enabling RLS with NO client policy = deny-all to the anon/authenticated
-- roles; the service role bypasses RLS and continues to write the log. This
-- is the same RLS-on-zero-policies pattern the fraud/growth tables already use.
--
-- (spatial_ref_sys is intentionally NOT touched — it is PostGIS's own SRID
--  reference catalog, public reference data, managed by the extension.)

alter table financial_admin_access_log enable row level security;
