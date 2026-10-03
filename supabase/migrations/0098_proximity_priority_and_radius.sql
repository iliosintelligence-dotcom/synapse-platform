-- Two changes to proximity, both following from one decision: proximity is for
-- someone who is ACTUALLY NEAR a house, with the app open, right now.
--
-- 1. The paid tier buys PRIORITY, never EXCLUSIVITY.
-- 2. The radius matches what the feature claims.

-- ── 1 · priority, not a gate ──────────────────────────────────────────────
-- index.html sells "proximity marketing" in the Leader tier at N250,000, so
-- the tier has to buy something real. The tempting implementation is to make
-- only Leader listings eligible. That is the wrong switch, and it breaks the
-- wrong person's experience:
--
--   A buyer walks down a street with five listings on it and is told about
--   two. They cannot know why. They do not know agency tiers exist. The
--   product does not look selective, it looks broken -- and the house they
--   were standing in front of is the one we hid.
--
-- What IS genuinely scarce is the daily cap: three notifications, ever, per
-- person per day, and a permanent per-property dedupe behind it. Those three
-- slots are the real estate. So the tier competes for the SLOT rather than for
-- eligibility: every verified listing can still reach every buyer, and when
-- more listings qualify than there are slots, the paying agency goes first.
--
-- A NEAR ZONE THAT NOTHING OUTRANKS. Sorting by tier across all distances
-- would put a Leader listing 480m away above a free one 40m away -- the buyer
-- is standing in front of the second one, and we would be pointing them down
-- the road.
--
-- The first attempt at this was distance BANDS with tier breaking ties inside
-- each band, and it has a cliff exactly where it must not: two listings either
-- side of a boundary sort by tier, so a free listing 1m away loses to a Leader
-- at 199m. That is the same failure, reintroduced by the fix for it.
--
-- So: inside 150m -- close enough to look up and see the building -- the order
-- is distance and nothing else, and no subscription reorders it. Past 150m,
-- where "which is nearer" stops being something a person on foot can feel,
-- tier sorts first and distance breaks its ties. One sentence, no cliff, and
-- the house you are standing in front of is always the one we name first.

-- ── 2 · the radius ────────────────────────────────────────────────────────
-- 1200m was sized for "somewhere in your neighbourhood" -- a fifteen-minute
-- walk, which is not what a proximity alert claims. It says you are near this
-- house. Since this feature only fires while the app is open, the person
-- receiving it is an active house-hunter walking a street, not someone going
-- about their day, and 500m is about the distance at which walking over is
-- still an obvious thing to do.
--
-- The default only. Existing rows are left exactly as they are: a radius a
-- person chose is theirs, and quietly rewriting it would be editing someone's
-- settings on their behalf. (There are 0 watches today, so this migrates
-- nothing -- it sets what the first one will get.)
alter table public.geofence_watches alter column radius_m set default 500;

create or replace function public.proximity_candidates(p_watch_id uuid)
returns table(property_id uuid, title text, city text, price numeric,
              bedrooms integer, trust_score integer, distance_m double precision)
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
         st_distance(p.location, w.last_point)::double precision
  from public.properties p
  -- LEFT join, deliberately. An inner join would silently drop a listing whose
  -- agency row was missing, and the failure mode of this function is showing a
  -- buyer one house fewer -- which is invisible and unreportable. A listing
  -- with no readable agency sorts as 'free' and is still offered.
  left join public.agencies a on a.id = p.agency_id
  where p.status = 'live'
    and p.is_active
    and p.verification_status = 'verified'
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
    -- 1 - the near zone comes first as a block. false sorts before true, so
    --     everything within 150m outranks everything beyond it, always.
    (st_distance(p.location, w.last_point) >= 150),
    -- 2 - inside the near zone, pure distance. Constant (0) outside it, so
    --     this key does nothing to the far group.
    case when st_distance(p.location, w.last_point) < 150
         then st_distance(p.location, w.last_point) else 0 end,
    -- 3 - tier, which can therefore only ever reorder the far group.
    case a.subscription_tier
      when 'market_leader' then 0
      when 'accelerator'   then 1
      else 2
    end,
    -- 4 - true distance, so the order is total and stable.
    st_distance(p.location, w.last_point)
  limit greatest(0, w.daily_cap - sent_today);
end $function$;

comment on function public.proximity_candidates(uuid) is
  'Candidate listings for one geofence watch. Every verified listing is eligible regardless of the agency''s plan; within 150m the order is distance alone, so a paid listing can never outrank a house the buyer is standing in front of; past 150m subscription_tier sorts first.';
