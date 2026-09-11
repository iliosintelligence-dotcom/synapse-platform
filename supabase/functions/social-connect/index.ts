/**
 * social-connect -- the OAuth flow that puts a real Meta token in Vault.
 *
 * WHY THIS EXISTS
 * 0053 built `connect_social_account` and gave it to service_role only, with a
 * comment saying it is "called by an OAuth callback running with the service
 * role". That callback was never written, so the whole token path had no
 * entrance: a correct, tested, unreachable function.
 *
 * WHAT IS NOT BLOCKED BY APPROVAL
 * In Development Mode, Meta grants an app's own admins, developers and testers
 * every permission the app requests WITHOUT App Review. So the owner of this
 * app can connect their own Instagram professional account or Facebook Page and
 * publish for real today. App Review is what lets OTHER agencies do it.
 *
 * ROUTES
 *   GET  ?action=start&platform=instagram|facebook  (Authorization: user JWT)
 *        -> { url } to send them to
 *   GET  ?code=..&state=..  -> callback; 302 back to the portal
 *
 * THE STATE PARAMETER IS THE SECURITY BOUNDARY.
 * The callback arrives from Meta with no session and no JWT -- it is a browser
 * redirect. Whatever it says about which agency to connect is the only claim
 * available, so it has to be one we made. `state` is HMAC-signed with a key
 * derived from the service role secret and carries an expiry, so a
 * connect-for-someone-else URL cannot be forged or replayed later. It also
 * carries WHICH platform, because both products share one app and one redirect
 * URI and Meta says nothing about which dialog the person came out of.
 *
 * MUST BE DEPLOYED WITH verify_jwt = false.
 * The callback is a browser redirect and carries no JWT, so the gateway would
 * reject it before this code ran. That does not make the function open:
 * `?action=start` checks the Authorization header and resolves the user itself,
 * and the callback trusts nothing except the HMAC-signed state it issued.
 * Authentication moved into the function; it was not removed.
 *
 * Secrets required (set in Supabase, never in this file):
 *   META_APP_ID, META_APP_SECRET, PORTAL_URL (optional)
 *   META_FB_CONFIG_ID (optional) -- set this when the Meta app is on
 *   "Facebook Login for Business" rather than classic Facebook Login. What it
 *   changes is documented at the dialog construction in the start branch.
 *   The redirect is NOT a secret -- see the derivation in the handler.
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

/* Facebook Pages. A Page token is what actually posts, and `pages_show_list`
   is what lets us discover which Pages this person administers in order to get
   one. `pages_read_engagement` is required alongside `pages_manage_posts` --
   Meta refuses the publish call without it, which is not obvious from the
   error it returns. `business_management` is deliberately NOT requested: it is
   heavily scrutinised in review and nothing here needs it. */
const FB_SCOPES = ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'];

const PLATFORMS = ['instagram', 'facebook'] as const;
type Platform = typeof PLATFORMS[number];

const scopesFor = (p: Platform): string[] => (p === 'facebook' ? FB_SCOPES : IG_SCOPES);

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

/**
 * Facebook Pages. Three exchanges, and the third is the one that matters:
 * posting to a Page is done with a PAGE token, not the user's own. A Page
 * token derived from a long-lived user token does not expire on a timer, which
 * is why no expiry is stored for it -- inventing a 60-day one would make the
 * portal show "session expired" on a credential that still works.
 */
async function finishFacebook(
  code: string,
  claims: Record<string, unknown>,
  appId: string,
  appSecret: string,
  redirectUri: string,
): Promise<Response> {
  const G = 'https://graph.facebook.com/v21.0';

  const tokRes = await fetch(
    `${G}/oauth/access_token?client_id=${encodeURIComponent(appId)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&client_secret=${encodeURIComponent(appSecret)}`
      + `&code=${encodeURIComponent(code)}`,
  );
  const tok = await tokRes.json().catch(() => ({}));
  if (!tokRes.ok || !tok.access_token) {
    return backToPortal('error', tok?.error?.message ?? 'Facebook would not issue a token.');
  }

  /* The short-lived user token lasts about an hour. Exchanging it is what
     makes the Page tokens derived from it long-lived too; skip this and every
     Page token quietly dies within the hour. */
  let userToken: string = tok.access_token;
  const longRes = await fetch(
    `${G}/oauth/access_token?grant_type=fb_exchange_token`
      + `&client_id=${encodeURIComponent(appId)}`
      + `&client_secret=${encodeURIComponent(appSecret)}`
      + `&fb_exchange_token=${encodeURIComponent(userToken)}`,
  );
  const long = await longRes.json().catch(() => ({}));
  if (longRes.ok && long.access_token) userToken = long.access_token;

  /* Which Pages this person administers, and the token for each. */
  const pagesRes = await fetch(
    `${G}/me/accounts?fields=id,name,access_token&limit=50`
      + `&access_token=${encodeURIComponent(userToken)}`,
  );
  const pages = await pagesRes.json().catch(() => ({}));
  if (!pagesRes.ok) {
    return backToPortal('error', pages?.error?.message ?? 'Could not read your Facebook Pages.');
  }

  const list = (pages.data ?? []) as Array<{ id: string; name: string; access_token: string }>;
  const usable = list.filter((pg) => pg.access_token);
  if (!usable.length) {
    /* Granting the permission without ticking a Page is the single most common
       way this flow ends with nothing connected, and Meta reports it as an
       empty list rather than an error. Say what to do about it, and say in
       the log how many came back at all -- an empty list and a list of Pages
       with no tokens are different problems wearing the same symptom. */
    console.error('social-connect: /me/accounts returned ' + list.length
      + ' page(s), ' + usable.length + ' with a token');
    return backToPortal('error',
      'No Facebook Page came back. Connect again and tick the Page you post from '
      + '-- you need to be an admin of it.');
  }

  /* One Page per agency, which is what social_accounts models (unique on
     agency + platform). The first is chosen deliberately rather than silently:
     when there are several, the portal is told so it can say which one. */
  const page = usable[0];

  /* What Meta ACTUALLY granted, rather than what this file asked for.
     Under a configuration the permissions are chosen in the Meta console, so
     FB_SCOPES stops describing reality altogether. And even in classic mode
     the operator can untick individual permissions in the dialog -- the
     constant was always a request, never a result.

     Nothing gates on the stored list today, so this is a record rather than a
     check, and it must never cost a working connection: every failure path
     here falls back to the requested list and says so in the log. */
  let grantedScopes: string[] = FB_SCOPES;
  const permRes = await fetch(
    `${G}/me/permissions?access_token=${encodeURIComponent(userToken)}`,
  ).catch(() => null);
  const perms = permRes && permRes.ok ? await permRes.json().catch(() => null) : null;
  const granted = ((perms?.data ?? []) as Array<{ permission: string; status: string }>)
    .filter((p) => p.status === 'granted')
    .map((p) => p.permission);
  if (granted.length) grantedScopes = granted;
  else console.warn('social-connect: could not read granted permissions; recording the requested list');

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { error: connErr } = await admin.rpc('connect_social_account', {
    p_agency_id: claims.agency_id as string,
    p_platform: 'facebook',
    p_account_id: page.id,
    p_username: page.name ?? '',
    p_access_token: page.access_token,
    p_refresh_token: null,
    // Deliberately null: a Page token from a long-lived user token has no
    // expiry, and a fabricated one would show as an expired session.
    p_expires_at: null,
    p_scopes: grantedScopes,
    p_connected_by: claims.profile_id as string,
  });
  if (connErr) return backToPortal('error', connErr.message);

  return backToPortal('facebook',
    usable.length > 1
      ? `${page.name} (chosen from ${usable.length} Pages)`
      : page.name);
}

/* ── the flow ─────────────────────────────────────────────────────────────── */

/** Sends the operator back to the portal with a plain-language outcome rather
 *  than leaving them on a white page owned by an edge function. */
function backToPortal(status: string, detail?: string): Response {
  /* THE DEFAULT IS ABSOLUTE, AND HAS TO BE.
     This used to fall back to the RELATIVE '/app/agency.html'. A relative
     redirect issued by an edge function resolves against the function's own
     origin, so with PORTAL_URL unset the operator finished a successful OAuth
     round trip and landed on
     https://<ref>.supabase.co/app/agency.html -- a 404. The token was safely
     in the vault by then, because the connect happens before this redirect, so
     the actual outcome was "it worked and looked broken": the worst kind, and
     one nobody would think to check because the failure appears after the
     success.

     PORTAL_URL still overrides, which is what a preview deployment or a
     rename needs. But a setting whose absence silently breaks the flow is not
     really optional, and making the operator discover that by walking into it
     is not a reasonable thing to ship. */
  const portal = Deno.env.get('PORTAL_URL')
    || 'https://www.synapsecore.dev/app/agency.html';
  /* SAY IT IN THE LOG AS WELL AS THE URL.
     Every failure on this leg used to exist in exactly one place: the
     `detail` parameter of a 302, which is visible only to the person holding
     the browser, as a toast that disappears. From the outside the callback
     was a 302 and nothing else -- indistinguishable from success, and it was
     read as success more than once today. The redirect stays; it is how the
     operator is told. This is how anyone reading the logs is told. */
  if (status === 'error') console.error('social-connect failed: ' + (detail ?? 'no detail'));
  else console.log('social-connect ' + status + ': ' + (detail ?? ''));

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
  /* Facebook only, and optional. Empty means classic Facebook Login. Set means
     the app is on Facebook Login for Business, where a configuration -- not a
     scope list -- decides what is asked for. Not a secret: it travels in the
     dialog URL in plain sight. It sits with the secrets because it is the same
     kind of thing, a per-app value this code cannot derive for itself. */
  const fbConfigId = (Deno.env.get('META_FB_CONFIG_ID') ?? '').trim();
  /* Both spellings are still read below. META_REDIRECT_URI is canonical;
     META_REDIRECT_URL is what Meta's own console calls "Valid OAuth Redirect
     URIs" while every human says URL, and that one letter once cost about two
     weeks of looking for a value that was already set. */
  /* ── THE REDIRECT IS NOT A SETTING. IT IS THIS FUNCTION'S OWN ADDRESS ──
     OAuth sends the browser back to redirect_uri with ?code=..., and the
     only endpoint that can do anything with that code is this one. So there
     is exactly one correct value, this function knows it without being told,
     and every other value is broken by construction.

     It had been set to the portal. Meta honoured it, the browser went
     straight back to the agency portal with a code nothing was listening
     for, and the connection silently did nothing -- reported as "it takes me
     to Facebook, I put in the code, and it just brings me back to the app".
     The logs showed it exactly: action=start returning 200 and then no
     callback to this function, ever.

     Deriving it removes the whole class of failure. The env var is still
     honoured when it agrees with reality -- an operator may need it for a
     custom domain -- but a value that does not point back here is ignored
     rather than obeyed, because obeying it cannot work. The disagreement is
     logged rather than swallowed, so this is visible instead of mysterious. */
  /* THE SCHEME IN url.origin IS A LIE HERE, AND IT COST A LOGIN.
     TLS terminates at Supabase's gateway, so the request this function
     actually receives is plain http and `url.origin` reads
     http://<ref>.supabase.co -- correct about the host, wrong about the
     scheme, and the scheme is the half Meta checks.

     Deriving from it handed Facebook an http:// redirect_uri and produced
     "Facebook has detected that this app isn't using a secure connection to
     transfer information", which is a dead end with an OK button -- no code,
     no callback, nothing in the logs but a 200 on ?action=start. Worse, the
     derivation ALSO out-voted a META_REDIRECT_URI that was set correctly to
     the https URL, on the grounds that it disagreed with "reality". It was
     right and this was wrong.

     So the host is taken from the request, which is the part it knows, and
     the scheme is asserted rather than read: these functions are only ever
     reachable over https in production. Localhost keeps http, because a
     local runtime genuinely is http and there is no gateway in front of it. */
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(url.host);
  const derivedRedirect = (isLocalHost ? 'http://' : 'https://')
    + url.host + '/functions/v1/social-connect';
  const configuredRedirect = (Deno.env.get('META_REDIRECT_URI')
    || Deno.env.get('META_REDIRECT_URL')
    || '').trim().replace(/\/+$/, '');
  const redirectUri = configuredRedirect === derivedRedirect
    ? configuredRedirect
    : derivedRedirect;
  if (configuredRedirect && configuredRedirect !== derivedRedirect) {
    console.warn('social-connect: ignoring META_REDIRECT_URI (' + configuredRedirect
      + ') because the OAuth code can only be exchanged here; using ' + derivedRedirect);
  }

  try {
    /* ── step 1: hand back an authorization URL ───────────────────────────── */
    if (url.searchParams.get('action') === 'start') {
      /* Which product. Both live on one Meta app and one redirect URI, so the
         platform has to travel through the signed state -- the callback is a
         bare browser redirect and Meta tells us nothing about which dialog the
         person just came out of. */
      const requested = url.searchParams.get('platform') ?? 'instagram';
      if (!PLATFORMS.includes(requested as Platform)) {
        return json({ error: `Unsupported platform: ${requested}` }, 400);
      }
      const platform = requested as Platform;

      /* Name what is actually missing. The old message asserted that both
         META_APP_ID and META_REDIRECT_URI were unset whenever either one was,
         which sent at least one debugging session after the wrong variable --
         the owner had set the secret and the redirect and not the app id, and
         the error told them the redirect was missing too.

         Presence only. The values are never read back, never logged and never
         returned; this reports three booleans. META_APP_SECRET is included
         because the callback leg needs it even though this guard does not, so
         a half-configured app fails here rather than silently later, after the
         person has already been sent to Meta and back. */
      /* The redirect is no longer on this list: it is derived above and
         cannot be missing. Only the two real secrets can be. */
      const missing = [
        !appId && 'META_APP_ID',
        !appSecret && 'META_APP_SECRET',
      ].filter(Boolean) as string[];
      if (missing.length) {
        return json({
          error: 'Meta is not configured on this project yet. Missing: ' + missing.join(', ') + '.',
          missing,
          hint: 'Set these on the synapse-platform project (bhrhejpekmhbhwryjhgk). '
              + 'The redirect no longer needs setting -- it is this function. '
              + 'Meta must still allow it: add ' + derivedRedirect
              + ' to Valid OAuth Redirect URIs on the Meta app.',
        }, 503);
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
        platform,
        nonce: crypto.randomUUID(),
        exp: Date.now() + STATE_TTL_MS,
      });

      /* Two different dialogs. Instagram Login lives on instagram.com and
         issues a token for graph.instagram.com; Facebook Login lives on
         facebook.com and issues one for graph.facebook.com. They are not
         interchangeable, and a token from one is simply rejected by the
         other's host. */
      const scopes = scopesFor(platform);
      const auth = new URL(platform === 'facebook'
        ? 'https://www.facebook.com/v21.0/dialog/oauth'
        : 'https://www.instagram.com/oauth/authorize');
      auth.searchParams.set('client_id', appId);
      auth.searchParams.set('redirect_uri', redirectUri);
      auth.searchParams.set('response_type', 'code');

      /* -- FACEBOOK LOGIN FOR BUSINESS ------------------------------------
         Meta ships two products both called Facebook Login and they take
         different dialog parameters. Classic Login is driven by `scope`.
         Login for Business is driven by a `config_id` naming a configuration
         built in the app console, and Meta's guidance is explicit that scope
         should NOT be sent with it -- the configuration decides the
         permissions, so a scope list is at best redundant and at worst
         fighting the configuration.

         `override_default_response_type` is the half that is easy to miss. A
         configuration carries its own default response type. Without this
         flag the `response_type=code` set above is discarded in favour of
         that default, which can hand back a token in the URL FRAGMENT rather
         than a code in the query. A fragment is never sent to the server, so
         the callback would arrive with nothing to exchange -- failing in
         exactly the silent way the rest of this file exists to prevent. Meta
         documents the flag as required whenever response_type is passed
         alongside a config_id.

         Unset, everything below behaves as it did: classic Login, scope list.
         Instagram is untouched either way -- config_id is a Facebook Login
         concept and the Instagram dialog does not accept it. */
      const usingConfig = platform === 'facebook' && !!fbConfigId;
      if (usingConfig) {
        auth.searchParams.set('config_id', fbConfigId);
        auth.searchParams.set('override_default_response_type', 'true');
      } else {
        auth.searchParams.set('scope', scopes.join(','));
      }
      auth.searchParams.set('state', state);

      /* `mode` is reported because the two products fail identically from the
         portal's side -- you come back with nothing connected -- and which
         dialog was actually built is the first thing worth knowing.
         `redirectUri` is reported for the same reason: it was wrong once, in
         a way nothing downstream could see. */
      console.log('social-connect start: platform=' + platform
        + ' mode=' + (usingConfig ? 'login-for-business' : 'classic')
        + ' redirect=' + redirectUri);

      return json({
        url: auth.toString(),
        platform,
        mode: usingConfig ? 'login-for-business' : 'classic',
        redirectUri,
        ...(usingConfig ? { configId: fbConfigId } : { scopes }),
        expiresInMinutes: STATE_TTL_MS / 60000,
      });
    }

    /* ── step 2: the callback ─────────────────────────────────────────────── */
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    // The person declined, or Meta refused. Both are ordinary outcomes.
    const denied = url.searchParams.get('error');
    if (denied) return backToPortal('cancelled', url.searchParams.get('error_description') ?? denied);

    if (!code || !state) return json({ error: 'This endpoint expects an OAuth redirect from Meta.' }, 400);
    if (!appId || !appSecret || !redirectUri) return backToPortal('error', 'Meta is not configured on this project.');

    const claims = await readState(state);
    if (!claims) return backToPortal('error', 'That connection link was invalid or has expired. Please start again.');

    /* The platform is read from the state we signed, never from the query --
       the callback's parameters are attacker-reachable and this one decides
       which token exchange runs and which account gets written. */
    if (claims.platform === 'facebook') {
      return await finishFacebook(code, claims, appId, appSecret, redirectUri);
    }

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
