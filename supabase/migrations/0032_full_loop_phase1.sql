-- 0032 · Full-loop Phase 1 backbone (build-plan v2.0).
-- Adds the recency window, the AI-analysis output columns (kept separate from
-- agency-typed fields), session attribution + agent-mode focus, and the
-- append-only pre-lead interaction log that powers the per-channel breakdown.

-- ─────────── recency window for Toju's "last 14 days" recommendation ───────────
-- Separate from created_at so re-listing/renewal can reset the window without
-- rewriting row-creation time.
alter table properties add column listed_at timestamptz not null default now();
create index idx_properties_listed_at on properties (listed_at desc);

-- ─────────── AI analysis output (analyze-listing Edge Function) ───────────
-- Kept SEPARATE from the agency's own input fields — the analyzer never
-- overwrites what the agency typed; it annotates alongside it.
alter table properties
  add column ai_analysis          jsonb,                       -- raw analyzer output
  add column ai_tags              text[] not null default '{}',-- structured match tags
  add column target_buyer_profile text;                        -- family|investor|young_professional|shared
create index idx_properties_ai_tags on properties using gin (ai_tags);

-- ─────────── session attribution + agent-mode focus ───────────
-- source_* carries where a conversation originated (a social post → landing →
-- deep link) so any lead it produces inherits the channel. active_property_id is
-- the property Toju is currently acting as agent for.
alter table chat_sessions
  add column source_channel     attribution_channel,
  add column source_post_id     text,
  add column source_property_id uuid references properties (id) on delete set null,
  add column active_property_id uuid references properties (id) on delete set null;

-- ─────────── channel_interactions (append-only) ───────────
-- Pre-lead and in-session interaction log per property per channel. Leads are
-- attributed via lead_attribution; this captures everything BEFORE a lead exists
-- (social clicks, landing views, app opens, messages) so the agency's per-channel
-- breakdown reflects real engagement, not just converted leads.
create table channel_interactions (
  id          uuid primary key default uuid_generate_v4(),
  property_id uuid not null references properties (id) on delete cascade,
  agency_id   uuid not null references agencies (id) on delete cascade,
  channel     attribution_channel not null,
  post_id     text,
  session_id  uuid references chat_sessions (id) on delete set null,
  kind        text not null,   -- social_click | landing_view | app_open | message | viewing_request
  occurred_at timestamptz not null default now()
);
create index idx_channel_interactions_agency on channel_interactions (agency_id, channel, occurred_at desc);
create index idx_channel_interactions_property on channel_interactions (property_id, occurred_at desc);

alter table channel_interactions enable row level security;
-- Append-only: writes happen via the landing-page / app / handoff Edge Functions
-- under the service role (which bypasses RLS); clients only read their agency's.
create trigger channel_interactions_no_mutate before update or delete on channel_interactions
  for each row execute function reject_mutation();
create policy channel_interactions_select on channel_interactions
  for select using (is_agency_member(agency_id));
