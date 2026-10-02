/**
 * paystack-webhook — Paystack's server-to-server confirmation of a charge.
 *
 * This is the authoritative activation path: the client's own `verify` call
 * (paystack-checkout) is a UX nicety for the redirect-back flow, but an
 * agency that closes the tab before that call completes still gets their
 * subscription activated because Paystack calls this independently.
 *
 * Paystack cannot send a Supabase JWT, so this function authenticates the
 * REQUEST itself via the x-paystack-signature header (HMAC-SHA512 of the
 * raw body, keyed with the Paystack secret) rather than verify_jwt. The
 * signature is checked BEFORE the body is parsed or trusted in any way.
 *
 * Deployed with verify_jwt = false.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected), PAYSTACK_SECRET_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  let signatureVerified = false;
  if (req.method !== 'POST') return new Response('ok');

  try {
    const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
    const rawBody = await req.text();
    const signature = req.headers.get('x-paystack-signature') ?? '';

    if (!paystackKey || !(await validSignature(rawBody, signature, paystackKey))) {
      // An unsigned or wrongly-signed request never reaches the body below.
      return new Response('invalid signature', { status: 401 });
    }
    signatureVerified = true;

    const event = JSON.parse(rawBody) as { event?: string; data?: { reference?: string } };
    const reference = event.data?.reference;

    if (event.event === 'charge.success' && reference) {
      const url = Deno.env.get('SUPABASE_URL') ?? '';
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const admin = createClient(url, serviceKey);
      await activatePayment(admin, reference, paystackKey);
    }

    // A trusted event that failed during verification or database activation
    // must be retried. Unknown events and unrecognised references are handled
    // as no-ops by activatePayment and acknowledged above.
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error(`paystack-webhook fatal: ${err instanceof Error ? err.message : 'Unknown error'}`);
    return signatureVerified
      ? new Response('retry', { status: 500 })
      : new Response('ok', { status: 200 });
  }
});

/** Constant-time comparison — a plain === on hex strings leaks timing info. */
async function validSignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/** Same activation path paystack-checkout's `verify` action uses — see that
 *  file for why this is a compare-and-swap, not read-then-write. Duplicated
 *  rather than shared: this codebase's edge functions are each small and
 *  self-contained by convention (see create-lead, social-generate) rather
 *  than reaching for a shared-lib abstraction for one reused function. */
async function activatePayment(
  admin: ReturnType<typeof createClient>,
  reference: string,
  paystackKey: string,
): Promise<void> {
  const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${paystackKey}` },
  });
  const verifyData = (await verifyRes.json().catch(() => ({}))) as {
    status?: boolean; data?: { status?: string; amount?: number; currency?: string };
  };
  if (!verifyRes.ok || !verifyData.status || verifyData.data?.status !== 'success') {
    throw new Error('Paystack did not confirm a successful transaction');
  }

  /* The database commits payment success and subscription activation in one
     transaction. On an RPC error the payment remains pending and Paystack
     can retry this webhook safely. */
  const { error } = await (admin as unknown as {
    rpc: (
      name: 'confirm_subscription_payment',
      args: { p_paystack_reference: string; p_amount_kobo: number; p_currency: string },
    ) => Promise<{
      data: Array<{ payment_status: string; plan_tier: string }> | null;
      error: { message: string; code?: string } | null;
    }>;
  }).rpc('confirm_subscription_payment', {
    p_paystack_reference: reference,
    p_amount_kobo: verifyData.data.amount ?? -1,
    p_currency: verifyData.data.currency ?? '',
  });
  if (error) {
    if (rpcMissing(error)) {
      /* A recorded payment that is still pending after the fallback must be
         retried: answering 200 would stop Paystack resending a charge the
         customer may never return to verify. A reference with no payment row
         is not ours to activate and is acknowledged. */
      const result = await legacyActivate(admin, reference, verifyData.data.amount, verifyData.data.currency);
      if (!result.ok && !result.missing) throw new Error('payment still pending after fallback activation');
      return;
    }
    throw error;
  }
}

/* THE MIGRATION MAY NOT BE THERE YET. confirm_subscription_payment arrives in
   migration 20261002091500, which is applied by hand, while this function
   deploys on every push to main -- so for a while after a merge the RPC can be
   missing. A payment made in that window must still activate, so a missing
   RPC (and only that) falls back to the compare-and-swap activation this
   replaced, unchanged. Any other error still fails loudly. */
function rpcMissing(e: { message?: string; code?: string } | null): boolean {
  if (!e) return false;
  return e.code === 'PGRST202' || e.code === '42883'
    || /could not find the function|function .* does not exist/i.test(e.message ?? '');
}

async function legacyActivate(
  admin: ReturnType<typeof createClient>,
  reference: string,
  amount: number | undefined,
  currency: string | undefined,
): Promise<{ ok: boolean; tier?: string; missing?: boolean }> {
  // The generated Database type predates the billing migration, so keep the
  // dynamic table/RPC typing confined to this migration-compatibility path.
  const legacyAdmin = admin as unknown as {
    from: (table: 'subscription_payments') => any;
    rpc: (
      name: 'activate_subscription',
      args: { p_agency_id: string; p_plan_tier: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
  // Atomic compare-and-swap, not read-then-write: only one UPDATE can match
  // status='pending' and return a row, so activation cannot double-apply.
  const { data: updated } = await legacyAdmin
    .from('subscription_payments')
    .update({ status: 'success', verified_at: new Date().toISOString() })
    .eq('paystack_reference', reference)
    .eq('status', 'pending')
    .eq('amount_kobo', amount ?? -1)
    .eq('currency', currency ?? '')
    .select('agency_id, plan_tier')
    .maybeSingle();
  if (updated) {
    const { error: activateError } = await legacyAdmin.rpc('activate_subscription', {
      p_agency_id: updated.agency_id,
      p_plan_tier: updated.plan_tier,
    });
    if (activateError) {
      /* Paid but not activated must not stick: a retry would find the payment
         already 'success' and never try again. Put it back to pending -- the
         same end state the new RPC's transaction rolls back to -- and fail,
         so the caller (or Paystack's webhook retry) tries the whole thing
         again. */
      await legacyAdmin
        .from('subscription_payments')
        .update({ status: 'pending', verified_at: null })
        .eq('paystack_reference', reference)
        .eq('status', 'success');
      throw new Error(`subscription activation failed: ${activateError.message}`);
    }
    return { ok: true, tier: updated.plan_tier as string };
  }
  // Already activated by the other path (webhook or client verify).
  const { data: already } = await legacyAdmin
    .from('subscription_payments')
    .select('plan_tier, status')
    .eq('paystack_reference', reference)
    .maybeSingle();
  if (already?.status === 'success') return { ok: true, tier: already.plan_tier as string };
  // No row at all: not a payment this system started, nothing to retry.
  return { ok: false, missing: !already };
}
