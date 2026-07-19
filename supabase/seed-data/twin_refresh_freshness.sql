-- twin_refresh_freshness.sql — re-arm the 14-day "no ghost listings" window.
--
-- WHY: toju-demo only recommends VERIFIED listings with listed_at within the
-- last 14 days (the core trust promise — we keep the rule, we refresh the
-- data). The digital-twin seed left listed_at at seed time (2026-06-20 →
-- 2026-07-04), so as of 2026-07-19 every one of the 560 live+verified rows is
-- outside the window and every match query returns [] — Toju talks in prose
-- with no cards. This script re-dates the stale demo inventory as if agencies
-- had recently reposted.
--
-- SAFE TO RE-RUN (idempotent in effect): the spread is a deterministic
-- function of each row's id, only rows that have fallen OUT of the window are
-- touched, and dates land 0–12 days back — organic-looking, and giving the
-- demo ~2 days of headroom before the oldest rows age out again.
--
-- NOTE: this is a demo-data operation, not a schema migration — run it via the
-- SQL editor / execute_sql, not apply_migration. If the demo needs to stay
-- fresh unattended, the durable fix is a weekly pg_cron job running this same
-- statement (flagged as an option, not implemented here).

update properties p
set listed_at  = ts.new_listed,
    expires_at = ts.new_listed + interval '14 days',
    updated_at = now()
from (
  select id,
         now()
           - make_interval(days => abs(hashtext(id::text)) % 12,
                           mins => abs(hashtext(id::text)) % 1440) as new_listed
  from properties
  where status = 'live'
    and verification_status = 'verified'
    and is_active
    and listed_at < now() - interval '14 days'
) ts
where p.id = ts.id;

-- Verify: expect 0 stale, ~560 fresh.
select
  count(*) filter (where listed_at >= now() - interval '14 days') as fresh,
  count(*) filter (where listed_at <  now() - interval '14 days') as stale
from properties
where status = 'live' and verification_status = 'verified' and is_active;
