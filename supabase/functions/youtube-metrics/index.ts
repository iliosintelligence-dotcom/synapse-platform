/**
 * youtube-metrics -- views, likes and comments for the YouTube posts Synapse published.
 *
 * Called by refresh_youtube_metrics (pg_cron, at :10 and :40) only when a published YouTube post has not been read in
 * an hour. Accepts the service key and nothing else, like publish-youtube. A function of its own so it deploys, and
 * can fail, without touching publishing or the Facebook / Instagram stats in post-metrics.
 *
 * For each channel: the agency's YouTube token (social_account_token), renewed first if it is within five minutes of
 * its hour (the same renewal social-publish does, written back with update_social_account_tokens); then
 * videos.list?part=statistics for up to 50 of its videos at a time; then views / likes / comments onto each post.
 * Unlisted and private videos answer only to their own channel's token, which is why the agency's token is used and
 * not an API key. A video YouTube no longer returns (deleted by the agency) keeps its last numbers and is not asked
 * about again for an hour. A channel whose token cannot be renewed is skipped and reported; reconnecting fixes it.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { batches, statsById, YT_VIDEOS } from './stats.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Equal without leaking how much of it matched: both sides are hashed to the same length, then compared in full. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]).then((d) => d.map((buf) => new Uint8Array(buf)));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* The client is untyped (no generated database types in this repo), so its rpc arguments are typed as never; `any`
   here says so once instead of at every call. */
// deno-lint-ignore no-explicit-any
type Admin = any;
type Post = { id: string; agency_id: string; platform_post_id: string; social_account_id: string | null };
type Account = { id: string; agency_id: string; token_expires_at: string | null; connected_at: string };

async function renewedToken(admin: Admin, a: Account): Promise<string | null> {
  const { data: current } = await admin.rpc('social_account_token', { p_account_id: a.id });
  const exp = a.token_expires_at ? Date.parse(a.token_expires_at) : 0;
  if (current && exp && exp - Date.now() > 5 * 60 * 1000) return String(current);

  const id = (Deno.env.get('GOOGLE_CLIENT_ID') ?? '').trim();
  const secret = (Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '').trim();
  if (!id || !secret) return null;
  const { data: rt } = await admin.rpc('social_account_refresh_token', { p_account_id: a.id });
  if (!rt) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'refresh_token', refresh_token: String(rt) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    console.error('youtube-metrics: refresh failed for ' + a.id + ': ' + (j.error ?? r.status));
    return null;
  }
  const { error } = await admin.rpc('update_social_account_tokens', {
    p_account_id: a.id,
    p_access_token: j.access_token,
    p_refresh_token: j.refresh_token ?? null,
    p_expires_at: new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000).toISOString(),
  });
  if (error) console.error('youtube-metrics: token not saved for ' + a.id + ': ' + error.message);
  return String(j.access_token);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey) return json({ error: 'Server misconfigured: no service role key' }, 500);
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return json({ error: 'Missing Authorization header' }, 401);
  if (!(await sameSecret(bearer, serviceKey))) return json({ error: 'Only the scheduled job may call this function' }, 403);

  const body = (await req.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.min(Math.max(Number(body?.limit) || 200, 1), 500);
  const admin = createClient(url, serviceKey);
  const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: due, error: dueErr } = await admin
    .from('social_posts')
    .select('id, agency_id, platform_post_id, social_account_id')
    .eq('platform', 'youtube').eq('status', 'published').is('deleted_at', null)
    .not('platform_post_id', 'is', null)
    .or(`metrics_at.is.null,metrics_at.lt.${staleBefore}`)
    .order('metrics_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (dueErr) return json({ error: 'read failed: ' + dueErr.message }, 500);
  const posts = (due ?? []) as Post[];
  if (!posts.length) return json({ looked_at: 0, updated: 0 });

  /* The channel each post went to: the one it names, else the agency's oldest -- the same default social-publish uses. */
  const agencies = [...new Set(posts.map((p) => p.agency_id))];
  const { data: accRows } = await admin
    .from('social_accounts')
    .select('id, agency_id, token_expires_at, connected_at')
    .eq('platform', 'youtube').eq('is_active', true).is('deleted_at', null)
    .in('agency_id', agencies)
    .order('connected_at', { ascending: true });
  const accounts = (accRows ?? []) as Account[];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const firstOf = new Map<string, Account>();
  for (const a of accounts) if (!firstOf.has(a.agency_id)) firstOf.set(a.agency_id, a);

  const groups = new Map<string, Post[]>();
  const noAccount: string[] = [];
  for (const p of posts) {
    const a = (p.social_account_id && byId.get(p.social_account_id)) || firstOf.get(p.agency_id);
    if (!a) { noAccount.push(p.id); continue; }
    groups.set(a.id, [...(groups.get(a.id) ?? []), p]);
  }

  let updated = 0;
  const skipped: string[] = [];
  const now = new Date().toISOString();
  for (const [accountId, list] of groups) {
    const token = await renewedToken(admin, byId.get(accountId)!);
    if (!token) { skipped.push(accountId); continue; }
    for (const batch of batches(list)) {
      const r = await fetch(YT_VIDEOS + '?part=statistics&id=' + batch.map((p) => encodeURIComponent(p.platform_post_id)).join(','), {
        headers: { Authorization: 'Bearer ' + token },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error('youtube-metrics: videos.list ' + r.status + ' for account ' + accountId + ': ' + (j?.error?.message ?? ''));
        skipped.push(accountId);
        continue;
      }
      const stats = statsById(j.items);
      for (const p of batch) {
        const s = stats.get(p.platform_post_id);
        const patch: Record<string, unknown> = { metrics_at: now };
        if (s) { patch.views = s.views; patch.likes = s.likes; patch.comments = s.comments; }
        const { error } = await admin.from('social_posts').update(patch).eq('id', p.id);
        if (error) console.error('youtube-metrics: could not save ' + p.id + ': ' + error.message);
        else if (s) updated++;
      }
    }
  }

  /* A post with no live YouTube account is marked read too, so it is not asked about every run until reconnected. */
  if (noAccount.length) await admin.from('social_posts').update({ metrics_at: now }).in('id', noAccount);

  return json({ looked_at: posts.length, updated, channels: groups.size, skipped_channels: skipped.length, without_account: noAccount.length });
});
