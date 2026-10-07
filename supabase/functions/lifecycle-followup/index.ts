/**
 * lifecycle-followup: the emails that follow a registration.
 *
 * Which email is due, to whom, is decided in the database (lifecycle_due, in
 * 20261007090000_welcome_and_follow_up.sql): it knows who has added a listing,
 * who is verified, who has connected a social account, who has unsubscribed and
 * who was emailed in the last day. This function only writes the email, sends it,
 * and records that it did.
 *
 *   POST { action: 'send_due' }   service role only (the half-hourly job)
 *   GET  ?u=<token>               the unsubscribe link in every email (no sign-in)
 *
 * Env: RESEND_API_KEY (an email provider; without it nothing is sent and the call
 * says so), FOLLOWUP_FROM (default "Synapse <hello@synapsecore.dev>", the domain
 * must be verified with the provider), LIFECYCLE_SECRET (signs unsubscribe links;
 * falls back to the service key), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { isServiceCall } from '../_shared/caller.ts';

const SITE = 'https://www.synapsecore.dev';
const REPLY_TO = 'ilios.intelligence@gmail.com';

const enc = new TextEncoder();
async function sign(id: string, secret: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode('unsub:' + id)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

interface Mail { subject: string; lead: string; body: string[]; cta: string; href: string }
const first = (n: string, email: string) => (n || email.split('@')[0].replace(/[._-]+/g, ' ')).trim().split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase());

/* What each email says. Short, specific, one thing to do. */
function mail(kind: string, name: string): Mail | null {
  const hi = `Hi ${name},`;
  switch (kind) {
    case 'a_welcome': return { subject: `Welcome to Synapse, ${name}. Start here`, lead: hi, cta: 'Open your portal', href: `${SITE}/app/agency.html`, body: [
      'Your agency account is ready. Three things, in this order, get you a real result fastest:',
      '1. Add your first listing. Photos, price and a pin on the map: about three minutes. Tayo, our AI advisor, starts matching it to buyers as soon as it is live.',
      '2. Get verified. Upload your CAC certificate and your listings carry the Verified badge, which buyers look for.',
      '3. Connect your social accounts, so each listing posts itself and every enquiry is traced back to the post that brought it.',
      'Reply to this email if you get stuck. A person reads it.'] };
    case 'a_listing': return { subject: 'Your first listing takes about three minutes', lead: hi, cta: 'Add a listing', href: `${SITE}/app/agency.html#listings`, body: [
      'You have not listed a property yet, and that is the one step that turns Synapse on.',
      'Add the photos, the price and a pin on the map. Once it is live, Tayo can recommend it to buyers who are looking for exactly that, and each enquiry arrives in your pipeline already qualified.'] };
    case 'a_verify': return { subject: 'Get your Verified badge', lead: hi, cta: 'Verify my agency', href: `${SITE}/app/agency.html`, body: [
      'Buyers choose verified agencies first. Upload your CAC certificate in the portal and your listings carry the Verified badge.',
      'It is a one-time step, and it is the single biggest thing you can do to be trusted on Synapse.'] };
    case 'a_social': return { subject: 'Let your listings post themselves', lead: hi, cta: 'Connect my accounts', href: `${SITE}/app/agency.html#social`, body: [
      'Connect Instagram, Facebook or another account once, and your listings can go out to your followers with a link that credits the post when a buyer enquires.',
      'Then you can see which post actually produced which deal, and spend on what sells.'] };
    case 'a_team': return { subject: 'Add your agents to Synapse', lead: hi, cta: 'Add my team', href: `${SITE}/app/agency.html#agents`, body: [
      'You are the only person on your agency here. Agencies get more from Synapse when the agents who handle the enquiries are on it too.',
      'Add each agent from the Agents page: they can post listings and social posts for the agency, and each lead is traced to the agent who handles it, so you can see who is closing and who needs help.'] };
    case 'a_proximity': return { subject: 'Reach buyers who are standing near your listing', lead: hi, cta: 'See proximity marketing', href: `${SITE}/app/agency.html#marketing`, body: [
      'Proximity marketing tells buyers about a home when they are physically near it. It only reaches people who have turned on alerts and whose brief matches your listing, and each person is told about a given home once, with daily limits, so it never becomes noise.',
      'Verified listings are offered first, so getting your Verified badge puts you at the front. Open Marketing in your portal to switch it on for a listing.'] };
    case 'a_checkin': return { subject: 'How is Synapse working for you?', lead: hi, cta: 'Open your portal', href: `${SITE}/app/agency.html`, body: [
      'You have been on Synapse for two weeks. What is working, and what is getting in your way?',
      'Just reply to this email. Every reply is read, and the things agencies tell us are what we build next.'] };
    case 'b_welcome': return { subject: `Welcome to Synapse, ${name}. Tell Tayo what you are looking for`, lead: hi, cta: 'Talk to Tayo', href: `${SITE}/app/toju.html`, body: [
      'Synapse finds you a home from the listings agencies have put up, and tells you straight which have been checked.',
      'Start by telling Tayo where you want to live and whether you are buying, renting or looking at land. It answers from what is actually listed, never from guesswork.'] };
    case 'b_tayo': return { subject: 'Not sure where to start? Tell Tayo your budget', lead: hi, cta: 'Open Tayo', href: `${SITE}/app/toju.html`, body: [
      'The quickest way to a short list is your area and your budget. Give Tayo both and it shows you what fits, and what your money does not reach, with real prices.',
      'You can come back any time: it remembers what you told it.'] };
    case 'b_alerts': return { subject: 'Be told when a home that fits appears', lead: hi, cta: 'See your matches', href: `${SITE}/app/browse.html`, body: [
      'New homes are listed every week. Open your matches and switch on alerts, and Synapse tells you when something that fits your brief appears nearby.',
      'Nothing you tell Synapse reaches an agency until you choose to send it.'] };
  }
  return null;
}

function render(m: Mail, unsub: string): { html: string; text: string } {
  const ps = m.body.map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#2b2622">${esc(p)}</p>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ee"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:20px">
<tr><td style="padding:30px 32px 6px"><span style="font-size:15px;font-weight:700;letter-spacing:.3em;color:#15120f">SYNAPSE</span></td></tr>
<tr><td style="padding:14px 32px 8px"><p style="margin:0 0 14px;font-size:19px;font-weight:600;color:#15120f">${esc(m.lead)}</p>${ps}
<p style="margin:22px 0 8px"><a href="${m.href}" style="display:inline-block;background:#ff8a2d;color:#15120f;text-decoration:none;font-weight:700;font-size:16px;padding:14px 26px;border-radius:999px">${esc(m.cta)}</a></p></td></tr>
<tr><td style="padding:18px 32px 30px;border-top:1px solid #eee"><p style="margin:0;font-size:12.5px;line-height:1.5;color:#8a8279">You are getting this because you created a Synapse account. <a href="${unsub}" style="color:#8a8279">Unsubscribe</a> from these emails any time.</p></td></tr>
</table></td></tr></table></body></html>`;
  const text = [m.lead, '', ...m.body, '', `${m.cta}: ${m.href}`, '', `Unsubscribe: ${unsub}`].join('\n');
  return { html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const secret = Deno.env.get('LIFECYCLE_SECRET') || serviceKey;
  if (!url || !serviceKey) return json({ error: 'Server misconfigured' }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  /* The link in every email: one tap and they are off the list. */
  const u = new URL(req.url).searchParams.get('u');
  if (req.method === 'GET' && u) {
    const [id, sig] = u.split('.');
    const page = (t: string, b: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title><body style="font-family:Helvetica,Arial,sans-serif;background:#f6f3ee;color:#15120f;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:420px;padding:28px;text-align:center"><h1 style="font-size:24px">${t}</h1><p style="color:#6b645c;line-height:1.5">${b}</p><p><a href="${SITE}" style="color:#15120f">Back to Synapse</a></p></div>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (!id || !sig || !/^[0-9a-f-]{36}$/i.test(id) || !same(sig, await sign(id, secret))) return page('That link is not valid', 'It may have been copied incompletely. Reply to any of our emails and we will take you off the list by hand.');
    await admin.from('lifecycle_optout').upsert({ profile_id: id }, { onConflict: 'profile_id' });
    return page('You are unsubscribed', 'You will not get these follow-up emails any more. Account and security emails still reach you when you need them.');
  }

  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!isServiceCall(req, serviceKey)) return json({ error: 'Not allowed' }, 403);
  const body = await req.json().catch(() => ({})) as { action?: string };
  /* One test email to the account owner, from the provider's own test sender, which works before any domain is verified. */
  if (body.action === 'test') {
    const k = Deno.env.get('RESEND_API_KEY'); if (!k) return json({ error: 'RESEND_API_KEY is not set' }, 400);
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'onboarding@resend.dev', to: [REPLY_TO], subject: 'Synapse follow-up emails: test', html: '<p>The email key works. Follow-ups start once the sending domain is verified.</p>' }) });
    return json({ ok: r.ok, status: r.status, body: (await r.text().catch(() => '')).slice(0, 300) });
  }
  /* Every email, once, to the account owner only, from the real sender: proof that the key, the domain and each template work. */
  if (body.action === 'samples') {
    const k = Deno.env.get('RESEND_API_KEY'), f = Deno.env.get('FOLLOWUP_FROM');
    if (!k || !f) return json({ error: 'RESEND_API_KEY and FOLLOWUP_FROM must both be set' }, 400);
    const kinds = ['a_welcome', 'a_listing', 'a_team', 'a_verify', 'a_social', 'a_proximity', 'a_checkin', 'b_welcome', 'b_tayo', 'b_alerts'];
    const out: Array<{ kind: string; ok: boolean; detail: string }> = [];
    for (const kind of kinds) {
      const m = mail(kind, 'Eden'); if (!m) continue;
      const { html, text } = render({ ...m, subject: m.subject }, SITE + '/privacy');
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: f, to: [REPLY_TO], reply_to: REPLY_TO, subject: '[Sample] ' + m.subject, html, text }) });
      out.push({ kind, ok: r.ok, detail: r.ok ? '' : `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}` });
      await new Promise((res) => setTimeout(res, 600));
    }
    return json({ sent: out.filter((x) => x.ok).length, results: out });
  }
  if (body.action !== 'send_due') return json({ error: 'Unknown action' }, 400);

  const { data: due, error } = await admin.rpc('lifecycle_due', { p_limit: 40 });
  if (error) return json({ error: error.message }, 500);
  const rows = (due ?? []) as Array<{ profile_id: string; email: string; full_name: string; role: string; kind: string }>;

  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return json({ configured: false, due: rows.length, note: 'No email provider key is set (RESEND_API_KEY), so nothing was sent.' });
  /* No default sender: until the domain is verified with the provider, mail to anyone but the account owner is refused,
     and every refusal would use up one of a person's three tries. Sending starts when FOLLOWUP_FROM is set. */
  const from = Deno.env.get('FOLLOWUP_FROM');
  if (!from) return json({ configured: false, due: rows.length, note: 'The email key is set but FOLLOWUP_FROM is not, so nothing was sent. Verify the sending domain, then set FOLLOWUP_FROM.' });

  let sent = 0, failed = 0;
  for (const r of rows) {
    const m = mail(r.kind, first(r.full_name, r.email));
    if (!m) continue;
    const link = `${url}/functions/v1/lifecycle-followup?u=${r.profile_id}.${await sign(r.profile_id, secret)}`;
    const { html, text } = render(m, link);
    let ok = false, err = '';
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [r.email], reply_to: REPLY_TO, subject: m.subject, html, text,
          headers: { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
      });
      ok = res.ok;
      if (!ok) err = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
    } catch (e) { err = e instanceof Error ? e.message : String(e); }

    const { data: prior } = await admin.from('lifecycle_messages').select('attempts').eq('profile_id', r.profile_id).eq('kind', r.kind).eq('channel', 'email').maybeSingle();
    await admin.from('lifecycle_messages').upsert({
      profile_id: r.profile_id, kind: r.kind, channel: 'email', status: ok ? 'sent' : 'failed',
      attempts: ((prior as { attempts?: number } | null)?.attempts ?? 0) + 1, error: ok ? null : err, updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id,kind,channel' });
    if (ok) sent++; else { failed++; console.error('follow-up not sent to ' + r.profile_id + ': ' + err); }
  }
  return json({ configured: true, due: rows.length, sent, failed });
});
