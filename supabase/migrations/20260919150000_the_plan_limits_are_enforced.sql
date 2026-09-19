-- The plan limits are enforced.
--
-- agency.html publishes three plans with hard numbers on them -- 20 / 100 /
-- unlimited active listings, 2 / 5 / unlimited team seats -- and an add-on
-- selling "+25 active listings when your catalogue outgrows the plan" for
-- N15k a month. subscription_tier exists on agencies, subscription_payments
-- records the money, activate_subscription() sets the tier, and the Paystack
-- webhook calls it.
--
-- Nothing anywhere enforced any of it. The only line of code in the entire
-- system that reads subscription_tier is the proximity ordering in 0098,
-- which sorts paid listings first past 150m. Everything else -- how many
-- properties you may list, how many people you may add -- was published as a
-- limit and implemented as a suggestion.
--
-- So an agency on the free plan could list five hundred properties and add
-- fifty staff, and the only thing that would have happened is that we would
-- have carried the cost of it.
--
-- ── the numbers are the published ones ───────────────────────────────────
--
-- Not numbers I chose. These are already on the pricing page in front of
-- customers, and a paywall that enforces something other than what was sold
-- is a worse problem than no paywall at all.
--
--   free            20 listings    2 seats
--   accelerator    100 listings    5 seats
--   market_leader   unlimited      unlimited
--
-- ── how it refuses ───────────────────────────────────────────────────────
--
-- IN THE DATABASE, not the portal. A check in agency.html is a suggestion to
-- anybody holding an anon key and a fetch(); this is a BEFORE INSERT trigger,
-- so the limit holds whether the request comes from the portal, from curl, or
-- from a script somebody wrote.
--
-- NEVER RETROACTIVELY. It counts what exists and refuses the NEXT one. An
-- agency already over its cap keeps everything it has -- nothing is hidden,
-- deactivated or deleted. Turning a limit on and having listings vanish from
-- under a paying customer is how you lose them, and the cap can be reached
-- honestly by downgrading, which must not be punished retroactively either.
--
-- THE SERVICE ROLE PASSES. Seeding, support fixes and migrations are not
-- customers, and a limit that blocks our own admin tooling gets disabled in
-- an emergency and never re-enabled.
--
-- THE MESSAGE NAMES THE PLAN, THE LIMIT AND THE WAY OUT. "new row violates
-- policy" tells an agency nothing they can act on.
--
-- ── what this does NOT do ────────────────────────────────────────────────
--
-- The feature gates are not here. The pricing page also says social
-- syndication and AI captions are Accelerate-and-above and proximity is
-- Leader only -- and Greenlight, on the free plan, has published 43 posts.
-- Switching that off is a commercial decision about a live customer who is
-- actively using it, not a technical gap to close quietly, so it is written
-- up rather than shipped. Counts are different: nobody is mid-way through
-- using their 21st listing.

-- ── 1. one place the numbers live ─────────────────────────────────────────
create or replace function plan_limits(p_tier subscription_tier)
returns table (max_listings integer, max_seats integer)
language sql immutable as $$
  /* NULL means unlimited, not zero. A ceiling of nothing and no ceiling at
     all are opposite answers and the checks below read them as such. */
  select
    case p_tier when 'free' then 20 when 'accelerator' then 100 else null end,
    case p_tier when 'free' then 2  when 'accelerator' then 5   else null end;
$$;

comment on function plan_limits(subscription_tier) is
  'The published plan ceilings, in one place. NULL means unlimited. These '
  'mirror the pricing page in agency.html -- change both together or the '
  'product is selling something it does not deliver.';

-- ── 2. a reading the portal can show before anybody hits the wall ─────────
create or replace function agency_plan_usage(p_agency_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tier', a.subscription_tier,
    'listings_used', (select count(*) from properties p
                        where p.agency_id = a.id and p.deleted_at is null and p.is_active),
    'listings_max', l.max_listings,
    'seats_used', (select count(*) from agency_members m
                     where m.agency_id = a.id and m.deleted_at is null),
    'seats_max', l.max_seats
  )
  from agencies a, lateral plan_limits(a.subscription_tier) l
  where a.id = p_agency_id;
$$;

revoke all on function agency_plan_usage(uuid) from public, anon;
grant execute on function agency_plan_usage(uuid) to authenticated, service_role;

comment on function agency_plan_usage(uuid) is
  'What an agency has used against what its plan allows. Exists so the portal '
  'can say "18 of 20" rather than letting somebody discover the ceiling by '
  'hitting it.';

-- ── 3. the listing cap ────────────────────────────────────────────────────
create or replace function enforce_listing_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tier  subscription_tier;
  v_max   integer;
  v_used  integer;
begin
  /* Our own tooling is not a customer. A cap that blocks support work gets
     switched off during an incident and quietly never switched back. */
  if auth.role() = 'service_role' then return new; end if;

  /* A draft or an inactive row costs nobody anything and is not what the
     pricing page counts. "Active listings" is the published unit. */
  if new.is_active is not true then return new; end if;

  select subscription_tier into v_tier from agencies where id = new.agency_id;
  if v_tier is null then return new; end if;          -- no agency: not ours to judge

  select max_listings into v_max from plan_limits(v_tier);
  if v_max is null then return new; end if;           -- unlimited

  select count(*) into v_used
    from properties
   where agency_id = new.agency_id and deleted_at is null and is_active
     and id <> new.id;

  if v_used >= v_max then
    raise exception
      'Your % plan includes % active listings and you have %. Upgrade, or archive one to make room.',
      v_tier, v_max, v_used
      using errcode = 'check_violation',
            hint = 'Subscription in the portal shows your plan and what each one includes.';
  end if;

  return new;
end;
$$;

drop trigger if exists properties_plan_limit on properties;
create trigger properties_plan_limit
  before insert on properties
  for each row execute function enforce_listing_limit();

/* Also on the way BACK to active. Without this, the cap is one archive and
   one un-archive away from meaningless. */
drop trigger if exists properties_plan_limit_reactivate on properties;
create trigger properties_plan_limit_reactivate
  before update of is_active on properties
  for each row when (new.is_active is true and old.is_active is not true)
  execute function enforce_listing_limit();

-- ── 4. the seat cap ───────────────────────────────────────────────────────
create or replace function enforce_seat_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tier  subscription_tier;
  v_max   integer;
  v_used  integer;
begin
  if auth.role() = 'service_role' then return new; end if;

  select subscription_tier into v_tier from agencies where id = new.agency_id;
  if v_tier is null then return new; end if;

  select max_seats into v_max from plan_limits(v_tier);
  if v_max is null then return new; end if;

  select count(*) into v_used
    from agency_members
   where agency_id = new.agency_id and deleted_at is null
     and profile_id <> new.profile_id;

  if v_used >= v_max then
    raise exception
      'Your % plan includes % team seats and you have %. Upgrade to add more.',
      v_tier, v_max, v_used
      using errcode = 'check_violation',
            hint = 'Subscription in the portal shows what each plan includes.';
  end if;

  return new;
end;
$$;

drop trigger if exists agency_members_seat_limit on agency_members;
create trigger agency_members_seat_limit
  before insert on agency_members
  for each row execute function enforce_seat_limit();
