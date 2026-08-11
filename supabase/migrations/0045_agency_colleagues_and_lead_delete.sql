-- 0045_agency_colleagues_and_lead_delete.sql
-- Everything the CRM's bulk Assign / Delete actions needed. Three separate
-- problems, all found by testing the actions rather than assuming they worked.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ASSIGN: an agency could not see its own colleagues.
--
-- profiles_select_own lets an account read only its own profile row, so the
-- assign menu would have been a list of blanks. Members of the same agency
-- need to see each other. Consumers are not agency members, so no consumer
-- profile becomes visible through this.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.shares_agency_with(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from agency_members me
    join agency_members them on them.agency_id = me.agency_id
    where me.profile_id = auth.uid()
      and them.profile_id = p_profile_id
      and me.deleted_at is null
      and them.deleted_at is null
  );
$$;

drop policy if exists profiles_select_agency_colleagues on public.profiles;
create policy profiles_select_agency_colleagues
  on public.profiles for select to authenticated
  using (deleted_at is null and shares_agency_with(id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The UPDATE policy from 0043 made soft-delete impossible for everyone.
--
-- It put `deleted_at is null` in WITH CHECK as well as USING. WITH CHECK tests
-- the row AFTER the update, so setting deleted_at always violated it. In USING
-- the condition is right (you may only update a lead that is not already
-- deleted); in WITH CHECK it is self-defeating.
--
-- WITH CHECK now enforces only what it is there for: the row must still belong
-- to an agency the caller is a member of, so a lead cannot be moved to another
-- agency on its way out.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists leads_update_agency on public.leads;
create policy leads_update_agency
  on public.leads
  for update
  to authenticated
  using (deleted_at is null and is_agency_member(agency_id))
  with check (is_agency_member(agency_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DELETE: a client-side soft delete is impossible by construction.
--
-- PostgreSQL applies the table's SELECT policies to the row a statement
-- produces. leads_select requires `deleted_at is null`, so the moment an UPDATE
-- sets deleted_at the resulting row is one the caller may not see, and the
-- statement is rejected with "new row violates row-level security policy" --
-- no matter how permissive the UPDATE policy is. Confirmed by dropping
-- leads_select alone, at which point the same UPDATE succeeds.
--
-- Loosening leads_select would make deleted leads visible again to the agency
-- AND to the consumer, which is the opposite of deleting them. So the delete
-- goes through a SECURITY DEFINER function that checks permission explicitly
-- and then bypasses RLS. deleted_at is deliberately NOT granted to clients.
--
-- NOTE the coalesce. agency_role() returns NULL for someone who is not a
-- member at all, and `NULL not in (...)` is NULL rather than true -- so an
-- uncoalesced guard never fires and a signed-in consumer with no connection to
-- the agency could delete its leads. That hole was real and was proven before
-- this fix.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.delete_lead(p_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid;
  v_role   text;
begin
  select agency_id into v_agency
  from leads
  where id = p_lead_id and deleted_at is null;

  if v_agency is null then
    raise exception 'Lead not found' using errcode = 'no_data_found';
  end if;

  -- Deleting is destructive and shared, so it stays with admins and owners.
  v_role := coalesce(agency_role(v_agency)::text, '');
  if v_role not in ('agency_admin', 'agency_owner') then
    raise exception 'Only an agency admin or owner can delete leads'
      using errcode = 'insufficient_privilege';
  end if;

  update leads set deleted_at = now() where id = p_lead_id;
  return p_lead_id;
end;
$$;

revoke all on function public.delete_lead(uuid) from public, anon;
grant execute on function public.delete_lead(uuid) to authenticated;

-- Defence in depth: if deleted_at is ever granted to clients again, this keeps
-- the admin/owner rule in force. The service role bypasses RLS but still fires
-- triggers, so it is exempted explicitly -- create-lead and any future backfill
-- must stay unblocked.
create or replace function public.leads_guard_soft_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role text;
begin
  if new.deleted_at is not null and old.deleted_at is null
     and current_setting('role', true) is distinct from 'service_role'
     and auth.uid() is not null then
    v_role := coalesce(agency_role(new.agency_id)::text, '');
    if v_role not in ('agency_admin', 'agency_owner') then
      raise exception 'Only an agency admin or owner can delete leads'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_guard_soft_delete_trg on public.leads;
create trigger leads_guard_soft_delete_trg
  before update on public.leads
  for each row execute function public.leads_guard_soft_delete();
