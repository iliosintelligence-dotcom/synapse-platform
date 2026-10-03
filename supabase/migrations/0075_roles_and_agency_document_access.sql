-- ═══════════════════════════════════════════════════════════════════════════
-- Who may see the company's papers, and who may never.
--
-- Three roles exist in agency_members: agency_owner, agency_admin, agent.
-- The policies below make them mean the same thing everywhere, because they
-- did not: agencies_update_admin let an admin rename the company and change
-- its brand, while can_access_document's 'agency' branch checked owner_id
-- alone -- so the same person could edit the business but not see the CAC
-- certificate proving it exists.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.can_access_document(
  p_entity_type document_entity_type, p_entity_id uuid)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
begin
  if p_entity_type = 'deal_room' then
    return exists (select 1 from deal_rooms d where d.id = p_entity_id
      and (d.consumer_id = auth.uid() or d.agent_id = auth.uid() or is_agency_member(d.agency_id)));
  elsif p_entity_type = 'property' then
    return exists (select 1 from properties p where p.id = p_entity_id and is_agency_member(p.agency_id))
        or exists (select 1 from deal_rooms d where d.property_id = p_entity_id and d.consumer_id = auth.uid());
  elsif p_entity_type = 'agency' then
    -- Owner OR admin. Never an agent: these are the director's ID and the
    -- bank statement, not company letterhead.
    return exists (select 1 from agencies a where a.id = p_entity_id
      and (a.owner_id = auth.uid()
           or agency_role(a.id) in ('agency_admin','agency_owner')));
  elsif p_entity_type = 'agent' then
    return p_entity_id = auth.uid()
        or exists (select 1 from agency_members m where m.profile_id = p_entity_id
             and agency_role(m.agency_id) in ('agency_admin','agency_owner'));
  end if;
  return false;
end;
$$;

-- documents had INSERT and SELECT and nothing else, so a certificate
-- uploaded blurry or since expired was permanent. is_verified stays out of
-- reach of everyone here deliberately: an agency must not be able to mark
-- its own papers verified. That is a platform_admin action.
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update using (can_access_document(entity_type, entity_id))
  with check (can_access_document(entity_type, entity_id));

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete using (can_access_document(entity_type, entity_id));

-- agency_verif_public was `auth.uid() is not null`: any consumer with an
-- account could read every agency's verification_notes, suspension_reason
-- and risk_indicator -- internal assessments about a business. The public
-- claim is agencies.verification_tier, which stays public.
drop policy if exists agency_verif_public on public.agency_verifications;
drop policy if exists agency_verifications_select_own on public.agency_verifications;
create policy agency_verifications_select_own on public.agency_verifications
  for select using (deleted_at is null and is_agency_member(agency_id));
