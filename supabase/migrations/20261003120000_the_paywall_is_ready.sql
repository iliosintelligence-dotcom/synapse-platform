-- The paywall is ready: a plan that lapses ends, and agencies already here
-- get sixty days free from the day it switches on.
--
-- DECISIONS (Eden, 2026-10-03):
--   · Build it now; switch it on when Paystack is live (ILIOS Digital's
--     account). It stays OFF after this file.
--   · Agencies that joined before the switch-on get 60 days free from that
--     day, and are told so in the portal.
--   · No grace: a paid plan whose period has ended counts as Free at once.
--
-- To switch on (one statement, run by us, never by a client):
--     select set_paywall(true);
-- It stamps the switch-on time once; switching off and on again keeps the
-- first date, so the sixty days cannot be restarted by accident.
--
-- Everything that enforces a plan now asks two questions instead of one:
--   paywall_applies(agency)    is the paywall on AND is this agency past
--                              its free period?
--   agency_effective_tier(a)   the tier it is actually on today: a paid tier
--                              whose period has ended is Free.

-- ── the switch, with its date ─────────────────────────────────────────────
create or replace function paywall_since()
returns timestamptz language sql stable security definer set search_path = public as $$
  select (value->>'since')::timestamptz from platform_settings where key = 'paywall_enabled';
$$;

create or replace function set_paywall(p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select value into v from platform_settings where key = 'paywall_enabled';
  v := coalesce(v, '{}'::jsonb)
       || jsonb_build_object('on', coalesce(p_on, false),
                             'existing_free_days', coalesce((v->>'existing_free_days')::int, 60));
  if p_on and (v->>'since') is null then
    v := v || jsonb_build_object('since', now());
  end if;
  insert into platform_settings (key, value, note) values ('paywall_enabled', v,
    'Eden 2026-10-03: on when Paystack is live. since = first switch-on; agencies that joined before it are free for existing_free_days after it.')
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end;
$$;
revoke all on function set_paywall(boolean) from public, anon, authenticated;
grant execute on function set_paywall(boolean) to service_role;

-- ── who is still in their free period ───────────────────────────────────
create or replace function agency_free_until(p_agency_id uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  /* Only for agencies that joined BEFORE the switch-on. NULL for everyone
     else, and NULL while the paywall has never been on. */
  select case when s.since is not null and a.created_at < s.since
              then s.since + make_interval(days => s.days) end
  from agencies a,
       lateral (select paywall_since() as since,
                       coalesce((select (value->>'existing_free_days')::int from platform_settings where key = 'paywall_enabled'), 60) as days) s
  where a.id = p_agency_id;
$$;

create or replace function paywall_applies(p_agency_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select paywall_active()
     and coalesce(agency_free_until(p_agency_id) <= now(), true);
$$;

-- ── the tier an agency is actually on today ─────────────────────────────
create or replace function agency_effective_tier(p_agency_id uuid)
returns subscription_tier language sql stable security definer set search_path = public as $$
  /* No grace (Eden): a paid tier whose period has ended is Free from that
     moment. Enterprise and any tier with no end date are left as they are. */
  select case
    when a.subscription_tier in ('accelerator', 'market_leader')
         and a.subscription_current_period_end is not null
         and a.subscription_current_period_end <= now()
    then 'free'::subscription_tier
    else a.subscription_tier end
  from agencies a where a.id = p_agency_id;
$$;

grant execute on function paywall_since(), agency_free_until(uuid), paywall_applies(uuid), agency_effective_tier(uuid)
  to authenticated, service_role;

-- ── every gate, re-pointed ──────────────────────────────────────────────
create or replace function agency_listings_max(p_agency_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when l.max_listings is null then null
    else l.max_listings + 25 * (
      select count(*)::integer from agency_addons x
       where x.agency_id = p_agency_id and x.addon_code = 'listing_pack'
         and x.applied_at is not null
         and (x.ends_at is null or x.ends_at > now()))
    end
  from plan_limits(agency_effective_tier(p_agency_id)) l;
$$;

create or replace function enforce_listing_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tier subscription_tier; v_max integer; v_used integer;
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.is_active is not true then return new; end if;
  if not paywall_applies(new.agency_id) then return new; end if;

  v_tier := agency_effective_tier(new.agency_id);
  if v_tier is null then return new; end if;
  v_max := agency_listings_max(new.agency_id);
  if v_max is null then return new; end if;

  select count(*) into v_used from properties
   where agency_id = new.agency_id and deleted_at is null and is_active and id <> new.id;

  if v_used >= v_max then
    raise exception
      'Your % plan includes % active listings and you have %. Upgrade, add a listing pack, or archive one to make room.',
      v_tier, v_max, v_used
      using errcode = 'check_violation',
            hint = 'Billing in the portal sells listing packs; Subscription shows what each plan includes.';
  end if;
  return new;
end;
$$;

create or replace function enforce_seat_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tier subscription_tier; v_max integer; v_used integer;
begin
  if auth.role() = 'service_role' then return new; end if;
  if not paywall_applies(new.agency_id) then return new; end if;

  v_tier := agency_effective_tier(new.agency_id);
  if v_tier is null then return new; end if;
  select max_seats into v_max from plan_limits(v_tier);
  if v_max is null then return new; end if;

  select count(*) into v_used from agency_members
   where agency_id = new.agency_id and deleted_at is null and profile_id <> new.profile_id;

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

create or replace function enforce_syndication_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.leg is distinct from 'agency' then return new; end if;
  if auth.role() = 'service_role' then return new; end if;
  if new.agency_id is null then return new; end if;
  if not paywall_applies(new.agency_id) then return new; end if;

  if not agency_can(new.agency_id, 'syndication') then
    raise exception
      'Publishing to your own social accounts is on the Accelerate plan and above.'
      using errcode = 'check_violation',
            hint = 'Your listings still go out on Synapse''s own channels at no cost. '
                || 'Subscription in the portal shows what each plan includes.';
  end if;
  return new;
end;
$$;

create or replace function agency_can(p_agency_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    not paywall_applies(p_agency_id)
    or coalesce(p_feature = any(plan_features(agency_effective_tier(p_agency_id))), false)
    or exists (
      select 1 from agency_feature_grants g
       where g.agency_id = p_agency_id and g.feature = p_feature
         and g.revoked_at is null
         and (g.expires_at is null or g.expires_at > now())
    );
$$;

create or replace function agency_plan_usage(p_agency_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tier', agency_effective_tier(a.id),
    'listings_used', (select count(*) from properties p
                        where p.agency_id = a.id and p.deleted_at is null and p.is_active),
    'listings_max', agency_listings_max(a.id),
    'seats_used', (select count(*) from agency_members m
                     where m.agency_id = a.id and m.deleted_at is null),
    'seats_max', l.max_seats,
    'paywall_on', paywall_active(),
    'enforced', paywall_applies(a.id),
    'free_until', agency_free_until(a.id)
  )
  from agencies a, lateral plan_limits(agency_effective_tier(a.id)) l
  where a.id = p_agency_id;
$$;

create or replace function agency_billing(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a agencies%rowtype;
  v_offer jsonb;
begin
  if not is_agency_member(p_agency_id) then
    raise exception 'Not a member of this agency' using errcode = '42501';
  end if;
  select * into a from agencies where id = p_agency_id;
  if not found then return null; end if;
  select value into v_offer from platform_settings where key = 'annual_offer';
  return jsonb_build_object(
    'tier', a.subscription_tier,
    'effective_tier', agency_effective_tier(a.id),
    'period_end', a.subscription_current_period_end,
    'annual_months_free', billing_annual_months_free(a.id),
    'offer_joined_before', v_offer->>'joined_before',
    'joined_at', a.created_at,
    'prices', billing_prices(),
    'listings_max', agency_listings_max(a.id),
    'paywall_on', paywall_active(),
    'enforced', paywall_applies(a.id),
    'free_until', agency_free_until(a.id)
  );
end;
$$;

-- Still off. This file builds it; set_paywall(true) turns it on.
select set_paywall(false);
