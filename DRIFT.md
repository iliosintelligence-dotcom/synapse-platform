# Repo / database drift

Recorded 19 August 2026. This file exists because the repository can no longer
rebuild production, and that is worth stating plainly rather than discovering
during a restore.

## What is missing

**19 applied migrations have no file here.** The database has 74 applied; the
repo has 61. The gap is not cosmetic — it includes security fixes that exist
*only* in the live database:

| Applied | Migration | Why it matters |
|---|---|---|
| 20260729143226 | `revoke_anon_execute_on_privileged_functions` | Closed anonymous access to SECURITY DEFINER functions |
| 20260729143329 | `revoke_public_execute_on_privileged_functions` | The real fix — the previous one was a no-op because Postgres grants EXECUTE to PUBLIC by default |
| 20260729182226 | `restore_anon_execute_on_rls_policy_helpers` | Regression fix; without it anonymous property browsing 401s |
| 20260729182949 | `proximity_watches_push_and_notification_routing` | `geofence_watches`, `push_subscriptions`, notification routing columns |
| 20260729183027 | `proximity_candidates_function` | The proximity matching function |
| 20260729183140 | `proximity_candidates_fix_smallint_casts` | |
| 20260729183335 | `notifications_allow_visitor_recipient` | Anonymous proximity watches |
| 20260731173827 | `harden_properties_insert_verification_not_self_grantable` | An agency could insert a row declaring itself verified |
| 20260731174320 | `property_media_cloudinary_id_optional` | |
| 20260731174459 | `verification_immutability_via_trigger_fix_soft_delete` | |
| 20260731174906 | `agency_can_see_own_soft_deleted_listings` | |
| 20260731191124 | `platform_admin_verification_desk` | |
| 20260801053123 | `property_media_visible_for_unverified_live_listings` | |
| 20260801053613 | `platform_admin_verification_authority` | |
| 20260801062319 | `agency_brand_kit_fields_and_tier_guard` | |
| 20260801170655 | `restrict_self_assignable_roles_at_signup` | **Privilege escalation fix** — signup metadata was cast straight into `profiles.role` |
| 20260802074742 | `enforce_listing_expiry_at_read_time` | Makes the 14-day expiry promise actually true |
| 20260802194728 | `add_listing_currency_for_global_markets` | |

`0061_property_places_drive_by_time_of_day.sql` was also missing and has been
written back by hand, because it was authored in this repo and could be
reproduced exactly.

## Status: recovered

All 18 were written back on 19 August 2026 into `supabase/migrations/recovered/`,
and **every one is verified byte-identical in substance to the copy Postgres
holds** in `supabase_migrations.schema_migrations.statements`.

The verification is the point. These were transcribed rather than pulled with
the CLI (no `SUPABASE_ACCESS_TOKEN` on this machine), and hand-copying REVOKE
statements and RLS policy expressions is exactly where a silent error would do
the most damage — a wrong `revoke` reads identically to a right one. So each
file was hashed on whitespace-normalised content and compared against a hash
computed inside the database:

```sql
select md5(lower(regexp_replace(array_to_string(statements, ';'), '\s+', '', 'g')))
from supabase_migrations.schema_migrations where version = '...';
```

18 of 18 matched. Re-run that comparison any time; the hashes are reproducible.

### Ordering

The recovered files keep their applied timestamps as names, and live in a
subdirectory, so they do **not** join the `0001_`–`0061_` sequence the CLI reads.
That is deliberate: they are already applied to production, and re-running them
against it would be a no-op at best. They exist so the history is recoverable and
auditable, not so the CLI replays them.

If you ever rebuild from empty, apply in this order: everything up to `0034_`,
then the `recovered/` files in filename order, then `0036_` onward. The table
above is already in that order.

## Also drifted

**Three functions are deployed with no source in this repo.** If the Supabase
project were lost, these are gone:

- `push-key`
- `push-subscribe`
- `proximity-report`

Recover with `supabase functions download <name>` once the CLI is installed and
authenticated.

**One function is in the repo but was never deployed:** `admin-actions`. Nothing
in the client calls it, so this is dead code rather than a broken feature —
decide whether it ships or goes.
