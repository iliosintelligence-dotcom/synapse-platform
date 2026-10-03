/**
 * paystack-checkout — start and confirm a Paystack payment for a Synapse
 * agency: a plan (Accelerate or Leader, monthly or annual) or an add-on.
 *
 * No Paystack key ever reaches the browser. Checkout uses Paystack's
 * hosted redirect page: this function calls /transaction/initialize and
 * hands the client an authorization_url to redirect to — card data is
 * collected on Paystack's own domain, never ours.
 *
 * POST { action: 'init', plan: 'accelerator' | 'market_leader', period?: 'monthly' | 'annual' }
 * POST { action: 'init', addon: 'listing_pack' | ... }
 *   -> { authorization_url, reference }
 * POST { action: 'verify', reference }
 *   -> { ok: true, kind, tier?, addon? } | { ok: false }
 *
 * The amount is never taken from the request. billing_quote() in the
 * database prices it for this agency (the annual offer depends on when the
 * agency joined), and that is what Paystack is asked to charge.
 *
 * Enterprise is never sold here: its terms are agreed with Synapse.
 *
 * Deployed with verify_jwt = true — every call must carry a real user JWT.
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * (auto-injected), PAYSTACK_SECRET_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

/* The portal's plan ids differ from the database's tier names in one place
   ('market-leader' vs 'market_leader'); accept both, store the tier. */
const PLAN_TIERS: Record<string, string> = {
  accelerator: 'accelerator',
  market_leader: 'market_leader',
  'market-leader': 'market_leader',
};

type Quote = { amount_kobo: number; months: number; label: string; months_free?: number };

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
    if (!paystackKey) return json({ error: 'Payments are not switched on yet. Please try again later.' }, 503);

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, serviceKey);

    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not authenticated' }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      action?: string; plan?: string; period?: string; addon?: string; reference?: string; agencyId?: string;
    };

    if (body.action === 'init') return await handleInit(userClient, admin, user, body, req, paystackKey);
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
  body: { plan?: string; period?: string; addon?: string; agencyId?: string },
  req: Request,
  paystackKey: string,
) {
  const tier = body.plan ? PLAN_TIERS[body.plan] : undefined;
  const addon = !tier && typeof body.addon === 'string' ? body.addon : undefined;
  if (!tier && !addon) return json({ error: 'Choose a plan or an add-on' }, 400);
  const period = body.period === 'annual' ? 'annual' : 'monthly';

  /* The agency being paid for is the one the portal is working in, named
     by it -- never the first of several memberships (Greptile). */
  const { data: membership } = await admin
    .from('agency_members')
    .select('agency_id')
    .eq('profile_id', user.id)
    .is('deleted_at', null);
  const mine = (membership ?? []).map((m) => String(m.agency_id));
  if (!mine.length) return json({ error: 'No agency found for this account' }, 404);
  const asked = typeof body.agencyId === 'string' ? body.agencyId : '';
  if (asked && !mine.includes(asked)) return json({ error: 'You are not a member of that agency' }, 403);
  if (!asked && mine.length > 1) return json({ error: 'Choose which agency to pay for' }, 400);
  const agencyId = asked || mine[0];

  const { data: role } = await userClient.rpc('agency_role', { p_agency_id: agencyId });
  if (role !== 'agency_owner' && role !== 'agency_admin') {
    return json({ error: 'Only an agency owner or admin can manage billing' }, 403);
  }

  if (tier) {
    const { data: agency } = await admin.from('agencies').select('subscription_tier').eq('id', agencyId).maybeSingle();
    if (agency?.subscription_tier === 'enterprise') {
      return json({ error: 'You are on Enterprise. Your terms are agreed with Synapse, so talk to us to change them.' }, 409);
    }
  }

  const { data: quote, error: quoteErr } = await admin.rpc('billing_quote', {
    p_agency_id: agencyId,
    p_kind: tier ? 'plan' : 'addon',
    p_code: tier ?? addon,
    p_period: period,
  });
  if (quoteErr) return json({ error: `Could not price this: ${quoteErr.message}` }, 500);
  const q = quote as Quote | null;
  if (!q || !(q.amount_kobo > 0)) return json({ error: 'That is not for sale' }, 400);

  if (!user.email) return json({ error: 'Account has no email on file' }, 400);

  /* WHERE THE PAYER RETURNS TO is chosen here, not by the caller (Greptile
     audit): the Origin header is whatever the request says it is, and the
     return link carries the payment reference. Only Synapse's own sites. */
  const ALLOWED = ['https://www.synapsecore.dev', 'https://synapsecore.dev'];
  const askedOrigin = req.headers.get('origin') ?? '';
  const origin = ALLOWED.includes(askedOrigin) || /^http:\/\/localhost:\d+$/.test(askedOrigin) ? askedOrigin : ALLOWED[0];
  const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${paystackKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      amount: q.amount_kobo,
      currency: 'NGN',
      /* No fragment and no query: Paystack appends ?reference= to this, and
         the portal's checkoutReturn() opens Billing once it has verified. */
      callback_url: `${origin}/app/agency.html`,
      metadata: {
        agency_id: agencyId,
        kind: tier ? 'plan' : 'addon',
        plan: tier ?? null,
        period: tier ? period : null,
        addon: addon ?? null,
        custom_fields: [{ display_name: 'Synapse', variable_name: 'item', value: q.label }],
      },
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
    kind: tier ? 'plan' : 'addon',
    plan_tier: tier ?? null,
    period: tier ? period : null,
    months: q.months,
    addon_code: addon ?? null,
    amount_kobo: q.amount_kobo,
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

  const { data: isMember } = await userClient.rpc('is_agency_member', { p_agency_id: row.agency_id });
  if (!isMember) return json({ error: 'Not authorized for this payment' }, 403);

  const result = await activatePayment(admin, reference, paystackKey);
  return json(result);
}

/**
 * The single place a Paystack-confirmed payment takes effect. Called from
 * both the client-triggered `verify` action and the webhook. Paystack's own
 * verify API is the authority on whether money moved; confirm_billing_payment
 * then marks the row paid and applies the plan or add-on in ONE transaction,
 * so a payment can never be marked paid without taking effect, nor take
 * effect twice when both paths arrive together.
 */
export async function activatePayment(
  admin: ReturnType<typeof createClient>,
  reference: string,
  paystackKey: string,
): Promise<{ ok: boolean; kind?: string; tier?: string; addon?: string }> {
  const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${paystackKey}` },
  });
  const verifyData = (await verifyRes.json().catch(() => ({}))) as {
    status?: boolean; data?: { status?: string; amount?: number; currency?: string };
  };
  if (!verifyRes.ok || !verifyData.status || verifyData.data?.status !== 'success') {
    return { ok: false };
  }

  const { data, error } = await admin.rpc('confirm_billing_payment', {
    p_reference: reference,
    p_amount_kobo: verifyData.data.amount ?? -1,
    p_currency: verifyData.data.currency ?? '',
  });
  if (error) {
    /* Thrown, not swallowed: the row stays pending, so the next verify or
       Paystack's next webhook delivery can try again. */
    throw new Error(`Could not confirm payment: ${error.message}`);
  }
  const r = data as { status?: string; kind?: string; tier?: string; addon?: string } | null;
  if (r?.status === 'success') return { ok: true, kind: r.kind, tier: r.tier ?? undefined, addon: r.addon ?? undefined };
  return { ok: false };
}
