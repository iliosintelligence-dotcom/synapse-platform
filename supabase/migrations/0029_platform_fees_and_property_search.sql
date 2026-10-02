-- 0029 · Gap-fill from the canonical schema spec audit.
-- The core schema already exists (0001-0028) and is richer than the spec, so
-- this migration adds ONLY the two genuinely-missing, non-conflicting items the
-- audit surfaced. It creates no duplicate tables and changes no existing enum.
--
--   1. platform fees — what Synapse ITSELF is owed (not money moving between
--      other parties; that is Layer 6's commission/escrow/wallet). Foundation
--      only: no banking partner, no money movement, just receivables.
--   2. properties full-text index — keyword search as a fallback to the
--      structured filtering Toju/browse already use.
--
-- (perceptual_hash from the spec is NOT added — it already exists as
--  property_media.image_hash, added for the Layer 4 fraud duplicate check.)

-- ───────────────────────── 1 · platform fees ─────────────────────────
create type fee_type as enum ('transaction_close', 'verification_subscription', 'proximity_alert');
create type fee_status as enum ('pending', 'invoiced', 'paid');

create table fees (
  id          uuid primary key default uuid_generate_v4(),
  agency_id   uuid not null references agencies (id) on delete restrict,  -- never orphan a receivable
  lead_id     uuid references leads (id) on delete set null,              -- fee survives lead removal
  fee_type    fee_type not null,
  amount      numeric(16,2) not null check (amount >= 0),
  status      fee_status not null default 'pending',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz                                                 -- money: soft-delete only
);
create trigger fees_updated_at before update on fees
  for each row execute function set_updated_at();
create index idx_fees_agency on fees (agency_id, status, created_at desc);
create index idx_fees_lead on fees (lead_id) where lead_id is not null;

alter table fees enable row level security;
-- Readable by the owning agency's admins/owners. All writes (raising, invoicing,
-- marking paid) happen in a platform Edge Function under the service role, which
-- bypasses RLS — so there is no insert/update policy by design.
create policy fees_select on fees
  for select using (
    agency_role(agency_id) in ('agency_admin', 'agency_owner')
  );

-- ──────────────── 2 · properties full-text search ────────────────
-- GIN index over an immutable to_tsvector expression of title + description.
-- Lets keyword search fall back through to_tsquery when structured filters
-- (city/type/budget) aren't enough. Does not alter the properties table.
create index idx_properties_fts on properties
  using gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));
