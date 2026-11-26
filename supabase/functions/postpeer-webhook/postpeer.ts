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

/* ── Synapse Studio (2026-11-18) ──────────────────────────────────────────── */

/** Platforms the studio connects through PostPeer. Facebook (our own Page login) and Telegram (our bot) stay as they were. */
export const STUDIO_PP_PLATFORMS = ['instagram', 'tiktok', 'youtube', 'x', 'linkedin'];

/** Whether the studio offers a platform: only one the agency studio offers too (`agencyReady`, social-connect's status),
 *  and only while posting to it through PostPeer is switched on (`publishOn`, ppPublishOn). */
export function studioCanConnect(platform: string, agencyReady: boolean, publishOn: boolean): boolean {
  return STUDIO_PP_PLATFORMS.includes(platform) && agencyReady && publishOn;
}

/** One studio post as PostPeer's request, or why it cannot go. The caption arrives already fitted for X; LinkedIn is
 *  fitted here. TikTok posts directly (2026-11-18: "for tiktok, it is meant to post directly"): public, with comments,
 *  duets and stitches on, and no branded-content declaration -- Synapse posting its own listings. Same media rules as
 *  social-publish's PostPeer adapter. */
export function studioPostBody(
  platform: string, caption: string, mediaIn: string[], accountId: string, postId: string,
): { body: Record<string, unknown> } | { error: string } {
  let media = mediaIn.slice();
  const content = platform === 'linkedin' ? fitForLinkedIn(caption) : caption;
  let specific: Record<string, unknown> = {};
  if (platform === 'tiktok') {
    if (!media.length) return { error: 'TikTok needs a photo or video.' };
    specific = {
      privacyLevel: 'PUBLIC_TO_EVERYONE', disableComment: false, disableDuet: false, disableStitch: false,
      brandContentToggle: false, brandOrganicToggle: false, draft: false,
    };
  } else if (platform === 'youtube') {
    const vid = media.find((u) => mediaTypeOf(u) === 'video');
    if (!vid) return { error: 'YouTube takes video only. Add a video, or leave YouTube off this post.' };
    media = [vid];
    const title = content.split('\n').map((l) => l.trim()).find((l) => l && !/^https?:\/\//i.test(l)) ?? '';
    specific = { title: title.replace(/[<>]/g, '').slice(0, 100).trim() || 'New listing', visibility: 'public' };
  } else if (platform === 'instagram') {
    if (!media.length) return { error: 'Instagram needs at least one photo or video.' };
    media = media.slice(0, 10);
  } else if (platform === 'x' || platform === 'linkedin') {
    const vids = media.filter((u) => mediaTypeOf(u) === 'video');
    media = vids.length ? vids.slice(0, 1) : media.slice(0, platform === 'x' ? 4 : 9);
    if (platform === 'linkedin') specific = { visibility: 'PUBLIC' };
  } else {
    return { error: 'The studio does not post to ' + platform + ' through PostPeer.' };
  }
  return {
    body: {
      content,
      mediaItems: media.map((url) => ({ type: mediaTypeOf(url), url })),
      platforms: [{ platform: PP_NAME[platform] ?? platform, accountId, ...(Object.keys(specific).length ? { platformSpecificData: specific } : {}) }],
      publishNow: true,
      /* A retry after a lost reply gets PostPeer's first answer back, never a second post. */
      idempotencyKey: 'synapse-studio-' + postId,
    },
  };
}

/* ── media every platform accepts (2026-11-26) ─────────────────────────────
   Read from the posts PostPeer refused in November: "Facebook does not allow mixing video and images in one post",
   "TikTok posts cannot mix video and image media items", "The aspect ratio is not supported" (Instagram), "Daily
   YouTube upload limit reached (5 per day). Resets at midnight Pacific." A listing's gallery is photos and videos
   together, and phone photos are tall, so each of these is the ordinary case, not an edge case. */

/** Facebook and TikTok take one kind of media per post: the first video alone when there is one, else the photos. */
export function oneKindOfMedia(platform: string, media: string[]): string[] {
  if (platform !== 'facebook' && platform !== 'tiktok') return media;
  const vids = media.filter((u) => mediaTypeOf(u) === 'video');
  return vids.length ? vids.slice(0, 1) : media;
}

/** Instagram feed photos must be between 4:5 (0.8) and 1.91:1. The largest crop inside a photo that is, or null when
 *  the photo already is. Rounded inwards, so the result is never just outside the range. */
export function igCropSize(w: number, h: number): { width: number; height: number } | null {
  if (!(w > 0 && h > 0)) return null;
  const r = w / h;
  if (r >= 0.8 && r <= 1.91) return null;
  return r < 0.8 ? { width: w, height: Math.floor(w / 0.8) } : { width: Math.floor(h * 1.91), height: h };
}

/** A public Supabase Storage URL, cropped by Storage's own image renderer. Null for any other host. The crop must fit
 *  inside the photo: the renderer never enlarges, and asked to, it returns the photo unchanged. format=origin keeps
 *  it a JPEG; without it a WebP can come back, which Instagram refuses. */
export function storageCropUrl(url: string, size: { width: number; height: number }): string | null {
  const m = String(url || '').match(/^(https:\/\/[^/]+)\/storage\/v1\/object\/public\/([^?#]+)/);
  if (!m) return null;
  return m[1] + '/storage/v1/render/image/public/' + m[2]
    + '?width=' + size.width + '&height=' + size.height + '&resize=cover&quality=90&format=origin';
}

/** Width and height from the first bytes of a JPEG, PNG or WebP. Null when it cannot tell. */
export function imageSizeFromBytes(d: Uint8Array): { w: number; h: number } | null {
  const u16 = (i: number) => (d[i] << 8) | d[i + 1];
  const u32 = (i: number) => ((d[i] << 24) >>> 0) + (d[i + 1] << 16) + (d[i + 2] << 8) + d[i + 3];
  if (d.length > 24 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return { w: u32(16), h: u32(20) };
  if (d.length > 30 && d[0] === 0x52 && d[1] === 0x49 && d[8] === 0x57 && d[9] === 0x45) {
    const kind = String.fromCharCode(d[12], d[13], d[14], d[15]);
    if (kind === 'VP8 ') return { w: (d[26] | (d[27] << 8)) & 0x3fff, h: (d[28] | (d[29] << 8)) & 0x3fff };
    if (kind === 'VP8L') {
      const b = d[21] | (d[22] << 8) | (d[23] << 16) | (d[24] << 24);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { w: 1 + (d[24] | (d[25] << 8) | (d[26] << 16)), h: 1 + (d[27] | (d[28] << 8) | (d[29] << 16)) };
    return null;
  }
  if (d[0] !== 0xff || d[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < d.length) {
    if (d[i] !== 0xff) { i++; continue; }
    const m = d[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) };
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    i += 2 + u16(i + 2);
  }
  return null;
}

/** Each Instagram feed photo made a shape Instagram takes. A photo whose size cannot be read, or that is not in
 *  Supabase Storage, is sent as it was -- never dropped. Videos are left alone. */
export async function instagramSafeMedia(media: string[], fetcher: typeof fetch = fetch): Promise<string[]> {
  return await Promise.all(media.map(async (url) => {
    if (mediaTypeOf(url) !== 'image') return url;
    try {
      const r = await fetcher(url, { headers: { Range: 'bytes=0-131071' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok && r.status !== 206) return url;
      const size = imageSizeFromBytes(new Uint8Array(await r.arrayBuffer()));
      const crop = size ? igCropSize(size.w, size.h) : null;
      return (crop && storageCropUrl(url, crop)) || url;
    } catch {
      return url;
    }
  }));
}

/** YouTube takes 5 uploads per channel per day, and the day ends at midnight Pacific. */
export const YOUTUBE_DAILY_UPLOADS = 5;

/** The start of the Pacific day `now` is in, and of the next one, as UTC instants. */
export function pacificDay(now = new Date()): { start: Date; next: Date } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'shortOffset',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const off = /GMT([+-]\d+)(?::(\d+))?/.exec(parts.timeZoneName ?? '');
  const offMin = off ? Number(off[1]) * 60 + Math.sign(Number(off[1])) * Number(off[2] ?? 0) : -480;
  const startUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - offMin * 60000;
  return { start: new Date(startUtc), next: new Date(startUtc + 864e5) };
}

/** Whether a PostPeer refusal is YouTube's daily cap (or Google's upload quota): wait for tomorrow, do not fail. */
export function isDailyUploadLimit(message: string): boolean {
  return /daily youtube upload limit|quota metric 'video uploads'|uploadlimitexceeded/i.test(String(message ?? ''));
}
