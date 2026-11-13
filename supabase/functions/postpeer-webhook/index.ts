/**
 * postpeer-webhook -- PostPeer tells us what became of a post, and when a connected account needs logging in again.
 *
 * social-publish marks a PostPeer post 'published' with payload.delivery 'pending' the moment PostPeer accepts it, the
 * same way TryPost posts were handled ("sent is not live"). This settles it: delivery 'live' with the real time and
 * link, or the row becomes 'failed' with PostPeer's reason so it lands where failures are looked at.
 * post-metrics' delivery check (every two minutes) asks PostPeer directly for anything this missed.
 *
 * Open to the world (verify_jwt = false: PostPeer has no Supabase session), so nothing is believed until the
 * signature checks out against POSTPEER_WEBHOOK_SECRET. Repeated deliveries are harmless: every write sets a state,
 * none adds to one.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { deliveryOf, PP_NAME, ppSignatureOk } from './postpeer.ts';

const reply = (status: number, body: unknown = { ok: status < 300 }) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type PpPlatform = {
  platform?: string; status?: string; platformPostId?: string | null; platformPostUrl?: string | null;
  publishedAt?: string | null; errorMessage?: string | null; warningMessage?: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const secret = (Deno.env.get('POSTPEER_WEBHOOK_SECRET') ?? '').trim();
  if (!secret) return reply(503, { error: 'not configured' });

  const raw = await req.text();
  const ok = await ppSignatureOk(secret, req.headers.get('x-postpeer-timestamp'), raw,
    req.headers.get('x-postpeer-signature'));
  if (!ok) return reply(401, { error: 'bad signature' });

  let ev: Record<string, any> = {};
  try { ev = JSON.parse(raw); } catch { return reply(400, { error: 'not json' }); }
  const type = String(ev.type ?? '');
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  /* ── a connected account stopped working, or was disconnected at PostPeer ── */
  if (type.startsWith('account.')) {
    const acc = ev.data?.account ?? {};
    if (!acc.id) return reply(200, { ok: true, ignored: 'no account id' });
    const patch: Record<string, unknown> = type === 'account.disconnected'
      ? { is_active: false, last_error: 'Disconnected at PostPeer. Connect it again under Channels.' }
      : { last_error: 'This account needs logging in again. Connect it again under Channels.'
          + (acc.reason ? ' (' + String(acc.reason).slice(0, 60) + ')' : '') };
    const { error } = await admin.from('social_accounts').update(patch)
      .eq('auth_source', 'postpeer').eq('platform_account_id', String(acc.id)).is('deleted_at', null);
    if (error) { console.error('postpeer-webhook: account update failed', error.message); return reply(500); }
    console.log('postpeer-webhook: ' + type + ' for integration ' + acc.id);
    return reply(200);
  }

  if (!type.startsWith('post.')) return reply(200, { ok: true, ignored: type || 'no type' });
  const ppPostId = String(ev.data?.post?.id ?? '');
  if (!ppPostId) return reply(200, { ok: true, ignored: 'no post id' });
  const platforms = (Array.isArray(ev.data?.platforms) ? ev.data.platforms : []) as PpPlatform[];

  /* One PostPeer post per row of ours, so this is one row -- but read as a list, never assumed. */
  const { data: rows, error: readErr } = await admin.from('social_posts')
    .select('id, platform, status, payload')
    .eq('provider', 'postpeer').eq('platform_post_id', ppPostId).is('deleted_at', null);
  if (readErr) { console.error('postpeer-webhook: read failed', readErr.message); return reply(500); }
  if (!rows?.length) return reply(200, { ok: true, ignored: 'unknown post ' + ppPostId });

  for (const row of rows as Array<{ id: string; platform: string; status: string; payload: Record<string, unknown> | null }>) {
    const entry = platforms.find((p) => p.platform === (PP_NAME[row.platform] ?? row.platform)) ?? platforms[0];
    const status = entry?.status ?? ev.data?.post?.status ?? '';
    const delivery = deliveryOf(status);
    const now = new Date().toISOString();
    const base = { ...(row.payload ?? {}), postpeer_status: status || null, delivery_checked_at: now };
    let patch: Record<string, unknown>;
    if (delivery === 'live') {
      const liveAt = entry?.publishedAt ?? ev.data?.post?.publishedAt ?? null;
      patch = {
        payload: { ...base, delivery: 'live', live_at: liveAt, live_url: entry?.platformPostUrl ?? null,
                   native_post_id: entry?.platformPostId ?? null,
                   warning: entry?.warningMessage ?? null },
        ...(liveAt ? { published_at: liveAt } : {}),
      };
    } else if (delivery === 'failed') {
      const why = (entry?.errorMessage ?? 'PostPeer could not publish this post.').slice(0, 500);
      patch = { status: 'failed', failure_reason: why, payload: { ...base, delivery: 'failed', delivery_error: why } };
    } else {
      patch = { payload: { ...base, delivery: 'pending' } };
    }
    const { error } = await admin.from('social_posts').update(patch).eq('id', row.id);
    if (error) { console.error('postpeer-webhook: write failed for ' + row.id, error.message); return reply(500); }
    console.log('postpeer-webhook: ' + type + ' -> ' + row.id + ' ' + delivery);
  }
  return reply(200);
});
