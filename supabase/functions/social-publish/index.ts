/**
 * social-publish — drains the social queue through a provider adapter.
 *
 * WHY THIS EXISTS IN THIS SHAPE
 * Meta approval is pending, and TikTok is a separate review after it. Waiting
 * for either before building the pipeline would mean discovering the whole
 * thing for the first time under time pressure, on the day the token lands.
 *
 * So the pipeline is complete and the provider is one swappable function. The
 * mock adapter records exactly what WOULD be sent and returns a synthetic id;
 * the real adapters slot in beside it without anything else changing. On the
 * day approval arrives the work is: add an adapter, connect an account, flip
 * dry_run off for one post.
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
 *   live:true is refused unless a real adapter is configured AND the row was
 *   queued with dry_run = false. Two independent switches, because publishing
 *   is public and irreversible.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-injected).
 * Later, per adapter: META_PAGE_TOKEN / TIKTOK_ACCESS_TOKEN.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

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

/* ── adapters ───────────────────────────────────────────────────────────────
   Each takes a queued post and returns a PublishResult. Adding a real provider
   means adding one entry here; nothing else in this file changes. */
type Adapter = (post: QueuedPost) => Promise<PublishResult>;

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
 * Its post id is deliberately prefixed and obviously synthetic — nobody should
 * be able to paste it into a provider dashboard and wonder why it 404s.
 */
const mockAdapter: Adapter = (post) =>
  Promise.resolve({
    ok: true,
    postId: `mock_${post.platform}_${crypto.randomUUID().slice(0, 8)}`,
    provider: 'mock',
    error: '',
    payload: { ...buildPayload(post), dispatched: false, note: 'No network call was made.' },
  });

/**
 * Real providers, deliberately unimplemented rather than half-written.
 * Returning a clear "not configured" is honest; a stub that pretends to
 * succeed would put a fake post id in a row marked as live.
 */
const notConfigured = (name: string): Adapter => (post) =>
  Promise.resolve({
    ok: false,
    postId: null,
    provider: name,
    error: `${name} is not connected yet — no app credentials on this project.`,
    payload: buildPayload(post),
  });

const ADAPTERS: Record<string, Adapter> = {
  mock: mockAdapter,
  instagram: notConfigured('Instagram'),
  facebook: notConfigured('Facebook'),
  tiktok: notConfigured('TikTok'),
  linkedin: notConfigured('LinkedIn'),
  x: notConfigured('X'),
};

/** Which adapter handles this post. A dry run always goes to the mock, whatever
 *  the platform — that is what makes it a rehearsal. */
function adapterFor(post: QueuedPost, live: boolean): Adapter {
  if (post.dry_run || !live) return ADAPTERS.mock;
  return ADAPTERS[post.platform] ?? notConfigured(post.platform);
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

    let published = 0;
    let failed = 0;
    let dryRun = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const post of rows) {
      const result = await adapterFor(post, live)(post);
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
