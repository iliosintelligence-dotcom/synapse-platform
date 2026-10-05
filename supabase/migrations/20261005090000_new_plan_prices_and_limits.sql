-- New plan prices, and listing limits back to what they were.
--
-- DECISION (Eden, 2026-10-05):
--   Free         0
--   Accelerate   25,000 a month   (was 75,000)
--   Leader       75,000 a month   (was 250,000)
-- Listing limits return to the earlier ceilings: Free 20, Accelerate 100,
-- Leader and Enterprise unlimited. Seats are unchanged. The listing pack is
-- +25 again.
--
-- Kobo, as everywhere: the checkout charges what billing_prices() says.
create or replace function billing_prices()
returns jsonb language sql immutable as $$
  select '{
    "plans": {
      "accelerator":   { "name": "Accelerate", "monthly_kobo": 2500000 },
      "market_leader": { "name": "Leader",     "monthly_kobo": 7500000 }
    },
    "addons": {
      "listing_pack":         { "name": "Extra Listing Pack",   "kobo": 1500000, "unit": "month", "on_sale": true,  "applied": "automatic" },
      "social_boost":         { "name": "Social Reach Boost",   "kobo": 1000000, "unit": "each",  "on_sale": true,  "applied": "team" },
      "verification_credits": { "name": "Verification Credits", "kobo":  600000, "unit": "pack",  "on_sale": true,  "applied": "team" },
      "campaign_boost":       { "name": "Campaign Boost",       "kobo": 2000000, "unit": "each",  "on_sale": true,  "applied": "team" },
      "ai_credits":           { "name": "AI Marketing Credits", "kobo":  800000, "unit": "pack",  "on_sale": false, "applied": "automatic" }
    }
  }'::jsonb;
$$;

create or replace function plan_limits(p_tier subscription_tier)
returns table (max_listings integer, max_seats integer)
language sql immutable as $$
  select
    case p_tier when 'free' then 20 when 'accelerator' then 100 else null end,
    case p_tier when 'free' then 2 when 'accelerator' then 5 else null end;
$$;

create or replace function agency_listings_max(p_agency_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  /* NULL (unlimited) stays NULL: a pack on top of no ceiling is no ceiling. */
  select case when l.max_listings is null then null
    else l.max_listings + 25 * (
      select count(*)::integer from agency_addons x
       where x.agency_id = p_agency_id and x.addon_code = 'listing_pack'
         and x.applied_at is not null
         and (x.ends_at is null or x.ends_at > now()))
    end
  from plan_limits(agency_effective_tier(p_agency_id)) l;
$$;
revoke all on function agency_listings_max(uuid) from public, anon, authenticated;
grant execute on function agency_listings_max(uuid) to service_role;
