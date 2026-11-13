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
      headers: { 'x-access-key': ppKey(), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
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

/** What one PostPeer platform result means for our row: live, failed, or still going. */
export function deliveryOf(status: string): 'live' | 'failed' | 'pending' {
  const s = String(status ?? '').toLowerCase();
  if (s === 'published') return 'live';
  if (s === 'failed') return 'failed';
  return 'pending';
}
