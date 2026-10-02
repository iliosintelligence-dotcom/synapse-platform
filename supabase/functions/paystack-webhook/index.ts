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
  if (req.method !== 'POST') return new Response('ok');

  try {
    const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
    const rawBody = await req.text();
    const signature = req.headers.get('x-paystack-signature') ?? '';

    if (!paystackKey || !(await validSignature(rawBody, signature, paystackKey))) {
      // The only case that ever gets a non-200: an unsigned or wrongly-signed
      // request never reaches the body below.
      return new Response('invalid signature', { status: 401 });
    }

    const event = JSON.parse(rawBody) as { event?: string; data?: { reference?: string } };
    const reference = event.data?.reference;

    if (event.event === 'charge.success' && reference) {
      const url = Deno.env.get('SUPABASE_URL') ?? '';
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const admin = createClient(url, serviceKey);
      await activatePayment(admin, reference, paystackKey);
    }

    // Always 200 once the signature is trusted -- Paystack retries on
    // non-2xx, and only a bad signature should ever produce one here, even
    // for events we don't act on or a reference we don't recognise.
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error(`paystack-webhook fatal: ${err instanceof Error ? err.message : 'Unknown error'}`);
    // Still 200: whatever went wrong is on our side, not a signal to Paystack
    // that it should keep retrying the same event forever.
    return new Response('ok', { status: 200 });
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
  if (!verifyRes.ok || !verifyData.status || verifyData.data?.status !== 'success') return;
  const amount = verifyData.data.amount;
  const currency = verifyData.data.currency;

  const { data: updated } = await admin
    .from('subscription_payments')
    .update({ status: 'success', verified_at: new Date().toISOString() })
    .eq('paystack_reference', reference)
    .eq('status', 'pending')
    .eq('amount_kobo', amount ?? -1)
    .eq('currency', currency ?? '')
    .select('agency_id, plan_tier')
    .maybeSingle();

  if (updated) {
    await admin.rpc('activate_subscription', { p_agency_id: updated.agency_id, p_plan_tier: updated.plan_tier });
  }
  // If no row was updated, either the client's own verify() already won the
  // race (fine — same end state), or the reference is unrecognised (also
  // fine to no-op on).
}
