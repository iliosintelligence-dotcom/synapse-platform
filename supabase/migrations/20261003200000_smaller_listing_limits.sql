-- Smaller listing limits, by plan.
--
-- DECISION (Eden, 2026-10-03): most agencies do not have many listings.
--   Free        3 active listings   (was 20)
--   Accelerate  10                  (was 100)
--   Leader      20                  (was unlimited)
--   Enterprise  unlimited
-- Team seats are unchanged: Free 2, Accelerate 5, Leader and Enterprise
-- unlimited. NULL still means unlimited, never zero.
--
-- The paywall is still OFF, so nothing is refused today. When it switches on,
-- an agency already over its new limit keeps every listing it has: the limit
-- only stops it ADDING more (see enforce_listing_limit).
--
-- The Extra Listing Pack is +5 listings for a month (it was +25). At +25 a
-- Free agency could buy a pack and hold more listings than Leader allows, which
-- would have undone the tiers.
create or replace function plan_limits(p_tier subscription_tier)
returns table (max_listings integer, max_seats integer)
language sql immutable as $$
  select
    case p_tier when 'free' then 3 when 'accelerator' then 10 when 'market_leader' then 20 else null end,
    case p_tier when 'free' then 2 when 'accelerator' then 5 else null end;
$$;

comment on function plan_limits(subscription_tier) is
  'The published plan ceilings, in one place. NULL means unlimited. These '
  'mirror the pricing page in agency.html and index.html: change them together.';

create or replace function agency_listings_max(p_agency_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  /* NULL (unlimited) stays NULL: a pack on top of no ceiling is no ceiling. */
  select case when l.max_listings is null then null
    else l.max_listings + 5 * (
      select count(*)::integer from agency_addons x
       where x.agency_id = p_agency_id and x.addon_code = 'listing_pack'
         and x.applied_at is not null
         and (x.ends_at is null or x.ends_at > now()))
    end
  from plan_limits(agency_effective_tier(p_agency_id)) l;
$$;
revoke all on function agency_listings_max(uuid) from public, anon, authenticated;
grant execute on function agency_listings_max(uuid) to service_role;
