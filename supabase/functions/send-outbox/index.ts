/**
 * send-outbox — drains the message outbox.
 *
 * The CRM queues messages to leads; this delivers them. It is deliberately a
 * separate step from queueing:
 *
 *   1. queue_lead_message() writes the row. That always succeeds, even with no
 *      Twilio credentials, so the agency's intent to message someone is never
 *      lost to an outage.
 *   2. This function claims a batch, sends it, and records what happened.
 *
 * The claim is atomic (claim_outbox_batch uses FOR UPDATE SKIP LOCKED and flips
 * queued -> sending in one statement), so two concurrent drains cannot pick up
 * the same row. These are real WhatsApp messages to real buyers; a double send
 * is not a cosmetic bug.
 *
 * Failures are retried up to max_attempts with a widening backoff, then left
 * as 'failed' with the provider's own error text so the agency can see why.
 *
 * This is invoked explicitly — by the dashboard's "Send now" button, or by
 * whatever scheduler the operator chooses. Nothing here fires on its own:
 * outbound messages to real people should be a decision, not a side effect.
 *
 * The caller must be a member of an agency, and only that agency's queue is
 * drained — the drain itself runs as the service role, so without that check
 * any signed-in account could push out every agency's messages.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-injected),
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from './cors.ts';

interface OutboxRow {
  id: string;
  to_phone: string;
  body: string;
  attempts: number;
  max_attempts: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!serviceKey) return json({ error: 'Server misconfigured: no service role key' }, 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const admin = createClient(url, serviceKey);
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    /* Who is asking, and for whom.

       The drain runs with the service role, so without this check any signed-in
       account could trigger outbound messaging for every agency on the
       platform. The claim is scoped to the caller's own agency, and only staff
       may trigger it. */
    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not authenticated' }, 401);

    const { data: membership } = await admin
      .from('agency_members')
      .select('agency_id, role')
      .eq('profile_id', user.id)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (!membership) return json({ error: 'You are not a member of an agency' }, 403);
    if (!['agent', 'agency_admin', 'agency_owner'].includes(membership.role as string)) {
      return json({ error: 'You cannot send messages for this agency' }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as { limit?: number };
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);

    const { data: claimed, error: claimErr } = await admin.rpc('claim_outbox_batch', {
      p_agency_id: membership.agency_id,
      p_limit: limit,
    });
    if (claimErr) return json({ error: `Could not claim work: ${claimErr.message}` }, 500);

    const rows = (claimed ?? []) as OutboxRow[];
    if (!rows.length) return json({ claimed: 0, sent: 0, failed: 0, results: [] });

    let sent = 0;
    let failed = 0;
    const results: Array<{ id: string; status: string; error?: string }> = [];

    for (const row of rows) {
      const result = await sendWhatsApp(row.to_phone, row.body);

      if (result.ok) {
        await admin
          .from('message_outbox')
          .update({
            status: 'sent',
            provider_message_id: result.sid,
            sent_at: new Date().toISOString(),
            last_error: null,
          })
          .eq('id', row.id);
        sent++;
        results.push({ id: row.id, status: 'sent' });
        continue;
      }

      // attempts was already incremented by the claim, so this row has had
      // `row.attempts` tries including the one that just failed.
      const exhausted = row.attempts >= row.max_attempts;
      // Widening backoff: 1 min, then 5, then 25. A provider that is down
      // stays down for a while, and hammering it helps nobody.
      const delayMinutes = Math.pow(5, Math.max(0, row.attempts - 1));
      const nextAttempt = new Date(Date.now() + delayMinutes * 60_000).toISOString();

      await admin
        .from('message_outbox')
        .update(
          exhausted
            ? { status: 'failed', last_error: result.error }
            : { status: 'queued', last_error: result.error, scheduled_for: nextAttempt },
        )
        .eq('id', row.id);

      failed++;
      results.push({
        id: row.id,
        status: exhausted ? 'failed' : 'queued',
        error: result.error,
      });
    }

    return json({ claimed: rows.length, sent, failed, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`send-outbox fatal: ${message}`);
    return json({ error: message }, 500);
  }
});

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
    if (!res.ok) {
      return { ok: false, sid: null, error: `Twilio ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
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
