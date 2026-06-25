-- Layer 6 · System 1 (Escrow) + System 6 (Developer Sales)
-- Escrow holds funds at a licensed partner (partner_institution_id). The
-- Synapse status only advances to released/refunded on a CONFIRMED partner
-- webhook — never on internal state alone. Escrow gates Developer installments.

-- ───────────────────────── escrow enums ─────────────────────────
create type escrow_type as enum (
  'earnest_money_deposit','rental_escrow','purchase_escrow','inspection_deposit','milestone_escrow'
);
create type escrow_status as enum (
  'pending_funding','funded','held','partially_released','released','refunded','disputed'
);
create type milestone_type as enum (
  'verification_complete','document_signed','inspection_passed','possession_confirmed','manual_approval'
);
create type escrow_approver_role as enum ('consumer','agent','agency_owner','platform_admin');
create type milestone_status as enum ('pending','approved','rejected');

-- ──────────────── escrow_accounts ────────────────
create table escrow_accounts (
  id                       uuid primary key default uuid_generate_v4(),
  deal_room_id             uuid not null references deal_rooms (id) on delete cascade,
  escrow_type              escrow_type not null,
  partner_institution_id   uuid not null references partner_institutions (id) on delete restrict,
  partner_account_reference text,         -- the partner account that holds the money
  payer_id                 uuid not null references profiles (id) on delete restrict,
  payee_id                 uuid not null references profiles (id) on delete restrict,
  amount                   numeric(16,2) not null check (amount > 0),
  currency                 text not null default 'NGN',
  status                   escrow_status not null default 'pending_funding',
  funded_at                timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger escrow_accounts_updated_at before update on escrow_accounts
  for each row execute function set_updated_at();
create index idx_escrow_deal_room on escrow_accounts (deal_room_id);
create index idx_escrow_parties on escrow_accounts (payer_id, payee_id);

-- ──────────────── escrow_milestones ────────────────
create table escrow_milestones (
  id                    uuid primary key default uuid_generate_v4(),
  escrow_account_id     uuid not null references escrow_accounts (id) on delete cascade,
  milestone_name        text not null,
  milestone_type        milestone_type not null,
  required_approver_role escrow_approver_role not null,
  status                milestone_status not null default 'pending',
  approved_by           uuid references profiles (id) on delete set null,
  approved_at           timestamptz,
  release_amount        numeric(16,2),
  release_percentage    numeric(5,2),
  created_at            timestamptz not null default now()
);
create index idx_escrow_milestones on escrow_milestones (escrow_account_id, status);

-- ──────────────── escrow_events (append-only) ────────────────
create table escrow_events (
  id                uuid primary key default uuid_generate_v4(),
  escrow_account_id uuid not null references escrow_accounts (id) on delete cascade,
  event_type        text not null,
  payload           jsonb not null default '{}',
  occurred_at       timestamptz not null default now()
);
create index idx_escrow_events on escrow_events (escrow_account_id, occurred_at desc);
create trigger escrow_events_no_mutate before update or delete on escrow_events
  for each row execute function reject_mutation();

-- ───────────────────────── System 6 enums ─────────────────────────
create type development_status as enum ('pre_launch','selling','sold_out','completed');
create type unit_status as enum ('available','reserved','sold','allocated');
create type installment_frequency as enum ('monthly','quarterly');
create type installment_plan_status as enum ('active','completed','defaulted','cancelled');
create type installment_status as enum ('upcoming','paid','late','missed');

-- ──────────────── developments ────────────────
create table developments (
  id                        uuid primary key default uuid_generate_v4(),
  developer_id              uuid not null references profiles (id) on delete cascade,
  development_name          text not null,
  location                  text not null,
  total_units               integer not null default 0,
  unit_types                jsonb not null default '[]',
  launch_date               date,
  completion_date_estimated date,
  status                    development_status not null default 'pre_launch',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz
);
create trigger developments_updated_at before update on developments
  for each row execute function set_updated_at();
create index idx_developments_developer on developments (developer_id, status);

-- ──────────────── unit_inventory ────────────────
create table unit_inventory (
  id                    uuid primary key default uuid_generate_v4(),
  development_id        uuid not null references developments (id) on delete cascade,
  unit_number           text not null,
  unit_type             text not null,
  floor_size_sqm        numeric(10,2),
  list_price            numeric(16,2) not null,
  status                unit_status not null default 'available',
  allocated_to_buyer_id uuid references profiles (id) on delete set null,
  reservation_expires_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (development_id, unit_number)
);
create trigger unit_inventory_updated_at before update on unit_inventory
  for each row execute function set_updated_at();
create index idx_unit_inventory_dev on unit_inventory (development_id, status);
-- expire stale reservations: a query/cron flips reserved → available when
-- reservation_expires_at < now() and the down payment is unpaid.
create index idx_unit_reservation_expiry on unit_inventory (reservation_expires_at)
  where status = 'reserved';

-- ──────────────── installment_plans ────────────────
create table installment_plans (
  id                    uuid primary key default uuid_generate_v4(),
  unit_id               uuid not null references unit_inventory (id) on delete cascade,
  buyer_id              uuid not null references profiles (id) on delete cascade,
  total_price           numeric(16,2) not null,
  down_payment_amount   numeric(16,2) not null,
  down_payment_paid     boolean not null default false,
  installment_count     integer not null,
  installment_amount    numeric(16,2) not null,
  installment_frequency installment_frequency not null default 'monthly',
  plan_status           installment_plan_status not null default 'active',
  start_date            date not null,
  created_at            timestamptz not null default now()
);
create index idx_installment_plans_buyer on installment_plans (buyer_id, plan_status);

-- ──────────────── installment_schedules ────────────────
create table installment_schedules (
  id                  uuid primary key default uuid_generate_v4(),
  installment_plan_id uuid not null references installment_plans (id) on delete cascade,
  installment_number  integer not null,
  due_date            date not null,
  amount_due          numeric(16,2) not null,
  amount_paid         numeric(16,2) not null default 0,
  paid_at             timestamptz,
  status              installment_status not null default 'upcoming',
  reminder_sent_at    timestamptz,
  unique (installment_plan_id, installment_number)
);
create index idx_installment_schedule_due on installment_schedules (due_date) where status = 'upcoming';
