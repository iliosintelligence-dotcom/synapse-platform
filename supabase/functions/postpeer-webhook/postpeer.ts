/**
 * PostPeer (postpeer.dev): the switches, the API call, and the webhook signature. Read 2026-11-13 from
 * https://api.postpeer.dev/docs/openapi.json and https://www.postpeer.dev/docs/webhooks.
 *
 * Agencies connect Instagram, TikTok and YouTube through PostPeer's already-approved apps; PostPeer holds the login and
 * we hold its integration id (social_accounts.auth_source = 'postpeer', platform_account_id = integration id).
 *
 * WHY THIS FILE LIVES HERE AND NOT IN _shared/. A change under _shared/ redeploys every function. It is imported by
 * social-connect, social-publish, post-metrics and tiktok-creator-info; a change to it alone redeploys only
 * postpeer-webhook, so touch the importers in the same change when they need the new code.
 *
 * THE SWITCHES, all Edge Function secrets, all empty by default -- empty means nothing here runs:
 *   POSTPEER_API_KEY         the project's key (x-access-key). Never leaves the server.
 *   POSTPEER_PLATFORMS       which platforms go through PostPeer, e.g. "instagram,tiktok,youtube".
 *   POSTPEER_AGENCIES        which agencies: a comma list of agency ids, or "all".
 *   POSTPEER_WEBHOOK_SECRET  the signing secret PostPeer returned when the webhook subscription was created.
 * Connecting needs all of the first three. Publishing on an already-connected PostPeer account needs the key and the
 * platform in POSTPEER_PLATFORMS -- so removing a platform from that list pauses its PostPeer posts at once.
 */

export const PP_API = 'https://api.postpeer.dev/v1';

const csv = (v: string | undefined): string[] =>
  (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function ppKey(): string {
  return (Deno.env.get('POSTPEER_API_KEY') ?? '').trim();
}

/** Platforms (our names) PostPeer is switched on for. */
export function ppPlatforms(): Set<string> {
  return new Set(csv(Deno.env.get('POSTPEER_PLATFORMS')));
}

/** Whether new connections for this agency and platform go through PostPeer. */
export function ppConnectFor(agencyId: string, platform: string): boolean {
  if (!ppKey() || !ppPlatforms().has(platform.toLowerCase())) return false;
  const agencies = csv(Deno.env.get('POSTPEER_AGENCIES'));
  return agencies.includes('all') || agencies.includes(String(agencyId).toLowerCase());
}

/** Whether posts on an already-connected PostPeer account may go out. */
export function ppPublishOn(platform: string): boolean {
  return Boolean(ppKey()) && ppPlatforms().has(platform.toLowerCase());
}

/** Our platform name -> PostPeer's. Only X differs. */
export const PP_NAME: Record<string, string> = {
  instagram: 'instagram', facebook: 'facebook', tiktok: 'tiktok', youtube: 'youtube',
  x: 'twitter', linkedin: 'linkedin', threads: 'threads', pinterest: 'pinterest',
};

export type PpResult = { status: number; body: Record<string, unknown> };

/** One PostPeer API call. Never throws: a network failure comes back as status 0. */
export async function pp(path: string, init: RequestInit = {}, timeoutMs = 25000): Promise<PpResult> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(PP_API + path, {
      ...init,
      signal: ctl.signal,
      /* Content-Type only with a body: PostPeer refuses a bodiless DELETE that claims to carry JSON (HTTP 400). */
      headers: {
        'x-access-key': ppKey(),
        ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body: (body && typeof body === 'object') ? body as Record<string, unknown> : {} };
  } catch (e) {
    return { status: 0, body: { error: e instanceof Error ? e.message : 'network error' } };
  } finally {
    clearTimeout(t);
  }
}

/** PostPeer's own words for a failed call, short enough for a card. */
export function ppError(r: PpResult): string {
  const b = r.body as Record<string, any>;
  const said = b?.error?.message ?? b?.error ?? b?.message ?? '';
  return (typeof said === 'string' && said ? said : 'HTTP ' + r.status).slice(0, 300);
}

/** image or video, from the file name -- the same test social-publish uses (isVideoUrl). PostPeer needs it stated. */
export function mediaTypeOf(url: string): 'image' | 'video' {
  return /\.(mp4|mov|m4v|qt)$/i.test(String(url || '').split('#')[0].split('?')[0]) ? 'video' : 'image';
}

const enc = new TextEncoder();

/** PostPeer's webhook signature: hex HMAC-SHA256 of "<timestamp>.<raw body>", sent as "sha256=<hex>". Constant-time
 *  comparison, and a timestamp more than five minutes from now is refused (replay). */
export async function ppSignatureOk(
  secret: string, timestamp: string | null, raw: string, received: string | null, nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!secret || !timestamp || !received) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(timestamp + '.' + raw)));
  const expected = 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

/** The PostPeer return address social-connect gave as redirectUri: the state in the PATH (/postpeer-done/<state>,
 *  /postpeer-cancel/<state>) so PostPeer's own query parameters can never corrupt it; or, for a link issued before
 *  2026-11-13, the query (?action=postpeer-done&state=...), cut at the first character a state never has, in case a
 *  "?" was appended into it. Null when the URL is not a PostPeer return. */
export function postPeerReturn(url: URL): { state: string; cancelled: boolean } | null {
  const m = url.pathname.match(/\/postpeer-(done|cancel)\/([A-Za-z0-9_.-]+)\/?$/);
  if (m) return { state: m[2], cancelled: m[1] === 'cancel' };
  if (url.searchParams.get('action') === 'postpeer-done') {
    const raw = (url.searchParams.get('state') ?? '').split(/[^A-Za-z0-9_.-]/)[0];
    return { state: raw, cancelled: Boolean(url.searchParams.get('cancelled')) };
  }
  return null;
}

/* ── X and LinkedIn (2026-11-13) ─────────────────────────────────────────── */

/** Whose account a post goes out on (social-publish's onSynapseAccount). A Synapse-leg post: Synapse's. A platform in
 *  `synapseOnly` (X): Synapse's -- unless the agency has its own account on it connected, then the agency's. */
export function goesOnSynapseAccount(
  leg: string, platform: string, cityChannelId: string | null, agencyHasOwn: boolean, synapseOnly: Set<string>,
): boolean {
  if (leg === 'synapse') return true;
  if (!synapseOnly.has(platform) || cityChannelId) return false;
  return !agencyHasOwn;
}

/** LinkedIn takes 3,000 characters. A longer caption is cut at a word, and the listing link is kept whole at the end. */
export function fitForLinkedIn(caption: string, max = 3000): string {
  const text = (caption ?? '').trim();
  if (text.length <= max) return text;
  const link = (text.match(/https?:\/\/[^\s]+/g) ?? []).find((u) => /synapsecore\.dev\/s\//.test(u)) ?? '';
  const body = link ? text.split(link).join(' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : text;
  const room = max - (link ? link.length + 2 : 0) - 1;
  let cut = body.slice(0, room);
  const space = cut.lastIndexOf(' ');
  if (space > room * 0.8) cut = cut.slice(0, space);
  return (cut.trim() + '…' + (link ? '\n\n' + link : '')).trim();
}

/* ── views and likes: when a PostPeer post is asked about ──────────────────
   Posting costs 1 credit; every stats read costs 1 more. So a post is read only at the days in POSTPEER_STATS_DAYS
   after it went live -- default "7": one read, 2 credits per post in all. "1,3,7,30" reads four times; "none" never
   (views and likes then stay empty for PostPeer posts). Each day is read once: the post is due when the latest day it
   has reached is later than its last read. Nothing after 60 days. A secret, so it changes without a deploy. */
const DAY_MS = 864e5;

export function statsDays(): number[] {
  const raw = (Deno.env.get('POSTPEER_STATS_DAYS') ?? '7').trim().toLowerCase();
  if (raw === 'none' || raw === '0') return [];
  const days = raw.split(',').map((s) => Number(s.trim())).filter((d) => Number.isFinite(d) && d >= 1 && d <= 60);
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : [7];
}

export function statsDue(publishedAt: string | null, metricsAt: string | null, now = Date.now(), days = statsDays()): boolean {
  const pub = Date.parse(publishedAt ?? '');
  if (!Number.isFinite(pub)) return false;
  const age = now - pub;
  if (age > 60 * DAY_MS) return false;
  const reached = days.filter((d) => age >= d * DAY_MS);
  if (!reached.length) return false;
  const point = pub + reached[reached.length - 1] * DAY_MS;
  const read = metricsAt ? Date.parse(metricsAt) : NaN;
  return !Number.isFinite(read) || read < point;
}

export type CleanupVerdict ={ done: boolean; outcome: string | null; error: string | null };

/** What removing a disconnected account at PostPeer came to (post-metrics, action postpeer-cleanup). Connected again
 *  here: left alone. Removed, or already gone: done. Anything else: try again later, with the reason. */
export function cleanupVerdict(stillConnectedHere: boolean, status: number | null, said: string): CleanupVerdict {
  if (stillConnectedHere) return { done: true, outcome: 'kept: connected again here', error: null };
  if (status === 200 || status === 204) return { done: true, outcome: 'removed at PostPeer', error: null };
  if (status === 404) return { done: true, outcome: 'already gone at PostPeer', error: null };
  return { done: false, outcome: null, error: (status ? 'HTTP ' + status + ': ' : '') + said };
}

/** What one PostPeer platform result means for our row: live, failed, or still going. */
export function deliveryOf(status: string): 'live' | 'failed' | 'pending' {
  const s = String(status ?? '').toLowerCase();
  if (s === 'published') return 'live';
  if (s === 'failed') return 'failed';
  return 'pending';
}
