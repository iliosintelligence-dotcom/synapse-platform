-- 0041 · activate_subscription() — the only path that ever writes
-- agencies.subscription_tier / subscription_current_period_end. Called from
-- paystack-checkout's activatePayment() after the payments-row compare-and-
-- swap has already succeeded, never directly from client code. security
-- definer so it can write agencies regardless of caller RLS; execute is
-- revoked from every client-facing role so only the service-role client
-- (used exclusively inside the edge functions) can call it.
--
-- greatest(coalesce(subscription_current_period_end, now()), now()) means an
-- early renewal extends from whichever is later -- now, or an already-paid-
-- through date -- instead of clipping remaining paid time.
create or replace function activate_subscription(p_agency_id uuid, p_plan_tier subscription_tier)
returns void language sql security definer set search_path = public as $$
  update agencies
  set subscription_tier = p_plan_tier,
      subscription_current_period_end =
        greatest(coalesce(subscription_current_period_end, now()), now()) + interval '30 days'
  where id = p_agency_id;
$$;
revoke execute on function activate_subscription(uuid, subscription_tier) from public, anon, authenticated;
