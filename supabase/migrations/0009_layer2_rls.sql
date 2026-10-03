-- Layer 2 · row level security
-- Every new table locked. Agents see only leads assigned to them and deal
-- rooms they belong to; agency admins/owners see all agency data; consumers
-- see only their own. Platform admins use the service role in Edge Functions.
-- Reuses is_agency_member()/agency_role() from migration 0002.

alter table lead_stage_history enable row level security;
alter table deal_rooms enable row level security;
alter table lead_attribution enable row level security;
alter table communications enable row level security;
alter table task_templates enable row level security;
alter table tasks enable row level security;
alter table events enable row level security;
alter table activity_feed enable row level security;
alter table notification_templates enable row level security;
alter table notifications enable row level security;
alter table agency_daily_snapshots enable row level security;
alter table agent_daily_snapshots enable row level security;
alter table property_performance enable row level security;

-- Helper: is this agent the lead's assignee, OR an admin/owner of its agency?
create or replace function can_access_lead(p_lead_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from leads l
    where l.id = p_lead_id
      and (
        l.consumer_id = auth.uid()
        or l.assigned_agent_id = auth.uid()
        or agency_role(l.agency_id) in ('agency_admin','agency_owner')
      )
  );
$$;

-- ──────────────── lead_stage_history (read-only to clients) ────────────────
create policy stage_history_select on lead_stage_history
  for select using (can_access_lead(lead_id));
-- inserts happen via move_lead_stage() (security definer); no client insert policy.

-- ──────────────── deal_rooms ────────────────
create policy deal_rooms_select on deal_rooms
  for select using (
    deleted_at is null and (
      consumer_id = auth.uid()
      or agent_id = auth.uid()
      or agency_role(agency_id) in ('agency_admin','agency_owner')
    )
  );
create policy deal_rooms_write_agency on deal_rooms
  for all using (
    agent_id = auth.uid() or agency_role(agency_id) in ('agency_admin','agency_owner')
  ) with check (
    is_agency_member(agency_id)
  );

-- ──────────────── lead_attribution (read-only to clients) ────────────────
create policy attribution_select on lead_attribution
  for select using (is_agency_member(agency_id) or can_access_lead(lead_id));
-- writes via the attribution service (service role / security definer).

-- ──────────────── communications ────────────────
create policy communications_select on communications
  for select using (can_access_lead(lead_id));
create policy communications_insert on communications
  for insert with check (can_access_lead(lead_id));
create policy communications_update on communications
  for update using (can_access_lead(lead_id));

-- ──────────────── tasks ────────────────
create policy tasks_select on tasks
  for select using (
    deleted_at is null and (
      assigned_to = auth.uid()
      or created_by = auth.uid()
      or agency_role(agency_id) in ('agency_admin','agency_owner')
    )
  );
create policy tasks_write on tasks
  for all using (is_agency_member(agency_id))
  with check (is_agency_member(agency_id));

-- ──────────────── task_templates (admins/owners manage) ────────────────
create policy task_templates_select on task_templates
  for select using (is_agency_member(agency_id));
create policy task_templates_write on task_templates
  for all using (agency_role(agency_id) in ('agency_admin','agency_owner'))
  with check (agency_role(agency_id) in ('agency_admin','agency_owner'));

-- ──────────────── events (read-only to clients) ────────────────
create policy events_select on events
  for select using (is_agency_member(agency_id));
-- emitted by services (security definer / service role); no client write.

-- ──────────────── activity_feed (read-only to clients) ────────────────
create policy activity_select on activity_feed
  for select using (is_agency_member(agency_id) or (lead_id is not null and can_access_lead(lead_id)));

-- ──────────────── notification_templates (platform-managed) ────────────────
create policy notification_templates_select on notification_templates
  for select using (auth.uid() is not null);
-- writes via service role only.

-- ──────────────── notifications (recipient-owned) ────────────────
create policy notifications_select_own on notifications
  for select using (recipient_id = auth.uid());
create policy notifications_update_own on notifications
  for update using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());
-- creation happens via the notification service (service role).

-- ──────────────── performance snapshots (read within agency) ────────────────
create policy agency_snapshots_select on agency_daily_snapshots
  for select using (is_agency_member(agency_id));
create policy agent_snapshots_select on agent_daily_snapshots
  for select using (
    agent_id = auth.uid() or agency_role(agency_id) in ('agency_admin','agency_owner')
  );
create policy property_performance_select on property_performance
  for select using (
    exists (select 1 from properties p where p.id = property_id and is_agency_member(p.agency_id))
  );
-- snapshots are written only by the nightly aggregator (security definer).
