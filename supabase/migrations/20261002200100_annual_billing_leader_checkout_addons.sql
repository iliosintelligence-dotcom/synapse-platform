-- Annual billing, a checkout for Leader, add-ons, and what Enterprise includes.
--
-- DECISIONS (Eden, 2026-10-02):
--   · Annual billing is real. Agencies that join now get two months free on
--     annual (pay 10 months, get 12). The offer closes in December: an agency
--     that joined before the close keeps it; one that joins after pays 12.
--   · Leader can be bought online, like Accelerate.
--   · Enterprise is a plan (previous migration) with Leader's features and no
--     limits. It is never sold at a checkout.
--   · The add-ons are sold from the portal's new Billing page.
--
-- Nothing here takes money on its own. Paystack goes live when ILIOS Digital's
-- account is activated; until then the checkout runs on whatever key is set.
--
-- ── 1. what Enterprise includes ──────────────────────────────────────────
create or replace function plan_features(p_tier subscription_tier)
returns text[] language sql immutable as $$
  /* Mirrors the COMPARE_ROWS table in agency.html. If these disagree, the
     product is selling something it does not deliver -- change both. */
  select case p_tier
    when 'free'          then array[]::text[]
    when 'accelerator'   then array['syndication', 'ai_captions']
    when 'market_leader' then array['syndication', 'ai_captions', 'proximity', 'campaigns']
    when 'enterprise'    then array['syndication', 'ai_captions', 'proximity', 'campaigns']
    else array[]::text[]
  end;
$$;
-- plan_limits() already answers NULL (unlimited) for any tier it does not
-- name, so Enterprise is unlimited without touching it.

-- Proximity ranks Enterprise with Leader. The body is 0101's, unchanged but
-- for the tier order in step 4.
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
    case a.subscription_tier
      when 'enterprise'    then 0
      when 'market_leader' then 0
      when 'accelerator'   then 1
      else 2
    end,
    -- 5 - then true distance, so the order is total and stable.
    st_distance(p.location, w.last_point)
  limit greatest(0, w.daily_cap - sent_today);
end $function$;


-- ── 2. a payment can be a plan or an add-on, for a month or a year ───────
alter table subscription_payments alter column plan_tier drop not null;
alter table subscription_payments
  add column if not exists kind       text not null default 'plan',
  add column if not exists period     text,
  add column if not exists months     integer not null default 1,
  add column if not exists addon_code text;
/* Rows written before this file are all plan payments for a month. There are
   none today (no checkout has ever been started), but fill them before the
   check below so it can never fail on old rows. */
update subscription_payments set period = 'monthly' where kind = 'plan' and period is null;
alter table subscription_payments drop constraint if exists subscription_payments_kind_check;
alter table subscription_payments add constraint subscription_payments_kind_check check (
  (kind = 'plan'  and plan_tier is not null and period is not null and period in ('monthly', 'annual'))
  or (kind = 'addon' and addon_code is not null)
);
alter table subscription_payments drop constraint if exists subscription_payments_months_check;
alter table subscription_payments add constraint subscription_payments_months_check
  check (months between 1 and 12);

-- ── 3. what an agency has bought besides its plan ────────────────────────
create table if not exists agency_addons (
  id          uuid primary key default uuid_generate_v4(),
  agency_id   uuid not null references agencies (id) on delete cascade,
  addon_code  text not null,
  payment_id  uuid references subscription_payments (id) on delete set null,
  starts_at   timestamptz not null default now(),
  /* Listing packs last a month. The others are one-off services: no end. */
  ends_at     timestamptz,
  /* When it took effect. A listing pack applies itself at payment; boosts and
     verification fast-tracks are done by the Synapse team, who set this when
     they have. NULL is "paid, not yet done", and the portal says exactly that. */
  applied_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_agency_addons_agency on agency_addons (agency_id, addon_code);
alter table agency_addons enable row level security;
/* Members see what their agency bought. Nobody writes from the client: rows
   come only from confirm_billing_payment() or the team. */
drop policy if exists agency_addons_select_own on agency_addons;
create policy agency_addons_select_own on agency_addons
  for select using (is_agency_member(agency_id));

-- ── 4. the prices, in one place ──────────────────────────────────────────
create or replace function billing_prices()
returns jsonb language sql immutable as $$
  /* Kobo. These mirror PRICING in agency.html and the landing page's cards;
     the checkout charges what THIS says, whatever a page shows. */
  select '{
    "plans": {
      "accelerator":   { "name": "Accelerate", "monthly_kobo": 7500000 },
      "market_leader": { "name": "Leader",     "monthly_kobo": 25000000 }
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
/* ai_credits is listed but not on sale: AI captions are not metered yet, so a
   pack of them would buy nothing. It goes on sale when there is a meter. */

-- ── 5. the annual offer ──────────────────────────────────────────────────
insert into platform_settings (key, value, note) values (
  'annual_offer',
  '{"months_free": 2, "joined_before": "2026-12-01T00:00:00+01:00"}'::jsonb,
  'Eden, 2026-10-02: agencies that join before joined_before get months_free '
  'on annual billing (pay 12 - months_free). Agencies that joined before the '
  'close keep it. To move the close, change joined_before; to end the offer '
  'for everyone, set months_free to 0. The landing page shows the offer until '
  'the same date (OFFER_CLOSES in index.html) -- change both together.'
) on conflict (key) do nothing;

create or replace function billing_annual_months_free(p_agency_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  /* 0 when the setting is missing: an offer nobody can read is not on. */
  select coalesce((
    select case
      when a.created_at < coalesce((s.value->>'joined_before')::timestamptz, 'infinity'::timestamptz)
      then greatest(0, least(11, coalesce((s.value->>'months_free')::integer, 0)))
      else 0 end
    from agencies a
    join platform_settings s on s.key = 'annual_offer'
    where a.id = p_agency_id
  ), 0);
$$;
revoke all on function billing_annual_months_free(uuid) from public, anon, authenticated;
grant execute on function billing_annual_months_free(uuid) to service_role;

-- ── 6. what a purchase costs this agency (the checkout asks this) ────────
create or replace function billing_quote(p_agency_id uuid, p_kind text, p_code text, p_period text default 'monthly')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_prices jsonb := billing_prices();
  v_plan   jsonb;
  v_addon  jsonb;
  v_free   integer;
begin
  if p_kind = 'plan' then
    v_plan := v_prices->'plans'->p_code;
    if v_plan is null then return null; end if;
    if p_period = 'monthly' then
      return jsonb_build_object('amount_kobo', (v_plan->>'monthly_kobo')::bigint, 'months', 1,
                                'label', (v_plan->>'name') || ', monthly');
    elsif p_period = 'annual' then
      v_free := billing_annual_months_free(p_agency_id);
      return jsonb_build_object('amount_kobo', (v_plan->>'monthly_kobo')::bigint * (12 - v_free), 'months', 12,
                                'months_free', v_free, 'label', (v_plan->>'name') || ', annual');
    end if;
    return null;
  elsif p_kind = 'addon' then
    v_addon := v_prices->'addons'->p_code;
    if v_addon is null or coalesce((v_addon->>'on_sale')::boolean, false) is not true then return null; end if;
    return jsonb_build_object('amount_kobo', (v_addon->>'kobo')::bigint, 'months', 1, 'label', v_addon->>'name');
  end if;
  return null;
end;
$$;
revoke all on function billing_quote(uuid, text, text, text) from public, anon, authenticated;
grant execute on function billing_quote(uuid, text, text, text) to service_role;

-- ── 7. listing packs raise the listing ceiling ───────────────────────────
create or replace function agency_listings_max(p_agency_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  /* NULL (unlimited) stays NULL: a pack on top of no ceiling is no ceiling. */
  select case when l.max_listings is null then null
    else l.max_listings + 25 * (
      select count(*)::integer from agency_addons x
       where x.agency_id = a.id and x.addon_code = 'listing_pack'
         and x.applied_at is not null
         and (x.ends_at is null or x.ends_at > now()))
    end
  from agencies a, lateral plan_limits(a.subscription_tier) l
  where a.id = p_agency_id;
$$;
revoke all on function agency_listings_max(uuid) from public, anon;
grant execute on function agency_listings_max(uuid) to authenticated, service_role;

create or replace function agency_plan_usage(p_agency_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tier', a.subscription_tier,
    'listings_used', (select count(*) from properties p
                        where p.agency_id = a.id and p.deleted_at is null and p.is_active),
    'listings_max', agency_listings_max(a.id),
    'seats_used', (select count(*) from agency_members m
                     where m.agency_id = a.id and m.deleted_at is null),
    'seats_max', l.max_seats
  )
  from agencies a, lateral plan_limits(a.subscription_tier) l
  where a.id = p_agency_id;
$$;

create or replace function enforce_listing_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tier subscription_tier; v_max integer; v_used integer;
begin
  if not paywall_active() then return new; end if;
  if auth.role() = 'service_role' then return new; end if;
  if new.is_active is not true then return new; end if;

  select subscription_tier into v_tier from agencies where id = new.agency_id;
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

-- ── 8. what the Billing page reads ───────────────────────────────────────
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
    'period_end', a.subscription_current_period_end,
    'annual_months_free', billing_annual_months_free(a.id),
    'offer_joined_before', v_offer->>'joined_before',
    'joined_at', a.created_at,
    'prices', billing_prices(),
    'listings_max', agency_listings_max(a.id),
    'paywall_on', paywall_active()
  );
end;
$$;
revoke all on function agency_billing(uuid) from public, anon;
grant execute on function agency_billing(uuid) to authenticated, service_role;

-- ── 9. a confirmed payment takes effect, once ────────────────────────────
/* Both the redirect-back verify and Paystack's webhook call this, after
   Paystack's own verify API says the charge succeeded. The pending -> success
   swap and its effect happen in one transaction: if the effect fails, the row
   stays pending and either path can try again, and a payment can never take
   effect twice. A plan bought again on the same tier extends from the later
   of now and the paid-through date; a different tier starts now. */
create or replace function confirm_billing_payment(p_reference text, p_amount_kobo bigint, p_currency text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v       subscription_payments%rowtype;
  v_tier  subscription_tier;
  v_end   timestamptz;
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

      update agencies ag
         set subscription_tier = v.plan_tier,
             subscription_current_period_end =
               (case when v_tier = v.plan_tier then greatest(coalesce(v_end, now()), now()) else now() end)
               + make_interval(months => v.months)
       where ag.id = v.agency_id;
    else
      insert into agency_addons (agency_id, addon_code, payment_id, ends_at, applied_at)
      values (v.agency_id, v.addon_code, v.id,
              case when v.addon_code = 'listing_pack' then now() + interval '1 month' end,
              case when v.addon_code = 'listing_pack' then now() end);
    end if;
    return jsonb_build_object('status', 'success', 'kind', v.kind, 'tier', v.plan_tier, 'addon', v.addon_code);
  end if;

  /* Already confirmed by the other path, or never ours: report what is there. */
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
