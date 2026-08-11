-- 0043_leads_update_policy.sql
-- Agency members can move their own leads through the pipeline.
--
-- `leads` had INSERT and SELECT policies but no UPDATE, so stage changes in
-- the CRM could never persist. This adds the missing policy.
--
-- RLS decides WHICH ROWS may be updated; it cannot restrict WHICH COLUMNS.
-- Left at the table-wide grant Supabase ships by default, this policy would
-- also let an agency rewrite delivery_status, source, consumer_phone and the
-- score columns -- that is, falsify the attribution and delivery record the
-- rest of the product treats as evidence. So the column list is narrowed
-- first and the policy is layered on top of it.
--
-- service_role keeps its own grants and is unaffected: the create-lead edge
-- function still writes delivery_status, whatsapp_message_sid and
-- delivered_at.

revoke update on public.leads from authenticated, anon;

grant update (
  current_stage,
  assigned_agent_id,
  interest_level,
  next_action_at,
  next_action_recommendation,
  timeline_to_purchase,
  budget_min,
  budget_max,
  budget_range,
  last_activity_at
) on public.leads to authenticated;

drop policy if exists leads_update_agency on public.leads;

create policy leads_update_agency
  on public.leads
  for update
  to authenticated
  -- USING gates which rows the update can see; WITH CHECK stops a row being
  -- moved to another agency. agency_id is not in the grant above, so the
  -- WITH CHECK is belt and braces rather than the only defence.
  using (deleted_at is null and is_agency_member(agency_id))
  with check (deleted_at is null and is_agency_member(agency_id));
