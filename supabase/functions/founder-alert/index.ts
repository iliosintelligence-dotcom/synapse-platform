/**
 * founder-alert — tells us when somebody arrives and when somebody registers.
 *
 * Eden: "I want to know every single time a user creates a new account [...]
 * That way we can keep a log of how many people actually come into the app
 * from social media or from other pages, and how many people are going on to
 * register."
 *
 * The log is growth_events and is the durable half; this is the part that
 * makes it arrive while it is still interesting.
 *
 * THROUGH THE TELEGRAM BOT, because it is the only channel in this project
 * that reliably reaches a person today. Twilio has never delivered a message,
 * there is no mail sender configured, and web push needs a subscription
 * nobody has made. The bot went in this afternoon for a different reason and
 * costs nothing to reuse.
 *
 * NOT ONE MESSAGE PER EVENT. A batch becomes one message, because twenty
 * separate pings for twenty arrivals is a notification somebody mutes, and a
 * muted channel reports nothing at all. Registrations are named individually
 * -- there are few and each one matters -- and arrivals are counted by source.
 *
 * MARKED BEFORE SENDING IS WRONG HERE, and marked after is also wrong. A send
 * that fails after Telegram accepted it would repeat; a mark that fails after
 * a successful send would repeat too. Between the two, repeating a message is
 * the cheaper mistake than silently losing one, so rows are marked AFTER a
 * confirmed send -- at worst somebody sees an arrival counted twice, which is
 * visible and harmless, rather than never hearing about a registration.
 */

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TG_TOKEN = (Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '').trim();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

interface Event {
  id: string;
  kind: string;
  source: string | null;
  link_token: string | null;
  created_at: string;
}

async function sb(path: string, init?: RequestInit) {
  return await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!SB_URL || !SERVICE_KEY) return json({ error: 'Server misconfigured' }, 500);

  /* Service role only. This reads the whole platform's funnel, which is the
     one thing in the database that belongs to no agency. */
  if ((req.headers.get('Authorization') ?? '') !== `Bearer ${SERVICE_KEY}`) {
    return json({ error: 'Not permitted' }, 403);
  }
  if (!TG_TOKEN) return json({ skipped: 'TELEGRAM_BOT_TOKEN is not set' });

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body?.limit) || 25, 1), 100);

  /* Where the alerts go. Read per run rather than cached: it is set once by
     hand and a stale value would send somebody else's alerts to a chat that
     is no longer ours. */
  const setRes = await sb('platform_settings?select=value&key=eq.founder_telegram_chat_id');
  const rows = setRes.ok ? await setRes.json().catch(() => []) : [];
  const chatId = String((Array.isArray(rows) && rows[0]?.value?.id) || '').trim();
  if (!chatId) return json({ skipped: 'no founder chat id set' });

  const evRes = await sb(
    'growth_events?select=id,kind,source,link_token,created_at'
    + `&notified_at=is.null&order=created_at.asc&limit=${limit}`);
  if (!evRes.ok) return json({ error: 'read failed', status: evRes.status }, 502);
  const events = (await evRes.json().catch(() => [])) as Event[];
  if (!Array.isArray(events) || !events.length) return json({ sent: 0 });

  const registrations = events.filter((e) => e.kind === 'registered');
  const arrivals = events.filter((e) => e.kind === 'arrived');

  /* Arrivals by source, because twenty lines saying "somebody arrived" is
     the same information as one line saying twenty did, and harder to read. */
  const bySource = new Map<string, number>();
  for (const a of arrivals) {
    const k = a.source || 'unknown';
    bySource.set(k, (bySource.get(k) ?? 0) + 1);
  }

  const lines: string[] = [];
  if (registrations.length) {
    lines.push(registrations.length === 1
      ? '🎉 Someone registered on Synapse'
      : `🎉 ${registrations.length} people registered on Synapse`);
    for (const r of registrations) {
      /* The source is the point. "Somebody signed up" is a number; "somebody
         who came from the Telegram post signed up" is a decision about where
         to spend the next hour. */
      lines.push('   · from ' + (r.source ? r.source : 'an unknown source')
        + (r.link_token ? ' (link ' + r.link_token + ')' : ''));
    }
  }
  if (bySource.size) {
    if (lines.length) lines.push('');
    lines.push(arrivals.length === 1 ? '👀 1 new visitor' : `👀 ${arrivals.length} new visitors`);
    for (const [src, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`   · ${src}: ${n}`);
    }
  }

  const send = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      disable_notification: registrations.length === 0,
    }),
  });
  const sendJson = await send.json().catch(() => ({ ok: false }));
  if (!sendJson?.ok) {
    /* Nothing is marked. The events stay unsent and the next run tries again,
       which is right: a missed registration is the one thing this function
       exists to prevent. */
    console.error('founder-alert: telegram refused: ' + (sendJson?.description ?? send.status));
    return json({ error: sendJson?.description ?? 'telegram refused', sent: 0 }, 502);
  }

  /* Marked AFTER a confirmed send. Between repeating a message and losing
     one, repeating is the cheaper mistake -- visible, harmless, and it does
     not cost us a registration nobody heard about. */
  const ids = events.map((e) => e.id);
  const mark = await sb(`growth_events?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ notified_at: new Date().toISOString() }),
  });
  if (!mark.ok) console.error('founder-alert: sent but could not mark ' + ids.length + ' rows');

  return json({ sent: events.length, registrations: registrations.length, arrivals: arrivals.length });
});
