-- ═══════════════════════════════════════════════════════════════════════════
-- Clear verification nobody earned.
--
-- WHY: "verified" on a Synapse listing is a claim to a buyer that Synapse ran
-- its checks and they passed on a date. On 5 September 2026 the live database
-- had two listings marked verified, one in_progress, and:
--
--     property_verifications          0 rows
--     property_verification_checks    0 rows
--     property_verification_history   0 rows
--     verification_nodes              [] on every row
--
-- Nothing had ever been checked. The flag was a claim with nothing behind it,
-- and properties_guard_verification exists precisely to stop an agency
-- setting it -- "verification fields are platform-owned". This script is the
-- platform side of that promise: if no check exists, the claim comes off.
--
-- SAFE TO RE-RUN. It only ever removes a claim, never adds one.
--
-- WHEN TO RUN IT: after seed_props_01..04.sql. Those files insert listings
-- with verification_status = 'verified', a trust_score, and a
-- verification_nodes array of per-check results ("Title: pass", "Survey:
-- pass") that were written by a generator, not by anyone who looked at a
-- property. Re-seeding therefore re-asserts hundreds of unearned claims, and
-- this puts them back.
--
-- WHAT IT DOES NOT BREAK: toju-chat used to filter on verification, so this
-- would once have silenced Tayo entirely. Since the search now RANKS on
-- verification instead of filtering (see runSearch), unverified homes are
-- still returned -- labelled -- and Tayo states which is which. Clearing the
-- flag costs no inventory. Do not run this against a database whose
-- toju-chat still filters.
-- ═══════════════════════════════════════════════════════════════════════════

update properties p
set verification_status = 'unverified',
    verified_at         = null,
    trust_score         = null,
    verification_nodes  = '[]'::jsonb,
    updated_at          = now()
where p.deleted_at is null
  and (
        p.verification_status <> 'unverified'
     or p.verified_at is not null
     or p.trust_score is not null
     or coalesce(jsonb_array_length(p.verification_nodes), 0) > 0
      )
  -- 'passed', not 'pass': property_check_status is (pending, passed, failed,
  -- not_applicable), while the seeds' verification_nodes JSON uses "pass".
  -- Two different vocabularies for the same idea, and only one is enforced.
  -- Leave alone anything with a real check behind it. Today that is nothing,
  -- which is the point; once the verification desk starts recording checks,
  -- this script stops touching those listings on its own.
  and not exists (
        select 1 from property_verification_checks c
        where c.property_id = p.id and c.status = 'passed'
      );

select count(*) filter (where verification_status = 'verified') as still_claiming_verified,
       count(*) filter (where verified_at is not null)          as still_dated,
       count(*) filter (where coalesce(jsonb_array_length(verification_nodes),0) > 0) as still_claiming_checks
from properties where deleted_at is null;
