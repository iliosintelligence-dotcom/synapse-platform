/**
 * social-publish -- drains the social queue and hands each post to its platform.
 *
 * WHAT CHANGED ON 2026-11-05
 * This file used to hold every platform's adapter (1,700 lines). Each platform
 * now has its own function -- social-facebook, social-instagram,
 * social-telegram, social-tiktok, social-x, social-youtube, social-linkedin --
 * built on one shared process (_shared/social/core.ts). What stays here is
 * the part that is the same for all of them:
 *
 *   who may drain        the scheduler (service key) or a member, for their agency
 *   claiming             claim_social_due_any / claim_social_batch, unchanged
 *   rehearsals           a dry run never leaves this file: the mock records what
 *                        WOULD be sent, and no platform function is called
 *   dispatch             POST social-<platform> {action:'publish', post_id}
 *
 * The platform function resolves the account, renews its token, sends, and
 * WRITES THE OUTCOME ITSELF. So if this function stops waiting -- a video that
 * takes minutes, a lost reply between the two -- the outcome is still saved,
 * and a post that may have gone out is never sent again on its own: a row
 * left 'publishing' for twenty minutes is settled as "check the channel" by
 * drain_social_queue.
 *
 * THE RULE THAT MATTERS, unchanged: a dry run must never be mistakable for a
 * real post. dry_run is stamped at queue time and cannot change; a rehearsal
 * is recorded with provider 'mock' and a synthetic id that says so. New: a
 * rehearsal run no longer touches a row queued for real -- it is put back in
 * the queue untouched rather than being "published" by the mock.
 *
 * POST { limit?: number, live?: boolean }
 *   live:true still only sends rows that were queued with dry_run = false.
 */
import {
  admin, buildPayload, corsHeaders, isServiceCall, json, MEMBER_ROLES, type PublishResult, type QueuedPost, SB_URL,
  SERVICE_KEY, ANON_KEY, settle,
} from '../_shared/social/core.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** The platforms with a function of their own. Anything else is refused plainly. */
const PLATFORMS = new Set(['facebook', 'instagram', 'telegram', 'tiktok', 'x', 'youtube', 'linkedin']);

/* Several posts at once, so one slow video does not hold up the batch, but
   few enough not to trip a platform's per-account rate limit. */
const CONCURRENCY = 4;
/* How long this function waits for one platform call before reporting it as
   still in progress. The platform function carries on and saves the outcome. */
const WAIT_MS = 100_000;
/* After this, no new post is started; claimed rows not yet started go back
   to the queue untouched, rather than sitting in 'publishing' for the
   twenty-minute "could not confirm" rule to catch. */
const START_BUDGET_MS = 90_000;

/** The mock: no network call, and it says so in every field it writes. */
function rehearse(post: QueuedPost): PublishResult {
  return {
    ok: true,
    postId: 'mock_' + post.platform + '_' + crypto.randomUUID().slice(0, 8),
    provider: 'mock',
    error: '',
    payload: { ...buildPayload(post), dispatched: false, note: 'No network call was made.' },
  };
}

async function dispatch(post: QueuedPost): Promise<Record<string, unknown>> {
  const call = fetch(SB_URL + '/functions/v1/social-' + post.platform, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + SERVICE_KEY, apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'publish', post_id: post.id }),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      /* The platform function itself could not run (not deployed, crashed on
         start). The row is still 'publishing'; settle it here so it is not
         left for the twenty-minute rule, and retry it later. */
      const why = 'The ' + post.platform + ' publisher did not answer (HTTP ' + r.status + ')'
        + (j?.error ? ': ' + String(j.error).slice(0, 200) : '.');
      const status = await settle(post, { ok: false, postId: null, provider: post.platform, error: why, payload: buildPayload(post) });
      return { id: post.id, platform: post.platform, leg: post.leg, status, error: why };
    }
    return j as Record<string, unknown>;
  }).catch(async (e) => {
    const why = 'Could not reach the ' + post.platform + ' publisher: ' + (e instanceof Error ? e.message : String(e));
    const status = await settle(post, { ok: false, postId: null, provider: post.platform, error: why, payload: buildPayload(post) });
    return { id: post.id, platform: post.platform, leg: post.leg, status, error: why };
  });
  const waited = new Promise<Record<string, unknown>>((res) => setTimeout(() => res({
    id: post.id, platform: post.platform, leg: post.leg, status: 'publishing',
    note: 'Still being processed by ' + post.platform + '; the outcome is saved on the post when it finishes.',
  }), WAIT_MS));
  return await Promise.race([call, waited]);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!SERVICE_KEY) return json({ error: 'Server misconfigured: no service role key' }, 500);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    /* The scheduler (drain_social_queue, every minute) proves itself with the
       service key and drains what is due across every agency. A person drains
       only their own agency's queue. */
    const scheduled = isServiceCall(req);
    const db = admin();
    let agencyId: string | null = null;
    if (!scheduled) {
      const asUser = createClient(SB_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
      const { data: { user } } = await asUser.auth.getUser();
      if (!user) return json({ error: 'Not authenticated' }, 401);
      const { data: m } = await db.from('agency_members').select('agency_id, role')
        .eq('profile_id', user.id).is('deleted_at', null).limit(1).maybeSingle();
      if (!m) return json({ error: 'You are not a member of an agency' }, 403);
      if (!MEMBER_ROLES.includes(String(m.role))) return json({ error: 'You cannot publish for this agency' }, 403);
      agencyId = String(m.agency_id);
    }

    const body = (await req.json().catch(() => ({}))) as { limit?: number; live?: boolean };
    const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 50);
    /* The scheduler always runs live and lets each row's own dry_run decide;
       a person must ask for a live run. */
    const live = scheduled ? true : body.live === true;

    const { data: claimed, error: claimErr } = scheduled
      ? await db.rpc('claim_social_due_any', { p_limit: limit })
      : await db.rpc('claim_social_batch', { p_agency_id: agencyId, p_limit: limit });
    if (claimErr) return json({ error: 'Could not claim work: ' + claimErr.message }, 500);

    const rows = ((claimed ?? []) as QueuedPost[]).map((r) => ({ ...r, media_urls: Array.isArray(r.media_urls) ? r.media_urls : [] }));
    const mode = scheduled ? 'scheduled' : 'manual';
    if (!rows.length) return json({ claimed: 0, mode, published: 0, failed: 0, dryRun: 0, results: [] });

    const started = Date.now();
    const results: Array<Record<string, unknown>> = [];
    const putBack: QueuedPost[] = [];
    let dryRun = 0;

    const queue = [...rows];
    const worker = async () => {
      for (;;) {
        const post = queue.shift();
        if (!post) return;
        if (Date.now() - started > START_BUDGET_MS) { putBack.push(post); continue; }

        /* A rehearsal of a rehearsal row: the mock, settled here. */
        if (post.dry_run) {
          dryRun++;
          const status = await settle(post, rehearse(post));
          results.push({ id: post.id, platform: post.platform, leg: post.leg, status, provider: 'mock', dryRun: true });
          continue;
        }
        /* A rehearsal RUN that claimed a row queued for real: not ours to
           touch. It goes back exactly as it was. */
        if (!live) { putBack.push(post); continue; }

        if (!PLATFORMS.has(post.platform)) {
          const why = 'Synapse does not publish to ' + post.platform + '.';
          const status = await settle(post, { ok: false, postId: null, provider: post.platform, error: why,
            payload: buildPayload(post), permanent: true });
          results.push({ id: post.id, platform: post.platform, leg: post.leg, status, error: why });
          continue;
        }
        results.push(await dispatch(post));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

    /* Back to the queue with the claim undone: status, and the attempt the
       claim counted, since no attempt was made. */
    for (const p of putBack) {
      await db.from('social_posts').update({ status: 'scheduled', attempts: Math.max(0, p.attempts - 1) })
        .eq('id', p.id).eq('status', 'publishing');
    }

    const published = results.filter((r) => r.status === 'published').length;
    const failed = results.filter((r) => r.status === 'failed' || r.status === 'scheduled').length;
    return json({
      claimed: rows.length,
      mode,
      published,
      failed,
      dryRun,
      returned_to_queue: putBack.length || undefined,
      note: dryRun === rows.length ? 'Every post in this batch was a rehearsal. No network call was made.' : undefined,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('social-publish fatal: ' + message);
    return json({ error: message }, 500);
  }
});
