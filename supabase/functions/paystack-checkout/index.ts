/**
 * paystack-checkout — start and confirm a Paystack payment for a Synapse
 * agency subscription (Accelerate today; Leader stays "Talk to sales").
 *
 * No Paystack key ever reaches the browser. Checkout uses Paystack's
 * hosted redirect page: this function calls /transaction/initialize and
 * hands the client an authorization_url to redirect to — card data is
 * collected on Paystack's own domain, never ours.
 *
 * POST { action: 'init', plan: 'accelerator' }
 *   -> { authorization_url, reference }
 * POST { action: 'verify', reference }
 *   -> { ok: true, tier } | { ok: false }
 *
 * Deployed with verify_jwt = true — every call must carry a real user JWT.
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * (auto-injected), PAYSTACK_SECRET_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const PLAN_PRICES: Record<string, { amountKobo: number; label: string }> = {
  accelerator: { amountKobo: 7_500_000, label: 'Accelerate' }, // ₦75,000
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
    if (!serviceKey) return json({ error: 'Server misconfigured: no service role key' }, 500);
    if (!paystackKey) return json({ error: 'Server misconfigured: no Paystack key' }, 500);

    // Caller-scoped client: identifies the user AND is the one that must be
    // used for is_agency_member()/agency_role() RPCs, since those SECURITY
    // DEFINER functions key off auth.uid() from the request's own JWT — the
    // service-role client has no "current user" and would resolve NULL.
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, serviceKey);

    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not authenticated' }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      action?: string; plan?: string; reference?: string;
    };

    if (body.action === 'init') return await handleInit(userClient, admin, user, body.plan, req, paystackKey);
    if (body.action === 'verify') return await handleVerify(userClient, admin, body.reference, paystackKey);
    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`paystack-checkout fatal: ${message}`);
    return json({ error: message }, 500);
  }
});

async function handleInit(
  userClient: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>,
  user: { id: string; email?: string },
  plan: string | undefined,
  req: Request,
  paystackKey: string,
) {
  const priced = plan ? PLAN_PRICES[plan] : undefined;
  if (!priced) return json({ error: 'Unknown or unpurchasable plan' }, 400);

  const { data: membership } = await admin
    .from('agency_members')
    .select('agency_id')
    .eq('profile_id', user.id)
    .is('deleted_at', null)
    .limit(1);
  const agencyId = membership?.[0]?.agency_id as string | undefined;
  if (!agencyId) return json({ error: 'No agency found for this account' }, 404);

  // Billing is sensitive — only owner/admin may start a real charge, not
  // any invited agent.
  const { data: role } = await userClient.rpc('agency_role', { p_agency_id: agencyId });
  if (role !== 'agency_owner' && role !== 'agency_admin') {
    return json({ error: 'Only an agency owner or admin can manage billing' }, 403);
  }

  if (!user.email) return json({ error: 'Account has no email on file' }, 400);

  const origin = req.headers.get('origin') || new URL(req.url).origin;
  const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${paystackKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      amount: priced.amountKobo,
      currency: 'NGN',
      callback_url: `${origin}/app/agency.html`,
      metadata: { agency_id: agencyId, plan },
    }),
  });
  const paystackData = (await paystackRes.json().catch(() => ({}))) as {
    status?: boolean; data?: { authorization_url?: string; reference?: string }; message?: string;
  };
  if (!paystackRes.ok || !paystackData.status || !paystackData.data?.reference) {
    return json({ error: `Paystack: ${paystackData.message || 'could not start checkout'}` }, 502);
  }

  const { error: insertErr } = await admin.from('subscription_payments').insert({
    agency_id: agencyId,
    plan_tier: plan,
    amount_kobo: priced.amountKobo,
    currency: 'NGN',
    paystack_reference: paystackData.data.reference,
    initialized_by: user.id,
  });
  if (insertErr) return json({ error: `Could not record payment: ${insertErr.message}` }, 500);

  return json({ authorization_url: paystackData.data.authorization_url, reference: paystackData.data.reference });
}

async function handleVerify(
  userClient: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>,
  reference: string | undefined,
  paystackKey: string,
) {
  if (!reference) return json({ error: 'reference is required' }, 400);

  const { data: row } = await admin
    .from('subscription_payments')
    .select('agency_id')
    .eq('paystack_reference', reference)
    .maybeSingle();
  if (!row) return json({ error: 'No payment found for that reference' }, 404);

  // Without this, anyone who observed a reference (screenshot, browser
  // history) could poll another agency's payment status. Activation itself
  // is already safe regardless — it's driven by Paystack's own response,
  // never by anything this caller supplies — this closes an info leak, not
  // a money-safety hole.
  const { data: isMember } = await userClient.rpc('is_agency_member', { p_agency_id: row.agency_id });
  if (!isMember) return json({ error: 'Not authorized for this payment' }, 403);

  const result = await activatePayment(admin, reference, paystackKey);
  return json(result);
}

/**
 * The single place a Paystack-confirmed payment becomes an active
 * subscription. Called from both the client-triggered `verify` action and
 * the webhook — both converge here so activation only ever happens once,
 * however the confirmation arrives.
 */
export async function activatePayment(
  admin: ReturnType<typeof createClient>,
  reference: string,
  paystackKey: string,
): Promise<{ ok: boolean; tier?: string }> {
  const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${paystackKey}` },
  });
  const verifyData = (await verifyRes.json().catch(() => ({}))) as {
    status?: boolean; data?: { status?: string; amount?: number; currency?: string };
  };
  if (!verifyRes.ok) throw new Error('Paystack verification request failed');
  if (!verifyData.status || verifyData.data?.status !== 'success') return { ok: false };

  /* This RPC confirms payment and extends the subscription in one database
     transaction. A failed activation rolls the payment back to pending, so
     this verification can safely be retried. */
  const { data: confirmation, error } = await (admin as unknown as {
    rpc: (
      name: 'confirm_subscription_payment',
      args: { p_paystack_reference: string; p_amount_kobo: number; p_currency: string },
    ) => Promise<{
      data: Array<{ payment_status: string; plan_tier: string }> | null;
      error: { message: string } | null;
    }>;
  }).rpc('confirm_subscription_payment', {
    p_paystack_reference: reference,
    p_amount_kobo: verifyData.data.amount ?? -1,
    p_currency: verifyData.data.currency ?? '',
  });
  if (error) throw error;
  const payment = Array.isArray(confirmation) ? confirmation[0] : confirmation;
  if (payment?.payment_status === 'success') {
    return { ok: true, tier: payment.plan_tier as string };
  }
  return { ok: false };
}
