-- Layer 4 · System 1 + 2 — agency verification engine & trust score
-- Verification is a living, multi-tier status. The trust score is a separate,
-- continuous signal snapshotted daily (never overwritten) for the timeline.
-- Reuses set_updated_at() and reject_mutation() from Layers 1–2.

create type agency_verification_tier as enum (
  'unverified','basic_verified','business_verified','enhanced_verified','synapse_certified'
);
create type verification_check_result as enum ('passed','failed','pending','expired');

-- ──────────────── agency_verifications ────────────────
create table agency_verifications (
  id                 uuid primary key default uuid_generate_v4(),
  agency_id          uuid not null references agencies (id) on delete cascade,
  current_tier       agency_verification_tier not null default 'unverified',
  previous_tier      agency_verification_tier,
  tier_changed_at    timestamptz,
  tier_changed_by    uuid references profiles (id) on delete set null,
  identity_verified  boolean not null default false,
  cac_verified       boolean not null default false,
  office_verified    boolean not null default false,
  bank_verified      boolean not null default false,
  documents_reviewed boolean not null default false,
  verification_notes text,
  expires_at         timestamptz,
  suspended_at       timestamptz,
  suspension_reason  text,
  risk_indicator     numeric(5,2),   -- reserved for Reputation Intelligence AI
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (agency_id)
);
create trigger agency_verifications_updated_at before update on agency_verifications
  for each row execute function set_updated_at();
create index idx_agency_verifications_tier on agency_verifications (current_tier);

-- ──────────────── agency_verification_checks (append-only) ────────────────
create table agency_verification_checks (
  id           uuid primary key default uuid_generate_v4(),
  agency_id    uuid not null references agencies (id) on delete cascade,
  check_type   text not null,
  check_source text not null,
  result       verification_check_result not null,
  evidence_url text,
  checked_by   uuid references profiles (id) on delete set null,
  checked_at   timestamptz not null default now(),
  notes        text
);
create index idx_agency_checks on agency_verification_checks (agency_id, checked_at desc);
create trigger agency_checks_no_mutate before update or delete on agency_verification_checks
  for each row execute function reject_mutation();

-- ──────────────── agency_trust_scores ────────────────
create table agency_trust_scores (
  id                       uuid primary key default uuid_generate_v4(),
  agency_id                uuid not null references agencies (id) on delete cascade,
  current_score            numeric(5,2) not null default 0,
  verification_component   numeric(5,2) not null default 0,
  response_time_component  numeric(5,2) not null default 0,
  lead_handling_component  numeric(5,2) not null default 0,
  transactions_component   numeric(5,2) not null default 0,
  ratings_component        numeric(5,2) not null default 0,
  disputes_component       numeric(5,2) not null default 0,
  predicted_trust_score    numeric(5,2),   -- reserved for Trust Scoring AI
  calculated_at            timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  unique (agency_id)
);
create index idx_agency_trust_score on agency_trust_scores (current_score desc);

-- ──────────────── agency_trust_score_snapshots (one/agency/day) ────────────────
create table agency_trust_score_snapshots (
  id                  uuid primary key default uuid_generate_v4(),
  agency_id           uuid not null references agencies (id) on delete cascade,
  score               numeric(5,2) not null,
  snapshot_date       date not null,
  component_breakdown jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  unique (agency_id, snapshot_date)
);
create index idx_agency_trust_snapshots on agency_trust_score_snapshots (agency_id, snapshot_date desc);
-- snapshots are immutable history
create trigger agency_trust_snapshots_no_mutate before update or delete on agency_trust_score_snapshots
  for each row execute function reject_mutation();
