/**
 * tiktok-creator-info -- what TikTok says about the account a post is going to, fresh, for the scheduler's TikTok panel.
 *
 * TikTok's Content Sharing Guidelines require the posting screen to query creator info as it opens: show which account
 * receives the post, offer exactly the privacy options TikTok returns, grey out interactions the creator disabled, and
 * stop with a reason when the creator cannot post right now. This function does that query server-side, so the token
 * never reaches the browser.
 *
 * Signed-in agency members only (verify_jwt plus a membership check), and only for a TikTok account of their own
 * agency. Off unless TIKTOK_DIRECT_POST is on: with it off the panel never asks, and this answers { enabled: false }.
 * A function of its own, so it deploys -- and can fail -- without touching connecting or publishing.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { creatorInfoFrom, TT_CREATOR_INFO } from './creator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// The client is untyped (no generated database types in this repo); `any` says so once.
// deno-lint-ignore no-explicit-any
type Admin = any;

/* A TikTok access token lasts 24 hours; renewed here when within fifteen minutes of its end, exactly as social-publish
   does (refreshTikTok), and written back with update_social_account_tokens. */
async function tokenFor(admin: Admin, accountId: string, expiresAt: string | null): Promise<string | null> {
  const exp = expiresAt ? Date.parse(expiresAt) : 0;
  if (exp && exp - Date.now() > 15 * 60 * 1000) {
    const { data } = await admin.rpc('social_account_token', { p_account_id: accountId });
    if (data) return String(data);
  }
  const key = (Deno.env.get('TIKTOK_CLIENT_KEY') ?? '').trim();
  const secret = (Deno.env.get('TIKTOK_CLIENT_SECRET') ?? '').trim();
  if (!key || !secret) return null;
  const { data: rt } = await admin.rpc('social_account_refresh_token', { p_account_id: accountId });
  if (!rt) return null;
  const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: key, client_secret: secret, grant_type: 'refresh_token', refresh_token: String(rt) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    console.error('tiktok-creator-info: refresh failed for ' + accountId + ': ' + (j.error ?? r.status));
    return null;
  }
  const { error } = await admin.rpc('update_social_account_tokens', {
    p_account_id: accountId,
    p_access_token: j.access_token,
    p_refresh_token: j.refresh_token ?? null,
    p_expires_at: new Date(Date.now() + (Number(j.expires_in) || 86400) * 1000).toISOString(),
  });
  if (error) console.error('tiktok-creator-info: token not saved for ' + accountId + ': ' + error.message);
  return String(j.access_token);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!/^(1|true|on|yes)$/i.test((Deno.env.get('TIKTOK_DIRECT_POST') ?? '').trim())) return json({ enabled: false });

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json({ error: 'Not signed in' }, 401);

  const body = (await req.json().catch(() => ({}))) as { account_id?: string };
  const admin: Admin = createClient(url, serviceKey);

  const { data: member } = await admin.from('agency_members')
    .select('agency_id').eq('profile_id', who.user.id).is('deleted_at', null).limit(1).maybeSingle();
  if (!member?.agency_id) return json({ error: 'You are not a member of an agency' }, 403);

  /* The named account, else the agency's oldest TikTok -- the same default social-publish uses -- and always this
     agency's own. */
  let q = admin.from('social_accounts')
    .select('id, token_expires_at, platform_username')
    .eq('agency_id', member.agency_id).eq('platform', 'tiktok').eq('is_active', true).is('deleted_at', null)
    .order('connected_at', { ascending: true }).limit(1);
  if (body.account_id) q = q.eq('id', String(body.account_id));
  const { data: accs } = await q;
  const acc = (accs ?? [])[0] as { id: string; token_expires_at: string | null } | undefined;
  if (!acc) return json({ ok: false, code: 'not_connected', reason: 'No TikTok account is connected. Connect one under Channels.' });

  const token = await tokenFor(admin, acc.id, acc.token_expires_at);
  if (!token) return json({ ok: false, code: 'token', reason: 'TikTok no longer accepts this connection. Reconnect TikTok under Channels.' });

  try {
    const r = await fetch(TT_CREATOR_INFO, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8' },
    });
    const j = await r.json().catch(() => null);
    return json({ ...creatorInfoFrom(r.status, j), account_id: acc.id });
  } catch (err) {
    console.error('tiktok-creator-info: query failed', err);
    return json({ ok: false, code: 'network', reason: 'Could not reach TikTok. Try again shortly.' });
  }
});
