-- Layer 6 · System 5 (Agent Commission) + System 4 (Affordability)
-- Both require NO banking partner. Commission automates an agency paying its
-- own agents over existing Paystack rails (internal payroll, not third-party
-- custody). Affordability is advisory only — never a credit decision.

-- ───────────────────────── System 5 enums ─────────────────────────
create type commission_applies_to as enum ('all_agents','specific_agent','specific_team');
create type commission_type as enum ('flat_percentage','tiered','flat_amount');
create type commission_status as enum ('pending','approved','paid');
create type bonus_type as enum ('volume_milestone','speed_bonus','quality_bonus');

-- ──────────────── commission_structures ────────────────
create table commission_structures (
  id              uuid primary key default uuid_generate_v4(),
  agency_id       uuid not null references agencies (id) on delete cascade,
  structure_name  text not null,
  applies_to      commission_applies_to not null default 'all_agents',
  applies_to_id   uuid,
  commission_type commission_type not null,
  base_percentage numeric(6,3),
  tier_rules      jsonb,
  flat_amount     numeric(16,2),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create trigger commission_structures_updated_at before update on commission_structures
  for each row execute function set_updated_at();
create index idx_commission_structures_agency on commission_structures (agency_id) where is_active;

-- ──────────────── commission_ledger ────────────────
create table commission_ledger (
  id                     uuid primary key default uuid_generate_v4(),
  deal_room_id           uuid not null references deal_rooms (id) on delete cascade,
  lead_id                uuid references leads (id) on delete set null,
  agent_id               uuid not null references profiles (id) on delete cascade,
  agency_id              uuid not null references agencies (id) on delete cascade,
  transaction_value      numeric(16,2) not null,
  commission_structure_id uuid references commission_structures (id) on delete set null,
  gross_commission_amount numeric(16,2) not null,
  splits                 jsonb not null default '{}',
  net_agent_payout       numeric(16,2) not null,
  status                 commission_status not null default 'pending',
  approved_by            uuid references profiles (id) on delete set null,
  paid_at                timestamptz,
  payout_reference       text,           -- Paystack transfer reference
  created_at             timestamptz not null default now()
);
create index idx_commission_ledger_agency on commission_ledger (agency_id, status, created_at desc);
create index idx_commission_ledger_agent on commission_ledger (agent_id, status);
create index idx_commission_ledger_payout on commission_ledger (status) where status = 'approved';

-- ──────────────── performance_bonuses ────────────────
create table performance_bonuses (
  id                uuid primary key default uuid_generate_v4(),
  agent_id          uuid not null references profiles (id) on delete cascade,
  agency_id         uuid not null references agencies (id) on delete cascade,
  bonus_type        bonus_type not null,
  trigger_condition jsonb not null default '{}',
  bonus_amount      numeric(16,2) not null,
  period_start      date not null,
  period_end        date not null,
  status            text not null default 'pending' check (status in ('pending','paid')),
  created_at        timestamptz not null default now()
);
create index idx_performance_bonuses_agent on performance_bonuses (agent_id, status);

-- ───────────────────────── System 4 ─────────────────────────
create type financing_recommendation as enum (
  'cash','rent_now_pay_monthly','mortgage_marketplace','not_recommended'
);

-- Advisory only. recommendation_reasoning always discloses the basis and that
-- this is NOT a credit approval.
create table affordability_analyses (
  id                          uuid primary key default uuid_generate_v4(),
  user_id                     uuid not null references profiles (id) on delete cascade,
  property_id                 uuid references properties (id) on delete set null,
  declared_monthly_income     numeric(16,2) not null,
  declared_monthly_expenses   numeric(16,2) not null default 0,
  declared_existing_debt      numeric(16,2) not null default 0,
  safe_monthly_budget         numeric(16,2) not null,
  stretch_monthly_budget      numeric(16,2) not null,
  recommended_max_property_price numeric(16,2) not null,
  financing_recommendation    financing_recommendation not null,
  recommendation_reasoning    text not null,
  calculated_at               timestamptz not null default now()
);
create index idx_affordability_user on affordability_analyses (user_id, calculated_at desc);
