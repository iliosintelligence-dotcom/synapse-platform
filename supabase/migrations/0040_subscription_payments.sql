-- 0040 · subscription billing (subscription_payments)
--
-- Agencies could see three pricing tiers in the dashboard (Free/Accelerate/
-- Leader), but nothing tracked which one an agency was actually on, and the
-- "Upgrade" buttons only fired a client-side toast — no payment, no record,
-- no activation. This adds the billing state (agencies.subscription_tier +
-- subscription_current_period_end) and an audit trail of Paystack charges
-- (subscription_payments) that the paystack-checkout / paystack-webhook edge
-- functions write to. Client code never writes here directly — see the RLS
-- policy below: agencies may only ever SELECT their own rows. Every write
-- happens through the service-role client inside those two functions, the
-- same pattern `leads` already uses for anything money- or trust-adjacent.
--
-- Deliberate non-actions: no recurring/auto-renewal billing (Paystack
-- Subscriptions API) — this is "pay once, active for 30 days", the simplest
-- correct thing that matches what was asked. No cron job enforces expiry
-- when subscription_current_period_end passes; subscription_tier just stops
-- being extended. Downgrade-on-expiry is a natural follow-up, not built here.

create type subscription_tier as enum ('free', 'accelerator', 'market_leader');

alter table agencies
  add column subscription_tier subscription_tier not null default 'free',
  add column subscription_current_period_end timestamptz;

create table subscription_payments (
  id                 uuid primary key default uuid_generate_v4(),
  agency_id          uuid not null references agencies (id) on delete cascade,
  plan_tier          subscription_tier not null,
  amount_kobo        bigint not null,
  currency           text not null default 'NGN',
  paystack_reference text not null unique,
  status             text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  initialized_by     uuid references profiles (id),
  created_at         timestamptz not null default now(),
  verified_at        timestamptz
);
create index idx_subscription_payments_agency on subscription_payments (agency_id);

alter table subscription_payments enable row level security;

-- Agencies can see their own billing history. No insert/update/delete policy
-- for authenticated or anon at all — only the service-role client (used
-- exclusively inside paystack-checkout / paystack-webhook) can write, so a
-- payment record can never be forged or edited from the client.
create policy subscription_payments_select_own on subscription_payments
  for select using (is_agency_member(agency_id));
