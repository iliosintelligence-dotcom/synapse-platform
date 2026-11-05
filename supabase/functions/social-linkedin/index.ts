/**
 * social-linkedin -- connects a LinkedIn profile or company page, posts to it, reads engagement back.
 *
 * SAME PROCESS AS FACEBOOK, LinkedIn's own sign-in (OAuth 2.0):
 *   start     linkedin.com/oauth/v2/authorization
 *   callback  linkedin.com/oauth/v2/accessToken, then who this is. With
 *             company-page access, the pages this person administers are
 *             HELD FOR A CHOICE (social_connect_picks), exactly as Facebook
 *             holds Pages, because connecting every page somebody can reach
 *             is how a page ends up on the wrong agency.
 *   publish   photos first (Images API: initializeUpload, then PUT), then
 *             POST /rest/posts: one photo as media, two to twenty as a
 *             multi-image post, none as text.
 *   refresh   tokens last sixty days. LinkedIn issues refresh tokens only to
 *             approved partners; without one the account is marked to
 *             reconnect when it ends.
 *   sweep     likes and comments on company-page posts.
 *
 * TWO LEVELS OF ACCESS, chosen by LINKEDIN_PAGES:
 *   unset  "Share on LinkedIn" + "Sign In with LinkedIn using OpenID
 *          Connect", both self-serve: an agent posts to their own PROFILE.
 *   true   adds the Community Management API (w_organization_social and
 *          friends): posting as a COMPANY PAGE. LinkedIn must approve the app
 *          for that product first; asking for the scopes before then fails
 *          at the dialog.
 *
 * Secrets: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET (LinkedIn developer
 * portal > the app > Auth), LINKEDIN_PAGES (optional). Register this
 * function's URL under Authorized redirect URLs.
 */
import {
  backToPortal, buildPayload, type Connection, fail, fetchMedia, fileComments, holdForChoice, isVideoUrl, json,
  markAccountError, type PickedAccount, platformFunction, postsToSweep, type PublishResult, type QueuedPost,
  refreshTokenOf, saveAccount, saveTokens, type StartContext, tokenRequest, writeMetrics,
} from '../_shared/social/core.ts';

const CLIENT_ID = (Deno.env.get('LINKEDIN_CLIENT_ID') ?? '').trim();
const CLIENT_SECRET = (Deno.env.get('LINKEDIN_CLIENT_SECRET') ?? '').trim();
const PAGES = /^(1|true|yes)$/i.test((Deno.env.get('LINKEDIN_PAGES') ?? '').trim());
/* The API version, YYYYMM. LinkedIn retires each about a year after release. */
const VERSION = (Deno.env.get('LINKEDIN_VERSION') ?? '').trim() || '202610';
const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET);
const SCOPES = ['openid', 'profile', 'w_member_social',
  ...(PAGES ? ['w_organization_social', 'r_organization_social', 'rw_organization_admin'] : [])];
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const REST = 'https://api.linkedin.com/rest';

const rest = (token: string, extra: Record<string, string> = {}) => ({
  Authorization: 'Bearer ' + token, 'LinkedIn-Version': VERSION, 'X-Restli-Protocol-Version': '2.0.0', ...extra,
});

function start(ctx: StartContext): Promise<Response> {
  if (!configured()) {
    return Promise.resolve(json({ error: 'LinkedIn is not configured on this project yet. Missing: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET.' }, 503));
  }
  const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', ctx.redirectUri);
  u.searchParams.set('state', ctx.state);
  u.searchParams.set('scope', SCOPES.join(' '));
  return Promise.resolve(json({ url: u.toString(), platform: 'linkedin', redirectUri: ctx.redirectUri, scopes: SCOPES, pages: PAGES }));
}

async function callback(code: string, claims: Record<string, unknown>, redirectUri: string): Promise<Response> {
  if (!configured()) return backToPortal('linkedin', 'error', 'LinkedIn is not configured on this project.');
  const tok = await tokenRequest(TOKEN_URL, {
    grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
  });
  if (typeof tok === 'string') return backToPortal('linkedin', 'error', 'LinkedIn would not issue a token: ' + tok);
  const access = String(tok.access_token);
  const granted = String(tok.scope ?? SCOPES.join(',')).split(/[,\s]+/).filter(Boolean);
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in) || 5184000) * 1000).toISOString();
  const refresh = tok.refresh_token ? String(tok.refresh_token) : null;

  const me = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: 'Bearer ' + access } });
  const mj = await me.json().catch(() => ({}));
  if (!mj?.sub) return backToPortal('linkedin', 'error', 'LinkedIn did not say who this is. Please try again.');
  const person = { id: 'urn:li:person:' + mj.sub, name: String(mj.name ?? 'LinkedIn profile') };

  /* The token travels with each held account, with its expiry and refresh, so
     whichever is chosen is saved whole. */
  const bundle = JSON.stringify({ access, refresh, expiresAt });

  if (PAGES && granted.includes('w_organization_social')) {
    const acl = await fetch(REST + '/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED', { headers: rest(access) });
    const aj = acl.ok ? await acl.json().catch(() => ({})) : {};
    const orgUrns = ((aj?.elements ?? []) as Array<{ organization?: string }>).map((e) => String(e.organization ?? '')).filter(Boolean);
    const accounts: PickedAccount[] = [{ ...person, kind: 'profile' }];
    for (const urn of orgUrns.slice(0, 25)) {
      const id = urn.split(':').pop() ?? '';
      const o = await fetch(REST + '/organizations/' + encodeURIComponent(id), { headers: rest(access) });
      const oj = o.ok ? await o.json().catch(() => ({})) : {};
      accounts.push({ id: urn, name: String(oj?.localizedName ?? 'Company page ' + id), kind: 'page' });
    }
    if (accounts.length > 1) {
      const tokens: Record<string, string> = {};
      for (const a of accounts) tokens[a.id] = bundle;
      const pick = await holdForChoice('linkedin', String(claims.agency_id), String(claims.profile_id), accounts, tokens, granted);
      if (!pick) return backToPortal('linkedin', 'error', 'LinkedIn shared your pages, but Synapse could not hold them while you choose. Please try again.');
      return backToPortal('linkedin', 'choose', pick);
    }
  }

  const saved = await saveAccount({
    agencyId: String(claims.agency_id), platform: 'linkedin', accountId: person.id, username: person.name,
    accessToken: access, refreshToken: refresh, expiresAt, scopes: granted, connectedBy: String(claims.profile_id),
    authSource: 'linkedin_oauth2',
  });
  if (saved.error) return backToPortal('linkedin', 'error', 'LinkedIn connected, but the account could not be saved: ' + saved.error);
  return backToPortal('linkedin', 'linkedin', person.name);
}

async function connectPicked(agencyId: string, profileId: string, chosen: PickedAccount[], tokens: Record<string, string>,
  scopes: string[]): Promise<{ connected: string[]; problems: string[] }> {
  const connected: string[] = [];
  const problems: string[] = [];
  for (const a of chosen) {
    let t: { access?: string; refresh?: string | null; expiresAt?: string } = {};
    try { t = JSON.parse(tokens[a.id] ?? '{}'); } catch { /* reported below */ }
    if (!t.access) { problems.push(a.name + ': no token came back for it'); continue; }
    const saved = await saveAccount({ agencyId, platform: 'linkedin', accountId: a.id, username: a.name, accessToken: t.access,
      refreshToken: t.refresh ?? null, expiresAt: t.expiresAt ?? null, scopes, connectedBy: profileId, authSource: 'linkedin_oauth2' });
    if (saved.error) problems.push(a.name + ': ' + saved.error);
    else connected.push(a.name);
  }
  return { connected, problems };
}

/* LinkedIn's "little text": these characters are markup and must be escaped,
   or a bracket in a listing title silently cuts the post short. */
function littleText(s: string): string {
  return s.replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => '\\' + c).slice(0, 3000);
}

async function liError(res: Response): Promise<{ message: string; permanent: boolean }> {
  const j = await res.json().catch(() => ({}));
  return { message: String(j?.message ?? j?.error_description ?? ('HTTP ' + res.status)).slice(0, 300),
    permanent: res.status !== 429 && res.status < 500 };
}

async function publish(post: QueuedPost, conn: Connection): Promise<PublishResult> {
  const payload: Record<string, unknown> = { ...buildPayload(post), account: conn.username, author: conn.platformAccountId };
  const media = post.media_urls ?? [];
  const photos = media.filter((u) => !isVideoUrl(u)).slice(0, 20);
  if (media.length && !photos.length) {
    return fail('linkedin', 'Synapse cannot post a video to LinkedIn yet. Add photos to the listing, or untick LinkedIn.', payload, true);
  }

  try {
    const images: string[] = [];
    for (const url of photos) {
      const file = await fetchMedia(url, 8 * 1024 * 1024);
      if (typeof file === 'string') return fail('linkedin', file, payload, true);
      const init = await fetch(REST + '/images?action=initializeUpload', {
        method: 'POST', headers: rest(conn.token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ initializeUploadRequest: { owner: conn.platformAccountId } }),
      });
      if (!init.ok) {
        const e = await liError(init);
        if (init.status === 401) await markAccountError(conn, 'LinkedIn says this permission has ended. Connect it again.');
        return fail('linkedin', 'LinkedIn would not take a photo: ' + e.message, payload, e.permanent);
      }
      const ij = await init.json().catch(() => ({}));
      const uploadUrl = ij?.value?.uploadUrl;
      const image = ij?.value?.image;
      if (!uploadUrl || !image) return fail('linkedin', 'LinkedIn did not say where to upload a photo.', payload);
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { Authorization: 'Bearer ' + conn.token }, body: file.bytes });
      if (!put.ok) return fail('linkedin', 'LinkedIn did not accept a photo (HTTP ' + put.status + ').', payload, put.status < 500 && put.status !== 429);
      images.push(String(image));
    }
    payload.images = images;

    const content = images.length === 1
      ? { media: { id: images[0] } }
      : images.length > 1 ? { multiImage: { images: images.map((id) => ({ id })) } } : undefined;
    const res = await fetch(REST + '/posts', {
      method: 'POST', headers: rest(conn.token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        author: conn.platformAccountId,
        commentary: littleText(post.caption ?? ''),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
      }),
    });
    if (!res.ok) {
      const e = await liError(res);
      if (res.status === 401) await markAccountError(conn, 'LinkedIn says this permission has ended. Connect it again.');
      return fail('linkedin', 'LinkedIn refused the post: ' + e.message, payload, e.permanent);
    }
    const id = res.headers.get('x-restli-id') ?? '';
    if (!id) return fail('linkedin', 'LinkedIn accepted the post but returned no id.', payload);
    return { ok: true, postId: id, provider: 'linkedin', error: '',
      payload: { ...payload, dispatched: true, live_url: 'https://www.linkedin.com/feed/update/' + id } };
  } catch (err) {
    return fail('linkedin', err instanceof Error ? err.message : String(err), payload);
  }
}

async function refresh(conn: Connection): Promise<string | null> {
  if (!configured()) return null;
  const rt = await refreshTokenOf(conn.accountId);
  if (!rt) return null;   /* no refresh token: LinkedIn has not granted programmatic refresh */
  const tok = await tokenRequest(TOKEN_URL, { grant_type: 'refresh_token', refresh_token: rt, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
  if (typeof tok === 'string') { console.error('social-linkedin: refresh failed for ' + conn.accountId + ': ' + tok); return null; }
  await saveTokens(conn.accountId, String(tok.access_token), tok.refresh_token ? String(tok.refresh_token) : null, Number(tok.expires_in) || 5184000);
  return String(tok.access_token);
}

/* Engagement on company-page posts only: reading a PROFILE post's numbers
   needs a permission LinkedIn reserves for its partners. */
async function sweep(limit: number): Promise<Record<string, unknown>> {
  const due = (await postsToSweep('linkedin', limit)).filter((d) => d.conn.platformAccountId.startsWith('urn:li:organization:'));
  let updated = 0;
  let filed = 0;
  for (const { post, conn } of due) {
    const urn = encodeURIComponent(post.platform_post_id);
    const s = await fetch(REST + '/socialActions/' + urn, { headers: rest(conn.token) });
    if (!s.ok) { console.error('social-linkedin: socialActions ' + s.status + ' for ' + post.id); continue; }
    const sj = await s.json().catch(() => ({}));
    const comments = sj?.commentsSummary?.aggregatedTotalComments ?? sj?.commentsSummary?.totalFirstLevelComments ?? null;
    await writeMetrics(post.id, { likes: sj?.likesSummary?.totalLikes ?? null, comments, shares: null });
    updated++;
    if (Number(comments) > 0) {
      const c = await fetch(REST + '/socialActions/' + urn + '/comments?count=50', { headers: rest(conn.token) });
      const cj = c.ok ? await c.json().catch(() => ({})) : {};
      // deno-lint-ignore no-explicit-any
      filed += await fileComments(post, ((cj?.elements ?? []) as Array<Record<string, any>>).map((e) => ({
        id: String(e?.commentUrn ?? e?.$URN ?? e?.id ?? ''), author: null,
        body: e?.message?.text ?? null, at: e?.created?.time ? new Date(Number(e.created.time)).toISOString() : null,
      })));
    }
  }
  return { looked_at: due.length, updated, comments_filed: filed };
}

platformFunction({
  platform: 'linkedin',
  status: () => ({ ready: configured(), pages: PAGES, version: VERSION, media: 'photos (1-20) or text' }),
  start, callback, connectPicked, publish, refresh,
  refreshWithin: 3 * 24 * 3600 * 1000,
  sweep,
});
