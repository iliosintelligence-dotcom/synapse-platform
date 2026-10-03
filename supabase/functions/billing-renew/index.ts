/**
 * billing-renew — charges the saved card for plans that are about to end.
 *
 * Called hourly by the renew-due-subscriptions cron job (via
 * renew_due_subscriptions()) with the service role key. Nobody else may call
 * it: a request is refused unless its bearer IS the service role key.
 *
 * For each agency claim_renewals() hands back (the claim stamps the attempt
 * first, so overlapping runs cannot charge twice) it:
 *   1. prices the plan today with billing_quote(), never from stored amounts;
 *   2. records a pending subscription_payments row under a fresh reference;
 *   3. charges the saved authorization with Paystack;
 *   4. on success, confirms through confirm_billing_payment, the same single
 *      path a first payment takes (so the webhook arriving too is harmless);
 *   5. on failure, marks the row failed and records why for the Billing page.
 *
 * A failed charge is retried by the schedule after 1, 2 and 3 days (see
 * renewal_candidates()), then it stops.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected), PAYSTACK_SECRET_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

interface Sub {
  agency_id: string; authorization_code: string; customer_email: string;
  plan_tier: string; period: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!serviceKey || bearer !== serviceKey) return json({ error: 'Not allowed' }, 401);
    if (!paystackKey) return json({ error: 'Payments are not switched on yet' }, 503);

    const body = (await req.json().catch(() => ({}))) as { limit?: number };
    const admin = createClient(url, serviceKey);

    const { data: claimed, error: claimErr } = await admin.rpc('claim_renewals', { p_limit: body.limit ?? 10 });
    if (claimErr) return json({ error: claimErr.message }, 500);

    const results: { ok: boolean }[] = [];
    for (const sub of (claimed ?? []) as Sub[]) {
      results.push(await renewOne(admin, sub, paystackKey));
    }
    return json({ attempted: results.length, renewed: results.filter((r) => r.ok).length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`billing-renew fatal: ${message}`);
    return json({ error: message }, 500);
  }
});

async function renewOne(
  admin: ReturnType<typeof createClient>, sub: Sub, paystackKey: string,
): Promise<{ ok: boolean }> {
  const fail = async (why: string) => {
    await admin.rpc('record_renewal_result', { p_agency_id: sub.agency_id, p_ok: false, p_error: why });
    return { ok: false };
  };

  const { data: quote, error: quoteErr } = await admin.rpc('billing_quote', {
    p_agency_id: sub.agency_id, p_kind: 'plan', p_code: sub.plan_tier, p_period: sub.period,
  });
  const q = quote as { amount_kobo?: number; months?: number } | null;
  if (quoteErr || !q || !((q.amount_kobo ?? 0) > 0)) return await fail('This plan could not be priced');

  const reference = `renew-${crypto.randomUUID()}`;
  const { error: insertErr } = await admin.from('subscription_payments').insert({
    agency_id: sub.agency_id, kind: 'plan', plan_tier: sub.plan_tier, period: sub.period,
    months: q.months, amount_kobo: q.amount_kobo, currency: 'NGN', paystack_reference: reference,
  });
  if (insertErr) return await fail('Could not start the renewal');

  const res = await fetch('https://api.paystack.co/transaction/charge_authorization', {
    method: 'POST',
    headers: { Authorization: `Bearer ${paystackKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: sub.customer_email, amount: q.amount_kobo, currency: 'NGN',
      authorization_code: sub.authorization_code, reference,
      metadata: { agency_id: sub.agency_id, kind: 'plan', plan: sub.plan_tier, period: sub.period, renewal: true },
    }),
  });
  const out = (await res.json().catch(() => ({}))) as {
    status?: boolean; message?: string;
    data?: { status?: string; amount?: number; currency?: string; gateway_response?: string };
  };
  const state = out.data?.status;

  if (res.ok && out.status && state === 'success') {
    const { error } = await admin.rpc('confirm_billing_payment', {
      p_reference: reference, p_amount_kobo: out.data?.amount ?? -1, p_currency: out.data?.currency ?? '',
    });
    if (error) {
      /* The card was charged but the database refused to record it. The row
         stays pending, and Paystack's charge.success webhook confirms it. */
      console.error(`billing-renew confirm failed: ${error.message}`);
      return { ok: false };
    }
    await admin.rpc('record_renewal_result', { p_agency_id: sub.agency_id, p_ok: true, p_error: null });
    return { ok: true };
  }

  /* Still in flight (a bank asking for more): leave the row pending; the
     webhook settles it and save_billing_authorization clears the failures. */
  if (state === 'pending' || state === 'ongoing' || state === 'queued' || state === 'processing') {
    return { ok: false };
  }

  await admin.from('subscription_payments').update({ status: 'failed' })
    .eq('paystack_reference', reference).eq('status', 'pending');
  const why = out.data?.gateway_response || out.message || 'The card was declined';
  return await fail(why);
}
