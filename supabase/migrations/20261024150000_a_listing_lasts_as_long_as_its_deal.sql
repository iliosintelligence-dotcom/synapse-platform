-- How long a listing stays up depends on the deal, not one number for all.
--
-- Eden, 2026-10-24: "The 21-day property expiry is only for rented
-- properties. Shortlets should be a week. And purchases -- investments, land,
-- buying houses -- should be 3 months."
--
--   rent      21 days   (lease folds into rent, see what_kind_of_deal)
--   shortlet   7 days   a short-let that was free last week may not be now
--   sale      90 days   houses, land, off-plan, investments: they move slowly
--
-- The window was decided in the browser (FRESH_DAYS = 21 in
-- agency-listings.js) and passed to reconfirm_listing as p_days. It is
-- decided here now, from the listing's own type, so no client can renew a
-- short-let for three months. p_days stays in the signature so callers that
-- still send it keep working; it is ignored.

create or replace function public.listing_fresh_days(p_type listing_type)
returns integer
language sql
immutable
as $$
  select case p_type::text when 'shortlet' then 7 when 'sale' then 90 else 21 end;
$$;

grant execute on function public.listing_fresh_days(listing_type) to anon, authenticated;

create or replace function public.reconfirm_listing(p_property_id uuid, p_days integer default null)
returns table (id uuid, availability_confirmed_at timestamptz, expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid;
  v_type   listing_type;
begin
  select agency_id, listing_type into v_agency, v_type
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
         expires_at = now() + make_interval(days => listing_fresh_days(v_type))
   where p.id = p_property_id
  returning p.id, p.availability_confirmed_at, p.expires_at;
end;
$$;

revoke all on function public.reconfirm_listing(uuid, integer) from public, anon;
grant execute on function public.reconfirm_listing(uuid, integer) to authenticated;

-- A new listing starts its clock here too, whatever the browser sent, and a
-- listing whose type is changed (rent -> sale) gets that type's window from
-- its last confirmation.
create or replace function public.properties_fresh_window()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    new.listed_at := coalesce(new.listed_at, now());
    new.expires_at := new.listed_at + make_interval(days => listing_fresh_days(new.listing_type));
  elsif new.listing_type is distinct from old.listing_type then
    new.expires_at := coalesce(new.availability_confirmed_at, new.listed_at, now())
                      + make_interval(days => listing_fresh_days(new.listing_type));
  end if;
  return new;
end;
$$;

drop trigger if exists properties_fresh_window on public.properties;
create trigger properties_fresh_window
  before insert or update of listing_type on public.properties
  for each row execute function public.properties_fresh_window();

-- Existing listings, measured from when they were last confirmed: sales get
-- their three months, short-lets come down a week after confirmation.
update public.properties
   set expires_at = coalesce(availability_confirmed_at, listed_at, created_at)
                    + make_interval(days => listing_fresh_days(listing_type))
 where deleted_at is null;
