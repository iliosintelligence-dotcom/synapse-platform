/**
 * telegram-webhook — what Telegram tells the Synapse bot.
 *
 * Two things, and nothing else is acted on:
 *
 *   /start <code> in a private chat
 *     Somebody pressed Start on the t.me/<bot>?start=<code> link the portal
 *     gave them. The code was issued to a signed-in Synapse profile, and the
 *     message arrives FROM a Telegram account -- so this is the moment the two
 *     are proved to be the same person. social-connect later asks Telegram
 *     whether that Telegram account administers a channel before connecting
 *     it, which is what stops one agency connecting another's channel.
 *
 *   my_chat_member in a channel
 *     The bot was added to a channel, promoted, restricted or removed, and
 *     Telegram says by whom. Kept, so the portal can offer a linked person the
 *     channels they have just added the bot to instead of asking for an @name.
 *
 * AUTHENTICATED BY TELEGRAM'S SECRET HEADER. setWebhook is called with a
 * secret_token and Telegram echoes it on every delivery. The secret is derived
 * from the bot token (HMAC), so there is no second secret to set or rotate:
 * a new token means a new secret, and social-connect re-registers the webhook
 * when Telegram reports deliveries failing with 401.
 *
 * ALWAYS 200 once authenticated. Telegram retries anything else, and a retry
 * of an update we could not handle will not go better the second time;
 * failures are logged instead.
 */

const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TG_TOKEN = (Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '').trim();

/* MUST MATCH social-connect's webhookSecret(). Duplicated rather than shared
   because the deploy workflow redeploys a function when its own folder
   changes; a shared file changing would leave one side on the old secret. */
async function webhookSecret(token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('synapse.telegram-webhook.v1'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sb(path: string, init: RequestInit = {}) {
  return await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

async function say(chatId: number | string, text: string) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
  }).catch((e) => console.error('telegram-webhook: reply failed', e));
}

const HELP = 'I post listings for estate agencies on Synapse into their Telegram channels.\n\n'
  + 'Agencies: connect a channel from the Synapse agency portal, under Social → '
  + 'Add channel → Telegram. It will ask you to press Start here once, to link your account.\n\n'
  + 'Looking for a home? Talk to Tayo at https://www.synapsecore.dev';

// deno-lint-ignore no-explicit-any
type Json = any;

/* ── the bot joined, left or changed rights in a channel ─────────────────── */
async function onMembership(m: Json) {
  const chat = m?.chat;
  /* Channels only. Groups are a different product -- anyone in them can
     speak -- and the portal offers channels. */
  if (!chat || chat.type !== 'channel') return;
  const next = m.new_chat_member ?? {};
  const status = String(next.status ?? 'left');
  const canPost = status === 'creator'
    || (status === 'administrator' && next.can_post_messages !== false);
  const r = await sb('telegram_bot_chats', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      chat_id: chat.id,
      chat_type: chat.type,
      title: chat.title ?? null,
      username: chat.username ?? null,
      bot_status: status,
      can_post: canPost,
      added_by: m.from?.id ?? null,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!r.ok) console.error('telegram-webhook: could not record chat', chat.id, r.status, await r.text());
  else console.log('telegram-webhook: bot is ' + status + ' in channel ' + chat.id);
}

/* ── a private message: /start <code>, or anything else ──────────────────── */
async function onMessage(msg: Json) {
  if (msg?.chat?.type !== 'private') return;          // say nothing in groups
  const text = String(msg.text ?? '').trim();
  const m = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,64})$/);
  if (!m) { await say(msg.chat.id, HELP); return; }

  /* Claimed in one statement: only an unused, unexpired code matches, and
     marking it used IS the read. Two presses of the same link cannot both
     succeed. */
  const now = new Date().toISOString();
  const claim = await sb(
    'telegram_link_codes?code=eq.' + encodeURIComponent(m[1])
      + '&used_at=is.null&expires_at=gt.' + encodeURIComponent(now) + '&select=profile_id',
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ used_at: now }) },
  );
  const rows = claim.ok ? await claim.json().catch(() => []) : [];
  if (!Array.isArray(rows) || !rows.length) {
    await say(msg.chat.id, 'That link has expired or has already been used. Go back to Synapse '
      + 'and press “Link Telegram” again — links last fifteen minutes.');
    return;
  }
  const profileId = rows[0].profile_id;
  const from = msg.from ?? {};

  const link = await sb('telegram_links', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      profile_id: profileId,
      telegram_user_id: from.id,
      telegram_username: from.username ?? null,
      first_name: from.first_name ?? null,
      linked_at: now,
    }),
  });
  if (!link.ok) {
    console.error('telegram-webhook: link failed', link.status, await link.text());
    await say(msg.chat.id, 'Something went wrong linking your account. Go back to Synapse and try again.');
    return;
  }

  /* THE FOUNDER'S ALERTS. A platform admin linking becomes where the
     new-account and arrival alerts go, if nobody has been set yet -- the
     setting was waiting for exactly this chat id. Never overwritten: moving
     alerts to a different person is a decision, not a side effect. */
  let extra = '';
  const prof = await sb('profiles?id=eq.' + encodeURIComponent(profileId) + '&select=role');
  const role = prof.ok ? ((await prof.json().catch(() => []))[0]?.role ?? '') : '';
  if (role === 'platform_admin') {
    const cur = await sb('platform_settings?key=eq.founder_telegram_chat_id&select=value');
    const val = cur.ok ? ((await cur.json().catch(() => []))[0]?.value ?? null) : null;
    if (val && !String(val.id ?? '').trim()) {
      const set = await sb('platform_settings?key=eq.founder_telegram_chat_id', {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ value: { id: String(msg.chat.id) } }),
      });
      if (set.ok) extra = '\n\nYou are a Synapse platform admin, so new-account and arrival alerts will come to this chat.';
    }
  }

  const who = from.username ? '@' + from.username : (from.first_name ?? 'This Telegram account');
  await say(msg.chat.id, 'Linked ✓ ' + who + ' is now connected to your Synapse account.\n\n'
    + 'Go back to Synapse to add your channel.' + extra);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('ok');
  if (!TG_TOKEN) return new Response('not configured', { status: 503 });
  const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!got || got !== await webhookSecret(TG_TOKEN)) {
    return new Response('forbidden', { status: 401 });
  }
  const update = await req.json().catch(() => null);
  try {
    if (update?.my_chat_member) await onMembership(update.my_chat_member);
    else if (update?.message) await onMessage(update.message);
  } catch (e) {
    console.error('telegram-webhook: update ' + (update?.update_id ?? '?') + ' failed', e);
  }
  return new Response('ok');
});
