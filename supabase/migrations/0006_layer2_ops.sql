-- Layer 2 · operations
-- Extends viewings into a structured workflow, adds communications,
-- tasks, and task templates.

-- ───────────────────────── enums ─────────────────────────
create type post_viewing_budget_fit as enum ('yes','maybe','no');
create type viewing_outcome as enum ('interested','not_interested','offer_pending','offer_made');
create type communication_channel as enum ('call','whatsapp','email','platform_message','meeting');
create type communication_direction as enum ('inbound','outbound');
create type communication_outcome as enum ('connected','voicemail','no_answer','replied','no_reply');
create type task_type as enum (
  'call','follow_up','send_documents','schedule_viewing','verify_documents','make_offer','custom'
);
create type task_priority as enum ('low','medium','high','urgent');
create type task_status as enum ('pending','in_progress','completed','cancelled');

-- The Layer 1 viewing_status enum lacks 'scheduled'; add it.
alter type viewing_status add value if not exists 'scheduled';

-- ──────────────── extend viewings → structured workflow ────────────────
alter table viewings
  add column lead_id                             uuid references leads (id) on delete set null,
  add column agent_id                            uuid references profiles (id) on delete set null,
  add column duration_minutes                    smallint,
  add column location_notes                      text,
  add column pre_viewing_notes                   text,
  -- ── AI signal layer: captured at completion ──
  add column post_viewing_interest_level         smallint check (post_viewing_interest_level between 1 and 5),
  add column post_viewing_concerns               text,
  add column post_viewing_budget_fit             post_viewing_budget_fit,
  add column post_viewing_likelihood_to_proceed  smallint check (post_viewing_likelihood_to_proceed between 1 and 10),
  add column outcome                             viewing_outcome,
  add column completed_at                        timestamptz;

create index idx_viewings_lead on viewings (lead_id);
create index idx_viewings_agent on viewings (agent_id);

-- ──────────────────────── communications ────────────────────────
-- response_time_seconds is computed on insert: time from the lead's last
-- inbound touch to this outbound one. Powers the response-time metric.
create table communications (
  id                    uuid primary key default uuid_generate_v4(),
  lead_id               uuid not null references leads (id) on delete cascade,
  agent_id              uuid references profiles (id) on delete set null,
  channel               communication_channel not null,
  direction             communication_direction not null,
  duration_seconds      integer,
  outcome               communication_outcome,
  sentiment_placeholder text,            -- reserved for AI (Layer 3)
  summary               text,
  response_time_seconds bigint,          -- computed for outbound replies
  occurred_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create trigger communications_updated_at before update on communications
  for each row execute function set_updated_at();
create index idx_communications_lead on communications (lead_id, occurred_at desc);
create index idx_communications_agent on communications (agent_id);

create or replace function compute_response_time()
returns trigger language plpgsql as $$
declare
  v_last_inbound timestamptz;
begin
  if new.direction = 'outbound' then
    select max(occurred_at) into v_last_inbound
      from communications
      where lead_id = new.lead_id and direction = 'inbound' and occurred_at <= new.occurred_at;
    if v_last_inbound is not null then
      new.response_time_seconds = extract(epoch from (new.occurred_at - v_last_inbound))::bigint;
    end if;
  end if;
  -- keep the lead's activity clock fresh
  update leads set last_activity_at = now() where id = new.lead_id;
  return new;
end;
$$;
create trigger communications_response_time before insert on communications
  for each row execute function compute_response_time();

-- ──────────────────────── task_templates ────────────────────────
-- Reusable definitions; future automation fires these when a lead enters
-- trigger_stage. due_offset_hours sets the due date relative to the trigger.
create table task_templates (
  id               uuid primary key default uuid_generate_v4(),
  agency_id        uuid not null references agencies (id) on delete cascade,
  name             text not null,
  task_type        task_type not null,
  description      text,
  default_priority task_priority not null default 'medium',
  due_offset_hours integer not null default 24,
  trigger_stage    lead_stage,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create trigger task_templates_updated_at before update on task_templates
  for each row execute function set_updated_at();
create index idx_task_templates_agency on task_templates (agency_id, trigger_stage);

-- ──────────────────────── tasks ────────────────────────
create table tasks (
  id           uuid primary key default uuid_generate_v4(),
  agency_id    uuid not null references agencies (id) on delete cascade,
  lead_id      uuid references leads (id) on delete cascade,
  assigned_to  uuid references profiles (id) on delete set null,
  created_by   uuid references profiles (id) on delete set null,
  title        text not null,
  description  text,
  task_type    task_type not null default 'custom',
  priority     task_priority not null default 'medium',
  status       task_status not null default 'pending',
  due_at       timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger tasks_updated_at before update on tasks
  for each row execute function set_updated_at();
create index idx_tasks_agency on tasks (agency_id, status);
create index idx_tasks_assigned on tasks (assigned_to, status);
create index idx_tasks_lead on tasks (lead_id);
create index idx_tasks_due on tasks (due_at asc nulls last);
