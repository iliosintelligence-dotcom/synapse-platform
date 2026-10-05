-- Deliberately does nothing. Kept as a record of an attempted fix that was wrong.
--
-- The Supabase advisor reports, for seven of our RLS predicate helpers:
--
--   "Function public.is_agency_member(uuid) can be executed by the `anon` role
--    as a SECURITY DEFINER function via /rest/v1/rpc/is_agency_member. Revoke
--    EXECUTE or switch it to SECURITY INVOKER if that is not intentional."
--
-- Following that advice breaks the database. RLS policy expressions are
-- evaluated as the querying role, so that role must hold EXECUTE on every
-- function a policy calls. Revoking it does not narrow what anon can see; the
-- query fails outright:
--
--   ERROR: 42501: permission denied for function is_platform_admin
--
-- This was applied and reverted on 2026-08-27. The blast radius, measured:
--
--   is_agency_member             42 anon-facing policies across 36 tables
--   agency_role                  15
--   can_access_lead               6
--   is_platform_admin             4   -- all four on `properties`
--   can_access_document           3
--   can_read_financial_identity   2
--   shares_agency_with            0   -- the only one safe to revoke
--
-- Four policies on `properties` means anonymous browsing -- the buyer's front
-- door -- returns an error rather than listings. That is worse than the warning.
--
-- Worth being precise about what the advisory is and isn't saying. The exposure
-- is real in the sense that the endpoint is reachable; it is not a data leak.
-- Impersonating anon exactly as PostgREST does, all seven answer false or null,
-- including can_access_lead() against a genuine lead id. They read past RLS
-- internally, but they only ever report on the caller, and an anonymous caller
-- has no access to report.
--
-- The fix is relocation, not revocation: move these helpers into a schema
-- PostgREST does not expose (it serves `public` only). Policies keep calling
-- them, roles keep EXECUTE, and no RPC endpoint exists to reach. Every policy
-- referencing them has to move in the same transaction, so it is a planned
-- change with a test pass -- not something to do while reacting to a linter.
--
-- Until then these seven advisories should be read as known and accepted.

do $$
begin
  raise notice
    '0069 is intentionally a no-op -- see the comment. Revoking EXECUTE from anon '
    'on RLS predicate helpers breaks anonymous reads; relocate them instead.';
end
$$;
