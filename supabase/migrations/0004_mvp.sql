-- Layer 0.5 (MVP) · leads + chat_sessions
-- The lead bridge is the product. These tables are load-bearing.
-- Self-contained: tables, indexes, triggers, and RLS in one migration.

-- ───────────────────────── enums ─────────────────────────
create type lead_source as enum ('toju_chat','contact_button','browse');
create type lead_delivery_status as enum ('pending','delivered','delivery_failed');

-- ───────────────────────── leads ─────────────────────────
-- consumer_name / consumer_phone are snapshots taken at creation so the
-- lead survives later profile edits. preferences holds the LeadPreferences
-- shape extracted by Toju (city, budget range, type, timeline).
create table leads (
  id                    uuid primary key default uuid_generate_v4(),
  property_id           uuid not null references properties (id) on delete cascade,
  consumer_id           uuid not null references profiles (id) on delete cascade,
  agency_id             uuid not null references agencies (id) on delete cascade,
  source                lead_source not null,
  consumer_name         text not null default '',
  consumer_phone        text,
  preferences           jsonb,
  delivery_status       lead_delivery_status not null default 'pending',
  whatsapp_message_sid  text,
  delivered_at          timestamptz,
  delivery_error        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create trigger leads_updated_at before update on leads
  for each row execute function set_updated_at();

-- Leads list is reverse-chronological per agency (dashboard primary view).
create index idx_leads_agency_created on leads (agency_id, created_at desc);
create index idx_leads_consumer on leads (consumer_id);
create index idx_leads_property on leads (property_id);
-- Surface delivery_failed leads quickly so none are silently lost.
create index idx_leads_delivery on leads (delivery_status);

-- ─────────────────────── chat_sessions ───────────────────────
-- One rolling Toju conversation per consumer. messages is trimmed to the
-- last 30 server-side; extracted preferences are promoted to columns so
-- they can drive search and be attached to leads without parsing jsonb.
create table chat_sessions (
  id                  uuid primary key default uuid_generate_v4(),
  consumer_id         uuid not null references profiles (id) on delete cascade,
  messages            jsonb not null default '[]',
  pref_city           text,
  pref_budget_min     numeric(16,2),
  pref_budget_max     numeric(16,2),
  pref_property_type  property_type,
  pref_listing_type   listing_type,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create trigger chat_sessions_updated_at before update on chat_sessions
  for each row execute function set_updated_at();
create index idx_chat_sessions_consumer on chat_sessions (consumer_id, updated_at desc);

-- ───────────────────────── RLS ─────────────────────────
alter table leads enable row level security;
alter table chat_sessions enable row level security;

-- Leads: readable by the consumer who generated it and the listing agency.
create policy leads_select on leads
  for select using (
    deleted_at is null
    and (consumer_id = auth.uid() or is_agency_member(agency_id))
  );

-- Consumers may create their own lead (client fallback). The create-lead
-- Edge Function uses the service role for the full write+deliver pipeline,
-- which bypasses RLS — there is intentionally no client update policy:
-- delivery_status is owned by the function alone.
create policy leads_insert_consumer on leads
  for insert with check (consumer_id = auth.uid());

-- Chat sessions: fully owned by the consumer. The toju-chat Edge Function
-- runs with the caller's JWT, so this policy governs it too.
create policy chat_sessions_all_own on chat_sessions
  for all using (consumer_id = auth.uid())
  with check (consumer_id = auth.uid());
