-- 0031 · Security hardening (from the post-push security advisor).
-- Three classes of finding, fixed per how each function is actually invoked.

-- ─────────── 1 · pin search_path on the trigger functions ───────────
-- These 5 were created without an explicit search_path (advisor:
-- function_search_path_mutable). They reference public tables and PostGIS
-- functions (installed in public), so pin to public.
alter function set_updated_at() set search_path = public;
alter function reject_mutation() set search_path = public;
alter function sync_property_location() set search_path = public;
alter function sync_geofence_centre() set search_path = public;
alter function compute_response_time() set search_path = public;

-- ─────────── 2 · revoke client EXECUTE on internal-only functions ───────────
-- These SECURITY DEFINER functions have no client (anon/authenticated) caller —
-- the cron aggregators run from pg_cron, recompute_node_score from the
-- verification pipeline (service role), handle_new_user only as a trigger.
-- EXECUTE is granted to PUBLIC by default (anon/authenticated inherit it), so
-- revoke from PUBLIC, then grant back to service_role for the Edge-Function /
-- pipeline callers. The owning role (pg_cron, triggers) executes regardless.
revoke execute on function recompute_node_score(uuid) from public, anon, authenticated;
revoke execute on function aggregate_daily_snapshots(date) from public, anon, authenticated;
revoke execute on function recalc_agency_trust(date) from public, anon, authenticated;
revoke execute on function aggregate_marketplace_health(date) from public, anon, authenticated;
revoke execute on function handle_new_user() from public, anon, authenticated;
grant execute on function recompute_node_score(uuid) to service_role;
grant execute on function aggregate_daily_snapshots(date) to service_role;
grant execute on function recalc_agency_trust(date) to service_role;
grant execute on function aggregate_marketplace_health(date) to service_role;

-- ─────────── 3 · add internal authz guards to the client-called definers ───────────
-- move_lead_stage and supersede_document ARE called client-side as the
-- authenticated user (api/crm, api/dealRooms, api/documents) and are
-- SECURITY DEFINER, so they bypass RLS. Without an internal check, any
-- signed-in user could move ANY lead's stage / supersede ANY document by id.
-- Guard each with the same access rule its table's RLS already enforces.

create or replace function move_lead_stage(
  p_lead_id uuid, p_to_stage lead_stage, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_from    lead_stage;
  v_since   timestamptz;
  v_seconds bigint;
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

create or replace function supersede_document(p_new_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_entity_type document_entity_type;
  v_entity_id   uuid;
  v_doc_type    document_type;
  v_next        integer;
begin
  select entity_type, entity_id, document_type
    into v_entity_type, v_entity_id, v_doc_type
    from documents where id = p_new_id;

  if v_entity_type is null then
    raise exception 'document % not found', p_new_id;
  end if;
  -- Same rule as the documents RLS: caller must be able to access the entity.
  if not can_access_document(v_entity_type, v_entity_id) then
    raise exception 'forbidden: not permitted to supersede documents for this entity'
      using errcode = 'insufficient_privilege';
  end if;

  select coalesce(max(version), 0) into v_next from document_versions
  where entity_type = v_entity_type and entity_id = v_entity_id and document_type = v_doc_type;

  insert into document_versions (document_id, entity_type, entity_id, document_type, version, storage_url, cloudinary_public_id, uploaded_by)
  select d.id, d.entity_type, d.entity_id, d.document_type,
         v_next + row_number() over (order by d.created_at),
         d.storage_url, d.cloudinary_public_id, d.uploaded_by
  from documents d
  where d.entity_type = v_entity_type and d.entity_id = v_entity_id
    and d.document_type = v_doc_type and d.id <> p_new_id and d.is_current;

  update documents set is_current = false
  where entity_type = v_entity_type and entity_id = v_entity_id
    and document_type = v_doc_type and id <> p_new_id;
end;
$$;
