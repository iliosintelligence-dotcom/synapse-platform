-- Layer 4 · System 6 + 7 — fraud detection & dispute resolution
-- Rule-based now; the append-only fraud_events log is the future-AI dataset.
-- Disputes are auditable, SLA-tracked, and feed back into trust scores.

-- ───────────────────────── fraud enums ─────────────────────────
create type fraud_entity_type as enum ('agency','agent','property','listing');
create type fraud_flag_type as enum (
  'duplicate_listing','price_anomaly','image_duplication',
  'suspicious_account_activity','fake_location','unverified_identity_listing'
);
create type fraud_severity as enum ('low','medium','high','critical');
create type fraud_status as enum ('open','under_review','resolved','dismissed');
create type fraud_detected_by as enum ('system','manual');

-- ──────────────── fraud_flags ────────────────
create table fraud_flags (
  id               uuid primary key default uuid_generate_v4(),
  entity_type      fraud_entity_type not null,
  entity_id        uuid not null,
  flag_type        fraud_flag_type not null,
  severity         fraud_severity not null,
  status           fraud_status not null default 'open',
  detected_by      fraud_detected_by not null default 'system',
  detection_method text,
  evidence         jsonb not null default '{}',
  reviewed_by      uuid references profiles (id) on delete set null,
  reviewed_at      timestamptz,
  resolution       text,   -- human label → Fraud Detection AI training signal
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create trigger fraud_flags_updated_at before update on fraud_flags
  for each row execute function set_updated_at();
create index idx_fraud_flags_entity on fraud_flags (entity_type, entity_id);
create index idx_fraud_flags_open on fraud_flags (status, severity) where status in ('open','under_review');

-- ──────────────── fraud_events (append-only) ────────────────
create table fraud_events (
  id          uuid primary key default uuid_generate_v4(),
  entity_type fraud_entity_type not null,
  entity_id   uuid not null,
  event_type  text not null,
  payload     jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
create index idx_fraud_events_entity on fraud_events (entity_type, entity_id, occurred_at desc);
create trigger fraud_events_no_mutate before update or delete on fraud_events
  for each row execute function reject_mutation();

-- ───────────────────────── dispute enums ─────────────────────────
create type dispute_type as enum (
  'property_misrepresented','agent_misconduct','ownership_dispute',
  'false_marketing_claims','viewing_no_show','payment_dispute','document_fraud','other'
);
create type dispute_state as enum (
  'submitted','acknowledged','evidence_requested','under_review',
  'decision_pending','resolved','appealed','closed'
);
create type dispute_resolution_type as enum ('upheld','dismissed','partially_upheld','settled');
create type dispute_evidence_type as enum ('document','screenshot','recording','statement');

-- ──────────────── disputes ────────────────
create table disputes (
  id              uuid primary key default uuid_generate_v4(),
  dispute_type    dispute_type not null,
  raised_by       uuid not null references profiles (id) on delete cascade,
  -- agency_id or agent profile id; not FK-constrained so either is valid.
  -- The accountable party is normally the agency (it owns its agents).
  raised_against  uuid not null,
  property_id     uuid references properties (id) on delete set null,
  lead_id         uuid references leads (id) on delete set null,
  deal_room_id    uuid references deal_rooms (id) on delete set null,
  description     text not null,
  current_state   dispute_state not null default 'submitted',
  opened_at       timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  decision        text,
  decision_by     uuid references profiles (id) on delete set null,
  resolution_type dispute_resolution_type,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create trigger disputes_updated_at before update on disputes
  for each row execute function set_updated_at();
create index idx_disputes_against on disputes (raised_against, current_state);
create index idx_disputes_state on disputes (current_state, opened_at);
-- SLA: acknowledge < 24h, resolve < 14d. Overdue detection is a query on
-- opened_at / acknowledged_at against now() in the admin dashboard.

-- ──────────────── dispute_evidence ────────────────
create table dispute_evidence (
  id            uuid primary key default uuid_generate_v4(),
  dispute_id    uuid not null references disputes (id) on delete cascade,
  submitted_by  uuid not null references profiles (id) on delete cascade,
  evidence_type dispute_evidence_type not null,
  storage_url   text,
  description   text,
  submitted_at  timestamptz not null default now()
);
create index idx_dispute_evidence on dispute_evidence (dispute_id, submitted_at);

-- ──────────────── dispute_comments ────────────────
create table dispute_comments (
  id          uuid primary key default uuid_generate_v4(),
  dispute_id  uuid not null references disputes (id) on delete cascade,
  author_id   uuid not null references profiles (id) on delete cascade,
  author_role text not null,
  content     text not null,
  is_internal boolean not null default false,   -- admins only
  created_at  timestamptz not null default now()
);
create index idx_dispute_comments on dispute_comments (dispute_id, created_at);
