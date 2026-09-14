/**
 * short-link -- resolves /s/<token> and records the click.
 *
 * WHY THIS IS THE WHOLE FUNCTION
 * All of the judgement lives in resolve_short_link(): what the token points
 * at, whether the link is still live, and what gets written. This file does
 * three things Postgres cannot -- read the user agent, decide the HTTP status,
 * and set the cache headers -- and then gets out of the way. proximity-report
 * is built the same way against proximity_candidates(), for the same reason:
 * one place to change a rule, not two that can disagree.
 *
 * 302, NOT 301
 * A permanent redirect is cached by the browser and by every proxy in between,
 * and the second click is then never seen by anyone. For a plain URL shortener
 * that is a feature. Here the click IS the product -- it is the only honest
 * source of channel attribution this platform has -- so the repeat round trip
 * is exactly what is being bought. `no-store` says the same thing again to
 * intermediaries that treat 302 as cacheable anyway.
 *
 * GET|HEAD /short-link/<token>   ->  302 to the listing
 * Unknown, retired or expired    ->  302 to the site root, never a 404: the
 *                                    link is printed in a published post that
 *                                    cannot be edited, and the person tapping
 *                                    it is real.
 *
 * Deployed with verify_jwt FALSE. It has to be -- the caller is a stranger
 * tapping a link on Instagram. Nothing here trusts the request: the only input
 * is a token looked up by equality, and the only write is one row of counters.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected), SITE_URL.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* Inlined rather than imported from ../_shared -- the import escapes the
   function's own directory, which the deploy flattens away. social-publish and
   social-connect both inline these for the same reason. */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
};

const SITE = (Deno.env.get('SITE_URL') || 'https://www.synapsecore.dev').replace(/\/+$/, '');

/** Tokens are exactly six base62 characters. Anything else never reaches the
 *  database -- it cannot be a link we minted, so there is nothing to look up. */
const TOKEN_RE = /^[0-9A-Za-z]{6}$/;

/* -- who is actually asking ---------------------------------------------- */

/* Link previews are the dominant false click, not spam. WhatsApp, Facebook,
   Slack and Telegram all fetch a URL the instant it is pasted -- before any
   human has seen it, and often twice. Counting those as interest would make
   every shared listing look roughly twice as popular as it is, and the error
   would be largest on exactly the posts that got shared most.

   These get the redirect like anyone else: a crawler that cannot reach
   property.html cannot read its OG tags, and the post then shows a grey box
   instead of the house. They are classified and excluded, never blocked. */
const PREVIEW = [
  'facebookexternalhit', 'facebookcatalog', 'whatsapp', 'twitterbot', 'slackbot',
  'slack-imgproxy', 'linkedinbot', 'telegrambot', 'discordbot', 'skypeuripreview',
  'pinterest', 'redditbot', 'embedly', 'iframely', 'quora link preview',
  'vkshare', 'nuzzel', 'bitlybot', 'google-pagerenderer', 'applebot',
];

const BOT = [
  'bot', 'crawler', 'spider', 'crawling', 'headlesschrome', 'phantomjs',
  'curl/', 'wget/', 'python-requests', 'python-urllib', 'go-http-client',
  'java/', 'okhttp', 'axios/', 'node-fetch', 'httpclient', 'scrapy',
  'ahrefs', 'semrush', 'mj12bot', 'dotbot', 'petalbot', 'uptime',
];

function classify(ua: string | null): 'human' | 'bot' | 'preview' {
  if (!ua) return 'bot';            // no user agent at all is not a person
  const s = ua.toLowerCase();
  /* Preview is tested first on purpose: several of these carry "bot" in the
     name, and calling facebookexternalhit a crawler would lose the distinction
     that matters -- a preview means someone SHARED the link, which is a real
     signal, just not a click. */
  if (PREVIEW.some((p) => s.includes(p))) return 'preview';
  if (BOT.some((b) => s.includes(b))) return 'bot';
  return 'human';
}

/* -- responses ------------------------------------------------------------ */

function redirect(to: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: to,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      /* The destination carries a listing id and a channel. Sending a full
         referrer would hand that to whatever the listing page later loads, for
         no benefit to anyone. */
      'Referrer-Policy': 'no-referrer',
    },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const url = new URL(req.url);
  /* Supabase strips /functions/v1, so the path arrives as /short-link/<token>.
     Vercel rewrites /s/<token> onto that. Taking the last non-empty segment
     handles both, plus ?t= for anyone testing the function directly. */
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || '';
  const token = (last === 'short-link' ? '' : last) || url.searchParams.get('t') || '';

  if (!TOKEN_RE.test(token)) {
    console.log(JSON.stringify({ at: 'short-link', outcome: 'malformed', token: token.slice(0, 12) }));
    return redirect(SITE + '/');
  }

  const ua = req.headers.get('user-agent');
  const uaClass = classify(ua);

  /* Generated ONCE, outside the retry, and reused if the call below has to go
     again. That is the entire reason click_events is keyed by it: a retry
     after a timeout is the one real duplicate on this path, and this makes it
     land on the same row instead of counting the click twice. */
  const eventId = crypto.randomUUID();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  let target: string | null = null;
  let lastErr = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await supabase.rpc('resolve_short_link', {
      p_token: token,
      p_event_id: eventId,
      p_ua_class: uaClass,
    });
    if (!error) { target = (data as string | null) ?? null; break; }
    lastErr = error.message || String(error);
    /* One retry, because a cold pooler connection is a real and transient
       failure and the person is waiting. Two would be optimism. */
    if (attempt === 1) await new Promise((r) => setTimeout(r, 120));
  }

  if (lastErr && target === null) {
    /* The click is lost -- there is nowhere to put it -- but the person is
       not. Send them to the site rather than showing them a failure they can
       do nothing about, and make sure the lost click is visible to us. */
    console.error(JSON.stringify({ at: 'short-link', outcome: 'rpc_failed', token, error: lastErr }));
    return redirect(SITE + '/');
  }

  if (!target) {
    console.log(JSON.stringify({ at: 'short-link', outcome: 'unresolved', token, uaClass }));
    return redirect(SITE + '/');
  }

  console.log(JSON.stringify({ at: 'short-link', outcome: 'ok', token, uaClass }));
  return redirect(target);
});
