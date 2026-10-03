-- Layer 6 · Systems 2, 3, 7 — GATED (highest regulatory exposure)
-- ⚠ These schemas exist so UI + origination can be built in parallel with
-- partnership negotiations, but NONE of these features may go live for a real
-- user until the relevant partner_institution.integration_status = 'live'
-- AND a written, signed partnership + compliance review exists.
--   System 2 (Rent Now Pay Monthly): lending partner carries credit risk.
--   System 3 (Mortgage Marketplace): a referral marketplace, never a lender.
--   System 7 (Wallet): virtual accounts at a licensed MFB/PSB, never custody.
-- Synapse originates, packages, mirrors. It does not underwrite or custody.

-- ───────────────── System 2 — Rent Now, Pay Monthly ─────────────────
create type rent_financing_status as enum (
  'draft','submitted','under_review','approved','declined','disbursed','active','completed','defaulted'
);
create type employment_status as enum (
  'employed','self_employed','business_owner','contract','unemployed','student'
);
create type repayment_status as enum ('upcoming','paid','late','missed');

create table rent_financing_applications (
  id                        uuid primary key default uuid_generate_v4(),
  tenant_id                 uuid not null references profiles (id) on delete cascade,
  property_id               uuid not null references properties (id) on delete cascade,
  deal_room_id              uuid references deal_rooms (id) on delete set null,
  annual_rent_amount        numeric(16,2) not null,
  requested_monthly_amount  numeric(16,2) not null,
  employment_status         employment_status not null,
  monthly_income_declared   numeric(16,2) not null,
  monthly_income_verified   numeric(16,2),   -- open-banking verified, if connected
  existing_debt_obligations numeric(16,2) not null default 0,
  guarantor_id              uuid,
  partner_lender_id         uuid not null references partner_institutions (id) on delete restrict,
  application_status        rent_financing_status not null default 'draft',
  declined_reason           text,
  approved_amount           numeric(16,2),
  approved_monthly_repayment numeric(16,2),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create trigger rent_financing_updated_at before update on rent_financing_applications
  for each row execute function set_updated_at();
create index idx_rent_financing_tenant on rent_financing_applications (tenant_id, application_status);

-- Repayment schedule is the partner lender's — MIRRORED for the tenant UI,
-- never generated independently by Synapse.
create table rent_repayment_schedules (
  id                 uuid primary key default uuid_generate_v4(),
  application_id     uuid not null references rent_financing_applications (id) on delete cascade,
  installment_number integer not null,
  due_date           date not null,
  amount_due         numeric(16,2) not null,
  amount_paid        numeric(16,2) not null default 0,
  paid_at            timestamptz,
  status             repayment_status not null default 'upcoming',
  late_fee_applied   numeric(16,2),
  unique (application_id, installment_number)
);
create index idx_rent_repayment_due on rent_repayment_schedules (due_date) where status = 'upcoming';

create table rent_guarantors (
  id                          uuid primary key default uuid_generate_v4(),
  application_id              uuid not null references rent_financing_applications (id) on delete cascade,
  guarantor_name              text not null,
  guarantor_phone             text not null,
  guarantor_relationship      text,
  guarantor_identity_verified boolean not null default false,  -- via Smile Identity (L4)
  consent_given               boolean not null default false,
  consent_given_at            timestamptz
);
create index idx_rent_guarantors_app on rent_guarantors (application_id);

-- ───────────────── System 3 — Mortgage Marketplace ─────────────────
create type mortgage_institution_type as enum (
  'commercial_bank','primary_mortgage_institution','cooperative','real_estate_finance_company'
);
create type mortgage_integration_status as enum ('manual_referral','api_connected');
create type mortgage_application_status as enum (
  'draft','submitted','document_collection','under_review','approved','declined','disbursed'
);

create table mortgage_providers (
  id                      uuid primary key default uuid_generate_v4(),
  institution_name        text not null,
  institution_type        mortgage_institution_type not null,
  api_integration_status  mortgage_integration_status not null default 'manual_referral',
  min_loan_amount         numeric(16,2) not null default 0,
  max_loan_amount         numeric(16,2) not null default 0,
  interest_rate_range_min numeric(6,3),
  interest_rate_range_max numeric(6,3),
  max_tenor_years         integer,
  eligibility_criteria    jsonb not null default '{}',
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger mortgage_providers_updated_at before update on mortgage_providers
  for each row execute function set_updated_at();

create table mortgage_applications (
  id                    uuid primary key default uuid_generate_v4(),
  buyer_id              uuid not null references profiles (id) on delete cascade,
  property_id           uuid not null references properties (id) on delete cascade,
  mortgage_provider_id  uuid not null references mortgage_providers (id) on delete restrict,
  declared_income       numeric(16,2) not null,
  declared_expenses     numeric(16,2) not null default 0,
  requested_loan_amount numeric(16,2) not null,
  requested_tenor_years integer not null,
  down_payment_available numeric(16,2) not null default 0,
  application_status    mortgage_application_status not null default 'draft',
  provider_reference_id text,
  approved_loan_amount  numeric(16,2),
  approved_interest_rate numeric(6,3),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger mortgage_applications_updated_at before update on mortgage_applications
  for each row execute function set_updated_at();
create index idx_mortgage_apps_buyer on mortgage_applications (buyer_id, application_status);

-- ───────────────── System 7 — Wallet (virtual accounts) ─────────────────
create type wallet_purpose as enum (
  'general','rent_savings','down_payment_savings','inspection_fees','booking_fees'
);
create type wallet_status as enum ('active','frozen','closed');
create type wallet_transaction_type as enum ('deposit','withdrawal','transfer_to_escrow','fee_payment');
create type wallet_transaction_status as enum ('pending','confirmed','failed');
create type savings_goal_type as enum ('rent_target','down_payment_target');

-- Each wallet is a dedicated virtual account at the partner bank. balance is
-- MIRRORED + reconciled — never the source of truth.
create table wallets (
  id                              uuid primary key default uuid_generate_v4(),
  user_id                         uuid not null references profiles (id) on delete cascade,
  partner_institution_id          uuid not null references partner_institutions (id) on delete restrict,
  partner_virtual_account_reference text,
  wallet_purpose                  wallet_purpose not null default 'general',
  balance                         numeric(16,2) not null default 0,
  status                          wallet_status not null default 'active',
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique (user_id, wallet_purpose)
);
create trigger wallets_updated_at before update on wallets
  for each row execute function set_updated_at();

create table savings_goals (
  id                uuid primary key default uuid_generate_v4(),
  wallet_id         uuid not null references wallets (id) on delete cascade,
  goal_type         savings_goal_type not null,
  target_amount     numeric(16,2) not null,
  target_date       date,
  current_progress  numeric(16,2) not null default 0,
  auto_save_enabled boolean not null default false,
  auto_save_amount  numeric(16,2),
  auto_save_frequency text check (auto_save_frequency in ('weekly','monthly')),
  created_at        timestamptz not null default now()
);
create index idx_savings_goals_wallet on savings_goals (wallet_id);

-- Every row mirrors a CONFIRMED transaction at the partner — Synapse never
-- writes a 'confirmed' transaction without a partner confirmation webhook.
create table wallet_transactions (
  id                          uuid primary key default uuid_generate_v4(),
  wallet_id                   uuid not null references wallets (id) on delete cascade,
  transaction_type            wallet_transaction_type not null,
  amount                      numeric(16,2) not null,
  partner_transaction_reference text,
  status                      wallet_transaction_status not null default 'pending',
  occurred_at                 timestamptz not null default now()
);
create index idx_wallet_txns on wallet_transactions (wallet_id, occurred_at desc);
