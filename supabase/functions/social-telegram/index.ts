/**
 * social-telegram -- posts to Telegram channels through the Synapse bot.
 *
 * NO OAUTH. Telegram is the one platform connected without a sign-in: the bot
 * is added to the channel as an administrator, and a code posted in it (or the
 * channel's @name, checked against the person's linked Telegram account) proves
 * it is theirs. That stays in social-connect and telegram-webhook, which own
 * the bot's webhook. The account it saves holds the bot's token, read here
 * like any other token.
 *
 * Moved out of social-publish on 2026-11-05 with its behaviour unchanged: a
 * single photo or video carries a real "View this home" button, an album
 * carries the link in its caption, a post with no photo goes as text, and a
 * channel's Story kit follows every post. One fix: a caption over Telegram's
 * 1,024 characters used to be cut at the end -- which is where the listing
 * link sits, so an album lost its only way to the listing. It is now cut in
 * the words, with the link kept whole.
 */
import {
  admin, buildPayload, captionLink, checkMedia, type Connection, fail, fitText, isVideoUrl, markAccountError,
  platformFunction, type PublishResult, type QueuedPost,
} from '../_shared/social/core.ts';

const TG_API = 'https://api.telegram.org';
const TG_CAPTION_MAX = 1024;
const TG_TEXT_MAX = 4096;

class TgError extends Error {
  permanent: boolean;
  constructor(message: string, status: number) {
    super(message);
    /* 400 and 403 are Telegram saying the post or the bot's rights are wrong;
       429 and 5xx will pass. */
    this.permanent = status === 400 || status === 403;
  }
}

async function publish(post: QueuedPost, conn: Connection): Promise<PublishResult> {
  const payload: Record<string, unknown> = { ...buildPayload(post), account: conn.username, chat_id: conn.platformAccountId };
  const media = post.media_urls ?? [];
  if (media.length) {
    const bad = checkMedia(media, { max: 10, mixed: true, maxVideos: 10, who: 'Telegram' });
    if (bad) return fail('telegram', bad, payload, true);
  }

  const base = `${TG_API}/bot${conn.token}`;
  const link = captionLink(post.caption);
  const button = link ? { reply_markup: { inline_keyboard: [[{ text: 'View this home', url: link }]] } } : {};
  const call = async (method: string, body: Record<string, unknown>) => {
    const r = await fetch(`${base}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ ok: false, description: 'unreadable reply' }));
    if (!j?.ok) throw new TgError(j?.description ?? ('Telegram refused ' + method), r.status);
    return j.result;
  };

  try {
    // deno-lint-ignore no-explicit-any
    let result: any;
    if (media.length === 0) {
      /* Telegram takes a listing as text, and a text post with a button is still a route to it. */
      result = await call('sendMessage', { chat_id: conn.platformAccountId, text: fitText(post.caption ?? '', TG_TEXT_MAX), ...button });
    } else if (media.length === 1) {
      const only = media[0];
      result = await call(isVideoUrl(only) ? 'sendVideo' : 'sendPhoto', {
        chat_id: conn.platformAccountId, [isVideoUrl(only) ? 'video' : 'photo']: only,
        caption: fitText(post.caption ?? '', TG_CAPTION_MAX), ...button,
      });
    } else {
      /* An album takes no button, so the caption carries the link (Telegram
         linkifies it). On the first item only: repeated, it counts ten times. */
      const group = media.slice(0, 10).map((url, i) => ({
        type: isVideoUrl(url) ? 'video' : 'photo', media: url,
        ...(i === 0 ? { caption: fitText(post.caption ?? '', TG_CAPTION_MAX) } : {}),
      }));
      const sent = await call('sendMediaGroup', { chat_id: conn.platformAccountId, media: group });
      result = Array.isArray(sent) ? sent[0] : sent;
      payload.album = group.length;
    }
    const messageId = result?.message_id;
    return { ok: true, postId: messageId != null ? String(messageId) : null, provider: 'telegram', error: '',
      payload: { ...payload, had_button: Boolean(link) && media.length <= 1, dispatched: true } };
  } catch (err) {
    const te = err instanceof TgError ? err : null;
    const message = err instanceof Error ? err.message : String(err);
    if (te?.permanent && /kicked|not a member|rights|chat not found/i.test(message)) {
      await markAccountError(conn, 'The Synapse bot can no longer post in this channel: ' + message);
    }
    return fail('telegram', message, payload, te?.permanent ?? false);
  }
}

/* ── the Story kit ──────────────────────────────────────────────────────────
   A bot cannot post a channel Story (postStory is for Business accounts), so
   the moment a listing goes out the bot messages whoever runs the channel a
   photo ready for the Story, the link on a one-tap Copy button, and a
   suggested line. For a Synapse city channel that is the founder chat; for an
   agency's channel, the member who connected it. Nobody linked, nothing sent. */
async function sendStoryKit(post: QueuedPost): Promise<void> {
  const token = (Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '').trim();
  if (!token) return;
  const photo = (post.media_urls ?? []).find((u) => u && !isVideoUrl(u));
  const link = captionLink(post.caption);
  if (!photo || !link) return;
  const db = admin();

  let chatId = '';
  let channel = '';
  if (post.city_channel_id) {
    const { data: cc } = await db.from('city_channels').select('handle, title').eq('id', post.city_channel_id).maybeSingle();
    const { data: fs } = await db.from('platform_settings').select('value').eq('key', 'founder_telegram_chat_id').maybeSingle();
    chatId = String((fs?.value as Record<string, unknown> | null)?.id ?? '').trim();
    channel = String(cc?.handle || cc?.title || 'the channel');
  } else {
    let q = db.from('social_accounts').select('platform_username, connected_by')
      .eq('agency_id', post.agency_id).eq('platform', 'telegram').eq('is_active', true).is('deleted_at', null)
      .order('connected_at', { ascending: true }).limit(1);
    if (post.social_account_id) q = q.eq('id', post.social_account_id);
    const { data: accs } = await q;
    const acc = (accs ?? [])[0] as { platform_username?: string; connected_by?: string } | undefined;
    if (!acc?.connected_by) return;
    const { data: tl } = await db.from('telegram_links').select('telegram_user_id').eq('profile_id', acc.connected_by).maybeSingle();
    chatId = tl?.telegram_user_id ? String(tl.telegram_user_id) : '';
    channel = String(acc.platform_username || 'your channel');
  }
  if (!chatId) return;

  const line = (post.caption ?? '').split('\n').map((l) => l.trim()).find((l) => l && !/^https?:\/\//i.test(l)) ?? '';
  const suggested = line.replace(/^\p{Extended_Pictographic}\s*/u, '').slice(0, 90);
  const handle = channel.startsWith('@') ? channel.slice(1) : '';
  const text = '\u{1F4F2} Story for ' + channel + '\n\n'
    + 'Telegram does not let bots post Stories, so here is one ready for you:\n'
    + '1. Save this photo.\n'
    + '2. Open ' + channel + ', tap its photo at the top, then “Add story”, and choose it.\n'
    + '3. Add a Link sticker and paste the listing link (tap “Copy link” below), so viewers can tap through.\n'
    + (suggested ? '4. Suggested text: ' + suggested + '\n' : '')
    + '\nStories on a channel unlock once it has enough boosts, Telegram’s rule, not ours.';
  const rows: Array<Array<Record<string, unknown>>> = [[{ text: 'Copy link', copy_text: { text: link.slice(0, 256) } }]];
  if (handle) rows.push([{ text: 'Open ' + channel, url: 'https://t.me/' + encodeURIComponent(handle) }]);

  const r = await fetch(`${TG_API}/bot${token}/sendPhoto`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo, caption: text.slice(0, 1024), reply_markup: { inline_keyboard: rows } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j?.ok) console.error('social-telegram: story kit not delivered for ' + post.id + ': ' + (j?.description ?? r.status));
}

platformFunction({
  platform: 'telegram',
  status: () => ({ ready: Boolean((Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '').trim()), connect: 'social-connect (bot + code)' }),
  publish,
  afterPublish: (post) => sendStoryKit(post),
});
