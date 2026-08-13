-- 0047_listing_availability_reconfirmation.sql
--
-- Availability reconfirmation.
--
-- The product promises listings are kept fresh, and `toju-demo` hard-filters
-- on `expires_at > now()` (toju-demo/index.ts:750). Every live listing
-- currently expires on the same day (2026-08-23) and nothing renews them, so
-- on that date Toju returns zero matches for every query while Browse keeps
-- showing the same listings -- because the RLS read policy does not filter on
-- expiry. Two surfaces disagreeing about whether a home exists is worse than
-- either answer on its own.
--
-- Verification and availability are different claims and are now stored
-- separately: `verification_status`/`verified_at` says Synapse checked the
-- listing; `availability_confirmed_at` says somebody confirmed the home is
-- still on the market. A home can be verified in March and gone by August.

alter table public.properties
  add column if not exists availability_confirmed_at timestamptz;

comment on column public.properties.availability_confirmed_at is
  'When the agency last confirmed this home is still available. Distinct from verified_at, which is when Synapse last checked the listing itself.';

-- Backfill from listed_at so existing stock is not misreported as never
-- confirmed. This is a statement about when the listing was published, which
-- is the most recent moment we can honestly claim anyone asserted it was real.
update public.properties
   set availability_confirmed_at = coalesce(listed_at, created_at)
 where availability_confirmed_at is null;

create index if not exists properties_expiry_idx
  on public.properties (expires_at)
  where deleted_at is null and is_active;

-- The agency's own action. SECURITY DEFINER because it must move expires_at,
-- which agencies do not hold column privileges on, and because the membership
-- check belongs in one place rather than split between RLS and the client.
-- Any member of the owning agency may confirm -- this is a routine operational
-- act, not a destructive one, so it is not restricted to admins/owners.
create or replace function public.reconfirm_listing(p_property_id uuid, p_days integer default 14)
returns table (id uuid, availability_confirmed_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid;
  v_days   integer := least(greatest(coalesce(p_days, 14), 1), 90);
begin
  select agency_id into v_agency
  from properties
  where properties.id = p_property_id and deleted_at is null;

  if v_agency is null then
    raise exception 'Listing not found' using errcode = 'no_data_found';
  end if;

  if not is_agency_member(v_agency) then
    raise exception 'You cannot confirm a listing you do not manage'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  update properties p
     set availability_confirmed_at = now(),
         expires_at = now() + make_interval(days => v_days)
   where p.id = p_property_id
  returning p.id, p.availability_confirmed_at, p.expires_at;
end;
$$;

revoke all on function public.reconfirm_listing(uuid, integer) from public, anon;
grant execute on function public.reconfirm_listing(uuid, integer) to authenticated;

-- Verified behaviour (2026-08-13):
--   outsider (no membership)      -> blocked, "You cannot confirm a listing you do not manage"
--   plain agent of owning agency  -> allowed
--   unknown listing id            -> "Listing not found"
--   p_days = 9999                 -> clamped to 90 days
