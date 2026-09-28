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

## Cron jobs, 27 September 2026

Two jobs had been failing for weeks: `synapse-daily-snapshots` since
4 September, and `cron-health-check`, which had reported *itself* as failing
every 15 minutes since it was built on 19 August. Three migrations fixed them:

| Migration | What it changed |
|---|---|
| `20260927230000_snapshots_one_row_per_agent_health_check_reads_finished_runs` | `aggregate_daily_snapshots()` takes one active membership per agent, so the agent upsert no longer sees the same `agent_id` twice; 3–26 September backfilled. `check_cron_health()` judges failure by the newest *finished* run, so it no longer flags its own run in flight. |
| `20260927235517_cron_health_view_reads_finished_runs` | The `cron_health` view reads finished runs too; `anon` and `authenticated` lose it. |
| `20260927235841_every_cron_job_has_an_allowed_silence` | `cron_expectations` rows for the nine jobs that had none. All 15 active jobs are now watched for going quiet. |

What the fixes turned up about the gap between this repo and the database:

**Live function bodies were not the repo's.** Both functions differed from
their files (`0008`, `0063`) — in comments only; the logic was identical, and
the `pg_temp` in their search_path comes from `0068`, which is tracked. Harmless
this time, but it is why each fix reproduced the body from `pg_proc.prosrc`,
checked by md5 before editing, rather than from the file. For these two the
repo's latest definition is the database's again. Do the same for any
`create or replace`: read the live definition first.

**Grants the repo never gave.** `0063` granted `cron_health` to `service_role`
alone, but Supabase's default privileges on `public` had already given `anon`
and `authenticated` everything on it. On a table, RLS stands between those
grants and the rows; a view owned by `postgres` without `security_invoker`
bypasses it, so the public anon key could read every job's schedule and last
error message over the REST API.
Revoked in `20260927235517`.

Every view in `public` had the same grant, and on one it was a hole:
`agent_social_counts` (`0065`) is a definer-rights view over `profiles` alone, so
Postgres makes it writable, and writes through it reach `profiles` as `postgres`
(BYPASSRLS). The anon key could delete every profile with one REST call.
`20260928001207` cuts it and `listing_agent_cards` back to SELECT, which is all
the clients use; no auth account was missing its profile afterwards, so there is
no sign it was used. The view also listed every account's id, buyers included;
since `20260928002419` it lists agents only, as `listing_agent_cards` does. `geography_columns` and `geometry_columns` carry the grant
too but belong to PostGIS and are left alone. **Every new view in `public` gets
this grant again** — a view needs its own `revoke all … from anon,
authenticated` before any `grant select`.

**Two files, one version.** A migration from a concurrent session was also
named `20260927230000_…`. `scripts/migrate.mjs` keys on the version alone, so
once the snapshots fix was recorded under it, the other file read as applied and
silently never ran. It was renumbered to `20260927234500` and applied. The
runner now refuses both halves of that: two files in this folder with one
version, and a file whose version `schema_migrations` records under another
migration's name.

**Snapshot rows for 3–26 September are a backfill**, written on 27 September
by re-running the aggregation, not by the nightly job. The figures are
date-filtered, so they match what the job would have written from the data as
it stood on the 27th — except `assigned_leads`, which counts current
assignment, not assignment on that day.

**One agent, one agency.** `agent_daily_snapshots` keys on `(agent_id, date)`,
so a person active in two agencies gets one row, for the most recently joined
membership; their work in the other agency is not snapshotted. That is one
person today. A row per agency needs the primary key changed.

**Alert history before 27 September is noisy.** Besides the health check's
3,740-occurrence alert on itself, any job caught mid-run on the quarter hour
opened and closed a "no message" alert — about 250 a day. None of those were
real failures.

**Confirmed on 28 September.** `synapse-daily-snapshots` succeeded at 01:30 UTC,
its first success since 3 September, and wrote 27 September itself: 43 agent
rows for 43 agents, 31 agency rows. Its alert closed at 2,306 occurrences.
`purge-telegram-link-codes` had its first run at 03:35 and its "has never run"
alert closed at the 03:45 check. The same will happen to any daily job created
after its slot for the day: it reads as stalled until its first run, then the
check closes it — `purge-social-connect-failures` did exactly that overnight.
