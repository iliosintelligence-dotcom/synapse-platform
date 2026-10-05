/**
 * synapse-studio — the back end of the Synapse studio (app/synapse.html).
 *
 * Synapse's own social media team works here, separately from the agency
 * portal. Two kinds of caller:
 *
 *   STAFF (a signed-in person whose synapse_staff_role() is not null): the
 *   page's actions below. Everything is checked against that role before
 *   anything else happens, and the studio never hands the page a table: it
 *   gets the answers the functions give.
 *
 *   THE SCHEDULER (the service role key as the bearer): publish_due and
 *   confirm_delivery, called by the drain-synapse-posts and
 *   confirm-synapse-posts cron jobs. Nobody else may call those two.
 *
 * ACCOUNTS LIVE IN TRYPOST. A Synapse channel is a TryPost social account;
 * Synapse stores its id, never a token. TryPost has no API to start a new
 * connection, so the manager connects an account inside TryPost, and this
 * function lists what TryPost holds (GET /api/social-accounts) so the page
 * can add it as a channel.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * TRYPOST_URL, TRYPOST_API_KEY, ANTHROPIC_API_KEY (captions only).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

type Admin = ReturnType<typeof createClient>;
type Row = Record<string, unknown>;

const TRYPOST_URL = (Deno.env.get('TRYPOST_URL') ?? '').replace(/\/+$/, '');
const TRYPOST_KEY = Deno.env.get('TRYPOST_API_KEY') ?? '';
const trypostOn = () => Boolean(TRYPOST_URL && TRYPOST_KEY);
const tpHeaders = () => ({
  Authorization: 'Bearer ' + TRYPOST_KEY, 'Content-Type': 'application/json', Accept: 'application/json',
});

/* Our platform -> TryPost content type. The same map social-publish uses for
   Synapse's own channels. A platform missing here cannot be posted from the
   studio yet. */
const CONTENT_TYPE: Record<string, string> = {
  instagram: 'instagram_feed', facebook: 'facebook_post', tiktok: 'tiktok_photo',
  linkedin: 'linkedin_page_post', x: 'x_post',
};
const NEEDS_MEDIA = new Set(['instagram', 'tiktok']);
const LABEL: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X', telegram: 'Telegram',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!serviceKey) return json({ error: 'Server misconfigured' }, 500);
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const body = (await req.json().catch(() => ({}))) as Row;
    const action = String(body.action ?? '');
    const admin = createClient(url, serviceKey);

    /* THE SCHEDULER */
    if (bearer === serviceKey) {
      if (action === 'publish_due') return json(await publishDue(admin));
      if (action === 'confirm_delivery') return json(await confirmDelivery(admin));
      return json({ error: 'Not a scheduler action' }, 403);
    }

    /* STAFF */
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not authenticated' }, 401);
    const { data: role } = await userClient.rpc('synapse_staff_role');
    if (!role) return json({ error: 'Not allowed' }, 403);

    /* A founder (platform admin) or a studio admin may manage who is on the team. */
    const canManage = role === 'platform_admin' || role === 'admin';

    switch (action) {
      case 'me': return json({ role, can_manage: canManage });
      case 'overview': return json(await overview(admin));
      case 'activity': return json(await rpc(admin, 'synapse_activity', { p_limit: 50 }));
      case 'trypost_accounts': return await trypostAccounts(admin);
      case 'channel_add': return await channelAdd(admin, user.id, body);
      case 'channel_update': return await channelUpdate(admin, body);
      case 'channel_remove': return await channelRemove(admin, body);
      case 'legacy_toggle': return await legacyToggle(admin, body);
      case 'settings_set': return await settingsSet(admin, body);
      case 'compose': return await compose(admin, user.id, body);
      case 'posts': return await posts(admin);
      case 'post_cancel': return await postCancel(admin, body);
      case 'suggest_caption': return await suggestCaption(body);
      case 'staff_list': return canManage ? await staffList(admin) : json({ error: 'Admins only' }, 403);
      case 'staff_add':
      case 'staff_invite': return canManage ? await staffInvite(admin, user.id, body) : json({ error: 'Admins only' }, 403);
      case 'staff_link': return canManage ? await staffLink(admin, body) : json({ error: 'Admins only' }, 403);
      case 'staff_remove': return canManage ? await staffRemove(admin, body) : json({ error: 'Admins only' }, 403);
      default: return json({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`synapse-studio fatal: ${message}`);
    return json({ error: message }, 500);
  }
});

async function rpc(admin: Admin, fn: string, args: Row = {}) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

async function overview(admin: Admin) {
  const o = (await rpc(admin, 'synapse_overview')) as Row;
  return { ...o, trypost_configured: trypostOn() };
}

/* ── accounts ──────────────────────────────────────────────────────────── */

type Acct = {
  id: string; platform: string; name: string; username: string; avatar: unknown;
  enabled: boolean; status: string; supported: boolean;
};

/** What TryPost holds, with its own platform names mapped to ours. */
async function fetchAccounts(): Promise<{ accounts: Acct[]; error?: string }> {
  if (!trypostOn()) return { accounts: [], error: 'TryPost is not configured on the server.' };
  let res: Response;
  try {
    res = await fetch(TRYPOST_URL + '/api/social-accounts', { headers: tpHeaders() });
  } catch (e) {
    return { accounts: [], error: 'Could not reach TryPost: ' + (e instanceof Error ? e.message : String(e)) };
  }
  const raw = await res.json().catch(() => null) as unknown;
  if (!res.ok) {
    /* TryPost's own words, so a 422 says what it objected to rather than only that it did. */
    return { accounts: [], error: 'TryPost answered HTTP ' + res.status + ': ' + JSON.stringify(raw).slice(0, 300) };
  }
  const list = (Array.isArray(raw) ? raw : (raw as Row)?.data ?? []) as Row[];
  /* TryPost names a Facebook-linked Instagram 'instagram-facebook' and a
     company LinkedIn 'linkedin-page'; both post as ours. */
  const NAME: Record<string, string> = { twitter: 'x', 'instagram-facebook': 'instagram', 'linkedin-page': 'linkedin' };
  const accounts = list.map((a) => {
    const rawPlatform = String(a.platform ?? '').toLowerCase();
    const platform = NAME[rawPlatform] ?? rawPlatform;
    return {
      id: String(a.id ?? ''),
      platform,
      name: String(a.display_name ?? a.name ?? a.username ?? ''),
      username: String(a.username ?? a.handle ?? ''),
      avatar: a.avatar ?? a.avatar_url ?? null,
      enabled: a.is_active !== false && a.enabled !== false,
      /* connected, token_expired or disconnected: only a connected one can post. */
      status: String(a.status ?? 'connected').toLowerCase(),
      supported: Boolean(CONTENT_TYPE[platform]),
    };
  }).filter((a) => a.id);
  return { accounts };
}

async function trypostAccounts(admin: Admin): Promise<Response> {
  const r = await fetchAccounts();
  if (r.error) return json({ error: r.error }, r.error.startsWith('TryPost is not configured') ? 503 : 502);
  const { data: mapped } = await admin.from('city_channels').select('trypost_account_id').not('trypost_account_id', 'is', null);
  const { data: legacy } = await admin.from('synapse_channels').select('trypost_account_id');
  const taken = new Set<string>([...(mapped ?? []), ...(legacy ?? [])].map((x) => String((x as Row).trypost_account_id)));
  return json({ accounts: r.accounts.map((a) => ({ ...a, added: taken.has(a.id) })) });
}

const PLATFORMS = Object.keys(CONTENT_TYPE);

async function channelAdd(admin: Admin, uid: string, b: Row): Promise<Response> {
  const accountId = String(b.trypost_account_id ?? '').trim();
  if (!accountId) return json({ error: 'Choose an account first.' }, 400);
  /* Trust TryPost's record of the account, not the page's: the platform, name
     and handle come from there, so a request cannot pair an id with the wrong
     network. */
  const r = await fetchAccounts();
  if (r.error) return json({ error: r.error }, 502);
  const acct = r.accounts.find((x) => x.id === accountId);
  if (!acct) return json({ error: 'TryPost does not have that account.' }, 400);
  if (!acct.supported) return json({ error: 'That platform cannot be added yet.' }, 400);
  if (!acct.enabled || acct.status !== 'connected') {
    return json({ error: 'That account needs reconnecting in TryPost before it can be added.' }, 400);
  }
  const label = String(b.label ?? '').trim().slice(0, 80) || acct.name.slice(0, 80) || null;
  const handle = acct.username.slice(0, 80) || null;
  const city = String(b.city ?? '').trim().slice(0, 60) || null;
  /* A new channel starts quiet: connected, but neither posting on its own nor
     receiving agencies' posts until the manager switches those on. */
  const { data, error } = await admin.from('city_channels').insert({
    platform: acct.platform, trypost_account_id: accountId, label, handle, title: label, city,
    is_active: true, autopilot: false, mirror_agency_posts: false, added_by: uid,
    daily_cap: 3, min_gap: '3 hours', window_start: 9, window_end: 20,
  }).select('id').single();
  if (error) {
    return json({ error: /duplicate|unique/i.test(error.message) ? 'That account is already a channel.' : error.message }, 400);
  }
  return json({ ok: true, id: (data as Row).id });
}

async function channelUpdate(admin: Admin, b: Row): Promise<Response> {
  const id = String(b.id ?? '');
  if (!id) return json({ error: 'No channel given.' }, 400);
  const patch: Row = {};
  const int = (v: unknown, lo: number, hi: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
  };
  if ('label' in b) { const l = String(b.label ?? '').trim().slice(0, 80); patch.label = l || null; patch.title = l || null; }
  if ('city' in b) { const c = String(b.city ?? '').trim().slice(0, 60); patch.city = c || null; }
  for (const k of ['is_active', 'autopilot']) if (k in b) patch[k] = b[k] === true;
  if ('mirror' in b) patch.mirror_agency_posts = b.mirror === true;
  if ('daily_cap' in b) { const n = int(b.daily_cap, 1, 24); if (n === null) return json({ error: 'Posts a day: 1 to 24.' }, 400); patch.daily_cap = n; }
  if ('min_gap_minutes' in b) { const n = int(b.min_gap_minutes, 30, 1440); if (n === null) return json({ error: 'Gap: 30 minutes to 24 hours.' }, 400); patch.min_gap = `${n} minutes`; }
  if ('window_start' in b) { const n = int(b.window_start, 0, 23); if (n === null) return json({ error: 'Start hour: 0 to 23.' }, 400); patch.window_start = n; }
  if ('window_end' in b) { const n = int(b.window_end, 1, 24); if (n === null) return json({ error: 'End hour: 1 to 24.' }, 400); patch.window_end = n; }
  if ('repost_days' in b) { const n = int(b.repost_days, 1, 365); if (n === null) return json({ error: 'Repeat after: 1 to 365 days.' }, 400); patch.repost_after = `${n} days`; }
  if (!Object.keys(patch).length) return json({ error: 'Nothing to change.' }, 400);
  patch.updated_at = new Date().toISOString();
  const { error } = await admin.from('city_channels').update(patch).eq('id', id);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function channelRemove(admin: Admin, b: Row): Promise<Response> {
  const id = String(b.id ?? '');
  if (!id) return json({ error: 'No channel given.' }, 400);
  const { count: a } = await admin.from('social_posts').select('id', { count: 'exact', head: true }).eq('city_channel_id', id);
  const { count: c } = await admin.from('synapse_posts').select('id', { count: 'exact', head: true }).eq('channel_id', id);
  if ((a ?? 0) + (c ?? 0) > 0) {
    /* Its history stays: the posts it made are the record. Switched off, not deleted. */
    await admin.from('city_channels').update({ is_active: false, autopilot: false, mirror_agency_posts: false }).eq('id', id);
    return json({ ok: true, kept: true });
  }
  const { error } = await admin.from('city_channels').delete().eq('id', id);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, kept: false });
}

async function legacyToggle(admin: Admin, b: Row): Promise<Response> {
  const id = String(b.id ?? '');
  const { error } = await admin.from('synapse_channels').update({ is_active: b.is_active === true }).eq('id', id);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function settingsSet(admin: Admin, b: Row): Promise<Response> {
  if (typeof b.twins_enabled !== 'boolean') return json({ error: 'Nothing to change.' }, 400);
  const { error } = await admin.from('platform_settings').upsert({
    key: 'synapse_twins', value: { enabled: b.twins_enabled },
    note: 'Whether an agency post is also copied to Synapse channels (queue_synapse_twins). Set from the Synapse studio.',
  }, { onConflict: 'key' });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

/* ── posts ─────────────────────────────────────────────────────────────── */

async function compose(admin: Admin, uid: string, b: Row): Promise<Response> {
  const caption = String(b.caption ?? '').trim();
  if (!caption) return json({ error: 'Write something to post.' }, 400);
  if (caption.length > 5000) return json({ error: 'That is too long. Keep it under 5,000 characters.' }, 400);
  const media = (Array.isArray(b.media_urls) ? b.media_urls : []).map(String).filter((u) => /^https:\/\//.test(u)).slice(0, 10);
  const ids = (Array.isArray(b.channel_ids) ? b.channel_ids : []).map(String);
  if (!ids.length) return json({ error: 'Choose at least one channel.' }, 400);

  let at = new Date();
  if (b.scheduled_at) {
    const d = new Date(String(b.scheduled_at));
    if (Number.isNaN(d.getTime())) return json({ error: 'That date is not valid.' }, 400);
    if (d.getTime() > Date.now() + 90 * 86400e3) return json({ error: 'Schedule within the next 90 days.' }, 400);
    at = d.getTime() < Date.now() ? new Date() : d;
  }

  const { data: chans } = await admin.from('city_channels')
    .select('id, platform, label, handle, trypost_account_id, is_active').in('id', ids);
  const found = (chans ?? []) as Row[];
  const group = crypto.randomUUID();
  const rows: Row[] = [];
  for (const id of ids) {
    const c = found.find((x) => x.id === id);
    const name = c ? String(c.label ?? c.handle ?? c.platform) : 'that channel';
    if (!c || c.is_active !== true) return json({ error: `${name} is switched off.` }, 400);
    const p = String(c.platform);
    if (!c.trypost_account_id || !CONTENT_TYPE[p]) return json({ error: `${name} cannot take studio posts yet.` }, 400);
    if (NEEDS_MEDIA.has(p) && !media.length) return json({ error: `${LABEL[p] ?? p} needs a picture. Add one, or untick ${name}.` }, 400);
    rows.push({
      group_id: group, channel_id: id, platform: p, caption, media_urls: media,
      status: 'scheduled', scheduled_at: at.toISOString(), created_by: uid,
    });
  }
  const { error } = await admin.from('synapse_posts').insert(rows);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, count: rows.length, group_id: group, at: at.toISOString() });
}

async function posts(admin: Admin): Promise<Response> {
  const { data, error } = await admin.from('synapse_posts')
    .select('id, group_id, platform, caption, media_urls, status, scheduled_at, published_at, failure_reason, payload, channel:city_channels(label, handle, title)')
    .order('scheduled_at', { ascending: false }).limit(60);
  if (error) return json({ error: error.message }, 400);
  return json({ posts: data });
}

async function postCancel(admin: Admin, b: Row): Promise<Response> {
  const id = String(b.id ?? '');
  const { data, error } = await admin.from('synapse_posts').update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'scheduled').select('id');
  if (error) return json({ error: error.message }, 400);
  if (!(data ?? []).length) return json({ error: 'That post has already gone out or been stopped.' }, 409);
  return json({ ok: true });
}

/* ── captions ──────────────────────────────────────────────────────────── */

async function suggestCaption(b: Row): Promise<Response> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json({ error: 'Caption help is not switched on.' }, 503);
  const brief = String(b.brief ?? '').trim().slice(0, 800);
  if (!brief) return json({ error: 'Say what the post is about.' }, 400);
  const platform = LABEL[String(b.platform ?? '').toLowerCase()] ?? 'social media';
  const system = 'You write social posts for Synapse, a Nigerian real-estate platform. Synapse has an AI advisor called Tayo that '
    + 'helps buyers and renters find homes that fit how they live, and it shows agencies\' listings that are checked and kept current. '
    + 'Voice: calm, specific, warm, plain English. No hype, no pressure, no invented facts, figures or promises. '
    + 'At most two emoji, no hashtag walls (up to three relevant hashtags at the end is fine). '
    + 'Write for ' + platform + '. Return ONLY a JSON array of exactly three different caption strings.';
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5', max_tokens: 900, system,
        messages: [{ role: 'user', content: 'The post is about: ' + brief }],
      }),
    });
  } catch { return json({ error: 'Could not reach the caption writer. Try again.' }, 502); }
  const data = await res.json().catch(() => ({})) as Row;
  const text = ((data.content as Row[] | undefined)?.[0]?.text as string | undefined) ?? '';
  const m = text.match(/\[[\s\S]*\]/);
  let options: string[] = [];
  try { options = (JSON.parse(m ? m[0] : '[]') as unknown[]).map(String).filter(Boolean).slice(0, 3); } catch { /* fall through */ }
  if (!res.ok || !options.length) return json({ error: 'The caption writer did not give an answer. Try again.' }, 502);
  return json({ options });
}

/* ── the team ──────────────────────────────────────────────────────────── */

async function staffList(admin: Admin): Promise<Response> {
  const { data } = await admin.from('synapse_staff').select('profile_id, role, created_at').order('created_at');
  const out: Row[] = [];
  for (const x of (data ?? []) as Row[]) {
    const { data: u } = await admin.auth.admin.getUserById(String(x.profile_id));
    const usr = u?.user as Row | undefined;
    /* Joined = they have signed in at least once. An invitation they have not opened shows as pending. */
    out.push({
      profile_id: x.profile_id, role: x.role, email: usr?.email ?? null, added: x.created_at,
      joined: Boolean(usr?.last_sign_in_at),
    });
  }
  return json({ staff: out });
}

const SITE = 'https://www.synapsecore.dev';

/** A link that lets the person create their account, with no email involved:
 *  the same token the invitation email carries, built into our own join page. */
async function joinLink(admin: Admin, email: string): Promise<{ link?: string; error?: string }> {
  /* A brand-new address gets an 'invite'; an address that exists but never joined gets a 'magiclink'.
     Both are verified by synapse-join.html with verifyOtp. */
  for (const type of ['invite', 'magiclink'] as const) {
    const { data, error } = await admin.auth.admin.generateLink({
      type, email, options: { redirectTo: SITE + '/app/synapse-join.html', data: { synapse_team: true } },
    } as never);
    const props = (data as Row | null)?.properties as Row | undefined;
    if (!error && props?.hashed_token) {
      return { link: SITE + '/app/synapse-join.html?type=' + encodeURIComponent(String(props.verification_type ?? type))
        + '&token_hash=' + encodeURIComponent(String(props.hashed_token)) };
    }
  }
  return { error: 'Could not make a link for that address.' };
}

async function staffInvite(admin: Admin, uid: string, b: Row): Promise<Response> {
  const email = String(b.email ?? '').trim();
  const role = b.role === 'admin' ? 'admin' : 'social_manager';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'That does not look like an email address.' }, 400);
  const give = async (id: unknown) => {
    const { error } = await admin.from('synapse_staff').upsert({ profile_id: id, role, created_by: uid }, { onConflict: 'profile_id' });
    return error;
  };

  /* Someone who already has a Synapse account needs no invitation: they get access and sign in as usual. */
  const existing = await rpc(admin, 'synapse_find_user', { p_email: email });
  if (existing) {
    const err = await give(existing);
    if (err) return json({ error: err.message }, 400);
    const { data: u } = await admin.auth.admin.getUserById(String(existing));
    if ((u?.user as Row | undefined)?.last_sign_in_at) return json({ ok: true, status: 'existing' });
    /* Invited before, never opened it: a fresh link for them. */
    const j = await joinLink(admin, email);
    return json({ ok: true, status: 'pending', link: j.link ?? null });
  }

  /* A new person. EMAIL IS A SWITCH, NOT AN ASSUMPTION. The invitation email only works once the project
     sends mail through its own provider and carries supabase/templates/invite.html: Supabase's default
     sender reaches its own team members only and will not accept a custom template. Until a founder has
     done that and switched platform_settings.synapse_invite_email on, the invitation is a link to pass on. */
  const { data: flag } = await admin.from('platform_settings').select('value').eq('key', 'synapse_invite_email').maybeSingle();
  const emailReady = (flag?.value as Row | undefined)?.enabled === true;
  let sent: { error: { message?: string } | null; data?: { user?: { id: string } | null } | null } =
    { error: { message: 'Email invitations are not switched on yet: the project has no mail provider of its own.' } };
  if (emailReady) {
    sent = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: SITE + '/app/synapse-join.html', data: { synapse_team: true },
    }) as typeof sent;
  }
  if (!sent.error && sent.data?.user) {
    const err = await give(sent.data.user.id);
    if (err) return json({ error: err.message }, 400);
    return json({ ok: true, status: 'emailed' });
  }

  /* The email could not go (usually: the project has no mail provider of its own, and Supabase's default
     one delivers to its own team only). The account may or may not have been made; either way, give the
     admin a link to pass on, and say plainly why. */
  const why = String(sent.error?.message ?? 'The email could not be sent.');
  let id: unknown = await rpc(admin, 'synapse_find_user', { p_email: email });
  const j = await joinLink(admin, email);
  if (!j.link) return json({ error: 'The invitation email could not be sent (' + why + ') and a link could not be made either.' }, 502);
  if (!id) id = await rpc(admin, 'synapse_find_user', { p_email: email });
  if (!id) return json({ error: 'The invitation email could not be sent (' + why + ').' }, 502);
  const err = await give(id);
  if (err) return json({ error: err.message }, 400);
  return json({ ok: true, status: 'link', link: j.link, reason: why });
}

/** A fresh join link for someone still holding an invitation. */
async function staffLink(admin: Admin, b: Row): Promise<Response> {
  const { data: u } = await admin.auth.admin.getUserById(String(b.profile_id ?? ''));
  const email = (u?.user as Row | undefined)?.email;
  if (!email) return json({ error: 'No such person.' }, 404);
  const j = await joinLink(admin, String(email));
  if (!j.link) return json({ error: j.error ?? 'Could not make a link.' }, 502);
  return json({ ok: true, link: j.link });
}

async function staffRemove(admin: Admin, b: Row): Promise<Response> {
  const { error } = await admin.from('synapse_staff').delete().eq('profile_id', String(b.profile_id ?? ''));
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

/* ── publishing (the scheduler) ────────────────────────────────────────── */

const X_LIMIT = 280;
const X_URL = /https?:\/\/[^\s]+/g;
function xWeight(text: string): number {
  let n = 0;
  for (const ch of text.replace(X_URL, 'x'.repeat(23))) {
    const cp = ch.codePointAt(0) ?? 0;
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}
/** A caption as X takes it: within 280 weighted characters, cut at a word. */
function fitForX(caption: string): string {
  const text = (caption ?? '').trim();
  if (xWeight(text) <= X_LIMIT) return text;
  const links = text.match(X_URL) ?? [];
  const link = links[0] ?? '';
  const body = text.replace(X_URL, ' ').replace(/[ \t]+/g, ' ').trim();
  const tail = link ? '\n\n' + link : '';
  const budget = X_LIMIT - xWeight(tail);
  let cut = '';
  for (const ch of body) { if (xWeight(cut + ch + '…') > budget) break; cut += ch; }
  const space = cut.lastIndexOf(' ');
  return ((space > 0 ? cut.slice(0, space) : cut).trim() + '…' + tail).trim();
}

async function publishDue(admin: Admin) {
  if (!trypostOn()) return { error: 'TryPost is not configured', sent: 0 };
  const { data: claimed, error } = await admin.rpc('claim_synapse_posts', { p_limit: 10 });
  if (error) return { error: error.message, sent: 0 };
  let sent = 0, failed = 0;
  for (const p of (claimed ?? []) as Row[]) {
    const r = await sendOne(admin, p);
    if (r) sent++; else failed++;
  }
  return { sent, failed };
}

async function sendOne(admin: Admin, p: Row): Promise<boolean> {
  const id = String(p.id);
  const platform = String(p.platform);
  const attempts = Number(p.attempts ?? 1);
  const settle = (patch: Row) => admin.from('synapse_posts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  /* Not sent: back in the queue a few minutes on, or failed after the third try. */
  const retry = async (why: string) => {
    if (attempts >= 3) await settle({ status: 'failed', failure_reason: why });
    else await settle({ status: 'scheduled', failure_reason: why, scheduled_at: new Date(Date.now() + attempts * 2 * 60e3).toISOString() });
    return false;
  };

  const { data: ch } = await admin.from('city_channels').select('trypost_account_id, is_active').eq('id', p.channel_id).maybeSingle();
  const accountId = String((ch as Row | null)?.trypost_account_id ?? '');
  const contentType = CONTENT_TYPE[platform];
  if (!ch || (ch as Row).is_active !== true) { await settle({ status: 'failed', failure_reason: 'The channel was switched off.' }); return false; }
  if (!accountId || !contentType) { await settle({ status: 'failed', failure_reason: 'This channel has no TryPost account for ' + platform + '.' }); return false; }

  const media = ((p.media_urls as string[]) ?? []).slice(0, platform === 'x' ? 4 : 10);
  const content = platform === 'x' ? fitForX(String(p.caption ?? '')) : String(p.caption ?? '');

  let draftId = '';
  try {
    const res = await fetch(TRYPOST_URL + '/api/posts', {
      method: 'POST', headers: tpHeaders(),
      body: JSON.stringify({
        platforms: [{
          social_account_id: accountId, content_type: contentType,
          /* TikTok publishes only with a privacy level. */
          ...(platform === 'tiktok' ? { meta: { privacy_level: 'PUBLIC_TO_EVERYONE' } } : {}),
        }],
        content, media: media.map((url) => ({ url })),
      }),
    });
    const body = await res.json().catch(() => ({})) as Row;
    draftId = String(body.id ?? '');
    if (!res.ok || !draftId) {
      const why = 'TryPost refused the post (HTTP ' + res.status + '): ' + JSON.stringify(body).slice(0, 300);
      /* A 422 is TryPost saying the post itself is wrong (an expired account, a
         missing picture, a bad type); sending it again will not change that. */
      if (res.status === 422) { await settle({ status: 'failed', failure_reason: why }); return false; }
      return await retry(why);
    }
  } catch (e) {
    return await retry('Could not reach TryPost: ' + (e instanceof Error ? e.message : String(e)));
  }

  try {
    const res = await fetch(TRYPOST_URL + '/api/posts/' + encodeURIComponent(draftId), {
      method: 'PUT', headers: tpHeaders(), body: JSON.stringify({ status: 'publishing' }),
    });
    if (!res.ok) {
      /* The draft exists and did not go out. A retry would make a second one, so this stops: the person fixes it in TryPost. */
      await settle({ status: 'failed', trypost_post_id: draftId,
        failure_reason: 'TryPost made the draft but would not publish it (HTTP ' + res.status + '). It is still in TryPost: publish or delete it there.' });
      return false;
    }
  } catch (_e) {
    /* THE REPLY WAS LOST, NOT THE REQUEST. TryPost may well have started
       publishing. Calling this a failure would invite someone to send it
       again, so it is 'sent' with its outcome unknown, and the delivery check
       asks TryPost what became of it. */
    await settle({
      status: 'sent', trypost_post_id: draftId, sent_at: new Date().toISOString(), failure_reason: null,
      payload: { ...(p.payload as Row ?? {}), delivery: 'pending', uncertain: true },
    });
    return true;
  }
  await settle({
    status: 'sent', trypost_post_id: draftId, sent_at: new Date().toISOString(), failure_reason: null,
    payload: { ...(p.payload as Row ?? {}), delivery: 'pending' },
  });
  return true;
}

function pick(o: Row | null | undefined, ...keys: string[]): unknown {
  if (!o) return null;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return null;
}

/** "Sent" means TryPost accepted it. This asks whether it went live. */
async function confirmDelivery(admin: Admin) {
  if (!trypostOn()) return { error: 'TryPost is not configured', settled: 0 };
  /* Thirty days is as long as we keep asking. A post still unsettled then is
     closed as unconfirmed, so it does not sit as 'sent' for ever. */
  await admin.from('synapse_posts').update({
    status: 'failed', updated_at: new Date().toISOString(),
    failure_reason: 'TryPost never confirmed this one. Check it in TryPost.',
  }).eq('status', 'sent').lt('sent_at', new Date(Date.now() - 30 * 86400e3).toISOString());
  const { data } = await admin.from('synapse_posts').select('id, platform, trypost_post_id, payload, sent_at')
    .eq('status', 'sent').not('trypost_post_id', 'is', null)
    .gt('sent_at', new Date(Date.now() - 30 * 86400e3).toISOString())
    .order('checked_at', { ascending: true, nullsFirst: true }).limit(25);
  let settled = 0;
  for (const r of (data ?? []) as Row[]) {
    let post: Row | null = null;
    try {
      const res = await fetch(TRYPOST_URL + '/api/posts/' + encodeURIComponent(String(r.trypost_post_id)), { headers: tpHeaders() });
      if (res.ok) post = await res.json().catch(() => null) as Row | null;
    } catch { /* ask again next time */ }
    /* Asked now, whether or not TryPost answered: an unreachable post must not keep the front of the queue. */
    await admin.from('synapse_posts').update({ checked_at: new Date().toISOString() }).eq('id', r.id);
    if (!post) continue;
    const platforms = Array.isArray(post.platforms) ? post.platforms as Row[] : [];
    const entry = platforms.find((x) => String(x.platform ?? '').toLowerCase() === String(r.platform)) ?? (platforms.length === 1 ? platforms[0] : null);
    const status = String(pick(entry, 'status') ?? pick(post, 'status') ?? '').toLowerCase();
    const liveRaw = pick(entry, 'published_at', 'publishedAt');
    const liveAt = liveRaw && !Number.isNaN(Date.parse(String(liveRaw))) ? new Date(String(liveRaw)).toISOString() : null;
    const url = pick(entry, 'platform_url', 'url', 'permalink', 'post_url', 'external_url');
    const errRaw = pick(entry, 'error_message', 'error', 'failure_reason', 'errors');
    const err = errRaw === null ? '' : (typeof errRaw === 'string' ? errRaw : JSON.stringify(errRaw)).slice(0, 300);
    const payload = { ...(r.payload as Row ?? {}), trypost_status: status || null, delivery_checked_at: new Date().toISOString() };
    if (status === 'published') {
      await admin.from('synapse_posts').update({
        status: 'live', published_at: liveAt ?? new Date().toISOString(), payload: { ...payload, delivery: 'live', live_url: url ?? null },
        updated_at: new Date().toISOString(),
      }).eq('id', r.id);
      settled++;
    } else if (status === 'draft' && Date.now() - Date.parse(String(r.sent_at)) > 15 * 60e3) {
      /* Still a draft a quarter of an hour on: the publish request never
         reached TryPost. It is not going out by itself. */
      await admin.from('synapse_posts').update({
        status: 'failed', payload: { ...payload, delivery: 'failed' }, updated_at: new Date().toISOString(),
        failure_reason: 'TryPost still has this as a draft: the publish request did not reach it. Publish it in TryPost, or send it again here.',
      }).eq('id', r.id);
      settled++;
    } else if (status === 'failed') {
      await admin.from('synapse_posts').update({
        status: 'failed',
        failure_reason: 'TryPost accepted this but could not post it to ' + (LABEL[String(r.platform)] ?? String(r.platform)) + (err ? ': ' + err : '.'),
        payload: { ...payload, delivery: 'failed' }, updated_at: new Date().toISOString(),
      }).eq('id', r.id);
      settled++;
    }
  }
  return { checked: (data ?? []).length, settled };
}
