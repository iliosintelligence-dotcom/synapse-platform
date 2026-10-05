-- Greptile's review of the auto-billing and feedback changes (PR 21), all real.
--
-- 1. A renewal could be charged twice. With no failures the retry wait was
--    zero, so two overlapping runs could both claim an agency, and a charge
--    left pending still counted as no failure, so the next hourly run charged
--    again. Now there is always a two-hour gap between attempts, and an agency
--    with a renewal still pending from the last day is not due.
-- 2. A replayed webhook could bring a removed card back. Removing a card now
--    leaves a tombstone (removed_at) and drops the token; a payment confirmed
--    before the removal can no longer restore it. The same guard stops an
--    older payment's card replacing a newer one.
-- 3. A renewal claimed a moment before the owner turned auto-renew off, removed
--    the card or changed plan still charged the old details. The function now
--    asks renewal_recheck() at the moment of charging.
-- 4. Anonymous feedback inserted a row per call. Repeats for the same reply
--    and rating now count (votes) instead of adding rows, and new anonymous
--    rows are capped per hour.

alter table billing_subscriptions
  add column if not exists removed_at timestamptz,
  add column if not exists card_saved_from timestamptz;
alter table billing_subscriptions alter column authorization_code drop not null;

-- ── 2. keep the card only from a payment newer than any removal ───────────
create or replace function save_billing_authorization(
  p_reference text, p_authorization_code text, p_email text,
  p_brand text, p_last4 text, p_exp text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v subscription_payments%rowtype;
begin
  select * into v from subscription_payments
   where paystack_reference = p_reference and status = 'success' and kind = 'plan';
  if not found or p_authorization_code is null or coalesce(p_email, '') = '' then return false; end if;
  insert into billing_subscriptions
    (agency_id, authorization_code, customer_email, card_brand, card_last4, card_exp,
     plan_tier, period, card_saved_from)
  values (v.agency_id, p_authorization_code, p_email, p_brand, p_last4, p_exp, v.plan_tier,
          coalesce(v.period, 'monthly'), v.verified_at)
  on conflict (agency_id) do update
     set authorization_code = excluded.authorization_code,
         customer_email = excluded.customer_email,
         card_brand = excluded.card_brand, card_last4 = excluded.card_last4, card_exp = excluded.card_exp,
         plan_tier = excluded.plan_tier, period = excluded.period,
         auto_renew = case when billing_subscriptions.removed_at is not null then true
                           else billing_subscriptions.auto_renew end,
         removed_at = null,
         card_saved_from = excluded.card_saved_from,
         failed_attempts = 0, last_error = null, updated_at = now()
   where (billing_subscriptions.removed_at is null or v.verified_at > billing_subscriptions.removed_at)
     and (billing_subscriptions.card_saved_from is null
          or v.verified_at >= billing_subscriptions.card_saved_from);
  return true;
end;
$$;
revoke all on function save_billing_authorization(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function save_billing_authorization(text, text, text, text, text, text) to service_role;

create or replace function remove_billing_card(p_agency_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if coalesce(agency_role(p_agency_id)::text, '') not in ('agency_owner', 'agency_admin') then
    raise exception 'Only an agency owner or admin can manage billing' using errcode = '42501';
  end if;
  update billing_subscriptions
     set authorization_code = null, removed_at = now(), auto_renew = false, updated_at = now()
   where agency_id = p_agency_id and removed_at is null;
  return found;
end;
$$;
revoke all on function remove_billing_card(uuid) from public, anon;
grant execute on function remove_billing_card(uuid) to authenticated;

-- ── 1. who is due: a real wait, and nothing already in flight ─────────────
create or replace function renewal_candidates()
returns setof billing_subscriptions language sql stable security definer set search_path = public as $$
  select s.*
    from billing_subscriptions s
    join agencies a on a.id = s.agency_id
   where s.auto_renew
     and s.removed_at is null
     and s.authorization_code is not null
     and a.deleted_at is null
     and a.subscription_tier = s.plan_tier
     and a.subscription_tier in ('accelerator', 'market_leader')
     and a.subscription_current_period_end is not null
     and a.subscription_current_period_end <= now() + interval '1 day'
     and s.failed_attempts < 4
     and (s.last_attempt_at is null
          or s.last_attempt_at <= now() - greatest(interval '2 hours', interval '1 day' * least(s.failed_attempts, 3)))
     and not exists (select 1 from subscription_payments p
                      where p.agency_id = s.agency_id and p.kind = 'plan' and p.status = 'pending'
                        and p.paystack_reference like 'renew-%'
                        and p.created_at > now() - interval '1 day');
$$;
revoke all on function renewal_candidates() from public, anon, authenticated;
grant execute on function renewal_candidates() to service_role;

create or replace function claim_renewals(p_limit integer default 10)
returns setof billing_subscriptions language sql security definer set search_path = public as $$
  update billing_subscriptions s
     set last_attempt_at = now()
   where s.agency_id in (select c.agency_id from renewal_candidates() c
                          limit greatest(1, least(coalesce(p_limit, 10), 25)))
     and (s.last_attempt_at is null
          or s.last_attempt_at <= now() - greatest(interval '2 hours', interval '1 day' * least(s.failed_attempts, 3)))
  returning s.*;
$$;
revoke all on function claim_renewals(integer) from public, anon, authenticated;
grant execute on function claim_renewals(integer) to service_role;

-- ── 3. asked again at the moment of charging ──────────────────────────────
create or replace function renewal_recheck(p_agency_id uuid)
returns setof billing_subscriptions language sql stable security definer set search_path = public as $$
  select s.*
    from billing_subscriptions s
    join agencies a on a.id = s.agency_id
   where s.agency_id = p_agency_id
     and s.auto_renew and s.removed_at is null and s.authorization_code is not null
     and a.deleted_at is null
     and a.subscription_tier = s.plan_tier
     and a.subscription_tier in ('accelerator', 'market_leader')
     and s.failed_attempts < 4;
$$;
revoke all on function renewal_recheck(uuid) from public, anon, authenticated;
grant execute on function renewal_recheck(uuid) to service_role;

-- ── the Billing page: a removed card is no card ──────────────────────────
create or replace function agency_billing(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a agencies%rowtype;
  v_offer jsonb;
  s billing_subscriptions%rowtype;
  v_card boolean;
begin
  if not is_agency_member(p_agency_id) then
    raise exception 'Not a member of this agency' using errcode = '42501';
  end if;
  select * into a from agencies where id = p_agency_id;
  if not found then return null; end if;
  select value into v_offer from platform_settings where key = 'annual_offer';
  select * into s from billing_subscriptions where agency_id = p_agency_id;
  v_card := s.agency_id is not null and s.removed_at is null and s.authorization_code is not null;
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
    'free_until', agency_free_until(a.id),
    'card', case when not v_card then null else jsonb_build_object(
        'brand', s.card_brand, 'last4', s.card_last4, 'exp', s.card_exp) end,
    'auto_renew', coalesce(v_card and s.auto_renew and s.plan_tier = a.subscription_tier, false),
    'renew_period', case when v_card then s.period end,
    'renew_failed_attempts', case when v_card then s.failed_attempts else 0 end,
    'renew_error', case when v_card then s.last_error end
  );
end;
$$;

-- ── 4. feedback: repeats count, they do not add rows ─────────────────────
alter table toju_feedback add column if not exists votes integer not null default 1;
create unique index if not exists uq_toju_feedback_anon_reply
  on toju_feedback (reply_id, rating) where user_id is null;

create or replace function record_toju_feedback(p_reply_id text, p_rating text, p_excerpt text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_rating not in ('up', 'down') or coalesce(char_length(p_reply_id), 0) not between 1 and 80 then
    return false;
  end if;
  if auth.uid() is not null then
    insert into toju_feedback (reply_id, rating, excerpt, user_id)
    values (p_reply_id, p_rating, left(p_excerpt, 300), auth.uid())
    on conflict (user_id, reply_id) where user_id is not null
    do update set rating = excluded.rating, created_at = now();
    return true;
  end if;
  /* Anonymous: a repeat for the same reply and rating is one more vote. A
     reply never seen before is a new row, and only so many of those an hour. */
  if not exists (select 1 from toju_feedback
                  where user_id is null and reply_id = p_reply_id and rating = p_rating)
     and (select count(*) from toju_feedback
           where user_id is null and created_at > now() - interval '1 hour') >= 500 then
    return false;
  end if;
  insert into toju_feedback (reply_id, rating, excerpt)
  values (p_reply_id, p_rating, left(p_excerpt, 300))
  on conflict (reply_id, rating) where user_id is null
  do update set votes = toju_feedback.votes + 1;
  return true;
end;
$$;
revoke all on function record_toju_feedback(text, text, text) from public, anon, authenticated;
grant execute on function record_toju_feedback(text, text, text) to anon, authenticated;
