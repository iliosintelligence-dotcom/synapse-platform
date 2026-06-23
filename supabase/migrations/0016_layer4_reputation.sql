-- Layer 4 · reputation, trust audit, and nightly trust recalculation
-- Reviews come only from verified interactions. Aggregates + trust scores are
-- snapshotted nightly (never live at query time). Reuses pg_cron from L2.

create type review_entity_type as enum ('agency','agent');
create type reputation_milestone_type as enum (
  'first_verification','tier_upgrade','transaction_10','transaction_50',
  'first_review','first_dispute','dispute_resolution','trust_milestone'
);

-- ──────────────── consumer_reviews ────────────────
create table consumer_reviews (
  id                     uuid primary key default uuid_generate_v4(),
  reviewer_id            uuid not null references profiles (id) on delete cascade,
  reviewed_entity_type   review_entity_type not null,
  reviewed_entity_id     uuid not null,
  rating                 smallint not null check (rating between 1 and 5),
  review_text            text,
  transaction_id         uuid references deal_rooms (id) on delete set null,
  is_verified_transaction boolean not null default false,
  is_published           boolean not null default false,
  created_at             timestamptz not null default now()
);
create index idx_reviews_entity on consumer_reviews (reviewed_entity_type, reviewed_entity_id) where is_published;
create index idx_reviews_reviewer on consumer_reviews (reviewer_id);

-- ──────────────── review_aggregates (one/entity/day) ────────────────
create table review_aggregates (
  id             uuid primary key default uuid_generate_v4(),
  entity_type    review_entity_type not null,
  entity_id      uuid not null,
  average_rating numeric(3,2) not null default 0,
  review_count   integer not null default 0,
  snapshot_date  date not null,
  created_at     timestamptz not null default now(),
  unique (entity_type, entity_id, snapshot_date)
);
create index idx_review_aggregates on review_aggregates (entity_type, entity_id, snapshot_date desc);

-- ──────────────── trust_audit_logs (append-only) ────────────────
create table trust_audit_logs (
  id          uuid primary key default uuid_generate_v4(),
  entity_type text not null,
  entity_id   uuid not null,
  event       text not null,
  delta       numeric(6,2),
  reason      text,
  actor_id    uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_trust_audit on trust_audit_logs (entity_type, entity_id, created_at desc);
create trigger trust_audit_no_mutate before update or delete on trust_audit_logs
  for each row execute function reject_mutation();

-- ──────────────── reputation_timelines (append-only, consumer-visible) ────────────────
create table reputation_timelines (
  id             uuid primary key default uuid_generate_v4(),
  entity_type    review_entity_type not null,
  entity_id      uuid not null,
  milestone_type reputation_milestone_type not null,
  label          text not null,
  occurred_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index idx_reputation_timeline on reputation_timelines (entity_type, entity_id, occurred_at);
create trigger reputation_timeline_no_mutate before update or delete on reputation_timelines
  for each row execute function reject_mutation();

-- ──────────────── nightly trust recalculation ────────────────
-- Computes the six components, writes the current score, appends a daily
-- snapshot, and refreshes review aggregates. Idempotent per (agency, date).
create or replace function recalc_agency_trust(p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_verif numeric; v_resp numeric; v_lead numeric; v_txn numeric; v_rate numeric; v_disp numeric;
  v_score numeric;
begin
  -- refresh review aggregates for the day
  insert into review_aggregates (entity_type, entity_id, average_rating, review_count, snapshot_date)
  select reviewed_entity_type, reviewed_entity_id, round(avg(rating)::numeric, 2), count(*), p_date
  from consumer_reviews where is_published group by reviewed_entity_type, reviewed_entity_id
  on conflict (entity_type, entity_id, snapshot_date) do update
    set average_rating = excluded.average_rating, review_count = excluded.review_count;

  for r in select id from agencies where deleted_at is null loop
    -- verification quality (25): tier-derived, 0–100 scaled
    select case av.current_tier
              when 'synapse_certified' then 100 when 'enhanced_verified' then 85
              when 'business_verified' then 70 when 'basic_verified' then 50 else 10 end
      into v_verif from agency_verifications av where av.agency_id = r.id;
    v_verif := coalesce(v_verif, 10);

    -- response time (20): faster than 1h = 100, decays to 0 by 24h
    select greatest(0, 100 - (avg(c.response_time_seconds) / 864.0))
      into v_resp from communications c join leads l on l.id = c.lead_id
      where l.agency_id = r.id and c.response_time_seconds is not null;
    v_resp := coalesce(v_resp, 50);

    -- lead handling (20): contacted / received
    select least(100, 100.0 * count(distinct c.lead_id) / nullif(count(distinct l.id), 0))
      into v_lead from leads l left join communications c
        on c.lead_id = l.id and c.direction = 'outbound'
      where l.agency_id = r.id;
    v_lead := coalesce(v_lead, 0);

    -- transactions (20): closed deals, capped at 100 (5 pts each)
    select least(100, count(*) * 5)
      into v_txn from deal_rooms where agency_id = r.id and status = 'closed';
    v_txn := coalesce(v_txn, 0);

    -- ratings (10): avg rating scaled to 100
    select coalesce(avg(rating) * 20, 60)
      into v_rate from consumer_reviews
      where reviewed_entity_type = 'agency' and reviewed_entity_id = r.id and is_published;

    -- disputes (5): start 100, -25 per upheld in last 12mo
    select greatest(0, 100 - 25 * count(*) filter (
             where resolution_type in ('upheld','partially_upheld')
               and opened_at > now() - interval '12 months'))
      into v_disp from disputes where raised_against = r.id;
    v_disp := coalesce(v_disp, 100);

    v_score := round(v_verif*0.25 + v_resp*0.20 + v_lead*0.20 + v_txn*0.20 + v_rate*0.10 + v_disp*0.05, 2);

    insert into agency_trust_scores as t (agency_id, current_score, verification_component,
      response_time_component, lead_handling_component, transactions_component,
      ratings_component, disputes_component, calculated_at)
    values (r.id, v_score, round(v_verif,2), round(v_resp,2), round(v_lead,2),
            round(v_txn,2), round(v_rate,2), round(v_disp,2), now())
    on conflict (agency_id) do update set
      current_score = excluded.current_score,
      verification_component = excluded.verification_component,
      response_time_component = excluded.response_time_component,
      lead_handling_component = excluded.lead_handling_component,
      transactions_component = excluded.transactions_component,
      ratings_component = excluded.ratings_component,
      disputes_component = excluded.disputes_component,
      calculated_at = now();

    insert into agency_trust_score_snapshots (agency_id, score, snapshot_date, component_breakdown)
    values (r.id, v_score, p_date, jsonb_build_object(
      'verification', round(v_verif,2), 'response_time', round(v_resp,2),
      'lead_handling', round(v_lead,2), 'transactions', round(v_txn,2),
      'ratings', round(v_rate,2), 'disputes', round(v_disp,2)))
    on conflict (agency_id, snapshot_date) do nothing;
  end loop;
end;
$$;

select cron.schedule(
  'synapse-trust-nightly',
  '0 2 * * *',
  $$select recalc_agency_trust((now())::date)$$
);
