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

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';

/** Pull one labelled number out of trypost's metrics array. Labels are
 *  title-cased in their payload ('Likes', 'Comments', 'Shares') but matched
 *  case-insensitively, because a label is their copy and copy changes. */
function metricValue(metrics: unknown, label: string): number | null {
  if (!Array.isArray(metrics)) return null;
  for (const m of metrics) {
    const r = (m || {}) as Record<string, unknown>;
    if (String(r.label ?? '').toLowerCase() === label.toLowerCase()) {
      const n = Number(r.value);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/**
 * Refresh engagement for published trypost posts, oldest-fetched first.
 *
 * Writes NULL through when trypost has no answer rather than zero. A post
 * nobody commented on and a post we could not ask about look identical as
 * zero, and they want opposite reactions from whoever reads the card --
 * metrics_at still moves so a permanently unsupported post does not hog
 * every sweep.
 */
/* Same versions social-publish addresses. Kept in step with it: a metric
   read against a different version than the publish is how you get a number
   that does not match the post it is attached to. */
const IG_GRAPH = 'https://graph.instagram.com/v21.0';
const FB_GRAPH = 'https://graph.facebook.com/v21.0';

/** A number, or null when the answer was not a number. Graph omits a field
 *  entirely rather than returning 0 when it has nothing, and `Number(undefined)`
 *  is NaN, which would be written as null anyway -- but silently, and for the
 *  wrong reason. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Engagement for posts published straight to Meta, which the trypost sweep
 * below never looks at because it filters on provider=trypost.
 *
 * Needs no scope the connect flow does not already request: on Instagram
 * like_count and comments_count are fields on the media object
 * (instagram_business_basic), and on Facebook the summaries need
 * pages_read_engagement, which the publish call requires anyway.
 */
async function sweepMeta(limit: number, h: Record<string, string>): Promise<Record<string, unknown>> {
  const stale = new Date(Date.now() - 3600e3).toISOString();
  const q = `${SB_URL}/rest/v1/social_posts`
    /* `comments` is the count from the LAST sweep, and it is read so this one
       can tell whether anything changed. `property_id` rides along so a
       comment can be filed against the listing it was written under without
       a second query per post. */
    + '?select=id,platform,platform_post_id,agency_id,property_id,comments'
    + '&deleted_at=is.null&status=eq.published&provider=in.(instagram,facebook)'
    + '&platform_post_id=not.is.null'
    + `&or=(metrics_at.is.null,metrics_at.lt.${stale})`
    + `&order=metrics_at.nullsfirst&limit=${limit}`;

  const res = await fetch(q, { headers: h });
  if (!res.ok) return { looked_at: 0, updated: 0, error: `read failed ${res.status}` };
  const rows = (await res.json()) as Array<{
    id: string; platform: string; platform_post_id: string; agency_id: string;
    property_id: string | null; comments: number | null;
  }>;
  if (!Array.isArray(rows) || !rows.length) return { looked_at: 0, updated: 0 };

  /* One token read per agency+platform. social_account_token is the only way
     a token may leave storage and it is service_role only -- decrypting the
     same secret once per row would be ten reads to answer one question. */
  /* THE TOKEN AND THE HOST THAT ACCEPTS IT, TOGETHER. They are one fact:
     an Instagram account connected through Facebook Login holds the PAGE's
     token and is addressed on graph.facebook.com, and the same account
     connected through Instagram Login is addressed on graph.instagram.com.
     Reading the token without reading auth_source is how this sweep came to
     ask the wrong host and record the silence as an answer. */
  type Account = { token: string; authSource: string };
  const accounts = new Map<string, Account | null>();
  async function accountFor(agencyId: string, platform: string): Promise<Account | null> {
    const key = agencyId + ':' + platform;
    if (accounts.has(key)) return accounts.get(key) ?? null;

    const accRes = await fetch(
      `${SB_URL}/rest/v1/social_accounts?select=id,auth_source&agency_id=eq.${agencyId}`
      + `&platform=eq.${platform}&is_active=is.true&deleted_at=is.null&limit=1`,
      { headers: h },
    );
    const accs = accRes.ok ? await accRes.json().catch(() => []) : [];
    const row = Array.isArray(accs) && accs[0] ? accs[0] : null;
    if (!row?.id) { accounts.set(key, null); return null; }

    const tRes = await fetch(`${SB_URL}/rest/v1/rpc/social_account_token`, {
      method: 'POST', headers: h,
      body: JSON.stringify({ p_account_id: row.id }),
    });
    const tok = tRes.ok ? await tRes.json().catch(() => null) : null;
    const value: Account | null = (typeof tok === 'string' && tok)
      ? { token: tok, authSource: row.auth_source === 'facebook_login'
            ? 'facebook_login' : 'instagram_login' }
      : null;

    accounts.set(key, value);
    return value;
  }

  /* ── the comments, read back and filed ────────────────────────────────
     Two platforms, two field names for the same three facts, one shape out.
     Normalised here so nothing downstream -- the upsert, the portal, a person
     reading a log -- has to know which platform a row came from to read it.

     WHAT IS TAKEN AND WHAT IS LEFT. The handle and the text, because a reply
     is addressed to the first and about the second. Not the commenter's
     profile id, not their picture, not anything that would let a row here be
     joined to a row there into a record of a person who has never used
     Synapse. The table's comment says the same thing; this is where it is
     actually true or not.

     Fifty is the cap. A property post with more than fifty comments is a
     result worth someone's whole attention rather than a card, and paging
     through hundreds on a background sweep spends rate limit that posts going
     out on time need more. */
  async function readComments(
    row: { id: string; platform: string; platform_post_id: string;
           agency_id: string; property_id: string | null },
    account: Account,
  ): Promise<number> {
    const isIg = row.platform === 'instagram';
    const host = isIg
      ? (account.authSource === 'facebook_login' ? FB_GRAPH : IG_GRAPH)
      : FB_GRAPH;
    const fields = isIg
      ? 'id,text,username,timestamp'
      : 'id,message,created_time,from{name}';

    const r = await fetch(
      `${host}/${encodeURIComponent(row.platform_post_id)}/comments`
      + `?fields=${encodeURIComponent(fields)}&limit=50`
      + `&access_token=${encodeURIComponent(account.token)}`,
    );
    if (!r.ok) {
      /* The most likely cause by far is a missing scope: comment text needs
         instagram_manage_comments, and an account connected before that was
         asked for holds a token that will never have it. Naming the status
         rather than swallowing it is what makes that diagnosable from a log
         instead of from a guess. */
      console.error('post-metrics: comments ' + r.status + ' for post ' + row.id
        + ' on ' + host + ' (a 403 here usually means the token predates the '
        + 'comment scope and the account needs reconnecting)');
      return 0;
    }

    const j = await r.json().catch(() => ({}));
    const data = Array.isArray(j?.data) ? j.data : [];
    if (!data.length) return 0;

    const payload = data.map((c: Record<string, unknown>) => ({
      social_post_id: row.id,
      agency_id: row.agency_id,
      property_id: row.property_id,
      platform: row.platform,
      platform_comment_id: String(c.id ?? ''),
      author_handle: isIg
        ? (typeof c.username === 'string' ? c.username : null)
        : ((c.from as Record<string, unknown>)?.name as string ?? null),
      body: isIg
        ? (typeof c.text === 'string' ? c.text : null)
        : (typeof c.message === 'string' ? c.message : null),
      commented_at: (isIg ? c.timestamp : c.created_time) ?? null,
      fetched_at: new Date().toISOString(),
    })).filter((c: { platform_comment_id: string }) => c.platform_comment_id);

    if (!payload.length) return 0;

    /* merge-duplicates, keyed on the platform's own comment id. An edited
       comment updates in place and a comment already seen does not duplicate.
       handled_at is deliberately absent from the payload: PostgREST only
       updates the columns it is sent, so a comment an agent has already dealt
       with does not come back unhandled because somebody fixed a typo in it. */
    const up = await fetch(
      `${SB_URL}/rest/v1/social_comments`
      + '?on_conflict=platform,platform_comment_id',
      {
        method: 'POST',
        headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload),
      },
    );
    if (!up.ok) {
      console.error('post-metrics: could not file ' + payload.length
        + ' comments for post ' + row.id + ': ' + up.status
        + ' ' + (await up.text().catch(() => '')));
      return 0;
    }
    return payload.length;
  }

  let updated = 0;
  let filed = 0;
  const results: unknown[] = [];

  for (const row of rows) {
    const account = await accountFor(row.agency_id, row.platform);
    /* Revoked or disconnected since publishing. metrics_at is NOT moved: the
       numbers are genuinely unknown and should stay unknown, and the next
       sweep should look again in case the agency reconnects. */
    if (!account) { results.push({ id: row.id, skipped: 'no token' }); continue; }
    const token = account.token;

    let likes: number | null = null;
    let comments: number | null = null;
    let shares: number | null = null;
    /* Distinguishes "asked, and the answer was nothing" from "never got an
       answer". Only the first is worth writing down. */
    let read = false;
    let why = '';

    try {
      if (row.platform === 'instagram') {
        /* THE HOST COMES FROM THE ACCOUNT. Same media id, same fields --
           only the host differs, and a Page token sent to
           graph.instagram.com is refused with an error that never mentions
           the host. social-publish picks its host the same way, from the
           same column, which is the point of the column. */
        const host = account.authSource === 'facebook_login' ? FB_GRAPH : IG_GRAPH;
        const r = await fetch(
          `${host}/${encodeURIComponent(row.platform_post_id)}`
          + `?fields=like_count,comments_count&access_token=${encodeURIComponent(token)}`,
        );
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          likes = num(j.like_count);
          comments = num(j.comments_count);
          /* Instagram does not expose a share count on a media object. null
             rather than 0, which would assert nobody shared it. */
          shares = null;
          read = true;
        } else {
          why = 'instagram ' + r.status + ' on ' + host;
        }
      } else {
        const r = await fetch(
          `${FB_GRAPH}/${encodeURIComponent(row.platform_post_id)}`
          + '?fields=likes.summary(true).limit(0),comments.summary(true).limit(0),shares'
          + `&access_token=${encodeURIComponent(token)}`,
        );
        if (r.ok) {
          const j = await r.json().catch(() => ({}));
          /* limit(0) asks for the COUNT without the rows. Without it Graph
             returns the first 25 likers, which is both slower and more
             personal data than this needs. */
          likes = num(j?.likes?.summary?.total_count);
          comments = num(j?.comments?.summary?.total_count);
          shares = num(j?.shares?.count);
          read = true;
        } else {
          why = 'facebook ' + r.status;
        }
      }
    } catch (err) {
      why = 'threw: ' + (err instanceof Error ? err.message : String(err));
    }

    /* A FAILED READ IS NOT A RESULT. Stamping metrics_at after a refused
       request marks the post as measured, hides the failure from every
       report, and sends the sweep round again an hour later to fail the same
       way in the same silence. Same rule as a missing token: leave it
       unknown, look again next time, and say so in the log. */
    if (!read) {
      console.error('post-metrics: ' + row.platform + ' post ' + row.id + ' not read: ' + why);
      results.push({ id: row.id, platform: row.platform, skipped: why || 'read failed' });
      continue;
    }

    /* THE TEXT, WHEN THERE IS NEW TEXT TO HAVE. Fetched before the count is
       written, so a failure to file the comments leaves the OLD count on the
       row and the next sweep tries again. Write the new count first and the
       post looks unchanged forever after a single bad request. */
    let got = 0;
    if (comments !== null && comments > 0 && comments !== row.comments) {
      got = await readComments(row, account);
      filed += got;
    }

    const patch = { likes, comments, shares, metrics_at: new Date().toISOString() };
    const up = await fetch(`${SB_URL}/rest/v1/social_posts?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (up.ok) updated++;
    results.push({ id: row.id, platform: row.platform, ...patch, comments_filed: got, written: up.ok });
  }

  return { looked_at: rows.length, updated, comments_filed: filed, results };
}

async function sweep(limit: number): Promise<Response> {
  if (!SB_URL || !SERVICE_KEY) return json({ error: 'Server misconfigured' }, 500);
  const h = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  const q = `${SB_URL}/rest/v1/social_posts`
    + '?select=id,platform,platform_post_id'
    + '&deleted_at=is.null&status=eq.published&provider=eq.trypost'
    + '&platform_post_id=not.is.null'
    + `&or=(metrics_at.is.null,metrics_at.lt.${new Date(Date.now() - 3600e3).toISOString()})`
    + `&order=metrics_at.nullsfirst&limit=${limit}`;

  /* Meta-published posts first, and independently: they are a different
     provider asked a different way, and a trypost outage must not stop an
     agency's own numbers refreshing. */
  const meta = await sweepMeta(limit, h);

  const res = await fetch(q, { headers: h });
  if (!res.ok) return json({ error: `read failed ${res.status}`, meta }, 502);
  const rows = (await res.json()) as Array<{ id: string; platform: string; platform_post_id: string }>;
  if (!Array.isArray(rows) || !rows.length) {
    return json({ looked_at: 0, updated: 0, meta });
  }

  /* One trypost call per DISTINCT trypost post, not per row. Our Instagram,
     Facebook and X rows for one publish share a trypost id, so asking once
     and fanning the answer out is three times less rate limit for the same
     information. */
  const byTrypost = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byTrypost.get(r.platform_post_id) ?? [];
    list.push(r);
    byTrypost.set(r.platform_post_id, list);
  }

  let updated = 0;
  const results: unknown[] = [];

  for (const [tid, group] of byTrypost) {
    let payload: Record<string, unknown> | null = null;
    try {
      const m = await fetch(`${TRYPOST_URL}/api/posts/${encodeURIComponent(tid)}/metrics`, {
        headers: { Authorization: `Bearer ${TRYPOST_API_KEY}`, Accept: 'application/json' },
      });
      if (m.ok) payload = await m.json().catch(() => null);
    } catch { /* unreachable: leave payload null and move on */ }

    const platforms = Array.isArray((payload as { platforms?: unknown })?.platforms)
      ? ((payload as { platforms: Array<Record<string, unknown>> }).platforms)
      : [];

    for (const row of group) {
      const entry = platforms.find(
        (p) => String(p.platform ?? '').toLowerCase() === String(row.platform).toLowerCase(),
      );
      const metrics = entry?.metrics;
      const patch = {
        likes: metricValue(metrics, 'Likes'),
        comments: metricValue(metrics, 'Comments'),
        shares: metricValue(metrics, 'Shares'),
        metrics_at: new Date().toISOString(),
      };
      const up = await fetch(`${SB_URL}/rest/v1/social_posts?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { ...h, Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
      if (up.ok) updated++;
      results.push({ id: row.id, platform: row.platform, ...patch, written: up.ok });
    }
  }

  return json({
    looked_at: rows.length, trypost_calls: byTrypost.size, updated, results, meta,
  });
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

  /* THE SWEEP, and it is a different function wearing the same name.

     The path below answers a signed-in agency about posts it can already
     see, using ITS token, and writes nothing. This one has no user at all:
     refresh_social_metrics calls it from pg_cron with the service role,
     because engagement has to land on the row whether or not anybody has a
     browser open. That is the entire reason it exists -- a comment count
     that only exists while a panel is open cannot appear on a card.

     Service role only. It reads across every agency and writes to
     social_posts, so a signed-in user reaching it would be a way to learn
     what other agencies are posting. Compared against the key rather than
     a role claim: the key IS the proof here, and the alternative is
     trusting a JWT we did not mint. */
  if (body.action === 'sweep') {
    const bearer = auth.replace(/^Bearer\s+/i, '').trim();
    if (!SERVICE_KEY || bearer !== SERVICE_KEY) {
      return json({ error: 'The sweep is for the scheduler, not for a session.' }, 403);
    }
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 50);
    return await sweep(limit);
  }

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
