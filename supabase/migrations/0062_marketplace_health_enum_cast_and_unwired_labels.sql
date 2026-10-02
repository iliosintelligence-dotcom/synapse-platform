-- 0062_marketplace_health_enum_cast_and_unwired_labels.sql
--
-- Two findings from auditing the tables with RLS enabled and no policy.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE WEEKLY MARKETPLACE-HEALTH JOB HAD NEVER SUCCEEDED
--
-- cron.job_run_details: 8 runs, 8 failures, every one since the job was first
-- scheduled. All died on the same line:
--
--   ERROR: column "health_status" is of type market_health_status
--          but expression is of type text
--
-- The trailing UPDATE builds health_status from a CASE returning bare string
-- literals. In an INSERT, Postgres coerces an unknown-typed literal to the
-- target column's type, which is why the insert half worked and the bug hid. In
-- an UPDATE ... SET the CASE resolves to text first, and there is no implicit
-- text -> enum assignment cast, so the function aborted every time.
--
-- Because the failure was inside a cron job, nothing surfaced it. The table sat
-- empty for eight weeks looking exactly like a feature nobody had built, rather
-- than one failing every Monday at 03:00. A scheduled job with no alerting is
-- indistinguishable from an absent one.
--
-- The cast is the whole fix; the logic is unchanged.

create or replace function public.aggregate_marketplace_health(p_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into marketplace_health as m (
    city, neighbourhood, listing_count, search_volume, lead_rate_per_listing,
    supply_demand_ratio, demand_score, health_status, snapshot_date
  )
  select
    p.city, null,
    count(distinct p.id) filter (where p.is_active and p.status = 'live'),
    coalesce((select count(*) from chat_sessions cs where cs.pref_city ilike p.city), 0),
    coalesce(count(distinct l.id)::numeric / nullif(count(distinct p.id), 0), 0),
    coalesce(count(distinct l.id)::numeric / nullif(count(distinct p.id), 0), 0),
    coalesce(count(distinct l.id), 0),
    'healthy'::market_health_status,
    p_date
  from properties p
  left join leads l on l.property_id = p.id and l.created_at > now() - interval '30 days'
  group by p.city
  on conflict (city, neighbourhood, snapshot_date) do update set
    listing_count = excluded.listing_count,
    search_volume = excluded.search_volume,
    lead_rate_per_listing = excluded.lead_rate_per_listing,
    supply_demand_ratio = excluded.supply_demand_ratio,
    demand_score = excluded.demand_score;

  -- The cast that was missing. Every branch is a valid market_health_status
  -- label (healthy, oversupplied, undersupplied, illiquid), checked against
  -- pg_enum before applying.
  update marketplace_health set health_status = (case
    when listing_count = 0 then 'illiquid'
    when search_volume < 3 then 'illiquid'
    when search_volume::numeric / nullif(listing_count, 0) > 1.5 then 'undersupplied'
    when search_volume::numeric / nullif(listing_count, 0) < 0.5 then 'oversupplied'
    else 'healthy'
  end)::market_health_status
  where snapshot_date = p_date;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TABLES THAT LOOK LIKE PROTECTION AND ARE NOT
--
-- Nine tables have RLS enabled with no policy, which is deny-all. That fails
-- closed and is safe, but it hides three very different situations behind one
-- symptom, and four of these have names implying an active control.
--
-- An auditor reading this schema would see fraud_events, fraud_flags,
-- trust_audit_logs and financial_admin_access_log and reasonably conclude that
-- fraud monitoring and access auditing exist. They do not: each is empty,
-- written by nothing and read by nothing, verified against every database
-- function, every edge function, and the whole client.
--
-- Not dropped. They are a deliberate schema for features that may still get
-- built, and dropping is the owner call rather than a tidy-up. Labelled, so the
-- schema stops making a claim the product cannot support.

comment on table public.fraud_events is
  'UNWIRED as of 2026-08-19. Empty; nothing writes to it and nothing reads it. RLS is enabled with no policy, so it is deny-all. Fraud monitoring does NOT exist -- do not treat the presence of this table as a control.';

comment on table public.fraud_flags is
  'UNWIRED as of 2026-08-19. Empty; no writer, no reader. Deny-all under RLS. Present as schema for a feature that has not been built.';

comment on table public.trust_audit_logs is
  'UNWIRED as of 2026-08-19. Empty; no writer, no reader. Trust changes are NOT audited anywhere -- recalc_agency_trust writes scores without logging them here.';

comment on table public.financial_admin_access_log is
  'UNWIRED as of 2026-08-19. Empty; no writer, no reader. Administrative access to financial identity is NOT being logged.';

comment on table public.growth_metrics is
  'UNWIRED as of 2026-08-19. Empty; no writer, no reader. Growth is not measured here.';

comment on table public.viral_loop_events is
  'UNWIRED as of 2026-08-19. Empty; no writer, no reader.';

-- These two are also policy-less, and that is CORRECT: both are written by the
-- service role, which bypasses RLS, and neither should be client-readable.
-- Commented so nobody "fixes" them by adding a policy.
comment on table public.demo_chat_sessions is
  'Deny-all under RLS by design. Written and read by the toju-demo edge function using the service role, which bypasses RLS. A client policy here would be a leak, not a fix.';

comment on table public.property_enrichment_queue is
  'Deny-all under RLS by design. Driven entirely by enrich_due_properties() and settle_enrichment_queue() under the service role. No client should see the queue.';

comment on table public.marketplace_health is
  'Written weekly by aggregate_marketplace_health() via cron. Deny-all under RLS: platform-level aggregate data, not something an agency or buyer reads. Empty before 2026-08-19 because the job failed on a missing enum cast for its first 8 runs.';

-- Verified after applying (2026-08-19): the job was run by hand exactly as cron
-- calls it and wrote its first row -- Ibadan, 6 listings, health_status
-- illiquid. search_volume is 0 because chat_sessions is genuinely empty.
