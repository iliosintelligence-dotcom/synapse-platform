/**
 * post-metrics — engagement on a published post, from the platform itself.
 *
 * The pipeline could already report the half of performance we measure: taps
 * on the short link, visits to the listing, enquiries that followed. What it
 * could not report is the half that happens on the platform and never touches
 * us — how many people saw it, liked it, commented. trypost exposes exactly
 * that, per post, across every account it published to:
 *
 *   GET https://app.trypost.it/api/posts/{trypost_post_id}/metrics
 *
 * WHY THIS IS A FUNCTION AND NOT A FETCH FROM THE BROWSER.
 * The trypost key is a workspace-wide credential. Anything holding it can post
 * as Synapse on every connected account, so it lives in the function's
 * environment and never leaves the server. The browser asks us; we ask trypost.
 *
 * WHAT STOPS AN AGENCY READING ANOTHER AGENCY'S NUMBERS.
 * The caller's own JWT is forwarded to PostgREST, so the social_posts read runs
 * under social_posts_rw -- is_agency_member(agency_id). A post that is not
 * theirs simply does not come back, and an id we cannot see is an id we never
 * ask trypost about. No service-role client is created here at all, which is
 * the point: there is nothing in this file that could be tricked into reading
 * past RLS.
 *
 * DEPLOY WITH verify_jwt TRUE. That is the default, but the default re-arms on
 * every deploy and has been lost before by being left implicit, so it is stated
 * here and passed explicitly at deploy time. Without a verified caller this
 * function has no identity to scope by.
 */

const TRYPOST_URL = (Deno.env.get('TRYPOST_URL') || 'https://app.trypost.it').replace(/\/+$/, '');
const TRYPOST_API_KEY = Deno.env.get('TRYPOST_API_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/**
 * trypost returns `metrics` as EITHER an array of {label, value} OR an object
 * {unsupported, reason}. Same field, two types -- so every consumer has to
 * check, and doing it once here means the browser never sees the ambiguity.
 *
 * The unsupported reasons are worth keeping rather than flattening to null:
 * "not_published" and "platform_not_supported" are completely different
 * answers to "why is there no number here", and only one of them is permanent.
 * TikTok and personal LinkedIn expose no post-level metrics at all today.
 */
function normalise(entry: Record<string, unknown>) {
  const m = entry?.metrics as unknown;
  const out: Record<string, unknown> = {
    platform: entry?.platform ?? null,
    status: entry?.status ?? null,
    url: entry?.platform_url ?? null,
  };
  if (Array.isArray(m)) {
    out.metrics = m
      .filter((x) => x && typeof (x as Record<string, unknown>).label === 'string')
      .map((x) => {
        const r = x as Record<string, unknown>;
        return { label: r.label, value: r.value, kind: r.kind ?? null };
      });
    out.supported = true;
  } else {
    const r = (m || {}) as Record<string, unknown>;
    out.metrics = [];
    out.supported = false;
    out.reason = r.reason ?? 'unknown';
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const auth = req.headers.get('Authorization') || '';
  if (!auth) return json({ error: 'Sign in first' }, 401);

  if (!TRYPOST_API_KEY) {
    /* Said plainly rather than as an empty result. A card showing no
       engagement because nothing is configured looks exactly like a post
       nobody engaged with, and those want opposite responses from whoever is
       reading the screen. */
    return json({ configured: false, results: {}, note: 'No trypost API key is set on this project.' });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* an empty body is a no-op, not an error */ }

  const ids = Array.isArray(body.postIds)
    ? (body.postIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 20)
    : [];
  if (!ids.length) return json({ configured: true, results: {} });

  /* The caller's own token, not ours. This single line is the entire
     authorisation model: PostgREST applies social_posts_rw for whoever is
     signed in, so the rows that come back are the rows they may see. */
  const qs = new URLSearchParams({
    select: 'id,platform_post_id,platform,status,provider',
    id: `in.(${ids.join(',')})`,
  });
  const rowsRes = await fetch(`${SUPABASE_URL}/rest/v1/social_posts?${qs}`, {
    headers: { apikey: ANON_KEY, Authorization: auth },
  });
  if (!rowsRes.ok) {
    return json({ error: 'Could not read those posts', detail: (await rowsRes.text()).slice(0, 200) }, 502);
  }
  const rows = (await rowsRes.json()) as Array<Record<string, string | null>>;

  /* One trypost call per DISTINCT trypost post id. Twins are separate posts
     there as well as here, so this is genuinely one call each -- but a caller
     that passes the same id twice should not pay for it twice. */
  const wanted = new Map<string, string[]>();   // trypost id -> our post ids
  for (const r of rows) {
    const tid = r.platform_post_id;
    if (!tid || r.provider !== 'trypost' || r.status !== 'published') continue;
    const list = wanted.get(tid) || [];
    list.push(r.id as string);
    wanted.set(tid, list);
  }
  if (!wanted.size) return json({ configured: true, results: {} });

  const results: Record<string, unknown> = {};
  await Promise.all([...wanted.entries()].map(async ([tid, ourIds]) => {
    let payload: Record<string, unknown> | null = null;
    let error: string | null = null;
    try {
      const r = await fetch(`${TRYPOST_URL}/api/posts/${encodeURIComponent(tid)}/metrics`, {
        headers: { Authorization: `Bearer ${TRYPOST_API_KEY}` },
      });
      if (r.status === 404) {
        /* The post is not in this workspace -- which happens when a key is
           rotated to a different workspace, or the post was deleted there.
           Not our caller's fault and not worth a 500. */
        error = 'not_found';
      } else if (!r.ok) {
        error = `http_${r.status}`;
      } else {
        payload = await r.json();
      }
    } catch (e) {
      error = (e as Error)?.message || 'fetch_failed';
    }

    const platforms = Array.isArray(payload?.platforms)
      ? (payload!.platforms as Array<Record<string, unknown>>).map(normalise)
      : [];

    /* Keyed by OUR post id, because that is what the card knows about itself.
       The trypost id is an implementation detail of how it got out. */
    for (const ourId of ourIds) {
      results[ourId] = error ? { error, platforms: [] } : { platforms };
    }
  }));

  return json({ configured: true, results });
});
