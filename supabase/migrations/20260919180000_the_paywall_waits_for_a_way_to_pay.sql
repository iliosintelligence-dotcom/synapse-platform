-- The paywall waits for a way to pay.
--
-- DECISION (Eden, 2026-09-19): "What do they click to pay? Which bank do they
-- pay to? What's the payment system? If we don't have these yet, then just
-- allow everybody to do whatever they want. Remove the paywall."
--
-- The right question, and the answer is uncomfortable. The plumbing exists:
--
--   click        "Upgrade to Accelerate" on the Subscription page
--   then         paystack-checkout {action:'init'} -> Paystack hosted page
--   card         entered on Paystack's domain, never ours
--   confirm      paystack-webhook -> activate_subscription() -> tier set
--   price        N75,000 (7,500,000 kobo)
--
-- Both functions are deployed and the webhook is validating HMAC signatures,
-- so a secret key is configured. But:
--
--   · subscription_payments has ZERO rows. Not one checkout has ever been
--     initiated, so the path has never moved a naira and is untested end to
--     end.
--   · Whether PAYSTACK_SECRET_KEY is a live key or a test key, and whether a
--     settlement bank account is attached to the Paystack business, are facts
--     in the Paystack dashboard that no query here can see.
--   · Leader has no self-serve path at all -- its button says "Talk to
--     sales", so there is nothing to click even in principle.
--
-- A paywall in front of a payment path that has never taken money does not
-- protect revenue. It turns away the people most willing to pay, and the
-- first person to hit it is the first person who wanted to give us N75,000.
-- Off is correct until a real transaction has settled.
--
-- ── a switch, not a demolition ───────────────────────────────────────────
--
-- Dropping the triggers would mean writing them again, and the second
-- writing is where the reactivation trigger or the service-role bypass gets
-- forgotten. Everything stays exactly where it is and consults one setting.
-- Turning it back on is one UPDATE, not a migration:
--
--   update platform_settings set value = '{"on": true}'::jsonb
--    where key = 'paywall_enabled';
--
-- The grants stay too. Greenlight's grandfathering is a promise that outlives
-- this, and it should already be true the moment the switch flips rather than
-- being something to remember on the day.

create table if not exists platform_settings (
  key         text primary key,
  value       jsonb not null,
  note        text,
  updated_at  timestamptz not null default now()
);

alter table platform_settings enable row level security;
/* Read by security-definer functions only; no policy, so PostgREST exposes
   nothing. A switch the client can read is a switch somebody will try to
   write. */
revoke all on platform_settings from anon, authenticated;

comment on table platform_settings is
  'Platform-wide switches read by security-definer functions. Not reachable '
  'through the API by design.';

insert into platform_settings (key, value, note) values (
  'paywall_enabled',
  '{"on": false}'::jsonb,
  'OFF 2026-09-19. Plan limits and feature gates are built and correct, but '
  'subscription_payments has never had a row -- no checkout has ever been '
  'initiated, so the Paystack path is untested, and Leader has no self-serve '
  'purchase at all. Blocking usage in front of a payment route that has never '
  'taken money turns away the people most willing to pay. Turn on once a real '
  'transaction has settled to a real bank account.'
) on conflict (key) do update set value = excluded.value, note = excluded.note, updated_at = now();

create or replace function paywall_active()
returns boolean language sql stable security definer set search_path = public as $$
  /* Defaults to FALSE when the row is missing. A limit that switches itself
     on because a setting failed to read is the wrong way round: the failure
     mode of a paywall should be letting somebody work, not stopping them. */
  select coalesce((select (value->>'on')::boolean from platform_settings
                    where key = 'paywall_enabled'), false);
$$;

comment on function paywall_active() is
  'Master switch for plan enforcement. False by default and on a missing row: '
  'a paywall that fails closed locks out paying customers over a read error.';

-- ── every gate asks it first ─────────────────────────────────────────────
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
  select max_listings into v_max from plan_limits(v_tier);
  if v_max is null then return new; end if;

  select count(*) into v_used from properties
   where agency_id = new.agency_id and deleted_at is null and is_active and id <> new.id;

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

create or replace function enforce_seat_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tier subscription_tier; v_max integer; v_used integer;
begin
  if not paywall_active() then return new; end if;
  if auth.role() = 'service_role' then return new; end if;

  select subscription_tier into v_tier from agencies where id = new.agency_id;
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
  if not paywall_active() then return new; end if;
  if new.leg is distinct from 'agency' then return new; end if;
  if auth.role() = 'service_role' then return new; end if;
  if new.agency_id is null then return new; end if;

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

/* agency_can() answers TRUE for everything while the paywall is off, so the
   AI-captions gate in social-generate opens with the rest. The function is
   the one place every caller asks, which is why the switch belongs in it as
   well as in the triggers -- an edge function cannot consult a trigger. */
create or replace function agency_can(p_agency_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    not paywall_active()
    or coalesce((
      select p_feature = any(plan_features(a.subscription_tier))
      from agencies a where a.id = p_agency_id
    ), false)
    or exists (
      select 1 from agency_feature_grants g
       where g.agency_id = p_agency_id and g.feature = p_feature
         and g.revoked_at is null
         and (g.expires_at is null or g.expires_at > now())
    );
$$;
