/**
 * social-youtube -- connects an agency's YouTube channel, uploads listing videos as Shorts, reads comments back.
 *
 * SAME PROCESS AS FACEBOOK, Google's own sign-in (OAuth 2.0 with PKCE):
 *   start     accounts.google.com, access_type=offline + prompt=consent so a
 *             refresh token always comes back
 *   callback  oauth2.googleapis.com/token, then channels?mine=true, then
 *             connect_social_account
 *   publish   one video per post: a resumable upload to videos.insert. A
 *             vertical video up to three minutes is shown as a Short. Photos
 *             cannot be posted to YouTube, and the post says so at once.
 *   refresh   access tokens last an hour; the refresh token does not rotate.
 *   sweep     view-free counts (likes, comments) and the latest comments.
 *
 * GOOGLE'S AUDIT. Until the Google Cloud project passes YouTube's API
 * compliance audit, every upload is locked PRIVATE whatever we ask for. The
 * publish result records the privacy YouTube actually applied, so a private
 * upload is never reported as a public post.
 *
 * Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (Google Cloud console >
 * APIs & Services > Credentials > OAuth client, type Web application, with
 * this function's URL as an Authorised redirect URI; YouTube Data API v3
 * enabled on the project).
 */
import {
  backToPortal, buildPayload, type Connection, fail, fetchMedia, fileComments, isVideoUrl, json, markAccountError,
  platformFunction, postsToSweep, type PublishResult, type QueuedPost, refreshTokenOf, saveAccount, saveTokens,
  type StartContext, tokenRequest, writeMetrics,
} from '../_shared/social/core.ts';

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const CLIENT_ID = (Deno.env.get('GOOGLE_CLIENT_ID') ?? '').trim();
const CLIENT_SECRET = (Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '').trim();
const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET);
const YT = 'https://www.googleapis.com/youtube/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/* A Short is at most three minutes, which at phone quality is well under
   this. The file is held in memory for the upload (YouTube needs its exact
   length up front), so the ceiling is set by the function's memory, not by
   YouTube: larger files are refused, not attempted. */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function start(ctx: StartContext): Promise<Response> {
  if (!configured()) {
    return Promise.resolve(json({ error: 'YouTube is not configured on this project yet. Missing: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.' }, 503));
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', ctx.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', ctx.state);
  u.searchParams.set('code_challenge', ctx.pkceChallenge ?? '');
  u.searchParams.set('code_challenge_method', 'S256');
  return Promise.resolve(json({ url: u.toString(), platform: 'youtube', redirectUri: ctx.redirectUri, scopes: SCOPES }));
}

async function callback(code: string, claims: Record<string, unknown>, redirectUri: string): Promise<Response> {
  if (!configured()) return backToPortal('youtube', 'error', 'YouTube is not configured on this project.');
  const tok = await tokenRequest(TOKEN_URL, {
    grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    ...(claims.pkce_verifier ? { code_verifier: String(claims.pkce_verifier) } : {}),
  });
  if (typeof tok === 'string') return backToPortal('youtube', 'error', 'Google would not issue a token: ' + tok);
  const granted = String(tok.scope ?? '').split(/\s+/).filter(Boolean);
  if (!granted.includes(SCOPES[0])) {
    return backToPortal('youtube', 'error', 'Google connected without permission to upload. Connect again and allow uploads.');
  }
  if (!tok.refresh_token) {
    /* Without one the connection dies in an hour, and the failure would land
       on the first scheduled post. Better to say so now. */
    return backToPortal('youtube', 'error', 'Google did not give a lasting permission. Remove Synapse in your Google account’s third-party access, then connect again.');
  }

  const ch = await fetch(YT + '/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + tok.access_token } });
  const cj = await ch.json().catch(() => ({}));
  const item = (cj?.items ?? [])[0];
  if (!item?.id) {
    return backToPortal('youtube', 'error', 'This Google account has no YouTube channel. Create one on YouTube, then connect again.');
  }
  const name = item.snippet?.customUrl || item.snippet?.title || 'YouTube channel';

  const saved = await saveAccount({
    agencyId: String(claims.agency_id), platform: 'youtube', accountId: String(item.id), username: String(name),
    accessToken: String(tok.access_token), refreshToken: String(tok.refresh_token),
    expiresAt: new Date(Date.now() + (Number(tok.expires_in) || 3600) * 1000).toISOString(),
    scopes: granted, connectedBy: String(claims.profile_id), authSource: 'google_oauth2',
  });
  if (saved.error) return backToPortal('youtube', 'error', 'YouTube connected, but the channel could not be saved: ' + saved.error);
  return backToPortal('youtube', 'youtube', String(name));
}

/* YouTube refuses < and > in titles and descriptions. */
const clean = (s: string) => s.replace(/[<>]/g, '');

async function publish(post: QueuedPost, conn: Connection): Promise<PublishResult> {
  const payload: Record<string, unknown> = { ...buildPayload(post), account: conn.username, channel_id: conn.platformAccountId };
  const videos = (post.media_urls ?? []).filter(isVideoUrl);
  if (!videos.length) return fail('youtube', 'YouTube takes video only, and this listing has no video. Add one, or untick YouTube.', payload, true);
  const video = videos[0];
  if (!/^https:\/\//i.test(video)) return fail('youtube', 'The video must be a public https address.', payload, true);

  const caption = (post.caption ?? '').trim();
  const firstLine = (caption.split('\n').find((l) => l.trim() && !/^https?:\/\//.test(l.trim())) ?? 'A home on Synapse').trim();
  const title = clean(firstLine).slice(0, 95);
  const description = clean(caption + (/#shorts/i.test(caption) ? '' : '\n\n#Shorts')).slice(0, 4900);
  payload.title = title;

  const file = await fetchMedia(video, MAX_VIDEO_BYTES);
  if (typeof file === 'string') return fail('youtube', file, payload, /MB/.test(file));
  const type = file.type && file.type.startsWith('video/') ? file.type : 'video/mp4';
  const length = file.bytes.byteLength;

  try {
    const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + conn.token, 'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(length),
      },
      body: JSON.stringify({
        snippet: { title, description, categoryId: '22' },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      }),
    });
    if (!init.ok) {
      const j = await init.json().catch(() => ({}));
      const msg = j?.error?.message ?? ('HTTP ' + init.status);
      if (init.status === 401) await markAccountError(conn, 'YouTube says this channel’s permission has ended. Connect it again.');
      return fail('youtube', 'YouTube would not start the upload: ' + msg, payload, init.status < 500 && init.status !== 429);
    }
    const uploadUrl = init.headers.get('location');
    if (!uploadUrl) return fail('youtube', 'YouTube did not say where to upload the video.', payload);

    const put = await fetch(uploadUrl, {
      method: 'PUT', headers: { 'Content-Type': type }, body: file.bytes,
    });
    const pj = await put.json().catch(() => ({}));
    if (!put.ok || !pj?.id) {
      return fail('youtube', 'YouTube did not accept the video: ' + (pj?.error?.message ?? ('HTTP ' + put.status)), payload,
        put.status >= 400 && put.status < 500 && put.status !== 429);
    }
    const applied = String(pj?.status?.privacyStatus ?? 'unknown');
    return { ok: true, postId: String(pj.id), provider: 'youtube', error: '',
      payload: { ...payload, dispatched: true, privacy: applied, live_url: 'https://youtube.com/shorts/' + pj.id,
        ...(applied !== 'public' ? { note: 'YouTube set this video to ' + applied + '. Until Google’s API audit is passed, uploads stay private.' } : {}) } };
  } catch (err) {
    return fail('youtube', err instanceof Error ? err.message : String(err), payload);
  }
}

async function refresh(conn: Connection): Promise<string | null> {
  if (!configured()) return null;
  const rt = await refreshTokenOf(conn.accountId);
  if (!rt) return null;
  const tok = await tokenRequest(TOKEN_URL, { grant_type: 'refresh_token', refresh_token: rt, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
  if (typeof tok === 'string') {
    console.error('social-youtube: refresh failed for ' + conn.accountId + ': ' + tok);
    if (/invalid_grant/i.test(tok)) await markAccountError(conn, 'Google withdrew Synapse’s access to this channel. Connect it again.');
    return null;
  }
  await saveTokens(conn.accountId, String(tok.access_token), tok.refresh_token ? String(tok.refresh_token) : null, Number(tok.expires_in) || 3600);
  return String(tok.access_token);
}

async function sweep(limit: number): Promise<Record<string, unknown>> {
  const due = await postsToSweep('youtube', limit);
  let updated = 0;
  let filed = 0;
  const fresh = new Map<string, string>();
  for (const { post, conn } of due) {
    let token = fresh.get(conn.accountId) ?? conn.token;
    if (!fresh.has(conn.accountId) && conn.expiresAt && Date.parse(conn.expiresAt) - Date.now() < 5 * 60 * 1000) {
      token = (await refresh(conn)) ?? '';
      fresh.set(conn.accountId, token);
    }
    if (!token) continue;
    const auth = { Authorization: 'Bearer ' + token };
    const v = await fetch(YT + '/videos?part=statistics&id=' + encodeURIComponent(post.platform_post_id), { headers: auth });
    const vj = v.ok ? await v.json().catch(() => ({})) : {};
    const s = (vj?.items ?? [])[0]?.statistics;
    if (s) {
      await writeMetrics(post.id, { likes: s.likeCount != null ? Number(s.likeCount) : null,
        comments: s.commentCount != null ? Number(s.commentCount) : null, shares: null });
      updated++;
    }
    if (s && Number(s.commentCount) > 0) {
      const c = await fetch(YT + '/commentThreads?part=snippet&maxResults=50&order=time&videoId=' + encodeURIComponent(post.platform_post_id), { headers: auth });
      const cj = c.ok ? await c.json().catch(() => ({})) : {};
      // deno-lint-ignore no-explicit-any
      filed += await fileComments(post, ((cj?.items ?? []) as Array<Record<string, any>>).map((t) => {
        const top = t?.snippet?.topLevelComment;
        return { id: String(top?.id ?? ''), author: top?.snippet?.authorDisplayName ?? null,
          body: top?.snippet?.textOriginal ?? null, at: top?.snippet?.publishedAt ?? null };
      }));
    }
  }
  return { looked_at: due.length, updated, comments_filed: filed };
}

platformFunction({
  platform: 'youtube',
  status: () => ({ ready: configured(), media: 'video only', note: 'Uploads stay private until Google’s API audit is passed.' }),
  start, callback, publish, refresh,
  refreshWithin: 10 * 60 * 1000,
  sweep,
});
