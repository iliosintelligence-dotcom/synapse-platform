/**
 * social-tiktok -- sends listing photos to the agent's TikTok inbox, renews TikTok tokens.
 *
 * CONNECTING stays in social-connect: TikTok requires its redirect URI to be
 * registered exactly, and the one registered is /functions/v1/social-connect.
 *
 * Moved out of social-publish on 2026-11-05 with its behaviour unchanged.
 * Content Posting API, photo mode, post_mode MEDIA_UPLOAD: the post lands in
 * the agent's TikTok inbox and they finish it in the app, adding a sound. So
 * "published" here means DELIVERED TO THE INBOX, and the payload says so.
 *
 * TikTok pulls photos only from a domain verified with it, which the storage
 * host is not, so each photo is addressed through www.synapsecore.dev/m/ (a
 * Vercel rewrite onto Supabase's image renderer). Until TikTok audits the app
 * it can only send to PRIVATE accounts; tiktokFailReason says so in words.
 */
import {
  buildPayload, type Connection, fail, isVideoUrl, markAccountError, platformFunction, type PublishResult,
  type QueuedPost, refreshTokenOf, saveTokens, SB_URL,
} from '../_shared/social/core.ts';

const TT_API = 'https://open.tiktokapis.com';
const TT_MEDIA_BASE = 'https://www.synapsecore.dev/m/';

function tiktokPhotoUrl(u: string): string | null {
  const store = SB_URL + '/storage/v1/object/public/';
  if (!u || !u.startsWith(store) || isVideoUrl(u)) return null;
  return TT_MEDIA_BASE + u.slice(store.length);
}

/* TikTok's fail_reason codes, in words an agent can act on. */
function tiktokFailReason(code: string): string {
  const c = code.toLowerCase();
  if (c.includes('pull_failed')) {
    return 'TikTok could not download the photos from synapsecore.dev. In the TikTok developer app, check URL '
      + 'properties: synapsecore.dev must show as verified (for the sandbox too). (' + code + ')';
  }
  if (c.includes('picture_size')) return 'TikTok would not take a photo’s size. (' + code + ')';
  if (c.includes('file_format')) return 'TikTok would not take a photo’s format. (' + code + ')';
  if (c.includes('spam_risk')) return 'TikTok’s limit is reached: at most 5 unfinished drafts in 24 hours. Finish or delete some in TikTok. (' + code + ')';
  if (c.includes('auth_removed')) return 'This TikTok account removed Synapse’s access. Reconnect it. (' + code + ')';
  if (c.includes('private') || c.includes('unaudited')) {
    return 'Until TikTok approves the app, it can only send to a private TikTok account. Set the account to private and try again. (' + code + ')';
  }
  return 'TikTok refused the post: ' + (code || 'no reason given') + '.';
}

async function publish(post: QueuedPost, conn: Connection): Promise<PublishResult> {
  const payload: Record<string, unknown> = { ...buildPayload(post), account: conn.username, mode: 'MEDIA_UPLOAD' };
  const photos = (post.media_urls ?? []).map(tiktokPhotoUrl).filter((u): u is string => Boolean(u)).slice(0, 35);
  if (!photos.length) {
    return fail('tiktok', 'No photo TikTok can take: it only pulls photos stored on Synapse. (Sending videos to TikTok is not built yet.)',
      payload, true);
  }
  const caption = (post.caption ?? '').trim();
  const title = (caption.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 90);
  const headers = { Authorization: 'Bearer ' + conn.token, 'Content-Type': 'application/json; charset=UTF-8' };
  try {
    const res = await fetch(TT_API + '/v2/post/publish/content/init/', {
      method: 'POST', headers,
      body: JSON.stringify({
        post_info: { title, description: caption.slice(0, 4000) },
        source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: photos },
        post_mode: 'MEDIA_UPLOAD', media_type: 'PHOTO',
      }),
    });
    const j = await res.json().catch(() => ({}));
    const code = j?.error ? String(j.error.code ?? '') : '';
    if (!res.ok || code !== 'ok') {
      if (/access_token_invalid|scope_not_authorized/i.test(code)) await markAccountError(conn, 'TikTok refused the connection: ' + code + '. Reconnect it.');
      return fail('tiktok', 'TikTok refused: ' + ((j?.error && (j.error.message || j.error.code)) || ('HTTP ' + res.status)),
        payload, res.status !== 429 && res.status < 500);
    }
    const publishId = j.data?.publish_id ? String(j.data.publish_id) : null;

    /* ACCEPTED IS NOT DELIVERED: TikTok then pulls the photos and can still
       refuse. The outcome is asked for, briefly, and recorded in its terms. */
    let st: Record<string, unknown> = {};
    for (let i = 0; publishId && i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const sr = await fetch(TT_API + '/v2/post/publish/status/fetch/', {
        method: 'POST', headers, body: JSON.stringify({ publish_id: publishId }),
      }).catch(() => null);
      const sj = sr ? await sr.json().catch(() => ({})) : {};
      st = (sj && sj.data) || {};
      if (st.status && !String(st.status).startsWith('PROCESSING')) break;
    }
    const status = String(st.status ?? '');
    if (status === 'FAILED') {
      return { ok: false, postId: publishId, provider: 'tiktok', permanent: true,
        payload: { ...payload, publish_id: publishId, tiktok_status: status, fail_reason: st.fail_reason ?? null },
        error: tiktokFailReason(String(st.fail_reason ?? '')) };
    }
    const inInbox = status === 'SEND_TO_USER_INBOX' || status === 'PUBLISH_COMPLETE';
    return { ok: true, postId: publishId, provider: 'tiktok', error: '',
      payload: { ...payload, photos: photos.length, publish_id: publishId, tiktok_status: status || 'unknown', delivered: 'inbox',
        note: inInbox
          ? 'In the TikTok inbox: open TikTok, tap the notification in Inbox, add a sound and post.'
          : 'TikTok is still fetching the photos; the draft reaches the TikTok inbox when it finishes.' } };
  } catch (err) {
    return fail('tiktok', err instanceof Error ? err.message : String(err), payload);
  }
}

/* TikTok's access token lives a day; the refresh token a year and may be replaced on use. */
async function refresh(conn: Connection): Promise<string | null> {
  const key = (Deno.env.get('TIKTOK_CLIENT_KEY') ?? '').trim();
  const secret = (Deno.env.get('TIKTOK_CLIENT_SECRET') ?? '').trim();
  if (!key || !secret) return null;
  const rt = await refreshTokenOf(conn.accountId);
  if (!rt) return null;
  const r = await fetch(TT_API + '/v2/oauth/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: key, client_secret: secret, grant_type: 'refresh_token', refresh_token: rt }),
  }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok || !j.access_token) {
    console.error('social-tiktok: refresh failed for ' + conn.accountId + ': ' + (j.error ?? r?.status) + ' ' + (j.error_description ?? ''));
    return null;
  }
  await saveTokens(conn.accountId, String(j.access_token), j.refresh_token ? String(j.refresh_token) : null, Number(j.expires_in) || 86400);
  return String(j.access_token);
}

platformFunction({
  platform: 'tiktok',
  status: () => ({
    ready: Boolean((Deno.env.get('TIKTOK_CLIENT_KEY') ?? '').trim() && (Deno.env.get('TIKTOK_CLIENT_SECRET') ?? '').trim()),
    mode: 'inbox', connect: 'social-connect?action=start&platform=tiktok',
  }),
  publish,
  refresh,
  refreshWithin: 15 * 60 * 1000,
});
