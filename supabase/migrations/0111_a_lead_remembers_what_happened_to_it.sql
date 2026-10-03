-- 0111 — A LEAD REMEMBERS WHAT HAPPENED TO IT
--
-- Every table this needs already existed. None of them had ever been written.
--
--   lead_stage_history   0 rows -- while three of five leads had left 'new'
--   activity_feed        0 rows
--   tasks                0 rows
--   task_templates       0 rows
--
-- So a lead was a row with a current stage and no past. You could not see when
-- it moved, who moved it, how long it sat, or what anyone did about it. And the
-- one thing a CRM is actually for -- telling an agent who to ring this morning
-- -- had no mechanism at all: tasks existed as a table and nothing created one.
--
-- WHY THE TRIGGER AND NOT THE PORTAL. setLeadStage() in the portal is one of
-- several ways a stage moves: Toju hands leads over, edge functions advance
-- them, and an agency will eventually do it from a phone. Writing the history
-- in the portal would record the portal's moves and silently miss the rest --
-- the exact shape of the bug that left social_posts without links for a
-- fortnight, where two paths wrote and only one did the work. The row is the
-- one thing every path has in common.
--
-- task_templates already carried trigger_stage and due_offset_hours, which is
-- someone's design saying "when a lead reaches this stage, raise this
-- follow-up, due this many hours out". This implements that.

begin;

-- ── seeds need somewhere to live ────────────────────────────────────────────
-- agency_id becomes nullable, meaning "every agency", which is the convention
-- content_templates already used for exactly this. The alternative was seven
-- rows times forty agencies plus a hook on agency creation to keep it true.
alter table public.task_templates alter column agency_id drop not null;

-- The read policy has to admit them. Same shape as content_templates_read.
-- The WRITE policy is deliberately untouched: it requires agency_role(agency_id)
-- to be admin or owner, and agency_role(null) is null -- so a seed is readable
-- by everyone and editable by no one.
drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select on public.task_templates
  for select using (agency_id is null or is_agency_member(agency_id));


-- ── the seeded follow-ups ───────────────────────────────────────────────────
-- The offsets are the argument. A new lead in Lagos real estate goes cold in
-- hours, not days -- the agent who calls first usually wins, and 24 hours is
-- already late. Everything downstream is paced to how long the real step takes.
insert into task_templates (agency_id, name, task_type, description, default_priority, due_offset_hours, trigger_stage, is_active)
values
  (null, 'Call the new lead', 'call',
   'First contact. Confirm what they are looking for, the budget and the timeline before anything else.',
   'urgent', 2, 'new', true),

  (null, 'Qualify the enquiry', 'follow_up',
   'Budget, timeline, financing, and whether they have seen anything else. Enough to know if this is real.',
   'high', 24, 'contacted', true),

  (null, 'Book the viewing', 'schedule_viewing',
   'A qualified lead with no date in the diary is the most common place a deal quietly dies.',
   'high', 24, 'qualified', true),

  (null, 'Confirm the viewing', 'follow_up',
   'Reconfirm the day before. No-shows are the single biggest waste of an agent''s week.',
   'medium', 24, 'viewing_scheduled', true),

  (null, 'Follow up after the viewing', 'follow_up',
   'While they still remember the place. Ask what they thought, and what would have to be true for them to take it.',
   'urgent', 4, 'viewing_completed', true),

  (null, 'Send the documents', 'send_documents',
   'Title, survey, receipts. A negotiation without papers stalls at exactly the point it should be closing.',
   'high', 12, 'negotiating', true),

  (null, 'Verify before money moves', 'verify_documents',
   'Confirm the papers and the owner one last time. This is the step that protects the buyer and the agency both.',
   'urgent', 6, 'commitment', true);


-- ── the loop ────────────────────────────────────────────────────────────────
create or replace function public.lead_stage_moved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev   timestamptz;
  v_actor  uuid := auth.uid();
  v_tpl    record;
  v_secs   bigint;
begin
  -- How long it sat where it was. Measured from the last MOVE rather than from
  -- created_at, so the second stage does not inherit the first one's age. Falls
  -- back to creation for the first move, which is genuinely how long it waited.
  select max(moved_at) into v_prev from lead_stage_history where lead_id = new.id;
  v_secs := extract(epoch from (now() - coalesce(v_prev, old.created_at)))::bigint;

  insert into lead_stage_history (lead_id, from_stage, to_stage, moved_by, moved_at, time_in_previous_stage_seconds)
  values (new.id, old.current_stage, new.current_stage, v_actor, now(), v_secs);

  insert into activity_feed (agency_id, lead_id, property_id, agent_id, activity_type, payload)
  values (new.agency_id, new.id, new.property_id, coalesce(v_actor, new.assigned_agent_id),
          'lead_stage_changed',
          jsonb_build_object('from', old.current_stage, 'to', new.current_stage,
                             'seconds_in_previous', v_secs));

  /* THE FOLLOW-UP RAISES ITSELF. A stage change is the moment the next action
     becomes knowable, and it is also the moment everyone is busy -- which is
     why "I'll call them tomorrow" is where leads go to die. The task is
     assigned to whoever owns the lead; an unassigned lead produces an
     unassigned task rather than none, because the work still exists. */
  for v_tpl in
    select * from task_templates
     where is_active and deleted_at is null
       and trigger_stage = new.current_stage
       and (agency_id is null or agency_id = new.agency_id)
  loop
    -- Never twice for the same lead and template. A lead moved back and forth
    -- between two stages would otherwise collect duplicates of the same call,
    -- and an agent who sees the same task three times stops reading the list.
    if not exists (
      select 1 from tasks
       where lead_id = new.id
         and title = v_tpl.name
         and status in ('pending', 'in_progress')
         and deleted_at is null
    ) then
      insert into tasks (agency_id, lead_id, assigned_to, created_by, title, description,
                         task_type, priority, status, due_at)
      values (new.agency_id, new.id, new.assigned_agent_id, v_actor, v_tpl.name, v_tpl.description,
              v_tpl.task_type, v_tpl.default_priority, 'pending',
              now() + make_interval(hours => coalesce(v_tpl.due_offset_hours, 24)));

      insert into activity_feed (agency_id, lead_id, property_id, agent_id, activity_type, payload)
      values (new.agency_id, new.id, new.property_id, new.assigned_agent_id, 'task_created',
              jsonb_build_object('title', v_tpl.name, 'due_in_hours', coalesce(v_tpl.due_offset_hours, 24)));
    end if;
  end loop;

  -- What the board sorts by. A stage change IS activity, and leaving this stale
  -- is how a lead that moved this morning shows as untouched for a week.
  new.last_activity_at := now();
  return new;
end;
$$;

drop trigger if exists trg_lead_stage_moved on public.leads;
create trigger trg_lead_stage_moved
  before update of current_stage on public.leads
  for each row
  when (old.current_stage is distinct from new.current_stage)
  execute function public.lead_stage_moved();


-- ── and the beginning of the story ──────────────────────────────────────────
create or replace function public.lead_created_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into activity_feed (agency_id, lead_id, property_id, agent_id, activity_type, payload)
  values (new.agency_id, new.id, new.property_id, new.assigned_agent_id, 'lead_created',
          jsonb_build_object('source', new.source, 'name', new.consumer_name));
  return new;
end;
$$;

drop trigger if exists trg_lead_created on public.leads;
create trigger trg_lead_created
  after insert on public.leads
  for each row
  execute function public.lead_created_activity();

commit;

-- VERIFIED on a real lead, then rolled back: two moves produced two
-- lead_stage_history rows, four activity_feed rows (two stage changes, two
-- tasks raised) and two tasks with the right types, priorities and due offsets.
-- The first move recorded 2,990,090 seconds in 'new' -- thirty-four days, which
-- is true and is the sort of number this table exists to make visible.
--
-- Note for anyone cleaning up after a test here: activity_feed and
-- lead_stage_history are both append-only, guarded by reject_mutation(). That
-- is correct and worth keeping. Deleting test rows means disabling the guard
-- and putting it back.
