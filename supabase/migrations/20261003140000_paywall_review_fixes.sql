-- Greptile's review of the paywall (Synapse-Demo PR #7), all six fixed.

-- 1. The switch reads its own setting defensively: a value that is not an
--    object (an old boolean) is replaced, so the switch-on date is always
--    readable and existing agencies always get their sixty days.
create or replace function set_paywall(p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select value into v from platform_settings where key = 'paywall_enabled';
  if v is null or jsonb_typeof(v) <> 'object' then v := '{}'::jsonb; end if;
  v := v || jsonb_build_object('on', coalesce(p_on, false),
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
select set_paywall(false);

-- 2 + 3. Another agency's plan, usage and free period are not anyone
--    else's business. The helpers are internal (called by security-definer
--    functions, which run as their owner); the one the portal calls checks
--    membership.
revoke execute on function agency_effective_tier(uuid) from public, anon, authenticated;
revoke execute on function agency_free_until(uuid) from public, anon, authenticated;
revoke execute on function paywall_applies(uuid) from public, anon, authenticated;
revoke execute on function agency_listings_max(uuid) from public, anon, authenticated;
grant execute on function agency_effective_tier(uuid), agency_free_until(uuid), paywall_applies(uuid), agency_listings_max(uuid) to service_role;

create or replace function agency_plan_usage(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_agency_member(p_agency_id) then
    raise exception 'Not a member of this agency' using errcode = '42501';
  end if;
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
  ) into r
  from agencies a, lateral plan_limits(agency_effective_tier(a.id)) l
  where a.id = p_agency_id;
  return r;
end;
$$;

-- 4. Proximity ranks by the plan an agency is actually on: a lapsed Leader
--    no longer keeps Leader priority. The body is 0101's, with the tier
--    order reading agency_effective_tier().
create or replace function public.proximity_candidates(p_watch_id uuid)
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
    case agency_effective_tier(a.id)
      when 'enterprise'    then 0
      when 'market_leader' then 0
      when 'accelerator'   then 1
      else 2
    end,
    -- 5 - then true distance, so the order is total and stable.
    st_distance(p.location, w.last_point)
  limit greatest(0, w.daily_cap - sent_today);
end $function$;


-- 5. A late confirmation never undoes a newer purchase. If a newer plan
--    payment has already been confirmed, an older one arriving afterwards
--    adds its months to the current plan instead of replacing it.
create or replace function confirm_billing_payment(p_reference text, p_amount_kobo bigint, p_currency text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v       subscription_payments%rowtype;
  v_tier  subscription_tier;
  v_end   timestamptz;
  v_newer boolean;
begin
  update subscription_payments sp
     set status = 'success', verified_at = now()
   where sp.paystack_reference = p_reference
     and sp.status = 'pending'
     and sp.amount_kobo = p_amount_kobo
     and sp.currency = p_currency
  returning sp.* into v;

  if found then
    if v.kind = 'plan' then
      select ag.subscription_tier, ag.subscription_current_period_end
        into v_tier, v_end
        from agencies ag where ag.id = v.agency_id for update;
      if not found then raise exception 'No agency for this payment'; end if;

      select exists (
        select 1 from subscription_payments o
         where o.agency_id = v.agency_id and o.kind = 'plan' and o.status = 'success'
           and o.id <> v.id and o.created_at > v.created_at
      ) into v_newer;

      if v_newer or v_tier = v.plan_tier then
        update agencies ag
           set subscription_current_period_end =
                 greatest(coalesce(v_end, now()), now()) + make_interval(months => v.months)
         where ag.id = v.agency_id;
      else
        update agencies ag
           set subscription_tier = v.plan_tier,
               subscription_current_period_end = now() + make_interval(months => v.months)
         where ag.id = v.agency_id;
      end if;
    else
      insert into agency_addons (agency_id, addon_code, payment_id, ends_at, applied_at)
      values (v.agency_id, v.addon_code, v.id,
              case when v.addon_code = 'listing_pack' then now() + interval '1 month' end,
              case when v.addon_code = 'listing_pack' then now() end);
    end if;
    return jsonb_build_object('status', 'success', 'kind', v.kind, 'tier', v.plan_tier, 'addon', v.addon_code);
  end if;

  return (
    select jsonb_build_object('status', sp.status, 'kind', sp.kind, 'tier', sp.plan_tier, 'addon', sp.addon_code)
      from subscription_payments sp
     where sp.paystack_reference = p_reference
       and sp.amount_kobo = p_amount_kobo
       and sp.currency = p_currency
  );
end;
$$;
revoke all on function confirm_billing_payment(text, bigint, text) from public, anon, authenticated;
grant execute on function confirm_billing_payment(text, bigint, text) to service_role;
