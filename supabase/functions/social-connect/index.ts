/**
 * social-connect — the OAuth flow that puts a real Instagram token in Vault.
 *
 * WHY THIS EXISTS
 * 0053 built `connect_social_account` and gave it to service_role only, with a
 * comment saying it is "called by an OAuth callback running with the service
 * role". That callback was never written, so the whole token path had no
 * entrance: a correct, tested, unreachable function.
 *
 * It also blocks Meta App Review, which is not a form -- it is a screencast of
 * a reviewer granting the permission and seeing the feature work. You cannot
 * record a permission dialog that nothing opens. This is that dialog.
 *
 * WHAT IS NOT BLOCKED BY APPROVAL
 * In Development Mode, Meta grants an app's own admins, developers and testers
 * every permission the app requests WITHOUT App Review. So the owner of this
 * app can connect their own Instagram professional account and publish for real
 * today. App Review is what lets OTHER agencies do it. The distinction matters:
 * it means this flow can be built and proven now rather than rehearsed.
 *
 * ROUTES
 *   GET  ?action=start   (Authorization: user JWT)  -> { url } to send them to
 *   GET  ?code=..&state=..                          -> callback; 302 back to the portal
 *
 * THE STATE PARAMETER IS THE SECURITY BOUNDARY.
 * The callback arrives from Instagram with no session and no JWT -- it is a
 * browser redirect. Whatever it says about which agency to connect is the only
 * claim available, so it has to be one we made. `state` is HMAC-signed with a
 * key derived from the service role secret and carries an expiry, so a
 * connect-for-someone-else URL cannot be forged or replayed later.
 *
 * MUST BE DEPLOYED WITH verify_jwt = false.
 * The callback is a browser redirect from Instagram and carries no JWT, so the
 * gateway would reject it before this code ran. That does not make the function
 * open: `?action=start` checks the Authorization header and resolves the user
 * itself, and the callback trusts nothing except the HMAC-signed state it
 * issued. Authentication moved into the function; it was not removed.
 *
 * Secrets required (set in Supabase, never in this file):
 *   META_APP_ID, META_APP_SECRET, META_REDIRECT_URI, PORTAL_URL (optional)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* CORS is inlined rather than imported from _shared. This function is deployed
   as a single file, and social-publish already shipped with an import path
   that did not exist in the repo -- it only worked because the helper was
   inlined at deploy time. One file with no import cannot drift that way. */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** How long a start URL stays usable. Long enough to read the dialog, short
 *  enough that a link leaked from browser history is already dead. */
const STATE_TTL_MS = 15 * 60 * 1000;

/* The permissions this app asks for, and nothing beyond them. Meta rejects
   over-broad requests, and every extra scope is another thing to justify.
   These are the current values for the Instagram API with Instagram Login;
   the older `business_*` names were deprecated in January 2025. */
const IG_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];

/* ── signed state ─────────────────────────────────────────────────────────── */

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): Uint8Array {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function stateKey(): Promise<CryptoKey> {
  /* Derived from a secret this function already has, so connecting an account
     does not require the operator to invent and store yet another one. */
  const material = new TextEncoder().encode(
    'synapse.social-connect.state.v1:' + (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''),
  );
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await stateKey(), new TextEncoder().encode(body));
  return body + '.' + b64url(new Uint8Array(sig));
}

async function readState(state: string): Promise<Record<string, unknown> | null> {
  const dot = state.lastIndexOf('.');
  if (dot < 1) return null;
  const body = state.slice(0, dot);
  const ok = await crypto.subtle.verify(
    'HMAC',
    await stateKey(),
    unb64url(state.slice(dot + 1)),
    new TextEncoder().encode(body),
  );
  if (!ok) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ── the flow ─────────────────────────────────────────────────────────────── */

/** Sends the operator back to the portal with a plain-language outcome rather
 *  than leaving them on a white page owned by an edge function. */
function backToPortal(status: string, detail?: string): Response {
  const portal = Deno.env.get('PORTAL_URL') ?? '/app/agency.html';
  const u = new URL(portal, 'https://placeholder.invalid');
  u.searchParams.set('connected', status);
  if (detail) u.searchParams.set('detail', detail.slice(0, 180));
  const target = portal.startsWith('http') ? u.toString() : u.pathname + u.search;
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: target } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const appId = Deno.env.get('META_APP_ID') ?? '';
  const appSecret = Deno.env.get('META_APP_SECRET') ?? '';
  const redirectUri = Deno.env.get('META_REDIRECT_URI') ?? '';

  try {
    /* ── step 1: hand back an authorization URL ───────────────────────────── */
    if (url.searchParams.get('action') === 'start') {
      if (!appId || !redirectUri) {
        return json({ error: 'Instagram is not configured on this project yet — META_APP_ID and META_REDIRECT_URI are unset.' }, 503);
      }

      const authHeader = req.headers.get('Authorization');
      if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

      const supaUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const userClient = createClient(supaUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await userClient.auth.getUser();
      const user = userData.user;
      if (!user) return json({ error: 'Not authenticated' }, 401);

      /* Which agency, decided here from membership rather than taken from the
         caller. The state we sign is only trustworthy if what it asserts was
         established server-side. Only an owner or admin may connect an account:
         it is a credential for the whole agency, not for one agent. */
      const admin = createClient(supaUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
      const { data: membership } = await admin
        .from('agency_members')
        .select('agency_id, role')
        .eq('profile_id', user.id)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();

      if (!membership) return json({ error: 'You are not a member of an agency' }, 403);
      if (!['agency_admin', 'agency_owner'].includes(membership.role as string)) {
        return json({ error: 'Only an agency owner or admin can connect a social account' }, 403);
      }

      const state = await signState({
        agency_id: membership.agency_id,
        profile_id: user.id,
        platform: 'instagram',
        nonce: crypto.randomUUID(),
        exp: Date.now() + STATE_TTL_MS,
      });

      const auth = new URL('https://www.instagram.com/oauth/authorize');
      auth.searchParams.set('client_id', appId);
      auth.searchParams.set('redirect_uri', redirectUri);
      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('scope', IG_SCOPES.join(','));
      auth.searchParams.set('state', state);

      return json({ url: auth.toString(), scopes: IG_SCOPES, expiresInMinutes: STATE_TTL_MS / 60000 });
    }

    /* ── step 2: the callback ─────────────────────────────────────────────── */
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    // The person declined, or Meta refused. Both are ordinary outcomes.
    const denied = url.searchParams.get('error');
    if (denied) return backToPortal('cancelled', url.searchParams.get('error_description') ?? denied);

    if (!code || !state) return json({ error: 'This endpoint expects an OAuth redirect from Instagram.' }, 400);
    if (!appId || !appSecret || !redirectUri) return backToPortal('error', 'Instagram is not configured on this project.');

    const claims = await readState(state);
    if (!claims) return backToPortal('error', 'That connection link was invalid or has expired. Please start again.');

    /* short-lived token */
    const form = new FormData();
    form.append('client_id', appId);
    form.append('client_secret', appSecret);
    form.append('grant_type', 'authorization_code');
    form.append('redirect_uri', redirectUri);
    form.append('code', code);

    const tokRes = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
    const tok = await tokRes.json().catch(() => ({}));
    if (!tokRes.ok || !tok.access_token) {
      return backToPortal('error', tok?.error_message ?? 'Instagram would not issue a token.');
    }

    /* Exchange for the 60-day token. Skipping this leaves a credential that
       dies in an hour, and the failure lands days later on a scheduled post. */
    let accessToken: string = tok.access_token;
    let expiresAt: string | null = null;
    const longRes = await fetch(
      'https://graph.instagram.com/access_token?grant_type=ig_exchange_token'
        + '&client_secret=' + encodeURIComponent(appSecret)
        + '&access_token=' + encodeURIComponent(accessToken),
    );
    const long = await longRes.json().catch(() => ({}));
    if (longRes.ok && long.access_token) {
      accessToken = long.access_token;
      if (typeof long.expires_in === 'number') {
        expiresAt = new Date(Date.now() + long.expires_in * 1000).toISOString();
      }
    }

    /* Who we just connected, so the portal can name the account rather than
       show an opaque id. */
    const meRes = await fetch(
      'https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=' + encodeURIComponent(accessToken),
    );
    const me = await meRes.json().catch(() => ({}));
    const accountId = String(me.user_id ?? tok.user_id ?? '');
    const username = String(me.username ?? '');
    if (!accountId) return backToPortal('error', 'Connected, but Instagram did not identify the account.');

    /* Into Vault, via the definer function built for exactly this. The token
       has now touched only this function and the vault. p_connected_by names
       the operator this callback is acting for: the function re-checks that
       they are an owner or admin of the agency in the signed state. */
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { error: connErr } = await admin.rpc('connect_social_account', {
      p_agency_id: claims.agency_id as string,
      p_platform: 'instagram',
      p_account_id: accountId,
      p_username: username,
      p_access_token: accessToken,
      p_refresh_token: null,
      p_expires_at: expiresAt,
      p_scopes: IG_SCOPES,
      p_connected_by: claims.profile_id as string,
    });
    if (connErr) return backToPortal('error', connErr.message);

    return backToPortal('instagram', username ? '@' + username : undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('social-connect fatal: ' + message);
    // A thrown error must never leave the operator staring at a raw stack.
    return url.searchParams.get('action') === 'start' ? json({ error: message }, 500) : backToPortal('error', message);
  }
});
