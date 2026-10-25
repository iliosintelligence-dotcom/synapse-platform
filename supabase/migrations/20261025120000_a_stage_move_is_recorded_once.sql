-- A stage move is recorded once, with its reason.
--
-- move_lead_stage (0005, guarded in 0031) wrote its own lead_stage_history row
-- and then updated leads.current_stage. Since 0111 that update fires
-- lead_stage_moved, which writes a history row too, so every move made through
-- the function was recorded twice: once with the reason and no real duration,
-- once with the duration and no reason. The CRM's Lost button (2026-10-25)
-- is the first client to call it, so the funnel report has been folding the
-- pairs back together in the browser.
--
-- Now the trigger is the only writer. move_lead_stage hands it the reason in a
-- transaction-local setting and does nothing but the update; the trigger puts
-- the reason on its history row and on the activity_feed payload. Moves made
-- by a plain update (the CRM's stage menu) are unchanged: no reason, one row.
--
-- History already written stays as it is: lead_stage_history is append-only
-- (lead_stage_history_no_update), and the report still folds the old pairs.

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
  -- Why it moved, when move_lead_stage was told (a Lost reason). Read once and
  -- cleared, so a second update in the same transaction cannot inherit it.
  v_reason text := nullif(current_setting('synapse.stage_reason', true), '');
begin
  perform set_config('synapse.stage_reason', '', true);

  -- How long it sat where it was. Measured from the last MOVE rather than from
  -- created_at, so the second stage does not inherit the first one's age. Falls
  -- back to creation for the first move, which is genuinely how long it waited.
  select max(moved_at) into v_prev from lead_stage_history where lead_id = new.id;
  v_secs := extract(epoch from (now() - coalesce(v_prev, old.created_at)))::bigint;

  insert into lead_stage_history (lead_id, from_stage, to_stage, moved_by, moved_at, reason, time_in_previous_stage_seconds)
  values (new.id, old.current_stage, new.current_stage, v_actor, now(), v_reason, v_secs);

  insert into activity_feed (agency_id, lead_id, property_id, agent_id, activity_type, payload)
  values (new.agency_id, new.id, new.property_id, coalesce(v_actor, new.assigned_agent_id),
          'lead_stage_changed',
          jsonb_build_object('from', old.current_stage, 'to', new.current_stage,
                             'seconds_in_previous', v_secs)
          || case when v_reason is null then '{}'::jsonb else jsonb_build_object('reason', v_reason) end);

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


-- Same access rule and signature as 0031, so callers and grants are untouched.
create or replace function public.move_lead_stage(
  p_lead_id uuid, p_to_stage lead_stage, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- Same rule as the leads RLS select policy: lead's consumer or an agency member.
  if not exists (
    select 1 from leads l
    where l.id = p_lead_id
      and (l.consumer_id = auth.uid() or is_agency_member(l.agency_id))
  ) then
    raise exception 'forbidden: not permitted to move lead %', p_lead_id
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('synapse.stage_reason', coalesce(left(p_reason, 200), ''), true);

  -- No history insert here: trg_lead_stage_moved records the move, and only
  -- when the stage actually changes. Moving a lead to the stage it is already
  -- in records nothing, where the old function wrote a row anyway.
  update leads set current_stage = p_to_stage where id = p_lead_id;

  perform set_config('synapse.stage_reason', '', true);
end;
$$;
