/**
 * social-publish -- drains the social queue through a provider adapter.
 *
 * WHY THIS EXISTS IN THIS SHAPE
 * The pipeline is complete and the provider is one swappable function. The
 * mock adapter records exactly what WOULD be sent and returns a synthetic id;
 * the real adapters sit beside it. Connecting an account and clearing dry_run
 * on a row is all that stands between a rehearsal and a real post.
 *
 * THE RULE THAT MATTERS
 * A dry run must never be mistakable for a real post. `dry_run` is stamped on
 * the row at queue time and cannot be changed afterwards, the adapter that
 * handled it is recorded in `provider`, and the exact payload is kept in
 * `payload`. Nothing here may write `published` with `dry_run = true` and no
 * network call behind it without that being visible in the row.
 *
 * Mirrors send-outbox deliberately: same atomic claim, same retry ladder, same
 * agency scoping. That pattern is already proven here.
 *
 * POST { limit?: number, live?: boolean }
 *   live:true still only sends rows that were queued with dry_run = false.
 *   Two independent switches, because publishing is public and irreversible.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-injected).
 * Tokens come from social_account_token, never from the environment.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
/* Inlined rather than imported from ../_shared. The import escapes the
   function's own directory, which the deploy flattens away -- the file simply
   is not there at runtime, and the failure is a cold-start module error rather
   than anything visible in the code. social-connect already inlines these for
   the same reason. Keep in step with _shared/cors.ts. */
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

interface QueuedPost {
  id: string;
  agency_id: string;
  property_id: string | null;
  platform: string;
  caption: string | null;
  media_urls: string[];
  attempts: number;
  max_attempts: number;
  dry_run: boolean;
}

interface PublishResult {
  ok: boolean;
  postId: string | null;
  provider: string;
  error: string;
  /** Exactly what was, or would have been, sent. Stored either way. */
  payload: Record<string, unknown>;
}

/* -- adapters ---------------------------------------------------------------
   Each takes a queued post plus the agency's connection for that platform, and
   returns a PublishResult. Adding a real provider means adding one entry here;
   nothing else in this file changes. */

/** What a real adapter needs beyond the post: which account it is posting as,
 *  and the token to post with. Read once per platform per batch, through the
 *  one path tokens are allowed to leave storage by -- `social_account_token`,
 *  which is service_role only. */
interface Connection {
  accountId: string;
  /** The IG user id or the Facebook Page id -- whatever the provider addresses. */
  platformAccountId: string;
  username: string;
  token: string;
}

type Adapter = (post: QueuedPost, conn: Connection) => Promise<PublishResult>;

/** Builds the request body a real adapter would send. Shared by every adapter
 *  so the rehearsal record is the same shape as the real one. */
function buildPayload(post: QueuedPost): Record<string, unknown> {
  return {
    platform: post.platform,
    caption: post.caption ?? '',
    caption_length: (post.caption ?? '').length,
    media: post.media_urls,
    media_count: post.media_urls.length,
    property_id: post.property_id,
  };
}

/**
 * The mock. Makes no network call, and says so in every field it writes.
 * Its post id is deliberately prefixed and obviously synthetic -- nobody should
 * be able to paste it into a provider dashboard and wonder why it 404s.
 */
const mockAdapter: Adapter = (post) =>
  Promise.resolve({
    ok: true,
    postId: 'mock_' + post.platform + '_' + crypto.randomUUID().slice(0, 8),
    provider: 'mock',
    error: '',
    payload: { ...buildPayload(post), dispatched: false, note: 'No network call was made.' },
  });

/**
 * Providers we have not written an adapter for. Returning a clear "not
 * implemented" is honest; a stub that pretends to succeed would put a fake post
 * id in a row marked as live.
 */
const notConfigured = (name: string): Adapter => (post) =>
  Promise.resolve({
    ok: false,
    postId: null,
    provider: name,
    error: name + ' publishing is not implemented on this project yet.',
    payload: buildPayload(post),
  });

/* -- Meta Graph -------------------------------------------------------------
   Instagram and Facebook are the same API with different nouns, so they share
   one caller. Meta returns errors inside a 200 as often as not, which is why
   the body is inspected rather than only the status. */

const IG_GRAPH = 'https://graph.instagram.com/v21.0';
const FB_GRAPH = 'https://graph.facebook.com/v21.0';

class GraphError extends Error {
  detail: Record<string, unknown>;
  constructor(message: string, detail: Record<string, unknown>) {
    super(message);
    this.detail = detail;
  }
}

async function graph(
  host: string,
  path: string,
  params: Record<string, string>,
  method: 'GET' | 'POST' = 'POST',
): Promise<Record<string, any>> {
  const qs = new URLSearchParams(params);
  const res = method === 'GET'
    ? await fetch(host + path + '?' + qs.toString())
    : await fetch(host + path, { method: 'POST', body: qs });

  const body = await res.json().catch(() => ({} as Record<string, any>));
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    /* Meta's own message is the useful one and is written for a human -- it
       says "The account is not a professional account" rather than "code 100".
       Pass it through instead of paraphrasing, and keep the codes for support. */
    throw new GraphError(
      e.message ?? ('HTTP ' + res.status + ' from ' + host),
      { code: e.code, subcode: e.error_subcode, type: e.type, fbtrace_id: e.fbtrace_id, status: res.status },
    );
  }
  return body;
}

/** Meta will not fetch media from a URL it cannot reach, and a signed URL that
 *  expires mid-publish fails halfway through a carousel. Catch it here, where
 *  the message can name the URL, rather than as a generic Graph error. */
function checkMedia(post: QueuedPost, max: number): string {
  if (!post.media_urls.length) return 'This post has no media, and Meta requires at least one image.';
  if (post.media_urls.length > max) {
    return 'Meta accepts at most ' + max + ' items in one post; this has ' + post.media_urls.length + '.';
  }
  const bad = post.media_urls.find((u) => !/^https:\/\//i.test(u));
  if (bad) return 'Media must be a public https URL Meta can fetch. Got: ' + bad.slice(0, 80);
  return '';
}

/* An Instagram container is built asynchronously: Meta fetches the image on its
   own schedule, and publishing before it is FINISHED fails. Poll rather than
   sleep-and-hope, and give up before the function's own wall clock does -- a
   timeout that reports honestly is worth more than one that gets killed. */
async function waitForContainer(host: string, id: string, token: string): Promise<void> {
  const deadline = Date.now() + 45000;
  let delay = 1000;
  for (;;) {
    const r = await graph(host, '/' + id, { fields: 'status_code,status', access_token: token }, 'GET');
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      throw new GraphError(
        'Instagram could not process the media: ' + (r.status ?? r.status_code),
        { status_code: r.status_code },
      );
    }
    if (Date.now() + delay > deadline) {
      throw new GraphError(
        'Instagram was still processing the media after 45 seconds. The post stays queued and will be retried.',
        { status_code: r.status_code },
      );
    }
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(delay * 2, 8000);
  }
}

/**
 * Instagram. Two shapes: one image is a single container, several are carousel
 * children gathered into a parent. Both end at /media_publish, which is the
 * only call that actually makes anything public.
 */
const instagramAdapter: Adapter = async (post, conn) => {
  const payload: Record<string, unknown> = {
    ...buildPayload(post), account: conn.username, ig_user_id: conn.platformAccountId,
  };
  const bad = checkMedia(post, 10);
  if (bad) return { ok: false, postId: null, provider: 'instagram', error: bad, payload };

  try {
    const caption = post.caption ?? '';
    let creationId: string;

    if (post.media_urls.length === 1) {
      const c = await graph(IG_GRAPH, '/' + conn.platformAccountId + '/media', {
        image_url: post.media_urls[0],
        caption: caption,
        access_token: conn.token,
      });
      creationId = c.id;
      await waitForContainer(IG_GRAPH, creationId, conn.token);
    } else {
      /* Children carry no caption of their own -- the parent holds it. Built in
         sequence rather than in parallel: Meta rate-limits container creation
         per IG user, and a burst of ten is the reliable way to hit it. */
      const children: string[] = [];
      for (const url of post.media_urls) {
        const child = await graph(IG_GRAPH, '/' + conn.platformAccountId + '/media', {
          image_url: url,
          is_carousel_item: 'true',
          access_token: conn.token,
        });
        children.push(child.id);
      }
      for (const id of children) await waitForContainer(IG_GRAPH, id, conn.token);

      const parent = await graph(IG_GRAPH, '/' + conn.platformAccountId + '/media', {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption: caption,
        access_token: conn.token,
      });
      creationId = parent.id;
      await waitForContainer(IG_GRAPH, creationId, conn.token);
      payload.carousel_children = children;
    }

    const published = await graph(IG_GRAPH, '/' + conn.platformAccountId + '/media_publish', {
      creation_id: creationId,
      access_token: conn.token,
    });

    return {
      ok: true,
      postId: String(published.id),
      provider: 'instagram',
      error: '',
      payload: { ...payload, creation_id: creationId, dispatched: true },
    };
  } catch (err) {
    const detail = err instanceof GraphError ? err.detail : {};
    return {
      ok: false, postId: null, provider: 'instagram',
      error: err instanceof Error ? err.message : 'Unknown Instagram error',
      payload: { ...payload, meta_error: detail },
    };
  }
};

/**
 * Facebook Pages. One photo posts directly; several are uploaded unpublished
 * and then attached to a single feed story, so the agency's page shows one post
 * with a gallery rather than six separate photo posts in a row.
 */
const facebookAdapter: Adapter = async (post, conn) => {
  const payload: Record<string, unknown> = {
    ...buildPayload(post), account: conn.username, page_id: conn.platformAccountId,
  };
  const bad = checkMedia(post, 10);
  if (bad) return { ok: false, postId: null, provider: 'facebook', error: bad, payload };

  try {
    const caption = post.caption ?? '';

    if (post.media_urls.length === 1) {
      const photo = await graph(FB_GRAPH, '/' + conn.platformAccountId + '/photos', {
        url: post.media_urls[0],
        caption: caption,
        access_token: conn.token,
      });
      return {
        ok: true,
        postId: String(photo.post_id ?? photo.id),
        provider: 'facebook',
        error: '',
        payload: { ...payload, photo_id: photo.id, dispatched: true },
      };
    }

    const ids: string[] = [];
    for (const url of post.media_urls) {
      const photo = await graph(FB_GRAPH, '/' + conn.platformAccountId + '/photos', {
        url: url,
        published: 'false',
        access_token: conn.token,
      });
      ids.push(photo.id);
    }

    const attached: Record<string, string> = {};
    ids.forEach((id, i) => {
      attached['attached_media[' + i + ']'] = JSON.stringify({ media_fbid: id });
    });

    const story = await graph(FB_GRAPH, '/' + conn.platformAccountId + '/feed', {
      message: caption,
      ...attached,
      access_token: conn.token,
    });

    return {
      ok: true,
      postId: String(story.id),
      provider: 'facebook',
      error: '',
      payload: { ...payload, photo_ids: ids, dispatched: true },
    };
  } catch (err) {
    const detail = err instanceof GraphError ? err.detail : {};
    return {
      ok: false, postId: null, provider: 'facebook',
      error: err instanceof Error ? err.message : 'Unknown Facebook error',
      payload: { ...payload, meta_error: detail },
    };
  }
};

const ADAPTERS: Record<string, Adapter> = {
  mock: mockAdapter,
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  tiktok: notConfigured('TikTok'),
  linkedin: notConfigured('LinkedIn'),
  x: notConfigured('X'),
};

/** No connection for this platform. Distinct from "not implemented": the
 *  adapter exists and works, nobody has connected an account to it. */
function notConnected(platform: string): string {
  return 'No ' + platform + ' account is connected to this agency. Connect one in the portal, then publish.';
}

/** A dry run always goes to the mock, whatever the platform -- that is what
 *  makes it a rehearsal. */
function adapterFor(post: QueuedPost, live: boolean): Adapter {
  if (post.dry_run || !live) return ADAPTERS.mock;
  return ADAPTERS[post.platform] ?? notConfigured(post.platform);
}

/** Stands in for a Connection when the batch is a rehearsal. The mock never
 *  reads it, and no token is fetched for a run that makes no network call. */
const NO_CONNECTION: Connection = {
  accountId: '', platformAccountId: '', username: 'rehearsal', token: '',
};

/**
 * Loads the agency's live connections, one per platform, and the token for
 * each. Tokens are read once per batch rather than once per post: a batch of
 * ten Instagram posts is one decrypt, not ten.
 *
 * A platform with no row here is not connected, which is a different failure
 * from a platform we cannot publish to at all -- the caller distinguishes them.
 */
async function loadConnections(
  admin: ReturnType<typeof createClient>,
  agencyId: string,
  platforms: string[],
): Promise<Record<string, Connection>> {
  const out: Record<string, Connection> = {};
  if (!platforms.length) return out;

  const { data: accounts } = await admin
    .from('social_accounts')
    .select('id, platform, platform_account_id, platform_username')
    .eq('agency_id', agencyId)
    .in('platform', platforms)
    .eq('is_active', true)
    .is('deleted_at', null);

  for (const a of (accounts ?? []) as Array<Record<string, string>>) {
    const { data: token } = await admin.rpc('social_account_token', { p_account_id: a.id });
    if (!token) continue;   // connected but revoked: treated as not connected
    out[a.platform] = {
      accountId: a.id,
      platformAccountId: a.platform_account_id,
      username: a.platform_username,
      token: token as unknown as string,
    };
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!serviceKey) return json({ error: 'Server misconfigured: no service role key' }, 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const admin = createClient(url, serviceKey);
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    /* Who is asking, and for whom. The drain runs as the service role, so
       without this any signed-in account could push another agency's queue
       out in public. */
    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not authenticated' }, 401);

    const { data: membership } = await admin
      .from('agency_members')
      .select('agency_id, role')
      .eq('profile_id', user.id)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (!membership) return json({ error: 'You are not a member of an agency' }, 403);
    if (!['agent', 'agency_admin', 'agency_owner'].includes(membership.role as string)) {
      return json({ error: 'You cannot publish for this agency' }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as { limit?: number; live?: boolean };
    const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 50);
    const live = body.live === true;

    const { data: claimed, error: claimErr } = await admin.rpc('claim_social_batch', {
      p_agency_id: membership.agency_id,
      p_limit: limit,
    });
    if (claimErr) return json({ error: `Could not claim work: ${claimErr.message}` }, 500);

    const rows = (claimed ?? []) as QueuedPost[];
    if (!rows.length) {
      return json({ claimed: 0, published: 0, failed: 0, dryRun: 0, results: [] });
    }

    /* Tokens are fetched once for the whole batch, and only for a live run --
       a rehearsal decrypts nothing, because it sends nothing. */
    const connections = live
      ? await loadConnections(admin, membership.agency_id as string,
          [...new Set(rows.filter((r) => !r.dry_run).map((r) => r.platform))])
      : {};

    let published = 0;
    let failed = 0;
    let dryRun = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const post of rows) {
      const rehearsal = post.dry_run || !live;
      const conn = rehearsal ? NO_CONNECTION : connections[post.platform];

      /* No connected account is a different failure from a platform we cannot
         publish to at all, and it is the one the agency can fix themselves. It
         is reported without an attempt, so a missing connection never burns a
         retry or waits out a backoff. */
      const result: PublishResult = (!rehearsal && !conn && ADAPTERS[post.platform] && ADAPTERS[post.platform] !== ADAPTERS.mock)
        ? {
            ok: false, postId: null, provider: post.platform,
            error: notConnected(post.platform),
            payload: buildPayload(post),
          }
        : await adapterFor(post, live)(post, conn ?? NO_CONNECTION);
      if (post.dry_run || !live) dryRun++;

      if (result.ok) {
        await admin
          .from('social_posts')
          .update({
            status: 'published',
            platform_post_id: result.postId,
            provider: result.provider,
            payload: result.payload,
            published_at: new Date().toISOString(),
            failure_reason: null,
          })
          .eq('id', post.id);
        published++;
        results.push({
          id: post.id, platform: post.platform, status: 'published',
          provider: result.provider, dryRun: post.dry_run, postId: result.postId,
        });
        continue;
      }

      // attempts was incremented by the claim, so this row has had `attempts`
      // tries including the one that just failed.
      const exhausted = post.attempts >= post.max_attempts;
      // Widening backoff: 1 min, then 5, then 25. A provider that is down
      // stays down for a while.
      const delayMinutes = Math.pow(5, Math.max(0, post.attempts - 1));
      const nextAttempt = new Date(Date.now() + delayMinutes * 60_000).toISOString();

      await admin
        .from('social_posts')
        .update(
          exhausted
            ? { status: 'failed', failure_reason: result.error, provider: result.provider, payload: result.payload }
            : { status: 'scheduled', failure_reason: result.error, provider: result.provider,
                payload: result.payload, scheduled_at: nextAttempt },
        )
        .eq('id', post.id);

      failed++;
      results.push({
        id: post.id, platform: post.platform,
        status: exhausted ? 'failed' : 'scheduled',
        provider: result.provider, error: result.error,
      });
    }

    return json({
      claimed: rows.length,
      published,
      failed,
      dryRun,
      // Stated plainly so a caller cannot mistake a rehearsal for a send.
      note: dryRun === rows.length
        ? 'Every post in this batch was a rehearsal. No network call was made.'
        : undefined,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`social-publish fatal: ${message}`);
    return json({ error: message }, 500);
  }
});
