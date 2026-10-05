-- Greptile review, 2026-10-05: two UPDATE policies let the agency edit columns
-- that are not theirs, because RLS is row-level and cannot say which columns.
--
--  1. agencies_update_admin lets an owner/admin update their agency row. The
--     existing guard (agencies_guard_tier) protects verification_tier, rating
--     and closed_deals, but NOT subscription_tier, subscription_current_period_end,
--     owner_id or the relationship manager. An agency admin could therefore
--     write subscription_tier = 'leader' on their own row and get a plan
--     they had not paid for, or hand the agency to another owner.
--  2. documents_update lets anybody who can see a document update it, and
--     the migration that added it says is_verified is out of reach. It was
--     not: an agency could mark its own papers verified.
--
-- Same shape as the existing guard. A change made from a client session
-- (role authenticated or anon) by anybody who is not a platform admin is
-- undone; changes from the service role, from security-definer billing and
-- verification functions (they run as their owner) and from admins go through.

create or replace function public.agencies_guard_plan_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_platform_admin() then
    return new;
  end if;
  if new.subscription_tier is distinct from old.subscription_tier
     or new.subscription_current_period_end is distinct from old.subscription_current_period_end then
    raise exception 'the plan and its paid period are set by billing, not by an agency'
      using errcode = '42501';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'ownership of an agency is changed by Synapse, not from the portal'
      using errcode = '42501';
  end if;
  if new.relationship_manager_id is distinct from old.relationship_manager_id
     or new.relationship_manager_hours is distinct from old.relationship_manager_hours then
    raise exception 'the relationship manager is assigned by Synapse'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists agencies_guard_plan_owner_trg on public.agencies;
create trigger agencies_guard_plan_owner_trg
  before update on public.agencies
  for each row execute function public.agencies_guard_plan_owner();

create or replace function public.documents_guard_verdict()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_platform_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.is_verified := false;
    new.verified_by := null;
    new.verified_at := null;
    new.verification_notes := null;
    new.ai_analysis_result := null;
    return new;
  end if;
  -- An edit (a new expiry, a re-label) keeps the verdict the platform gave.
  new.is_verified := old.is_verified;
  new.verified_by := old.verified_by;
  new.verified_at := old.verified_at;
  new.verification_notes := old.verification_notes;
  new.ai_analysis_result := old.ai_analysis_result;
  return new;
end;
$$;

drop trigger if exists documents_guard_verdict_trg on public.documents;
create trigger documents_guard_verdict_trg
  before insert or update on public.documents
  for each row execute function public.documents_guard_verdict();
