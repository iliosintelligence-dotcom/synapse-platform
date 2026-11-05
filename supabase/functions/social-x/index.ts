/**
 * social-x -- connects an agency's X account, posts to it, and reads replies back.
 *
 * SAME PROCESS AS FACEBOOK, X's own sign-in. OAuth 2.0 with PKCE:
 *   start     x.com/i/oauth2/authorize, scopes below
 *   callback  POST api.x.com/2/oauth2/token (confidential client: Basic auth),
 *             GET /2/users/me, then connect_social_account -- the token in
 *             Vault, the account in social_accounts, exactly like a Page.
 *   publish   images first (POST /2/media/upload, up to four), then
 *             POST /2/tweets. The caption is fitted to 280 weighted
 *             characters with the listing link kept whole.
 *   refresh   access tokens last two hours; the refresh token ROTATES on
 *             every use, so the new pair is saved before anything else.
 *   sweep     like/reply/repost counts for our posts, and replies to them
 *             from the account's mentions, into social_comments.
 *
 * Until 2026-10-24 an agency's X post went out on Synapse's X through TryPost,
 * because agencies had no way to connect X. They do now, so an X post goes to
 * the agency's own account like every other platform.
 *
 * COST. X charges per call on its pay-per-use plan, and a post carrying a URL
 * costs far more than one without (docs/huginn-for-social-media.md). Every
 * listing caption carries its tracked link. That is a pricing decision for
 * ILIOS Digital, not something this file decides.
 *
 * Secrets: X_CLIENT_ID, X_CLIENT_SECRET (X developer portal > the app >
 * Keys and tokens > OAuth 2.0 Client ID and Client Secret). Redirect to
 * register in the app's User authentication settings: this function's URL.
 */
import {
  admin, backToPortal, buildPayload, checkMedia, type Connection, fail, fetchMedia, isVideoUrl, markAccountError,
  platformFunction, postsToSweep, type PublishResult, type QueuedPost, refreshTokenOf, saveAccount, saveTokens,
  fileComments, writeMetrics, json, refreshGuarded, type StartContext, tokenRequest,
} from '../_shared/social/core.ts';

const X_API = 'https://api.x.com/2';
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];
const CLIENT_ID = (Deno.env.get('X_CLIENT_ID') ?? '').trim();
const CLIENT_SECRET = (Deno.env.get('X_CLIENT_SECRET') ?? '').trim();
const basic = () => 'Basic ' + btoa(CLIENT_ID + ':' + CLIENT_SECRET);
const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET);

/* ── connect ─────────────────────────────────────────────────────────────── */

function start(ctx: StartContext): Promise<Response> {
  if (!configured()) {
    return Promise.resolve(json({ error: 'X is not configured on this project yet. Missing: X_CLIENT_ID, X_CLIENT_SECRET.' }, 503));
  }
  const u = new URL('https://x.com/i/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', ctx.redirectUri);
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('state', ctx.state);
  u.searchParams.set('code_challenge', ctx.pkceChallenge ?? '');
  u.searchParams.set('code_challenge_method', 'S256');
  return Promise.resolve(json({ url: u.toString(), platform: 'x', redirectUri: ctx.redirectUri, scopes: SCOPES }));
}

async function callback(code: string, claims: Record<string, unknown>, redirectUri: string): Promise<Response> {
  if (!configured()) return backToPortal('x', 'error', 'X is not configured on this project.');
  const verifier = String(claims.pkce_verifier ?? '');
  if (!verifier) return backToPortal('x', 'error', 'That connection took too long. Please start again.');
  const tok = await tokenRequest(X_API + '/oauth2/token', {
    grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, client_id: CLIENT_ID,
  }, { Authorization: basic() });
  if (typeof tok === 'string') return backToPortal('x', 'error', 'X would not issue a token: ' + tok);
  const granted = String(tok.scope ?? '').split(/\s+/).filter(Boolean);
  if (!granted.includes('tweet.write')) {
    return backToPortal('x', 'error', 'X connected without permission to post. Connect again and allow posting.');
  }

  const me = await fetch(X_API + '/users/me', { headers: { Authorization: 'Bearer ' + tok.access_token } });
  const mj = await me.json().catch(() => ({}));
  const id = String(mj?.data?.id ?? '');
  if (!id) return backToPortal('x', 'error', 'X did not say which account this is. Please try again.');
  const username = mj?.data?.username ? '@' + mj.data.username : 'X account';

  const saved = await saveAccount({
    agencyId: String(claims.agency_id), platform: 'x', accountId: id, username,
    accessToken: String(tok.access_token), refreshToken: tok.refresh_token ? String(tok.refresh_token) : null,
    expiresAt: new Date(Date.now() + (Number(tok.expires_in) || 7200) * 1000).toISOString(),
    scopes: granted, connectedBy: String(claims.profile_id), authSource: 'x_oauth2',
  });
  if (saved.error) return backToPortal('x', 'error', 'X connected, but the account could not be saved: ' + saved.error);
  return backToPortal('x', 'x', username);
}

/* ── the 280 rule ───────────────────────────────────────────────────────────
   X counts (twitter-text v3) a URL as 23, most Latin text as 1 and the rest --
   emoji, the naira sign -- as 2. Of thirteen Synapse X posts on 27 Sept, the
   only one that went live was the one under 280 by that count. */
const X_LIMIT = 280;
const X_URL = /https?:\/\/[^\s]+/g;
const X_TAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

function xWeight(text: string): number {
  let n = 0;
  for (const ch of text.replace(X_URL, 'x'.repeat(23))) {
    const cp = ch.codePointAt(0) ?? 0;
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d)
      || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

/** Within 280 weighted characters, the listing link kept (ours first), up to
 *  two hashtags if they leave room, words cut at a sentence or a word. */
export function fitForX(caption: string): string {
  const text = (caption ?? '').trim();
  if (xWeight(text) <= X_LIMIT) return text;
  const links = text.match(X_URL) ?? [];
  const link = links.find((u) => /synapsecore\.dev\/s\//.test(u)) ?? links[0] ?? '';
  const tags = (text.match(X_TAG) ?? []).map((t) => t.trim()).slice(0, 2);
  let body = text.replace(X_URL, ' ').replace(X_TAG, ' ')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const tail = (withTags: boolean) =>
    (link ? '\n\n' + link : '') + (withTags && tags.length ? (link ? ' ' : '\n\n') + tags.join(' ') : '');
  const withTags = xWeight(tail(true)) <= 80;
  const budget = X_LIMIT - xWeight(tail(withTags));
  if (xWeight(body) > budget) {
    let cut = '';
    for (const ch of body) {
      if (xWeight(cut + ch + '…') > budget) break;
      cut += ch;
    }
    const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
    const space = cut.lastIndexOf(' ');
    body = sentence > cut.length * 0.5
      ? cut.slice(0, sentence + 1).trim()
      : (space > 0 ? cut.slice(0, space) : cut).trim().replace(/[,;:\-–—]+$/, '') + '…';
  }
  return (body + tail(withTags)).trim();
}

/* ── publish ─────────────────────────────────────────────────────────────── */

/** X's error, and whether sending again could help. */
async function xError(res: Response): Promise<{ message: string; permanent: boolean; tokenDead: boolean }> {
  const j = await res.json().catch(() => ({}));
  const detail = j?.detail || j?.title || j?.errors?.[0]?.message || j?.error_description || j?.error || ('HTTP ' + res.status);
  return {
    message: String(detail).slice(0, 300) + (res.status === 402 ? ' (the X developer account has no credits left)' : ''),
    permanent: res.status !== 429 && res.status < 500,
    tokenDead: res.status === 401,
  };
}

async function publish(post: QueuedPost, conn: Connection): Promise<PublishResult> {
  const text = fitForX(post.caption ?? '');
  const payload: Record<string, unknown> = { ...buildPayload(post), account: conn.username, text, x_weight: xWeight(text),
    x_fitted: text !== (post.caption ?? '').trim() };
  const media = post.media_urls ?? [];
  /* Photos only for now: an X video needs a chunked upload, which is a
     separate piece of work. Four photos at most is X's own rule. */
  const photos = media.filter((u) => !isVideoUrl(u)).slice(0, 4);
  if (media.length && !photos.length) {
    return fail('x', 'Synapse cannot post a video to X yet. Add photos to the listing, or untick X.', payload, true);
  }
  if (photos.length) {
    const bad = checkMedia(photos, { max: 4, mixed: false, maxVideos: 0, who: 'X', photosOnly: true });
    if (bad) return fail('x', bad, payload, true);
  }
  const auth = { Authorization: 'Bearer ' + conn.token };

  try {
    const mediaIds: string[] = [];
    for (const url of photos) {
      const file = await fetchMedia(url, 5 * 1024 * 1024);
      if (typeof file === 'string') return fail('x', file, payload, true);
      const form = new FormData();
      form.append('media', new Blob([file.bytes], { type: file.type || 'image/jpeg' }), 'photo');
      form.append('media_category', 'tweet_image');
      const up = await fetch(X_API + '/media/upload', { method: 'POST', headers: auth, body: form });
      if (!up.ok) {
        const e = await xError(up);
        if (e.tokenDead) await markAccountError(conn, 'X says this account’s permission has ended. Connect it again.');
        return fail('x', 'X would not take a photo: ' + e.message, payload, e.permanent);
      }
      const uj = await up.json().catch(() => ({}));
      const id = String(uj?.data?.id ?? uj?.media_id_string ?? '');
      if (!id) return fail('x', 'X took a photo but returned no id for it.', payload);
      mediaIds.push(id);
    }
    payload.media_ids = mediaIds;

    const res = await fetch(X_API + '/tweets', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
    });
    if (!res.ok) {
      const e = await xError(res);
      if (e.tokenDead) await markAccountError(conn, 'X says this account’s permission has ended. Connect it again.');
      return fail('x', 'X refused the post: ' + e.message, payload, e.permanent);
    }
    const j = await res.json().catch(() => ({}));
    const id = String(j?.data?.id ?? '');
    if (!id) return fail('x', 'X accepted the post but returned no id.', payload);
    return { ok: true, postId: id, provider: 'x', error: '',
      payload: { ...payload, dispatched: true, live_url: 'https://x.com/i/web/status/' + id } };
  } catch (err) {
    return fail('x', err instanceof Error ? err.message : String(err), payload);
  }
}

/* ── refresh ──────────────────────────────────────────────────────────────── */

async function refresh(conn: Connection): Promise<string | null> {
  if (!configured()) return null;
  const rt = await refreshTokenOf(conn.accountId);
  if (!rt) return null;
  const tok = await tokenRequest(X_API + '/oauth2/token',
    { grant_type: 'refresh_token', refresh_token: rt, client_id: CLIENT_ID }, { Authorization: basic() });
  if (typeof tok === 'string') {
    console.error('social-x: refresh failed for ' + conn.accountId + ': ' + tok);
    return null;
  }
  /* The old refresh token is dead the moment this one is issued: save first. */
  await saveTokens(conn.accountId, String(tok.access_token), tok.refresh_token ? String(tok.refresh_token) : null,
    Number(tok.expires_in) || 7200);
  return String(tok.access_token);
}

/* ── read back ──────────────────────────────────────────────────────────────
   Counts for our posts in one request per account (up to 100 ids), then the
   account's mentions since the last one seen, keeping only replies whose
   conversation is one of our posts. Handle and text only. */
async function sweep(limit: number): Promise<Record<string, unknown>> {
  const due = await postsToSweep('x', limit);
  const byAccount = new Map<string, typeof due>();
  for (const d of due) {
    const k = d.conn.accountId;
    if (!byAccount.has(k)) byAccount.set(k, []);
    byAccount.get(k)!.push(d);
  }
  let updated = 0;
  let filed = 0;
  for (const [, items] of byAccount) {
    let conn = items[0].conn;
    if (conn.expiresAt && Date.parse(conn.expiresAt) - Date.now() < 15 * 60 * 1000) {
      const fresh = await refreshGuarded(conn, refresh);
      if (!fresh) continue;
      conn = { ...conn, token: fresh };
    }
    const auth = { Authorization: 'Bearer ' + conn.token };
    const ids = items.map((i) => i.post.platform_post_id).join(',');
    const r = await fetch(X_API + '/tweets?ids=' + encodeURIComponent(ids) + '&tweet.fields=public_metrics', { headers: auth });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      for (const t of (j?.data ?? []) as Array<{ id: string; public_metrics?: Record<string, number> }>) {
        const it = items.find((i) => i.post.platform_post_id === t.id);
        if (!it || !t.public_metrics) continue;
        await writeMetrics(it.post.id, {
          likes: t.public_metrics.like_count ?? null,
          comments: t.public_metrics.reply_count ?? null,
          shares: (t.public_metrics.retweet_count ?? 0) + (t.public_metrics.quote_count ?? 0),
        });
        updated++;
      }
    } else {
      console.error('social-x: metrics ' + r.status + ' for account ' + conn.accountId);
    }

    /* Replies, through the account's mentions. Matched against EVERY X post
       this account published in the last thirty days -- not only the few due
       a metrics read in this batch -- because the cursor is account-wide: a
       reply passed over now would never be looked at again. */
    const { data: mine } = await admin().from('social_posts')
      .select('id, agency_id, property_id, platform, platform_post_id')
      .eq('platform', 'x').eq('provider', 'x').eq('status', 'published').is('deleted_at', null)
      .eq('agency_id', items[0].post.agency_id)
      .gt('published_at', new Date(Date.now() - 30 * 86400e3).toISOString())
      .not('platform_post_id', 'is', null).limit(500);
    const ours = new Map<string, { id: string; agency_id: string; property_id: string | null; platform: string }>(
      ((mine ?? []) as Array<{ id: string; agency_id: string; property_id: string | null; platform: string; platform_post_id: string }>)
        .map((p) => [p.platform_post_id, p]));
    const { data: cur } = await admin().from('social_sync_cursors').select('since_id')
      .eq('account_id', conn.accountId).eq('platform', 'x').maybeSingle();
    const q = new URLSearchParams({ max_results: '50', 'tweet.fields': 'conversation_id,created_at,author_id',
      expansions: 'author_id', 'user.fields': 'username' });
    if (cur?.since_id) q.set('since_id', String(cur.since_id));
    const mr = await fetch(X_API + '/users/' + encodeURIComponent(conn.platformAccountId) + '/mentions?' + q.toString(), { headers: auth });
    if (!mr.ok) { console.error('social-x: mentions ' + mr.status + ' for account ' + conn.accountId); continue; }
    const mj = await mr.json().catch(() => ({}));
    const users = new Map<string, string>(((mj?.includes?.users ?? []) as Array<{ id: string; username: string }>)
      .map((u) => [u.id, '@' + u.username]));
    const mentions = (mj?.data ?? []) as Array<{ id: string; text: string; conversation_id?: string; created_at?: string; author_id?: string }>;
    const byPost = new Map<string, typeof mentions>();
    for (const m of mentions) {
      if (!m.conversation_id || !ours.has(m.conversation_id) || m.id === m.conversation_id) continue;
      if (!byPost.has(m.conversation_id)) byPost.set(m.conversation_id, []);
      byPost.get(m.conversation_id)!.push(m);
    }
    let allFiled = true;
    for (const [conversation, replies] of byPost) {
      const n = await fileComments(ours.get(conversation)!, replies.map((m) => ({
        id: m.id, author: users.get(m.author_id ?? '') ?? null, body: m.text ?? null, at: m.created_at ?? null,
      })));
      if (n < 0) allFiled = false; else filed += n;
    }
    /* The cursor moves only when every reply in this page was written. With
       more than one page of mentions waiting, the next sweep reads the next. */
    const newest = mj?.meta?.newest_id;
    if (newest && allFiled) {
      await admin().from('social_sync_cursors').upsert({ account_id: conn.accountId, platform: 'x', since_id: String(newest),
        updated_at: new Date().toISOString() }, { onConflict: 'account_id,platform' });
    }
  }
  return { looked_at: due.length, updated, comments_filed: filed };
}

platformFunction({
  platform: 'x',
  status: () => ({ ready: configured(), scopes: SCOPES }),
  start, callback, publish, refresh,
  refreshWithin: 15 * 60 * 1000,
  sweep,
});
