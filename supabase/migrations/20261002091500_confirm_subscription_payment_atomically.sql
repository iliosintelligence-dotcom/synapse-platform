-- Confirm a Paystack payment and activate its plan atomically.
--
-- Both the checkout verifier and the webhook call this function after Paystack's
-- verification API confirms the charge. The payment row remains pending if the
-- agency update fails, allowing either confirmation path to retry without losing
-- a successful charge or extending a plan twice.

create or replace function public.confirm_subscription_payment(
  p_paystack_reference text,
  p_amount_kobo bigint,
  p_currency text
)
returns table (payment_status text, plan_tier public.subscription_tier)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_plan_tier public.subscription_tier;
begin
  update public.subscription_payments as payment
  set status = 'success',
      verified_at = now()
  where paystack_reference = p_paystack_reference
    and status = 'pending'
    and amount_kobo = p_amount_kobo
    and currency = p_currency
  returning payment.agency_id, payment.plan_tier
  into v_agency_id, v_plan_tier;

  if found then
    update public.agencies
    set subscription_tier = v_plan_tier,
        subscription_current_period_end =
          greatest(coalesce(subscription_current_period_end, now()), now()) + interval '30 days'
    where id = v_agency_id;

    if not found then
      raise exception 'No agency exists for the confirmed subscription payment';
    end if;

    return query select 'success'::text, v_plan_tier;
    return;
  end if;

  -- A concurrent confirmation may already have committed. Return its status
  -- without extending the subscription a second time.
  return query
  select p.status, p.plan_tier
  from public.subscription_payments p
  where p.paystack_reference = p_paystack_reference
    and p.amount_kobo = p_amount_kobo
    and p.currency = p_currency;
end;
$$;

revoke all on function public.confirm_subscription_payment(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.confirm_subscription_payment(text, bigint, text)
  to service_role;
