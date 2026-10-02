-- The verification desk needs an actor who can certify a listing. Agencies must
-- never be able to (that guarantee stays intact); the platform can.
--
-- Three things were missing:
--   1. a way to recognise a platform administrator,
--   2. an UPDATE policy letting one touch a listing it does not own,
--   3. an exemption in the verification-immutability trigger.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'platform_admin'::user_role
      and deleted_at is null
  );
$$;

-- See every listing, including drafts and unverified ones: a queue you cannot
-- see is a queue you cannot work.
drop policy if exists properties_select_platform_admin on public.properties;
create policy properties_select_platform_admin
  on public.properties for select
  using (is_platform_admin());

drop policy if exists properties_update_platform_admin on public.properties;
create policy properties_update_platform_admin
  on public.properties for update
  using (is_platform_admin())
  with check (is_platform_admin());

-- The trigger previously allowed verification changes ONLY when there was no
-- authenticated user (service-role context). That made the desk impossible to
-- use from a browser. A platform admin is now also permitted; an agency member
-- still is not, even for its own listings.
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

-- property_media on unverified listings must stay readable to the desk too.
comment on function public.is_platform_admin() is
  'True when the caller''s profile carries the platform_admin role. Used to grant verification authority without granting it to agencies.';
