-- Auto billing: a plan renews itself.
--
-- HOW IT WORKS. The first plan payment goes through Paystack's page as it does
-- today. When it succeeds, Paystack hands back a reusable card authorization;
-- we keep that code (never the card number) against the agency. A job then
-- charges it again a day before the period ends, for the same plan and the
-- same period, at the price billing_quote() gives for that agency today.
--
--   * It is on by default for a card payment and says so on the Billing page
--     before and after paying. An owner or admin can turn it off, or remove
--     the card, at any time. Turning it off lets the plan end on its date.
--   * A failed charge is retried after 1, 2 and 3 days, then it stops. Nothing
--     is charged after that and the plan lapses to Free, which is how it
--     already works (no grace).
--   * Add-ons are never renewed automatically. Enterprise is never charged.
--
-- The authorization code is a charge capability, so the table has no policy
-- and no grant: the portal reads only the safe fields, through agency_billing.

create table if not exists billing_subscriptions (
  agency_id          uuid primary key references agencies (id) on delete cascade,
  authorization_code text not null,
  customer_email     text not null,
  card_brand         text,
  card_last4         text,
  card_exp           text,
  plan_tier          subscription_tier not null,
  period             text not null check (period in ('monthly', 'annual')),
  auto_renew         boolean not null default true,
  failed_attempts    integer not null default 0,
  last_attempt_at    timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table billing_subscriptions enable row level security;
revoke all on billing_subscriptions from public, anon, authenticated;

-- ── keep the card after a successful PLAN payment ─────────────────────────
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
    (agency_id, authorization_code, customer_email, card_brand, card_last4, card_exp, plan_tier, period)
  values (v.agency_id, p_authorization_code, p_email, p_brand, p_last4, p_exp, v.plan_tier,
          coalesce(v.period, 'monthly'))
  on conflict (agency_id) do update
     set authorization_code = excluded.authorization_code,
         customer_email = excluded.customer_email,
         card_brand = excluded.card_brand, card_last4 = excluded.card_last4, card_exp = excluded.card_exp,
         plan_tier = excluded.plan_tier, period = excluded.period,
         failed_attempts = 0, last_error = null, updated_at = now();
  return true;
end;
$$;
revoke all on function save_billing_authorization(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function save_billing_authorization(text, text, text, text, text, text) to service_role;

-- ── the owner's two controls ──────────────────────────────────────────────
create or replace function set_auto_renew(p_agency_id uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if coalesce(agency_role(p_agency_id)::text, '') not in ('agency_owner', 'agency_admin') then
    raise exception 'Only an agency owner or admin can manage billing' using errcode = '42501';
  end if;
  update billing_subscriptions
     set auto_renew = coalesce(p_on, false), updated_at = now(),
         failed_attempts = case when coalesce(p_on, false) then 0 else failed_attempts end,
         last_error = case when coalesce(p_on, false) then null else last_error end
   where agency_id = p_agency_id;
  return found;
end;
$$;
revoke all on function set_auto_renew(uuid, boolean) from public, anon;
grant execute on function set_auto_renew(uuid, boolean) to authenticated;

create or replace function remove_billing_card(p_agency_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if coalesce(agency_role(p_agency_id)::text, '') not in ('agency_owner', 'agency_admin') then
    raise exception 'Only an agency owner or admin can manage billing' using errcode = '42501';
  end if;
  delete from billing_subscriptions where agency_id = p_agency_id;
  return found;
end;
$$;
revoke all on function remove_billing_card(uuid) from public, anon;
grant execute on function remove_billing_card(uuid) to authenticated;

-- ── who is due ────────────────────────────────────────────────────────────
-- One definition, used by the cron check and by the claim. Due = auto-renew
-- on, still on the plan the card was saved for, period ends within a day (or
-- has ended), fewer than 4 failures, and the retry wait has passed.
create or replace function renewal_candidates()
returns setof billing_subscriptions language sql stable security definer set search_path = public as $$
  select s.*
    from billing_subscriptions s
    join agencies a on a.id = s.agency_id
   where s.auto_renew
     and a.deleted_at is null
     and a.subscription_tier = s.plan_tier
     and a.subscription_tier in ('accelerator', 'market_leader')
     and a.subscription_current_period_end is not null
     and a.subscription_current_period_end <= now() + interval '1 day'
     and s.failed_attempts < 4
     and (s.last_attempt_at is null
          or s.last_attempt_at <= now() - interval '1 day' * least(s.failed_attempts, 3));
$$;
revoke all on function renewal_candidates() from public, anon, authenticated;
grant execute on function renewal_candidates() to service_role;

-- Claim stamps last_attempt_at in the same statement that selects the row, and
-- re-checks the wait in the UPDATE itself, so two overlapping runs can never
-- both charge the same agency.
create or replace function claim_renewals(p_limit integer default 10)
returns setof billing_subscriptions language sql security definer set search_path = public as $$
  update billing_subscriptions s
     set last_attempt_at = now()
   where s.agency_id in (select c.agency_id from renewal_candidates() c
                          limit greatest(1, least(coalesce(p_limit, 10), 25)))
     and (s.last_attempt_at is null
          or s.last_attempt_at <= now() - interval '1 day' * least(s.failed_attempts, 3))
  returning s.*;
$$;
revoke all on function claim_renewals(integer) from public, anon, authenticated;
grant execute on function claim_renewals(integer) to service_role;

create or replace function record_renewal_result(p_agency_id uuid, p_ok boolean, p_error text)
returns void language sql security definer set search_path = public as $$
  update billing_subscriptions
     set failed_attempts = case when p_ok then 0 else failed_attempts + 1 end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'The card was declined'), 160) end,
         updated_at = now()
   where agency_id = p_agency_id;
$$;
revoke all on function record_renewal_result(uuid, boolean, text) from public, anon, authenticated;
grant execute on function record_renewal_result(uuid, boolean, text) to service_role;

-- ── the Billing page learns about it ──────────────────────────────────────
create or replace function agency_billing(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a agencies%rowtype;
  v_offer jsonb;
  s billing_subscriptions%rowtype;
begin
  if not is_agency_member(p_agency_id) then
    raise exception 'Not a member of this agency' using errcode = '42501';
  end if;
  select * into a from agencies where id = p_agency_id;
  if not found then return null; end if;
  select value into v_offer from platform_settings where key = 'annual_offer';
  select * into s from billing_subscriptions where agency_id = p_agency_id;
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
    'card', case when s.agency_id is null then null else jsonb_build_object(
        'brand', s.card_brand, 'last4', s.card_last4, 'exp', s.card_exp) end,
    'auto_renew', coalesce(s.auto_renew and s.plan_tier = a.subscription_tier, false),
    'renew_period', s.period,
    'renew_failed_attempts', coalesce(s.failed_attempts, 0),
    'renew_error', s.last_error
  );
end;
$$;

-- ── the hourly job ────────────────────────────────────────────────────────
-- Same shape as drain_social_queue: look for due work first and only wake the
-- function when there is some.
create or replace function renew_due_subscriptions()
returns integer language plpgsql security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp' as $$
declare v_key text; v_url text; v_due integer;
begin
  select count(*) into v_due from renewal_candidates();
  if v_due = 0 then return 0; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if v_key is null or v_url is null then
    raise warning 'renew_due_subscriptions: service_role_key or project_url missing from vault';
    return 0;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/billing-renew',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('limit', 10),
    timeout_milliseconds := 120000);
  return v_due;
end;
$$;
revoke all on function renew_due_subscriptions() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'renew-due-subscriptions') then
    perform cron.schedule('renew-due-subscriptions', '7 * * * *', 'select public.renew_due_subscriptions()');
  end if;
end $$;
