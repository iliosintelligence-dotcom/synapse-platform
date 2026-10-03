-- Layer 4 · System 3 — agent verification & reputation
-- Individual accountability within the agency structure.

create type agent_incident_type as enum (
  'consumer_complaint','missed_viewing','misrepresentation','dispute_upheld','other'
);
create type incident_severity as enum ('minor','moderate','major');
create type incident_outcome as enum ('warning','suspension','removal');

-- ──────────────── agent_verifications ────────────────
create table agent_verifications (
  id                    uuid primary key default uuid_generate_v4(),
  agent_id              uuid not null references profiles (id) on delete cascade,
  agency_id             uuid not null references agencies (id) on delete cascade,
  identity_verified     boolean not null default false,
  identity_verified_at  timestamptz,
  training_completed    boolean not null default false,
  training_completed_at timestamptz,
  is_suspended          boolean not null default false,
  suspended_at          timestamptz,
  suspension_reason     text,
  suspended_by          uuid references profiles (id) on delete set null,
  risk_indicator        numeric(5,2),   -- reserved for Reputation Intelligence AI
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (agent_id, agency_id)
);
create trigger agent_verifications_updated_at before update on agent_verifications
  for each row execute function set_updated_at();
create index idx_agent_verifications_agency on agent_verifications (agency_id);

-- ──────────────── agent_disciplinary_records (append-only) ────────────────
create table agent_disciplinary_records (
  id            uuid primary key default uuid_generate_v4(),
  agent_id      uuid not null references profiles (id) on delete cascade,
  agency_id     uuid not null references agencies (id) on delete cascade,
  incident_type agent_incident_type not null,
  description   text not null,
  severity      incident_severity not null,
  outcome       incident_outcome not null,
  recorded_by   uuid references profiles (id) on delete set null,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index idx_agent_discipline on agent_disciplinary_records (agent_id, occurred_at desc);
create trigger agent_discipline_no_mutate before update or delete on agent_disciplinary_records
  for each row execute function reject_mutation();

-- ──────────────── agent_reputation_snapshots (one/agent/day) ────────────────
create table agent_reputation_snapshots (
  id                  uuid primary key default uuid_generate_v4(),
  agent_id            uuid not null references profiles (id) on delete cascade,
  agency_id           uuid not null references agencies (id) on delete cascade,
  score               numeric(5,2) not null,
  snapshot_date       date not null,
  component_breakdown jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  unique (agent_id, snapshot_date)
);
create index idx_agent_reputation on agent_reputation_snapshots (agent_id, snapshot_date desc);
create trigger agent_reputation_no_mutate before update or delete on agent_reputation_snapshots
  for each row execute function reject_mutation();
