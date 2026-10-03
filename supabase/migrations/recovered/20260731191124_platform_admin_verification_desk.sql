-- The verification desk needs a human operator who can certify a listing from
-- the browser. Until now only a service context (auth.uid() is null) could,
-- which meant verification could only happen from a server job that does not
-- exist. This adds a platform_admin path — still never the agency itself.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'platform_admin'
  );
$$;

-- Agencies still cannot touch verification; platform admins and server-side
-- callers can.
create or replace function public.properties_guard_verification()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or public.is_platform_admin() then
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

-- A desk operator must be able to see and act on every agency's queue.
drop policy if exists properties_select_admin on public.properties;
create policy properties_select_admin
  on public.properties for select
  using (public.is_platform_admin());

drop policy if exists properties_update_admin on public.properties;
create policy properties_update_admin
  on public.properties for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
