-- Layer 6 · the licensed-partner registry
-- ⚠ REGULATORY INVARIANT: Synapse never custodies funds. Every money-touching
-- record in this layer references a partner_institution. The partner holds the
-- money and the regulatory liability; Synapse holds the ledger + UX. A
-- money-movement feature must NOT activate for real users unless its partner's
-- integration_status = 'live' (contract + regulatory sign-off confirmed).

create type partner_institution_type as enum (
  'microfinance_bank','payment_service_bank','commercial_bank',
  'lending_partner','mortgage_provider','payment_processor'
);
create type partner_integration_status as enum ('prospective','contracted','live','suspended');

create table partner_institutions (
  id                       uuid primary key default uuid_generate_v4(),
  name                     text not null,
  type                     partner_institution_type not null,
  integration_status       partner_integration_status not null default 'prospective',
  license_reference        text,          -- CBN/NAICOM license, for the record
  vault_credential_key     text,          -- Supabase Vault key id; never the secret
  supports_escrow          boolean not null default false,
  supports_virtual_accounts boolean not null default false,
  supports_lending         boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz
);
create trigger partner_institutions_updated_at before update on partner_institutions
  for each row execute function set_updated_at();
create index idx_partners_status on partner_institutions (integration_status, type);

-- Guard used by money-movement Edge Functions: is this partner cleared to
-- move real funds? security definer so functions can check without RLS noise.
create or replace function partner_is_live(p_partner_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from partner_institutions
    where id = p_partner_id and integration_status = 'live' and deleted_at is null
  );
$$;

-- Append-only log of every platform-admin access to a financial record.
-- (Compliance requirement: admin reads of financial data are themselves events.)
create table financial_admin_access_log (
  id          uuid primary key default uuid_generate_v4(),
  admin_id    uuid references profiles (id) on delete set null,
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null,
  occurred_at timestamptz not null default now()
);
create index idx_fin_admin_access on financial_admin_access_log (entity_type, entity_id, occurred_at desc);
create trigger fin_admin_access_no_mutate before update or delete on financial_admin_access_log
  for each row execute function reject_mutation();
