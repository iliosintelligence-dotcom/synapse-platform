/**
 * The shared half of every social platform function.
 *
 * WHY ONE CORE AND SEVEN FUNCTIONS (2026-11-05)
 * Every platform goes through the same process -- connect, token in Vault,
 * account row, queue, claim, publish, retry, metrics and comments -- and
 * differs in four places only: how it is connected (OAuth or, for Telegram, a
 * bot), how a post is sent, how a token is renewed, and how engagement is
 * read back. Those four live in social-<platform>/index.ts. Everything else
 * lives here, once, so a fix to the process is a fix for every platform.
 *
 * THE CONTRACT every social-<platform> function answers (platformFunction()):
 *   GET  ?action=status                 anyone       is this platform configured
 *   GET  ?action=start[&for=studio]     a member     -> { url } to send them to
 *   GET  ?code=..&state=..              the platform the OAuth callback
 *   GET  ?action=pick&pick=..           the member   the accounts held while they choose
 *   POST ?action=pick {pick, ids}       the member   connect the ones ticked
 *   POST {action:'publish', post_id}    service role publish ONE claimed post and settle it
 *   POST {action:'refresh', account_id} service role renew one token
 *   POST {action:'sweep', limit}        service role read metrics and comments back
 *
 * The publish leg SETTLES THE ROW ITSELF (settle()). social-publish claims and
 * dispatches; it does not write outcomes. So an outcome is saved even if the
 * dispatcher stopped waiting, and a post is never left half-recorded because
 * the HTTP reply between two functions was lost.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
export const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
export const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
export const SITE = 'https://www.synapsecore.dev';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// deno-lint-ignore no-explicit-any
export type Admin = SupabaseClient<any, 'public', any>;
let adminClient: Admin | null = null;
export function admin(): Admin {
  if (!adminClient) adminClient = createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false } });
  return adminClient;
}

/* ── types ──────────────────────────────────────────────────────────────── */

export interface QueuedPost {
  id: string;
  agency_id: string;
  property_id: string | null;
  platform: string;
  caption: string | null;
  media_urls: string[];
  attempts: number;
  max_attempts: number;
  dry_run: boolean;
  status: string;
  /* 'agency' (the agency's own account) or 'synapse' (a channel we own). */
  leg: string;
  social_account_id: string | null;
  post_format?: string | null;
  city_channel_id?: string | null;
}

/** Which account a post goes out on, and the credential for it. */
export interface Connection {
  /** social_accounts.id, or city_channels.id for a Synapse channel. */
  accountId: string;
  kind: 'agency' | 'city';
  /** The id the platform addresses: IG user, Page, chat, X user, channel, org URN. */
  platformAccountId: string;
  username: string;
  token: string;
  authSource: string;
  expiresAt: string | null;
}

export interface PublishResult {
  ok: boolean;
  postId: string | null;
  provider: string;
  error: string;
  /** Exactly what was, or would have been, sent. Stored either way. */
  payload: Record<string, unknown>;
  /** The platform said the post itself is wrong (bad media, no permission,
   *  not supported). Retrying will not change that, so it fails at once
   *  instead of three times over half an hour. */
  permanent?: boolean;
}

/** What each platform function supplies. Only `publish` is required. */
export interface PlatformSpec {
  platform: string;
  /** Booleans about configuration, never values. */
  status: () => Record<string, unknown>;
  /** Build the dialog URL. Absent for a platform with no OAuth (Telegram). */
  start?: (ctx: StartContext) => Promise<Response>;
  /** Exchange the code and save the account(s). */
  callback?: (code: string, claims: Record<string, unknown>, redirectUri: string) => Promise<Response>;
  /** Connect the accounts a member ticked from a held pick (LinkedIn pages). */
  connectPicked?: (agencyId: string, profileId: string, chosen: PickedAccount[], tokens: Record<string, string>,
    scopes: string[]) => Promise<{ connected: string[]; problems: string[] }>;
  /** Send one post. The connection has already been resolved and refreshed. */
  publish: (post: QueuedPost, conn: Connection) => Promise<PublishResult>;
  /** Renew a token that is about to end. Returns the new access token, or null. */
  refresh?: (conn: Connection) => Promise<string | null>;
  /** How close to expiry a token is renewed, in ms. */
  refreshWithin?: number;
  /** Read engagement and comments back for recent published posts. */
  sweep?: (limit: number) => Promise<Record<string, unknown>>;
  /** Whether Synapse staff may connect Synapse's own account here (?for=studio). Off by default. */
  studio?: boolean;
  /** Anything else this platform answers (Telegram's story kit, TikTok's check). */
  extra?: (req: Request, url: URL, action: string) => Promise<Response | null>;
  /** Runs after a post is published and saved. Must never throw into the publish. */
  afterPublish?: (post: QueuedPost, conn: Connection, result: PublishResult) => Promise<void>;
}

export interface StartContext {
  req: Request;
  url: URL;
  redirectUri: string;
  /** Signed state carrying who, for which agency (or the studio), and this platform. */
  state: string;
  /** The PKCE challenge for this attempt, when the platform asked for one. */
  pkceChallenge: string | null;
  studio: boolean;
}

export interface PickedAccount { id: string; name: string; [k: string]: unknown }

/* ── who is calling ─────────────────────────────────────────────────────── */

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function bearer(req: Request): string {
  const h = req.headers.get('Authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

/** The platform itself (pg_cron, social-publish): the bearer IS the service key. */
export function isServiceCall(req: Request): boolean {
  const t = bearer(req);
  return !!SERVICE_KEY && !!t && sameString(t, SERVICE_KEY);
}

export const MEMBER_ROLES = ['agent', 'agency_admin', 'agency_owner'];

/** A signed-in member of an agency, and which agency. Same rule as social-connect. */
export async function memberCaller(req: Request): Promise<{ userId: string; agencyId: string } | Response> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth) return json({ error: 'Not authenticated' }, 401);
  const asUser = createClient(SB_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'Not authenticated' }, 401);
  const { data: m } = await admin().from('agency_members').select('agency_id, role')
    .eq('profile_id', user.id).is('deleted_at', null).limit(1).maybeSingle();
  if (!m) return json({ error: 'You are not a member of an agency' }, 403);
  if (!MEMBER_ROLES.includes(String(m.role))) return json({ error: 'Only a member of this agency can connect an account' }, 403);
  return { userId: user.id, agencyId: String(m.agency_id) };
}

/** A signed-in Synapse staff member (the studio). */
export async function staffCaller(req: Request): Promise<{ userId: string } | Response> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth) return json({ error: 'Not authenticated' }, 401);
  const asUser = createClient(SB_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'Not authenticated' }, 401);
  const { data: role } = await asUser.rpc('synapse_staff_role');
  if (!role) return json({ error: 'Only Synapse staff can do this' }, 403);
  return { userId: user.id };
}

/* ── signed state ───────────────────────────────────────────────────────────
   The callback arrives with no session: whatever it says about which agency
   is the only claim available, so it has to be one we signed. Same scheme as
   social-connect, with its own prefix so a state minted for one function can
   never be replayed at another. */

export const STATE_TTL_MS = 15 * 60 * 1000;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function stateKey(platform: string): Promise<CryptoKey> {
  const material = new TextEncoder().encode('synapse.social-' + platform + '.state.v1:' + SERVICE_KEY);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signState(platform: string, payload: Record<string, unknown>): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await stateKey(platform), new TextEncoder().encode(body));
  return body + '.' + b64url(new Uint8Array(sig));
}

export async function readState(platform: string, state: string): Promise<Record<string, unknown> | null> {
  const dot = state.lastIndexOf('.');
  if (dot < 1) return null;
  const body = state.slice(0, dot);
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await stateKey(platform), unb64url(state.slice(dot + 1)),
      new TextEncoder().encode(body));
  } catch { ok = false; }
  if (!ok) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return null;
    if (parsed.platform !== platform) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ── PKCE ───────────────────────────────────────────────────────────────────
   X requires it; Google and LinkedIn accept it. The verifier must survive the
   round trip and must NOT travel in the state (the state is readable, only
   signed). So it is kept server-side for fifteen minutes, keyed on the
   state's nonce, and taken exactly once. */

export async function newPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

export async function keepVerifier(nonce: string, platform: string, verifier: string): Promise<void> {
  const { error } = await admin().rpc('stash_oauth_verifier', { p_nonce: nonce, p_platform: platform, p_verifier: verifier });
  if (error) throw new Error('Could not start the connection: ' + error.message);
}

export async function takeVerifier(nonce: string, platform: string): Promise<string | null> {
  const { data } = await admin().rpc('take_oauth_verifier', { p_nonce: nonce, p_platform: platform });
  return typeof data === 'string' && data ? data : null;
}

/* ── the redirect ───────────────────────────────────────────────────────────
   OAuth sends the browser back to redirect_uri, and the only endpoint that
   can use the code is this function. So the redirect is this function's own
   https address -- derived, never configured (social-connect lost two weeks
   to a configured value that pointed somewhere else). The scheme is asserted
   because TLS ends at Supabase's gateway and the request reads as http. */
export function redirectUriFor(url: URL, platform: string): string {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(url.host);
  return (local ? 'http://' : 'https://') + url.host + '/functions/v1/social-' + platform;
}

/** Back to the portal (or the studio) with a plain outcome, and a written
 *  record of anything that went wrong (social_connect_failures). */
export async function backToPortal(
  platform: string,
  status: string,
  detail?: string,
  extra?: { reason?: string; facts?: Record<string, unknown>; studio?: boolean },
): Promise<Response> {
  if (status === 'error') console.error('social-' + platform + ' connect failed: ' + (detail ?? ''));
  else console.log('social-' + platform + ' ' + status + ': ' + (detail ?? ''));
  if (status === 'error' || status === 'cancelled') {
    const write = admin().from('social_connect_failures').insert({
      status,
      detail: ('[' + platform + '] ' + (detail ?? '')).slice(0, 1000),
      ...(extra?.facts ? { facts: { platform, ...extra.facts } } : {}),
    }).then(() => null, () => null);
    await Promise.race([write, new Promise((r) => setTimeout(r, 1500))]);
  }
  const base = extra?.studio
    ? (Deno.env.get('STUDIO_URL') || SITE + '/app/synapse.html')
    : (Deno.env.get('PORTAL_URL') || SITE + '/app/agency.html');
  const u = new URL(base);
  u.searchParams.set('connected', status);
  u.searchParams.set('platform', platform);
  if (detail) u.searchParams.set('detail', detail.slice(0, 180));
  if (extra?.reason) u.searchParams.set('reason', extra.reason);
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: u.toString() } });
}

/* ── accounts and tokens ────────────────────────────────────────────────── */

export interface SaveAccount {
  agencyId: string;
  platform: string;
  accountId: string;
  username: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  scopes: string[];
  connectedBy: string;
  authSource: string;
}

/** Into Vault through the one definer function built for it. */
export async function saveAccount(a: SaveAccount): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await admin().rpc('connect_social_account', {
    p_agency_id: a.agencyId,
    p_platform: a.platform,
    p_account_id: a.accountId,
    p_username: a.username,
    p_access_token: a.accessToken,
    p_refresh_token: a.refreshToken ?? null,
    p_expires_at: a.expiresAt ?? null,
    p_scopes: a.scopes,
    p_connected_by: a.connectedBy,
    p_auth_source: a.authSource,
  });
  return { id: typeof data === 'string' ? data : null, error: error ? error.message : null };
}

/** Writes a renewed token back, so the stored credential stays the working
 *  one. Retried, because for X the old refresh token is dead the moment the
 *  new one is issued: a lost save means the agency must connect again. A save
 *  that still fails is written on the account, where the portal shows it,
 *  and reported to the caller. */
export async function saveTokens(accountId: string, access: string, refresh: string | null,
  expiresInSec: number | null): Promise<boolean> {
  let last = '';
  for (let i = 0; i < 3; i++) {
    const { error } = await admin().rpc('update_social_account_tokens', {
      p_account_id: accountId,
      p_access_token: access,
      p_refresh_token: refresh,
      p_expires_at: expiresInSec ? new Date(Date.now() + expiresInSec * 1000).toISOString() : null,
    });
    if (!error) return true;
    last = error.message;
    await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }
  console.error('social: renewed token NOT saved for ' + accountId + ': ' + last);
  await admin().from('social_accounts').update({
    last_error: 'A renewed sign-in could not be saved. If posts start failing, connect this account again.',
    updated_at: new Date().toISOString(),
  }).eq('id', accountId).then(() => null, () => null);
  return false;
}

/**
 * One renewal per account at a time. The scheduler, the read-back sweep and
 * several publishing workers can all decide the same token needs renewing;
 * on X the first renewal retires the refresh token the others are holding,
 * and the losers would fail their posts and ask the agency to reconnect.
 *
 * So a renewal takes a short lease on the account first. Whoever does not
 * get it waits for the holder, then reads back the token the holder saved.
 */
export async function refreshGuarded(conn: Connection, renew: (c: Connection) => Promise<string | null>): Promise<string | null> {
  if (conn.kind !== 'agency') return renew(conn);
  const db = admin();
  const { data: got } = await db.rpc('take_token_refresh_lease', { p_account_id: conn.accountId });
  if (got === true) {
    try {
      return await renew(conn);
    } finally {
      await db.rpc('release_token_refresh_lease', { p_account_id: conn.accountId }).then(() => null, () => null);
    }
  }
  /* Somebody else is renewing. Wait for them (at most ~20 s), then use what they saved. */
  const before = conn.expiresAt ? Date.parse(conn.expiresAt) : 0;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data: row } = await db.from('social_accounts').select('token_expires_at, token_refresh_lease')
      .eq('id', conn.accountId).maybeSingle();
    const exp = row?.token_expires_at ? Date.parse(String(row.token_expires_at)) : 0;
    const leased = row?.token_refresh_lease && Date.parse(String(row.token_refresh_lease)) > Date.now();
    if (exp > before || !leased) {
      if (exp <= before) return null;
      const { data: tok } = await db.rpc('social_account_token', { p_account_id: conn.accountId });
      return typeof tok === 'string' && tok ? tok : null;
    }
  }
  return null;
}

export async function refreshTokenOf(accountId: string): Promise<string | null> {
  const { data } = await admin().rpc('social_account_refresh_token', { p_account_id: accountId });
  return typeof data === 'string' && data ? data : null;
}

/** Records a failure on the account so the portal can say "reconnect". */
export async function markAccountError(conn: Connection, message: string): Promise<void> {
  if (conn.kind !== 'agency' || !conn.accountId) return;
  await admin().from('social_accounts').update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('id', conn.accountId).then(() => null, () => null);
}

/**
 * The account a post goes out on. The same rules social-publish has always
 * used, in one place:
 *   - a city-channel post goes to that Synapse channel;
 *   - any other Synapse-leg post goes to Synapse's default channel for the
 *     platform (the oldest active city channel that can take it);
 *   - an agency post goes to the account it named, or the agency's oldest
 *     active account on that platform. A NAMED account that is no longer
 *     connected resolves to nothing -- quietly posting to a different
 *     account is the one outcome nobody asked for.
 */
export async function resolveConnection(post: QueuedPost): Promise<Connection | string> {
  const db = admin();
  if (post.leg === 'synapse') {
    /* Synapse's own channels are a Telegram chat the bot runs or a Facebook
       Page the studio connected. Its own X, YouTube and LinkedIn are not
       connectable yet (TryPost held them until 2026-10-24). */
    if (post.platform !== 'telegram' && post.platform !== 'facebook') {
      return 'Synapse does not post to ' + post.platform + ' from its own account yet.';
    }
    let q = db.from('city_channels')
      .select('id, platform, chat_id, meta_page_id, handle, title, is_active')
      .eq('platform', post.platform).eq('is_active', true);
    /* Named channel, or the oldest active one that can take the post: for
       Facebook that is a Page the studio connected (it has a meta_page_id). */
    if (post.city_channel_id) q = q.eq('id', post.city_channel_id);
    else {
      if (post.platform === 'facebook') q = q.not('meta_page_id', 'is', null);
      else q = q.not('chat_id', 'is', null);
      q = q.order('created_at', { ascending: true }).limit(1);
    }
    const { data } = await q;
    const c = (data ?? [])[0] as Record<string, string> | undefined;
    if (!c) {
      return post.city_channel_id
        ? 'This Synapse channel is switched off or no longer connected.'
        : 'Synapse has no ' + post.platform + ' channel connected. Connect one in the studio.';
    }
    if (post.platform === 'telegram') {
      const bot = (Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '').trim();
      if (!c.chat_id) return 'This Synapse Telegram channel has no chat yet: the bot is not a posting admin of it.';
      if (!bot) return 'The Synapse bot is not configured on the server (TELEGRAM_BOT_TOKEN).';
      return { accountId: c.id, kind: 'city', platformAccountId: String(c.chat_id), username: c.handle || c.title || 'synapse',
        token: bot, authSource: 'telegram_bot', expiresAt: null };
    }
    const { data: tok } = await db.rpc('city_channel_token', { p_id: c.id });
    if (!tok || !c.meta_page_id) return 'Synapse has no Facebook Page connected. Connect one in the studio: Channels, Add a channel, Facebook.';
    return { accountId: c.id, kind: 'city', platformAccountId: String(c.meta_page_id), username: c.handle || c.title || 'synapse',
      token: String(tok), authSource: 'facebook_login', expiresAt: null };
  }

  let q = db.from('social_accounts')
    .select('id, platform_account_id, platform_username, auth_source, token_expires_at')
    .eq('agency_id', post.agency_id).eq('platform', post.platform)
    .eq('is_active', true).is('deleted_at', null);
  q = post.social_account_id ? q.eq('id', post.social_account_id) : q.order('connected_at', { ascending: true }).limit(1);
  const { data } = await q;
  const a = (data ?? [])[0] as Record<string, string> | undefined;
  if (!a) {
    return post.social_account_id
      ? 'The ' + post.platform + ' account this post was meant for is no longer connected. Reconnect it, or choose another account.'
      : 'No ' + post.platform + ' account is connected to this agency. Connect one in the portal, then publish.';
  }
  const { data: tok } = await db.rpc('social_account_token', { p_account_id: a.id });
  if (!tok) return 'The ' + post.platform + ' account is connected but its permission was removed. Connect it again.';
  return { accountId: a.id, kind: 'agency', platformAccountId: a.platform_account_id, username: a.platform_username,
    token: String(tok), authSource: a.auth_source || 'oauth2', expiresAt: a.token_expires_at || null };
}

/* ── media ──────────────────────────────────────────────────────────────── */

/* The same rule the portal applies when it records media_type. Query and
   fragment first: ".mp4?t=1" matches nothing otherwise. */
const VIDEO_EXT = /\.(mp4|mov|m4v|qt)$/i;
export function isVideoUrl(u: string): boolean {
  return VIDEO_EXT.test(String(u || '').split('#')[0].split('?')[0]);
}

export interface MediaRules { min?: number; max: number; mixed: boolean; maxVideos: number; who: string; videoOnly?: boolean; photosOnly?: boolean }

/** '' when the media is acceptable, otherwise a sentence saying what is not. */
export function checkMedia(urls: string[], r: MediaRules): string {
  const min = r.min ?? 1;
  if (urls.length < min) {
    return min === 1 ? r.who + ' needs at least one photo or video, and this post has none.'
      : r.who + ' needs at least ' + min + ' items; this post has ' + urls.length + '.';
  }
  if (urls.length > r.max) return r.who + ' accepts at most ' + r.max + ' items in one post; this has ' + urls.length + '.';
  const bad = urls.find((u) => !/^https:\/\//i.test(u));
  if (bad) return 'Media must be a public https address ' + r.who + ' can fetch. Got: ' + bad.slice(0, 80);
  const videos = urls.filter(isVideoUrl);
  if (r.videoOnly && videos.length !== urls.length) return r.who + ' takes video only. Remove the photos, or untick ' + r.who + '.';
  if (r.photosOnly && videos.length) return r.who + ' cannot take video from Synapse yet. Remove the video, or untick ' + r.who + '.';
  if (videos.length > r.maxVideos) {
    return r.who + ' accepts at most ' + r.maxVideos + ' video' + (r.maxVideos === 1 ? '' : 's') + ' in one post; this has ' + videos.length + '.';
  }
  if (!r.mixed && videos.length > 0 && videos.length !== urls.length) {
    return r.who + ' cannot mix video and photos in one post. Send the video on its own, or the photos on their own.';
  }
  return '';
}

/** Downloads one media file, refusing anything larger than the platform takes. */
export async function fetchMedia(url: string, maxBytes: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string } | string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    return 'Could not download ' + url.slice(0, 80) + ': ' + (e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) return 'Could not download ' + url.slice(0, 80) + ' (HTTP ' + res.status + ').';
  const declared = Number(res.headers.get('content-length') ?? 0);
  const tooBig = (n: number) => 'A file is ' + Math.round(n / 1048576) + ' MB or more, over the '
    + Math.round(maxBytes / 1048576) + ' MB this platform takes.';
  if (declared && declared > maxBytes) {
    await res.body?.cancel();
    return tooBig(declared);
  }
  /* Read in pieces and stop the moment the file passes the limit: a server
     that sends no Content-Length must not be able to fill the function's
     memory with one "photo". */
  const reader = res.body?.getReader();
  if (!reader) return 'Could not download ' + url.slice(0, 80) + ' (empty reply).';
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return tooBig(total);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
  return { bytes, type: (res.headers.get('content-type') ?? '').split(';')[0].trim() };
}

/** The request body a platform would be sent, shared so every rehearsal record has one shape. */
export function buildPayload(post: QueuedPost): Record<string, unknown> {
  return {
    platform: post.platform,
    caption: post.caption ?? '',
    caption_length: (post.caption ?? '').length,
    media: post.media_urls,
    media_count: post.media_urls.length,
    property_id: post.property_id,
  };
}

export function fail(provider: string, error: string, payload: Record<string, unknown>, permanent = false): PublishResult {
  return { ok: false, postId: null, provider, error, payload, permanent };
}

/** The listing's tracked link out of the caption: caption_with_link put it there. */
export function captionLink(caption: string | null): string | null {
  const m = (caption ?? '').match(/https?:\/\/[^\s]+\/s\/[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}

/** Cut a caption to a limit at a word, never mid-word, keeping the tracked link whole. */
export function fitText(text: string, max: number): string {
  const t = (text ?? '').trim();
  if (t.length <= max) return t;
  const link = captionLink(t);
  const body = link ? t.replace(link, ' ').replace(/[ \t]+/g, ' ').trim() : t;
  const tail = link ? '\n\n' + link : '';
  const room = max - tail.length - 1;
  const cut = body.slice(0, Math.max(0, room));
  const space = cut.lastIndexOf(' ');
  return ((space > room * 0.6 ? cut.slice(0, space) : cut).trimEnd().replace(/[,;:\-]+$/, '') + '…' + tail).trim();
}

/* ── the outcome, written once ──────────────────────────────────────────────
   One place decides what a result means for the row:
     ok          published, with the platform's id. Saving is retried, because
                 a lost save is how a post gets sent twice.
     permanent   failed now: the platform said the post itself is wrong.
     otherwise   back in the queue at 1, 5, then 25 minutes; failed after the
                 last attempt. */
export async function settle(post: QueuedPost, result: PublishResult): Promise<string> {
  const db = admin();
  if (result.ok) {
    const patch = {
      status: 'published', platform_post_id: result.postId, provider: result.provider,
      payload: result.payload, published_at: new Date().toISOString(), failure_reason: null,
    };
    for (let i = 0; i < 3; i++) {
      const { error } = await db.from('social_posts').update(patch).eq('id', post.id);
      if (!error) return 'published';
      console.error('social: provider accepted ' + post.id + ' but the save failed (' + error.message + ')');
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    return 'published_unsaved';
  }
  const exhausted = result.permanent || post.attempts >= post.max_attempts;
  const delayMinutes = Math.pow(5, Math.max(0, post.attempts - 1));
  /* A failure only ever moves a row that is still 'publishing'. If the row
     has already been settled -- published by the platform function a moment
     before the dispatcher reported its own trouble -- a later failure must not
     put it back in the queue, which is exactly how a post goes out twice. */
  const { data: moved } = await db.from('social_posts').update(exhausted
    ? { status: 'failed', failure_reason: result.error, provider: result.provider, payload: result.payload }
    : { status: 'scheduled', failure_reason: result.error, provider: result.provider, payload: result.payload,
        scheduled_at: new Date(Date.now() + delayMinutes * 60_000).toISOString() })
    .eq('id', post.id).eq('status', 'publishing').select('id');
  if (!moved || !moved.length) return 'already_settled';
  return exhausted ? 'failed' : 'scheduled';
}

/* ── engagement read back ───────────────────────────────────────────────── */

export interface CommentRow { id: string; author: string | null; body: string | null; at: string | null }

/** Files comments against the post, keyed on the platform's own id so re-reading
 *  never duplicates. The number filed, or -1 if the write failed. */
export async function fileComments(post: { id: string; agency_id: string; property_id: string | null; platform: string },
  comments: CommentRow[]): Promise<number> {
  const rows = comments.filter((c) => c.id).slice(0, 50).map((c) => ({
    social_post_id: post.id, agency_id: post.agency_id, property_id: post.property_id, platform: post.platform,
    platform_comment_id: c.id, author_handle: c.author, body: c.body, commented_at: c.at,
    fetched_at: new Date().toISOString(),
  }));
  if (!rows.length) return 0;
  const { error } = await admin().from('social_comments').upsert(rows, { onConflict: 'platform,platform_comment_id' });
  /* -1, not 0: "nothing to file" and "the write failed" must not look alike to
     a sweep deciding whether it may move its cursor past these comments. */
  if (error) { console.error('social: comments not filed for ' + post.id + ': ' + error.message); return -1; }
  return rows.length;
}

/** Writes numbers through as NULL when the platform had no answer: "nobody liked
 *  it" and "we could not ask" are different, and zero would say the first. */
export async function writeMetrics(postId: string, m: { likes: number | null; comments: number | null; shares: number | null }): Promise<void> {
  await admin().from('social_posts').update({ ...m, metrics_at: new Date().toISOString() }).eq('id', postId);
}

/** Published posts on this platform due a metrics read, oldest-read first, with their connection. */
export async function postsToSweep(platform: string, limit: number): Promise<Array<{ post: QueuedPost & { platform_post_id: string }; conn: Connection }>> {
  const stale = new Date(Date.now() - 3600e3).toISOString();
  const { data } = await admin().from('social_posts')
    .select('id, agency_id, property_id, platform, caption, media_urls, attempts, max_attempts, dry_run, status, leg, social_account_id, city_channel_id, platform_post_id')
    .eq('platform', platform).eq('provider', platform).eq('status', 'published').is('deleted_at', null)
    .not('platform_post_id', 'is', null)
    .gt('published_at', new Date(Date.now() - 30 * 86400e3).toISOString())
    .or('metrics_at.is.null,metrics_at.lt.' + stale)
    .order('metrics_at', { ascending: true, nullsFirst: true }).limit(limit);
  const out: Array<{ post: QueuedPost & { platform_post_id: string }; conn: Connection }> = [];
  const cache = new Map<string, Connection | string>();
  for (const p of (data ?? []) as Array<QueuedPost & { platform_post_id: string }>) {
    const key = p.leg + ':' + (p.city_channel_id || p.social_account_id || p.agency_id);
    if (!cache.has(key)) cache.set(key, await resolveConnection(p));
    const c = cache.get(key);
    if (c && typeof c !== 'string') out.push({ post: p, conn: c });
  }
  return out;
}

/* ── the function itself ───────────────────────────────────────────────── */

/** Claims a post the dispatcher handed over, reading it fresh. Only a row
 *  that is still 'publishing' is sent: a second invocation for the same row
 *  (a retried HTTP call) finds it already settled and does nothing. */
async function claimedPost(postId: string): Promise<QueuedPost | null> {
  const { data } = await admin().from('social_posts')
    .select('id, agency_id, property_id, platform, caption, media_urls, attempts, max_attempts, dry_run, status, leg, social_account_id, post_format, city_channel_id')
    .eq('id', postId).maybeSingle();
  const p = data as QueuedPost | null;
  if (!p || p.status !== 'publishing') return null;
  p.media_urls = Array.isArray(p.media_urls) ? p.media_urls : [];
  return p;
}

/** Publish one claimed post: resolve, renew if due, send, settle. */
export async function publishOne(spec: PlatformSpec, postId: string): Promise<Record<string, unknown>> {
  const post = await claimedPost(postId);
  if (!post) return { id: postId, status: 'skipped', note: 'not claimed, or already settled' };
  if (post.platform !== spec.platform) {
    return { id: postId, status: await settle(post, fail(spec.platform, 'Sent to the wrong platform function.', buildPayload(post), true)) };
  }

  const resolved = await resolveConnection(post);
  if (typeof resolved === 'string') {
    /* No account is the agency's to fix, and retrying will not connect one. */
    const status = await settle(post, fail(post.platform, resolved, buildPayload(post), true));
    return { id: post.id, platform: post.platform, leg: post.leg, status, error: resolved };
  }
  let conn = resolved;

  if (spec.refresh && conn.expiresAt) {
    const left = Date.parse(conn.expiresAt) - Date.now();
    if (left < (spec.refreshWithin ?? 15 * 60 * 1000)) {
      const fresh = await refreshGuarded(conn, spec.refresh).catch((e) => { console.error('social-' + spec.platform + ' refresh threw', e); return null; });
      if (fresh) conn = { ...conn, token: fresh };
      else if (left <= 0) {
        const why = 'The ' + post.platform + ' connection has expired and could not be renewed. Connect the account again.';
        await markAccountError(conn, why);
        const status = await settle(post, fail(post.platform, why, buildPayload(post), true));
        return { id: post.id, platform: post.platform, leg: post.leg, status, error: why };
      }
    }
  }

  let result: PublishResult;
  try {
    result = await spec.publish(post, conn);
  } catch (e) {
    result = fail(post.platform, (e instanceof Error ? e.message : String(e)) || 'Unknown error', buildPayload(post));
  }
  const status = await settle(post, result);
  if (result.ok && status === 'published' && spec.afterPublish) {
    await spec.afterPublish(post, conn, result).catch((e) => console.error('social-' + spec.platform + ' afterPublish failed for ' + post.id, e));
  }
  return { id: post.id, platform: post.platform, leg: post.leg, status, provider: result.provider,
    postId: result.postId, ...(result.ok ? {} : { error: result.error }) };
}

/** Wires a PlatformSpec to the shared contract and serves it. */
export function platformFunction(spec: PlatformSpec): void {
  Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    const url = new URL(req.url);
    let action = url.searchParams.get('action') ?? '';
    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
      body = await req.clone().json().catch(() => ({}));
      if (!action && typeof body.action === 'string') action = body.action;
    }
    const redirectUri = redirectUriFor(url, spec.platform);

    try {
      if (action === 'status') return json({ platform: spec.platform, ...spec.status(), redirect_uri: spec.start ? redirectUri : null });

      /* ── service role: the dispatcher and the scheduler ── */
      if (action === 'publish' || action === 'refresh' || action === 'sweep') {
        if (!isServiceCall(req)) return json({ error: 'This action is for the scheduler, not for a session.' }, 403);
        if (action === 'publish') {
          const id = String(body.post_id ?? '');
          if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'post_id is required' }, 400);
          return json(await publishOne(spec, id));
        }
        if (action === 'refresh') {
          if (!spec.refresh) return json({ ok: false, note: spec.platform + ' tokens are not renewed this way' });
          const id = String(body.account_id ?? '');
          const { data } = await admin().from('social_accounts')
            .select('id, platform, platform_account_id, platform_username, auth_source, token_expires_at')
            .eq('id', id).eq('platform', spec.platform).eq('is_active', true).is('deleted_at', null).maybeSingle();
          if (!data) return json({ ok: false, error: 'No such active account' }, 404);
          const { data: tok } = await admin().rpc('social_account_token', { p_account_id: id });
          const fresh = await refreshGuarded({ accountId: id, kind: 'agency', platformAccountId: data.platform_account_id,
            username: data.platform_username, token: String(tok ?? ''), authSource: data.auth_source, expiresAt: data.token_expires_at },
          spec.refresh);
          return json({ ok: Boolean(fresh) });
        }
        if (!spec.sweep) return json({ looked_at: 0, note: 'no read-back for ' + spec.platform });
        return json(await spec.sweep(Math.min(Math.max(Number(body.limit) || 20, 1), 50)));
      }

      if (spec.extra) {
        const r = await spec.extra(req, url, action);
        if (r) return r;
      }

      /* ── a member starting a connection ── */
      if (action === 'start') {
        if (!spec.start) return json({ error: spec.platform + ' is not connected through a sign-in.' }, 400);
        const studio = url.searchParams.get('for') === 'studio';
        if (studio && !spec.studio) return json({ error: 'The studio cannot connect Synapse’s own ' + spec.platform + ' yet.' }, 400);
        const who = studio ? await staffCaller(req) : await memberCaller(req);
        if (who instanceof Response) return who;
        const nonce = crypto.randomUUID();
        const pkce = await newPkce();
        await keepVerifier(nonce, spec.platform, pkce.verifier);
        const state = await signState(spec.platform, {
          platform: spec.platform, nonce, exp: Date.now() + STATE_TTL_MS, profile_id: who.userId,
          ...(studio ? { studio: true } : { agency_id: (who as unknown as { agencyId: string }).agencyId }),
        });
        return await spec.start({ req, url, redirectUri, state, pkceChallenge: pkce.challenge, studio });
      }

      /* ── a member choosing which held accounts are theirs ── */
      if (action === 'pick') {
        if (!spec.connectPicked) return json({ error: 'Nothing to choose on ' + spec.platform }, 400);
        const who = await memberCaller(req);
        if (who instanceof Response) return who;
        const pickId = req.method === 'GET' ? (url.searchParams.get('pick') ?? '') : String(body.pick ?? '');
        if (!/^[0-9a-f-]{36}$/i.test(pickId)) return json({ error: 'This choice has expired. Connect again.' }, 404);
        const { data: row } = await admin().from('social_connect_picks')
          .select('pages, expires_at, agency_id, profile_id, platform').eq('id', pickId).maybeSingle();
        if (!row || row.platform !== spec.platform || row.profile_id !== who.userId || row.agency_id !== who.agencyId
            || Date.parse(String(row.expires_at)) < Date.now()) {
          return json({ error: 'This choice has expired. Connect again.' }, 404);
        }
        if (req.method === 'GET') {
          return json({ expires_at: row.expires_at, accounts: ((row.pages ?? []) as PickedAccount[]).map((p) => ({ id: p.id, name: p.name })) });
        }
        const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map(String) : [];
        if (!ids.length) return json({ error: 'Tick at least one account.' }, 400);
        const { data: got } = await admin().rpc('take_connect_pick', { p_id: pickId });
        if (!got) return json({ error: 'This choice has expired. Connect again.' }, 404);
        const taken = got as { pages: PickedAccount[]; tokens: Record<string, string>; scopes: string[] };
        const res = await spec.connectPicked(who.agencyId, who.userId,
          (taken.pages ?? []).filter((p) => ids.includes(p.id)), taken.tokens ?? {}, taken.scopes ?? []);
        if (!res.connected.length) return json({ error: 'Nothing could be saved: ' + res.problems.join('; ') }, 500);
        return json(res);
      }

      /* ── the platform sending the browser back ── */
      if (req.method === 'GET' && (url.searchParams.has('code') || url.searchParams.has('error'))) {
        if (!spec.callback) return json({ error: 'No sign-in on ' + spec.platform }, 400);
        const stateRaw = url.searchParams.get('state') ?? '';
        const claims = stateRaw ? await readState(spec.platform, stateRaw) : null;
        const studio = claims?.studio === true;
        const denied = url.searchParams.get('error');
        if (denied) {
          return backToPortal(spec.platform, 'cancelled',
            (url.searchParams.get('error_description') ?? denied).slice(0, 200),
            { studio, facts: { where: 'dialog', error: denied.slice(0, 60) } });
        }
        if (!claims) return backToPortal(spec.platform, 'error', 'That connection link was invalid or has expired. Please start again.');
        const verifier = await takeVerifier(String(claims.nonce ?? ''), spec.platform);
        return await spec.callback(url.searchParams.get('code') ?? '', { ...claims, pkce_verifier: verifier }, redirectUri);
      }

      return json({ error: 'Unknown action' }, 400);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('social-' + spec.platform + ' fatal: ' + message);
      return url.searchParams.has('code') ? backToPortal(spec.platform, 'error', message) : json({ error: message }, 500);
    }
  });
}

/** Holds accounts a member must choose between (LinkedIn pages, say), as Facebook does. */
export async function holdForChoice(platform: string, agencyId: string, profileId: string, accounts: PickedAccount[],
  tokens: Record<string, string>, scopes: string[]): Promise<string | null> {
  const { data, error } = await admin().rpc('stash_connect_pick_for', {
    p_platform: platform, p_agency_id: agencyId, p_profile_id: profileId,
    p_pages: accounts, p_tokens: tokens, p_scopes: scopes,
  });
  if (error) console.error('social-' + platform + ': could not hold the accounts: ' + error.message);
  return typeof data === 'string' ? data : null;
}

/** OAuth token endpoint call, form-encoded, answering with the parsed body or an error sentence. */
export async function tokenRequest(endpoint: string, params: Record<string, string>,
  headers: Record<string, string> = {}): Promise<Record<string, unknown> | string> {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
    body: new URLSearchParams(params),
  }).catch((e) => e as Error);
  if (r instanceof Error) return 'Could not reach the sign-in service: ' + r.message;
  const j = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok || !j.access_token) {
    return String(j.error_description ?? j.error ?? ('HTTP ' + r.status)).slice(0, 300);
  }
  return j;
}
