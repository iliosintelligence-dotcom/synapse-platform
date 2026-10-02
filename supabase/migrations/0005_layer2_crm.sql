-- Layer 2 · CRM core
-- Extends the MVP leads table into a lead-intelligence schema, adds the
-- append-only stage history, deal rooms, and the attribution audit table.
-- Additive only — the MVP lead bridge keeps working unchanged.

-- ───────────────────────── enums ─────────────────────────
create type lead_stage as enum (
  'new','contacted','qualified','viewing_scheduled','viewing_completed',
  'negotiating','commitment','closed','lost'
);
create type risk_level as enum ('low','medium','high');
create type deal_room_status as enum ('active','pending','closed','lost');
create type attribution_channel as enum (
  'instagram','tiktok','facebook','proximity_alert','ai_recommendation',
  'direct_search','whatsapp_campaign','referral','website','organic'
);

-- ──────────────── extend leads → lead intelligence ────────────────
alter table leads
  add column assigned_agent_id            uuid references profiles (id) on delete set null,
  add column current_stage                lead_stage not null default 'new',
  add column budget_range                 text,
  add column budget_min                   numeric(16,2),
  add column budget_max                   numeric(16,2),
  add column timeline_to_purchase         text,
  add column interest_level               smallint check (interest_level between 1 and 5),
  add column last_activity_at             timestamptz,
  add column next_action_at               timestamptz,
  add column risk_level                   risk_level,
  -- ── reserved for AI (Layer 3): nullable, rule-populated now ──
  add column lead_score                   numeric(5,2),
  add column intent_score                 numeric(5,2),
  add column financial_readiness_score    numeric(5,2),
  add column engagement_score             numeric(5,2),
  add column urgency_score                numeric(5,2),
  add column responsiveness_score         numeric(5,2),
  add column fit_score                    numeric(5,2),
  add column conversion_probability       numeric(5,2),
  add column next_action_recommendation   text;

create index idx_leads_assigned_agent on leads (assigned_agent_id);
create index idx_leads_stage on leads (current_stage);
create index idx_leads_last_activity on leads (last_activity_at desc nulls last);
create index idx_leads_next_action on leads (next_action_at asc nulls last);

-- ──────────────── lead_stage_history (append-only) ────────────────
create table lead_stage_history (
  id                              uuid primary key default uuid_generate_v4(),
  lead_id                         uuid not null references leads (id) on delete cascade,
  from_stage                      lead_stage,
  to_stage                        lead_stage not null,
  moved_by                        uuid references profiles (id) on delete set null,
  moved_at                        timestamptz not null default now(),
  reason                          text,
  time_in_previous_stage_seconds  bigint
);
create index idx_stage_history_lead on lead_stage_history (lead_id, moved_at);

-- Append-only guard: block updates and deletes at the database level.
create or replace function reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Table %s is append-only', tg_table_name;
end;
$$;
create trigger lead_stage_history_no_update before update or delete on lead_stage_history
  for each row execute function reject_mutation();

-- Record a stage transition with computed time-in-stage. Used by the API.
create or replace function move_lead_stage(
  p_lead_id uuid, p_to_stage lead_stage, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_from       lead_stage;
  v_since      timestamptz;
  v_seconds    bigint;
begin
  select current_stage, greatest(updated_at, created_at) into v_from, v_since
    from leads where id = p_lead_id;

  select extract(epoch from (now() - max(moved_at)))::bigint into v_seconds
    from lead_stage_history where lead_id = p_lead_id;

  insert into lead_stage_history (lead_id, from_stage, to_stage, moved_by, reason, time_in_previous_stage_seconds)
  values (p_lead_id, v_from, p_to_stage, auth.uid(), p_reason, v_seconds);

  update leads
    set current_stage = p_to_stage, last_activity_at = now()
    where id = p_lead_id;
end;
$$;

-- ──────────────────────── deal_rooms ────────────────────────
create table deal_rooms (
  id             uuid primary key default uuid_generate_v4(),
  lead_id        uuid not null references leads (id) on delete cascade,
  property_id    uuid not null references properties (id) on delete cascade,
  consumer_id    uuid not null references profiles (id) on delete cascade,
  agency_id      uuid not null references agencies (id) on delete cascade,
  agent_id       uuid references profiles (id) on delete set null,
  status         deal_room_status not null default 'active',
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  closing_price  numeric(16,2),
  closing_type   listing_type,
  documents      jsonb not null default '[]',
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (lead_id)
);
create trigger deal_rooms_updated_at before update on deal_rooms
  for each row execute function set_updated_at();
create index idx_deal_rooms_agency on deal_rooms (agency_id, status);
create index idx_deal_rooms_agent on deal_rooms (agent_id);
create index idx_deal_rooms_property on deal_rooms (property_id);

-- ──────────────── lead_attribution (append-only) ────────────────
create table lead_attribution (
  id             uuid primary key default uuid_generate_v4(),
  lead_id        uuid not null references leads (id) on delete cascade,
  property_id    uuid references properties (id) on delete set null,
  agency_id      uuid not null references agencies (id) on delete cascade,
  channel        attribution_channel not null,
  is_first_touch boolean not null default false,
  is_last_touch  boolean not null default false,
  occurred_at    timestamptz not null default now(),
  campaign_id    uuid,
  created_at     timestamptz not null default now()
);
create index idx_attribution_lead on lead_attribution (lead_id, occurred_at);
create index idx_attribution_agency on lead_attribution (agency_id, channel);
create trigger lead_attribution_no_update before update or delete on lead_attribution
  for each row execute function reject_mutation();
