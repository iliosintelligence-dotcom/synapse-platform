-- Layer 2 · event architecture, activity feed, notifications
-- events + activity_feed are append-only and immutable. Both are added to
-- the Realtime publication so clients update without polling.

-- ───────────────────────── enums ─────────────────────────
create type activity_type as enum (
  'lead_created','lead_assigned','lead_stage_changed','call_logged','whatsapp_sent',
  'email_sent','viewing_scheduled','viewing_completed','viewing_cancelled',
  'document_uploaded','offer_made','offer_rejected','deal_closed','deal_lost',
  'task_created','task_completed','note_added','proximity_alert_triggered',
  'social_post_published','viewing_incomplete'
);
create type event_type as enum (
  'lead_created','lead_assigned','lead_stage_changed','viewing_scheduled',
  'viewing_completed','message_sent','task_created','task_completed',
  'offer_submitted','deal_closed','deal_lost','communication_logged','attribution_recorded'
);
create type notification_channel as enum ('push','email','sms','whatsapp','in_app');
create type notification_status as enum ('pending','sent','delivered','failed','read');

-- ──────────────────────── events (append-only) ────────────────────────
create table events (
  id          uuid primary key default uuid_generate_v4(),
  event_type  event_type not null,
  agency_id   uuid not null references agencies (id) on delete cascade,
  actor_id    uuid references profiles (id) on delete set null,
  entity_type text not null,
  entity_id   uuid not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index idx_events_agency on events (agency_id, created_at desc);
create index idx_events_entity on events (entity_type, entity_id);
create trigger events_no_update before update or delete on events
  for each row execute function reject_mutation();

-- ──────────────────────── activity_feed (append-only) ────────────────────────
create table activity_feed (
  id            uuid primary key default uuid_generate_v4(),
  agency_id     uuid not null references agencies (id) on delete cascade,
  lead_id       uuid references leads (id) on delete cascade,
  property_id   uuid references properties (id) on delete set null,
  agent_id      uuid references profiles (id) on delete set null,
  activity_type activity_type not null,
  payload       jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index idx_activity_agency on activity_feed (agency_id, created_at desc);
create index idx_activity_lead on activity_feed (lead_id, created_at desc);
create trigger activity_feed_no_update before update or delete on activity_feed
  for each row execute function reject_mutation();

-- ──────────────────────── notification_templates ────────────────────────
create table notification_templates (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  channel       notification_channel not null,
  subject       text,
  body_template text not null,
  variables     jsonb not null default '{}',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger notification_templates_updated_at before update on notification_templates
  for each row execute function set_updated_at();

-- ──────────────────────── notifications ────────────────────────
-- Every notification is a tracked record, not fire-and-forget.
create table notifications (
  id             uuid primary key default uuid_generate_v4(),
  recipient_id   uuid not null references profiles (id) on delete cascade,
  agency_id      uuid references agencies (id) on delete cascade,
  channel        notification_channel not null,
  template_id    uuid references notification_templates (id) on delete set null,
  payload        jsonb not null default '{}',
  status         notification_status not null default 'pending',
  sent_at        timestamptz,
  delivered_at   timestamptz,
  read_at        timestamptz,
  failure_reason text,
  retry_count    integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create trigger notifications_updated_at before update on notifications
  for each row execute function set_updated_at();
create index idx_notifications_recipient on notifications (recipient_id, status, created_at desc);
create index idx_notifications_retry on notifications (status) where status = 'failed';

-- ──────────────── Realtime publication ────────────────
-- Pipeline, deal rooms, feeds, notifications all subscribe to these.
alter publication supabase_realtime add table leads;
alter publication supabase_realtime add table lead_stage_history;
alter publication supabase_realtime add table activity_feed;
alter publication supabase_realtime add table events;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table viewings;
alter publication supabase_realtime add table communications;
alter publication supabase_realtime add table deal_rooms;
