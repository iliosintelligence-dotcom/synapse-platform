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

/* ── the handoff to Tayo ────────────────────────────────────────────────
   Somebody who messages the bot instead of tapping a post's button is asking
   something, and the bot is not who answers. Tayo is: Synapse's advisor, who
   knows every listing, the full cost of each, and how to find the one that
   fits. So every private message is answered with a button into Tayo's chat
   that CARRIES what they said -- their question sent for them (?ask=), or the
   very home they forwarded (?reply=<listing>) -- rather than an address to
   type and a question to ask twice.

   new=1 opens a fresh conversation; ch=telegram credits the visit to
   Telegram. Both are read by toju.html and arrival.js. */
const SITE = 'https://www.synapsecore.dev';
function tayoLink(extra: Record<string, string>): string {
  return SITE + '/app/toju.html?' + new URLSearchParams({ new: '1', ch: 'telegram', ...extra }).toString();
}

/* What somebody typed, fit to travel in a link. A URL is logged along the
   way, and Tayo needs neither a phone number nor an email to answer about
   homes, so both are taken out; the rest is trimmed to what Tayo reads. */
function cleanAsk(t: string): string {
  return t
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ')
    .replace(/\+?\d[\d\s-]{6,}\d/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

type Button = { text: string; url: string };
async function sayWith(chatId: number | string, text: string, rows: Button[][]) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text,
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: rows },
    }),
  }).catch((e) => console.error('telegram-webhook: reply failed', e));
}

const WELCOME = 'Hi \u{1F44B} I post homes to Synapse\u2019s Telegram channels.\n\n'
  + 'To find a home, or to ask about one, talk to Tayo \u2014 Synapse\u2019s property advisor. '
  + 'Tell Tayo what you\u2019re looking for, and Tayo will find homes that fit, with every cost shown.';

/* Greetings and taps of Start: nothing to carry over, so the plain way in. */
const GREETING = /^(\/start\b.*|hi+|hello+|hey+|hy|how far|good (morning|afternoon|evening|day)|\u{1F44B})[\s!.?]*$/iu;

async function handOff(msg: Json) {
  const chatId = msg.chat.id;
  const text = String(msg.text ?? msg.caption ?? '').trim();

  /* A POST FORWARDED FROM ONE OF OUR CHANNELS carries its listing's short
     link in the caption. Resolved to the listing, so Tayo opens on that exact
     home and speaks first about it. */
  const link = text.match(/synapsecore\.dev\/s\/([A-Za-z0-9_-]{3,32})/i);
  if (link) {
    const r = await sb('short_links?select=property_id&limit=1&token=eq.' + encodeURIComponent(link[1]));
    const pid = r.ok ? ((await r.json().catch(() => []))[0]?.property_id ?? null) : null;
    if (pid) {
      await sayWith(chatId,
        'Tayo, Synapse\u2019s property advisor, can take you through this home \u2014 the full cost, '
          + 'the area, and whether it fits what you need.',
        [[{ text: 'Ask Tayo about this home', url: tayoLink({ reply: String(pid) }) }]]);
      return;
    }
  }

  /* A QUESTION, in their words: sent to Tayo for them, so the answer is
     waiting when the chat opens. */
  if (text && !GREETING.test(text)) {
    const ask = cleanAsk(text);
    if (ask.length >= 3) {
      await sayWith(chatId,
        'That\u2019s one for Tayo, Synapse\u2019s property advisor. Tayo will answer it and show you '
          + 'homes that fit \u2014 your question goes with you.',
        [[{ text: 'Continue with Tayo', url: tayoLink({ ask }) }]]);
      return;
    }
  }

  await sayWith(chatId, WELCOME, [
    [{ text: 'Chat with Tayo', url: tayoLink({}) }],
    [{ text: 'Browse homes', url: SITE + '/app/browse.html?ch=telegram' }],
    [{ text: 'I\u2019m an estate agency', url: SITE + '/app/agency.html#social' }],
  ]);
}

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

  /* A SYNAPSE CITY CHANNEL switches on here. The seeded row names the @name
     the channel must have; the bot arriving as a posting admin of a channel
     with that name is the confirmation, and leaving (or losing the right to
     post) switches it off. For any other channel this matches nothing. */
  const claim = await sb('rpc/claim_city_channel', {
    method: 'POST',
    body: JSON.stringify({
      p_chat_id: chat.id,
      p_username: chat.username ?? null,
      p_title: chat.title ?? null,
      p_status: status,
      p_can_post: canPost,
    }),
  });
  if (!claim.ok) console.error('telegram-webhook: claim_city_channel failed', claim.status, await claim.text());
  else {
    const id = await claim.json().catch(() => null);
    if (id) console.log('telegram-webhook: city channel ' + id + ' is now ' + (canPost ? 'on' : 'off'));
  }
}

/* ── "/connect CODE" posted in a channel ──────────────────────────────────
   The portal gave a signed-in agency member the code; somebody able to post
   in this channel has just posted it. That is the proof the channel is
   theirs to connect. The code is claimed in one statement (single use), the
   bot's own right to post is checked with Telegram, the channel is connected
   to the code's agency, and the code post is deleted so followers never see
   it. Every outcome is written to the code's row, which the portal watches. */
async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).catch(() => null);
  return r ? await r.json().catch(() => ({ ok: false })) : { ok: false };
}

async function onChannelPost(p: Json) {
  const text = String(p?.text ?? '').trim();
  const m = text.match(/^\/connect(?:@\w+)?\s+([A-Za-z0-9]{6,12})$/);
  if (!m || !p.chat) return;          // every other channel post, ours included
  const code = m[1].toUpperCase();
  const chat = p.chat;
  const now = new Date().toISOString();

  const claim = await sb(
    'telegram_connect_codes?code=eq.' + encodeURIComponent(code)
      + '&used_at=is.null&expires_at=gt.' + encodeURIComponent(now) + '&select=agency_id,profile_id',
    { method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ used_at: now, chat_id: chat.id }) },
  );
  const rows = claim.ok ? await claim.json().catch(() => []) : [];
  if (!Array.isArray(rows) || !rows.length) return;   // unknown, used or expired: leave the post alone
  const { agency_id, profile_id } = rows[0];
  const mark = (fields: Record<string, unknown>) => sb('telegram_connect_codes?code=eq.' + encodeURIComponent(code), {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fields),
  });

  const me = await tg('getMe', {});
  const member = me.ok ? await tg('getChatMember', { chat_id: chat.id, user_id: me.result.id }) : { ok: false };
  const st = member.ok ? String(member.result.status) : '';
  const canPost = st === 'creator' || (st === 'administrator' && member.result.can_post_messages !== false);
  if (!canPost) {
    await mark({ error: 'The bot is in ' + (chat.title ?? 'the channel') + ' but is not allowed to post. '
      + 'In the channel: Administrators \u2192 the bot \u2192 turn on Post Messages, then post the code again.' });
    return;
  }

  const label = chat.username ? '@' + chat.username : (chat.title ?? 'channel');
  const conn = await sb('rpc/connect_telegram_channel', {
    method: 'POST',
    body: JSON.stringify({
      p_agency_id: agency_id, p_chat_id: String(chat.id), p_title: chat.title ?? '',
      p_username: chat.username ? '@' + chat.username : '', p_bot_token: TG_TOKEN,
      p_connected_by: profile_id,
    }),
  });
  if (!conn.ok) {
    const why = await conn.text();
    console.error('telegram-webhook: connect_telegram_channel failed', conn.status, why);
    await mark({ error: 'The channel could not be connected: ' + why.slice(0, 200) });
    return;
  }
  const accountId = await conn.json().catch(() => null);

  const del = await tg('deleteMessage', { chat_id: chat.id, message_id: p.message_id });
  await mark({ account_id: accountId, channel: label, code_post_deleted: Boolean(del.ok) });
  console.log('telegram-webhook: channel ' + chat.id + ' connected by code for agency ' + agency_id);
}

/* ── a private message: /start <code>, or anything else ──────────────────── */
async function onMessage(msg: Json) {
  if (msg?.chat?.type !== 'private') return;          // say nothing in groups
  const text = String(msg.text ?? '').trim();
  const m = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,64})$/);
  if (!m) { await handOff(msg); return; }

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
    else if (update?.channel_post) await onChannelPost(update.channel_post);
    else if (update?.message) await onMessage(update.message);
  } catch (e) {
    console.error('telegram-webhook: update ' + (update?.update_id ?? '?') + ' failed', e);
  }
  return new Response('ok');
});
