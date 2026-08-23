/**
 * create-lead — THE LEAD BRIDGE. The most important function in the product.
 *
 * Triggered by "Contact agent" or by Toju when a user expresses clear
 * interest. It:
 *   1. identifies the consumer from their JWT,
 *   2. snapshots their name/phone and attaches extracted preferences,
 *   3. writes the lead (service role, so the row is durable),
 *   4. sends a formatted WhatsApp message to the agency via Twilio,
 *   5. retries once on failure; if it still fails, flags the lead
 *      (delivery_failed) so it is NEVER silently lost.
 *
 * The lead row is persisted BEFORE delivery is attempted — a Twilio outage
 * can never lose a lead. The dashboard surfaces delivery_failed leads.
 *
 * DELIVERY IS OPTIONAL BY DESIGN. Twilio may be unconfigured (it currently
 * is). That must never stop a lead being captured: the agency can still work
 * the lead from the CRM, and a lead sitting in the CRM with no WhatsApp is
 * incomparably better than a buyer who was told "request sent" while nothing
 * was written. Missing credentials therefore produce a saved, flagged lead
 * and a 207 — not a failure.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * (auto-injected), TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

interface LeadPreferences {
  city: string | null;
  budget_min: number | null;
  budget_max: number | null;
  property_type: string | null;
  listing_type: string | null;
  timeline: string | null;
  /* What Toju already worked out with this buyer, when they ran the negotiator
     before making contact. It rides along so the agency opens the lead knowing
     what was proposed and why — previously Toju wrote an opening offer and a
     message, and the only route to the agency was the buyer copying it to a
     clipboard and finding them somewhere else. */
  negotiation?: LeadNegotiation | null;
}

interface LeadNegotiation {
  offer: number | null;
  advice: string;
  draft: string;
}

/* Client-supplied, so it is clamped rather than trusted: a number that is
   actually a number, strings bounded so a malformed post cannot write an essay
   into the lead. */
function cleanNegotiation(raw: unknown): LeadNegotiation | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  const offer = typeof n.offer === 'number' && isFinite(n.offer) && n.offer > 0 ? n.offer : null;
  const advice = typeof n.advice === 'string' ? n.advice.slice(0, 1200) : '';
  const draft = typeof n.draft === 'string' ? n.draft.slice(0, 1200) : '';
  if (offer == null && !advice && !draft) return null;
  return { offer, advice, draft };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!serviceKey) return json({ error: 'Server misconfigured: no service role key' }, 500);

    // Caller-scoped client identifies the consumer (RLS).
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    // Service-role client owns the durable write + delivery status.
    const admin = createClient(url, serviceKey);

    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not authenticated' }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      property_id?: string; source?: string; negotiation?: unknown;
    };
    if (!body.property_id) return json({ error: 'property_id is required' }, 400);
    // `source` is a Postgres enum; anything unrecognised would fail the insert,
    // so it is validated here rather than passed through from the client.
    const ALLOWED = ['toju_chat', 'contact_button', 'browse', 'direct', 'search', 'referral'];
    const source = ALLOWED.includes(body.source ?? '') ? body.source! : 'contact_button';

    // ── gather the data the agency needs to act on the lead ──
    const { data: profile } = await admin
      .from('profiles')
      .select('full_name, phone')
      .eq('id', user.id)
      .maybeSingle();

    const { data: prop, error: pErr } = await admin
      .from('properties')
      .select('id, title, price, city, agency_id')
      .eq('id', body.property_id)
      .maybeSingle();
    if (pErr || !prop) return json({ error: 'Property not found' }, 404);

    const { data: agency } = await admin
      .from('agencies')
      .select('name, whatsapp_number')
      .eq('id', prop.agency_id)
      .maybeSingle();

    // ── extracted preferences from the consumer's latest Toju session ──
    // Optional: the table may not exist on every environment, and a buyer may
    // never have spoken to Toju. Either way the lead still stands on its own.
    let preferences: LeadPreferences | null = null;
    try {
    const { data: session } = await admin
      .from('chat_sessions')
      .select('pref_city, pref_budget_min, pref_budget_max, pref_property_type, pref_listing_type')
      .eq('consumer_id', user.id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (session) {
      preferences = {
        city: session.pref_city ?? null,
        budget_min: session.pref_budget_min ?? null,
        budget_max: session.pref_budget_max ?? null,
        property_type: session.pref_property_type ?? null,
        listing_type: session.pref_listing_type ?? null,
        timeline: null,
      };
    }
    } catch { /* preferences are a bonus, never a blocker */ }

    /* A buyer who negotiated but has no chat session still has a negotiation
       worth keeping, so this builds the object rather than only decorating one
       that already exists. */
    const negotiation = cleanNegotiation(body.negotiation);
    if (negotiation) {
      preferences = {
        ...(preferences ?? {
          city: null, budget_min: null, budget_max: null,
          property_type: null, listing_type: null, timeline: null,
        }),
        negotiation,
      };
    }

    const consumerName = (profile?.full_name as string) || 'A Synapse buyer';
    const consumerPhone = (profile?.phone as string | null) ?? null;

    // ── 1. persist the lead FIRST (never lose it) ──
    const { data: lead, error: leadErr } = await admin
      .from('leads')
      .insert({
        property_id: prop.id,
        consumer_id: user.id,
        agency_id: prop.agency_id,
        source,
        consumer_name: consumerName,
        consumer_phone: consumerPhone,
        preferences,
        delivery_status: 'pending',
      })
      .select('id')
      .single();
    if (leadErr || !lead) return json({ error: `Could not create lead: ${leadErr?.message}` }, 500);
    const leadId = lead.id as string;

    // ── 2. deliver via WhatsApp, retry once ──
    const message = formatWhatsApp({
      consumerName,
      consumerPhone,
      propertyTitle: prop.title as string,
      price: prop.price as number,
      city: prop.city as string,
      preferences,
      source,
      leadId,
    });

    const toNumber = agency?.whatsapp_number as string | undefined;
    let delivered = false;
    let messageSid: string | null = null;
    let lastError = '';

    if (!toNumber) {
      lastError = 'Agency has no WhatsApp number configured';
    } else {
      for (let attempt = 0; attempt < 2 && !delivered; attempt++) {
        const result = await sendWhatsApp(toNumber, message);
        if (result.ok) {
          delivered = true;
          messageSid = result.sid;
        } else {
          lastError = result.error;
          if (result.error === 'Twilio not configured') break;   // retrying cannot help
        }
      }
    }

    // ── 3. record delivery outcome — flagged, never silent ──
    if (delivered) {
      await admin
        .from('leads')
        .update({
          delivery_status: 'delivered',
          whatsapp_message_sid: messageSid,
          delivered_at: new Date().toISOString(),
        })
        .eq('id', leadId);
      return json({ lead_id: leadId, delivery_status: 'delivered' });
    }

    await admin
      .from('leads')
      .update({ delivery_status: 'delivery_failed', delivery_error: lastError })
      .eq('id', leadId);
    // Lead is saved and flagged. Report honestly: the lead EXISTS, and the
    // caller should tell the buyer it was received, because it was.
    console.error(`Lead ${leadId} delivery failed: ${lastError}`);
    return json(
      { lead_id: leadId, delivery_status: 'delivery_failed', error: lastError },
      207, // Multi-Status: lead created, delivery did not succeed
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`create-lead fatal: ${message}`);
    return json({ error: message }, 500);
  }
});

/* ───────── helpers ───────── */

function naira(n: number): string {
  return `₦${Number(n).toLocaleString('en-NG')}`;
}

function formatWhatsApp(p: {
  consumerName: string;
  consumerPhone: string | null;
  propertyTitle: string;
  price: number;
  city: string;
  preferences: LeadPreferences | null;
  source: string;
  leadId: string;
}): string {
  const lines = [
    '🟢 *New qualified lead — Synapse*',
    '',
    `*Buyer:* ${p.consumerName}`,
    p.consumerPhone ? `*Phone:* ${p.consumerPhone}` : '*Phone:* (in app)',
    '',
    `*Property:* ${p.propertyTitle}`,
    `*Price:* ${naira(p.price)} · ${p.city}`,
  ];

  if (p.preferences) {
    const { budget_min, budget_max } = p.preferences;
    if (budget_min != null || budget_max != null) {
      const lo = budget_min != null ? naira(budget_min) : '—';
      const hi = budget_max != null ? naira(budget_max) : '—';
      lines.push(`*Buyer budget:* ${lo} – ${hi}`);
    }
  }

  /* Above the source line on purpose: an agent skimming this on a phone should
     see the number before the provenance. */
  if (p.preferences?.negotiation) {
    const n = p.preferences.negotiation;
    lines.push('');
    if (n.offer != null) lines.push(`*Toju's opening offer:* ${naira(n.offer)}`);
    if (n.advice) lines.push(`_${n.advice}_`);
  }

  const sourceLabel =
    p.source === 'toju_chat' ? 'Toju recommendation' : p.source === 'browse' ? 'Browse' : 'Contact button';
  lines.push('', `*Source:* ${sourceLabel}`, `*Lead ID:* ${p.leadId}`);
  return lines.join('\n');
}

interface SendResult {
  ok: boolean;
  sid: string | null;
  error: string;
}

async function sendWhatsApp(toNumber: string, body: string): Promise<SendResult> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_WHATSAPP_FROM');
  if (!sid || !token || !from) {
    return { ok: false, sid: null, error: 'Twilio not configured' };
  }

  const to = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${normalize(toNumber)}`;
  const fromAddr = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: fromAddr, Body: body }),
    });
    if (!res.ok) return { ok: false, sid: null, error: `Twilio ${res.status}: ${await res.text()}` };
    const data = (await res.json()) as { sid?: string };
    return { ok: true, sid: data.sid ?? null, error: '' };
  } catch (err) {
    return { ok: false, sid: null, error: err instanceof Error ? err.message : 'network error' };
  }
}

/** Best-effort E.164 normalisation for Nigerian numbers. */
function normalize(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('234')) return `+${digits}`;
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
  return `+${digits}`;
}
