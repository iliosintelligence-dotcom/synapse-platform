-- PROBLEM
-- properties_update_agency enforced "an agency may not change its own
-- verification" with a WITH CHECK subquery that re-selects the row:
--     verification_status = (select p.verification_status from properties p
--                            where p.id = properties.id)
-- That subquery runs under RLS, and properties_select_agency hides rows where
-- deleted_at is not null. So the moment an agency set deleted_at, the subquery
-- returned no row, the comparison evaluated to NULL, and the check failed.
-- Net effect: an agency could not delete its own listing by any route — there
-- is no DELETE policy either. Verified by probe before this migration.
--
-- FIX
-- Column immutability is a trigger's job, not RLS's. RLS decides which rows you
-- may touch; a trigger decides which columns may change. The trigger sees OLD
-- and NEW directly and needs no self-select, so soft delete works and the
-- verification fields stay just as locked.
--
-- Server-side callers (the verification desk, running with the service key and
-- therefore no JWT subject) must still be able to certify a listing, so the
-- guard applies only when there is an authenticated end user.

create or replace function public.properties_guard_verification()
returns trigger
language plpgsql
as $$
begin
  -- No end-user identity => platform/service context (edge functions, jobs).
  if auth.uid() is null then
    return new;
  end if;

  if new.verification_status is distinct from old.verification_status
     or new.verification_nodes is distinct from old.verification_nodes
     or new.trust_score        is distinct from old.trust_score
     or new.verified_at        is distinct from old.verified_at then
    raise exception
      'verification fields are platform-owned and cannot be changed by an agency'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists properties_guard_verification_trg on public.properties;
create trigger properties_guard_verification_trg
  before update on public.properties
  for each row execute function public.properties_guard_verification();

-- With the trigger enforcing immutability, the policy only has to answer the
-- row-visibility question.
drop policy if exists properties_update_agency on public.properties;
create policy properties_update_agency
  on public.properties
  for update
  using (deleted_at is null and is_agency_member(agency_id))
  with check (is_agency_member(agency_id));
