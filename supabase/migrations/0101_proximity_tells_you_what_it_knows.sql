-- Proximity stops excluding unverified listings and starts DISCLOSING.
--
-- The verified-only gate meant proximity could never fire: 500 of 507 live
-- listings have no photos, so under 0100 they cannot be verified, so under the
-- old matcher they could never be reached. A feature that is correct and never
-- runs has the same value to a buyer as one that does not exist.
--
-- The decision is disclosure instead of exclusion: tell the buyer a home is
-- near them AND tell them plainly whether anyone has checked it. That is the
-- same thing browse.html and property.html already do -- verifyChip() renders
-- "Not verified" on every unverified card, and property.html says "Not yet
-- verified" in as many words. Proximity was the one surface that refused to
-- show an unverified home at all, which is a stricter rule than the product
-- applies anywhere else.
--
-- THE COPY HAD TO CHANGE IN THE SAME BREATH AS THE GATE, and this is the part
-- that mattered. Both notification templates hardcoded the word:
--
--     notify.js         title: 'A verified home, right where you are'
--                       body:  ... + ' · verified ' + d.verifiedAgo
--     proximity-report  title: 'A verified home, right here'
--                       body:  `${title} · ${distance}m away · verified`
--
-- Opening the gate without touching those would not have been a missing
-- disclosure. It would have pushed a FALSE CLAIM to a stranger's phone and
-- walked them to an address on the strength of it. The claim, not the gate, was
-- the dangerous half.

-- ── the buyer keeps the choice ────────────────────────────────────────────
-- browse.html already has a "Verified only" toggle, because some buyers want
-- exactly that. A watch gets the same switch, so a person who does not want to
-- hear about unchecked homes never does.
--
-- Defaults to false, matching the decision above: disclosure is the default,
-- exclusion is available. The other criteria columns on this table (city,
-- deal_type, max_price, min_bedrooms) work the same way -- null or false means
-- "do not narrow".
alter table public.geofence_watches
  add column if not exists verified_only boolean not null default false;

-- Dropped rather than replaced: the return type gains a column, and
-- CREATE OR REPLACE cannot change a function's signature.
drop function if exists public.proximity_candidates(uuid);

create function public.proximity_candidates(p_watch_id uuid)
returns table(property_id uuid, title text, city text, price numeric,
              bedrooms integer, trust_score integer, distance_m double precision,
              is_verified boolean)
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  w public.geofence_watches%rowtype;
  sent_today int;
  now_local time := (now() at time zone 'Africa/Lagos')::time;
  in_quiet boolean;
begin
  select * into w from public.geofence_watches where id = p_watch_id;
  if not found or not w.enabled or w.last_point is null then
    return;
  end if;

  in_quiet := case
    when w.quiet_from < w.quiet_to then now_local >= w.quiet_from and now_local < w.quiet_to
    else now_local >= w.quiet_from or now_local < w.quiet_to
  end;
  if in_quiet then return; end if;

  select count(*) into sent_today
  from public.notifications n
  where n.kind = 'proximity_match'
    and coalesce(n.recipient_id::text, n.visitor_id) = coalesce(w.user_id::text, w.visitor_id)
    and n.created_at >= date_trunc('day', now());
  if sent_today >= w.daily_cap then return; end if;

  return query
  select p.id, p.title::text, p.city::text, p.price,
         p.bedrooms::int, p.trust_score::int,
         st_distance(p.location, w.last_point)::double precision,
         (p.verification_status = 'verified')          -- the caller MUST say this out loud
  from public.properties p
  left join public.agencies a on a.id = p.agency_id
  where p.status = 'live'
    and p.is_active
    -- The verified-only gate is gone. It survives only as the buyer's own
    -- choice, below, and as something every notification has to state.
    and (not w.verified_only or p.verification_status = 'verified')
    and p.listed_at >= now() - interval '14 days'
    and p.location is not null
    and st_dwithin(p.location, w.last_point, w.radius_m)
    and (w.city         is null or p.city = w.city)
    and (w.deal_type    is null or p.listing_type = w.deal_type)
    and (w.max_price    is null or p.price <= w.max_price)
    and (w.min_bedrooms is null or p.bedrooms >= w.min_bedrooms)
    and not exists (
      select 1 from public.notifications n
      where n.kind = 'proximity_match'
        and n.property_id = p.id
        and coalesce(n.recipient_id::text, n.visitor_id) = coalesce(w.user_id::text, w.visitor_id)
    )
  order by
    -- 1 - the near zone as a block: within 150m outranks everything beyond it.
    (st_distance(p.location, w.last_point) >= 150),
    -- 2 - inside the near zone, pure distance. Not verification, and not tier:
    --     the house you can see is still named first, and the notification
    --     tells you what is known about it.
    case when st_distance(p.location, w.last_point) < 150
         then st_distance(p.location, w.last_point) else 0 end,
    -- 3 - VERIFIED BEFORE UNVERIFIED, and ahead of tier. Where there is a
    --     choice between homes the buyer cannot yet see, a checked one is the
    --     better thing to spend a scarce daily slot on. Safety sorts above
    --     commerce; that ordering is deliberate and should stay that way.
    (p.verification_status <> 'verified'),
    -- 4 - then the paid tier.
    case a.subscription_tier
      when 'market_leader' then 0
      when 'accelerator'   then 1
      else 2
    end,
    -- 5 - then true distance, so the order is total and stable.
    st_distance(p.location, w.last_point)
  limit greatest(0, w.daily_cap - sent_today);
end $function$;

comment on function public.proximity_candidates(uuid) is
  'Candidate listings for one geofence watch. Unverified listings ARE returned -- is_verified says which, and every caller must state it in the notification. Within 150m the order is distance alone; beyond it, verified sorts before unverified, then subscription_tier, then distance. A watch with verified_only = true opts out of unverified entirely.';
