-- Layer 6 · System 8 — Financial Identity Graph
-- The consumer financial trust signal (distinct from Layer 4 agency/agent
-- scores). Schema built early so Systems 1-3 write into it from day one.
-- STRICTEST RLS on the platform: readable by the user themselves, and by
-- others ONLY through an explicit, logged, consent-scoped grant.

create type financial_score_audience as enum ('self','landlord_agency','lender');

create table financial_identities (
  id                             uuid primary key default uuid_generate_v4(),
  user_id                        uuid not null references profiles (id) on delete cascade,
  synapse_trust_score            numeric(5,2),
  payment_reliability_score      numeric(5,2),
  verification_completeness_score numeric(5,2),
  transaction_history_score      numeric(5,2),
  rental_history_verified        boolean not null default false,
  predicted_score                numeric(5,2),   -- reserved for AI scoring
  score_calculated_at            timestamptz,
  score_version                  integer not null default 1,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  unique (user_id)
);
create trigger financial_identities_updated_at before update on financial_identities
  for each row execute function set_updated_at();

-- Append-only: every score movement traces to a specific contributing event.
create table score_component_history (
  id                     uuid primary key default uuid_generate_v4(),
  financial_identity_id  uuid not null references financial_identities (id) on delete cascade,
  component_name         text not null,
  component_value        numeric(8,2) not null,
  contributing_event_type text not null,
  contributing_event_id  uuid,
  recorded_at            timestamptz not null default now()
);
create index idx_score_history on score_component_history (financial_identity_id, recorded_at desc);
create trigger score_history_no_mutate before update or delete on score_component_history
  for each row execute function reject_mutation();

-- A user-triggered, logged, consent-scoped share of their financial identity
-- (e.g. when they submit a rental/mortgage application). Never default access.
create table financial_consent_grants (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references profiles (id) on delete cascade,
  granted_to_id    uuid not null references profiles (id) on delete cascade,
  audience         financial_score_audience not null,
  shared_components text[] not null default '{}',
  context_type     text not null,
  context_id       uuid,
  granted_at       timestamptz not null default now(),
  revoked_at       timestamptz
);
create index idx_consent_grants_user on financial_consent_grants (user_id);
create index idx_consent_grants_grantee on financial_consent_grants (granted_to_id) where revoked_at is null;

-- Helper: may the current user read this financial identity? Either it's
-- theirs, or they hold a live consent grant from its owner.
create or replace function can_read_financial_identity(p_user_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select p_user_id = auth.uid()
      or exists (
        select 1 from financial_consent_grants g
        where g.user_id = p_user_id and g.granted_to_id = auth.uid() and g.revoked_at is null
      );
$$;
