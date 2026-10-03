/**
 * agency-advisor -- the business advisor an agency can actually talk to.
 *
 * WHY THIS EXISTS
 * The Ask-Tayo panel offered three fixed questions -- "Why are sales down this
 * month?", "Where should I focus today?", "Which listings are
 * underperforming?" -- to every agency in every state. An agency that signed
 * up four minutes ago has no sales, no focus and no listings, so all three
 * were noise at the exact moment the product had the most to explain.
 *
 * This answers real questions instead, about two things:
 *   1. THEIR numbers, gathered here from their own rows.
 *   2. HOW to do things in Synapse -- the part a new agency actually needs.
 *
 * THE FACTS ARE GATHERED SERVER-SIDE, NOT ASKED FOR.
 * The browser sends a question and nothing else. Every number in the prompt is
 * counted here, scoped to the agency the CALLER is a member of, so a question
 * cannot be used to read another agency's pipeline by asking nicely.
 *
 * IT MUST NOT INVENT NUMBERS. Half this product's panes are empty because the
 * agency is new, and the honest answer is "nothing yet, here is how to get the
 * first one". An advisor that fabricates a conversion rate to sound useful is
 * worse than one that says there is no data -- this codebase has spent weeks
 * removing exactly that.
 *
 * Env: ANTHROPIC_API_KEY, plus the usual SUPABASE_* injected by the platform.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-opus-5';

/** Only the last few turns. This is a side panel, not a transcript. */
const MAX_TURNS = 12;

interface Facts {
  agencyName: string;
  stage: string;
  brandSet: boolean;
  brandMissing: string[];
  listingsTotal: number;
  listingsLive: number;
  listingsVerified: number;
  listingsStale: number;
  teamSize: number;
  leadsTotal: number;
  leadsByStage: Record<string, number>;
  channelsConnected: string[];
  postsQueued: number;
  postsPublishedReal: number;
  postsRehearsed: number;
  viewings: number;
}

/**
 * Counts, not content. Everything here is a number the agency could work out
 * themselves from their own panes -- nothing about any other agency, and no
 * buyer's personal details, ever reach the model.
 */
async function gatherFacts(admin: any, agencyId: string): Promise<Facts> {
  const count = async (table: string, build: (q: any) => any) => {
    const q = build(admin.from(table).select('*', { count: 'exact', head: true }).eq('agency_id', agencyId));
    const { count: n } = await q;
    return n ?? 0;
  };

  const { data: agency } = await admin
    .from('agencies').select('name, city, logo_url, brand_color, brand_font')
    .eq('id', agencyId).maybeSingle();

  const fourteenDaysAgo = new Date(Date.now() - 14 * 864e5).toISOString();

  const listingsTotal    = await count('properties', (q: any) => q.is('deleted_at', null));
  const listingsLive     = await count('properties', (q: any) => q.is('deleted_at', null).eq('status', 'live'));
  const listingsVerified = await count('properties', (q: any) => q.is('deleted_at', null).eq('verification_status', 'verified'));
  const listingsStale    = await count('properties', (q: any) =>
    q.is('deleted_at', null).eq('status', 'live').lt('listed_at', fourteenDaysAgo));
  const teamSize         = await count('agency_members', (q: any) => q.is('deleted_at', null));
  const leadsTotal       = await count('leads', (q: any) => q.is('deleted_at', null));
  const viewings         = await count('viewings', (q: any) => q);
  const postsQueued      = await count('social_posts', (q: any) => q.is('deleted_at', null).eq('status', 'scheduled'));
  const postsPublishedReal = await count('social_posts', (q: any) =>
    q.is('deleted_at', null).eq('status', 'published').eq('dry_run', false));
  const postsRehearsed   = await count('social_posts', (q: any) =>
    q.is('deleted_at', null).eq('status', 'published').eq('dry_run', true));

  /* The column is current_stage, not stage. Reading the wrong name does not
     throw here -- PostgREST returns an error object and the count silently
     comes back empty -- so the advisor would have reported "no leads" to an
     agency with a full pipeline. */
  const { data: leadRows } = await admin
    .from('leads').select('current_stage').eq('agency_id', agencyId).is('deleted_at', null);
  const leadsByStage: Record<string, number> = {};
  for (const r of (leadRows ?? []) as Array<{ current_stage: string }>) {
    const k = r.current_stage || 'unassigned';
    leadsByStage[k] = (leadsByStage[k] ?? 0) + 1;
  }

  const { data: accounts } = await admin
    .from('social_accounts').select('platform')
    .eq('agency_id', agencyId).eq('is_active', true).is('deleted_at', null);
  const channelsConnected = (accounts ?? []).map((a: { platform: string }) => a.platform);

  const brandMissing: string[] = [];
  if (!agency?.name) brandMissing.push('agency name');
  if (!agency?.logo_url) brandMissing.push('logo');
  if (!agency?.brand_color) brandMissing.push('brand colour');

  /* The single most useful fact about an agency is which of these they have
     not done yet, because it decides what advice is worth giving at all. */
  const stage =
    listingsTotal === 0 ? 'brand new: no listings yet'
    : channelsConnected.length === 0 && postsPublishedReal === 0 ? 'has listings, nothing published'
    : leadsTotal === 0 ? 'publishing, no leads yet'
    : 'running: has listings and leads';

  return {
    agencyName: agency?.name || 'this agency',
    stage,
    brandSet: brandMissing.length === 0,
    brandMissing,
    listingsTotal, listingsLive, listingsVerified, listingsStale,
    teamSize, leadsTotal, leadsByStage,
    channelsConnected, postsQueued, postsPublishedReal, postsRehearsed,
    viewings,
  };
}

/* What the product can actually do, and where the controls are. Written from
   the shipped app, so the advisor can walk somebody through a task instead of
   describing a feature in the abstract. Anything not built is marked, because
   an advisor that promises a button which does not exist wastes more of the
   agency's time than saying "not yet". */
const HOW_IT_WORKS = `
SYNAPSE, AS BUILT TODAY (agency portal, left-hand tabs):
- Overview: every listing with its verification checks and a map.
- Listings: add or edit a listing. A listing needs photos, price, city and
  address. Verification is decided by the platform, not by the agency, and a
  listing stays live for 14 days from when it was last confirmed; after that it
  needs re-listing.
- Marketing: pick a listing, press Generate, and the AI writes a caption per
  platform and checks each against that platform's real limits. "Rehearse" runs
  the whole pipeline and shows exactly what WOULD be sent without touching an
  account. "Publish for real" appears once a channel is connected.
- Channels (in Marketing): Connect Instagram or Facebook. Tokens are held by
  the platform, never in the browser. TikTok, LinkedIn and X are not built yet.
- CRM: leads with five stages, assignment across agents, bulk actions, and an
  outbox that only sends when somebody presses send.
- Team: invite agents; Brand holds the agency name, logo, colours and voice,
  which every generated caption signs off with.
- Pricing/plan: Free, Accelerate and Leader tiers.

NOT BUILT YET, and must never be described as available: proximity alerts for
agencies, ad spend and CTR figures, lead scoring, TikTok/LinkedIn/X publishing,
and WhatsApp delivery from the outbox (it queues but cannot yet send).
`.trim();

function systemPrompt(f: Facts): string {
  return `You are Tayo, the business advisor inside Synapse, talking to ${f.agencyName} — a real estate agency in Nigeria.

WHERE THIS AGENCY ACTUALLY IS: ${f.stage}

THEIR REAL NUMBERS, counted from their own records just now:
- Listings: ${f.listingsTotal} total, ${f.listingsLive} live, ${f.listingsVerified} verified, ${f.listingsStale} past the 14-day freshness window
- Team: ${f.teamSize} member(s)
- Leads: ${f.leadsTotal} total${Object.keys(f.leadsByStage).length ? ' (' + Object.entries(f.leadsByStage).map(([k, v]) => k + ': ' + v).join(', ') + ')' : ''}
- Viewings booked: ${f.viewings}
- Connected channels: ${f.channelsConnected.length ? f.channelsConnected.join(', ') : 'none'}
- Posts: ${f.postsQueued} queued, ${f.postsPublishedReal} really published, ${f.postsRehearsed} rehearsals (rehearsals were never sent anywhere)
- Brand: ${f.brandSet ? 'complete' : 'missing ' + f.brandMissing.join(', ')}

${HOW_IT_WORKS}

HOW TO ANSWER
- Be brief. Two or three short paragraphs at most, or a short list. This is a
  side panel, not a report.
- When they ask how to do something, give the actual steps in this app, naming
  the tab and the button. Assume they are looking at the screen.
- When they ask about performance, use ONLY the numbers above.
- NEVER invent a number, a rate, a benchmark or a trend. If the number is zero
  or the data does not exist, say so plainly and say what would produce the
  first one. "You have no leads yet" followed by the next concrete step is a
  good answer; a made-up conversion rate is not.
- Do not describe anything in the NOT BUILT list as available.
- No preamble, no "great question", no sign-off. Answer and stop.
- Nigerian context: prices in naira, cities like Lagos, Abuja, Ibadan.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
    if (!serviceKey) return json({ error: 'Server misconfigured: no service role key' }, 500);
    if (!apiKey) return json({ error: 'The advisor is not configured on this project yet.' }, 503);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const admin = createClient(url, serviceKey);
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });

    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not authenticated' }, 401);

    /* Which agency, decided from membership rather than taken from the body.
       Every fact below is scoped to this id. */
    const { data: membership } = await admin
      .from('agency_members').select('agency_id, role')
      .eq('profile_id', user.id).is('deleted_at', null).limit(1).maybeSingle();
    if (!membership) return json({ error: 'You are not a member of an agency' }, 403);

    const body = (await req.json().catch(() => ({}))) as {
      question?: string;
      history?: Array<{ role: string; content: string }>;
    };
    const question = String(body.question ?? '').trim().slice(0, 2000);
    if (!question) return json({ error: 'Ask a question first.' }, 400);

    const facts = await gatherFacts(admin, membership.agency_id as string);

    /* Only roles the API accepts, only the last few turns, and the content is
       coerced to string -- the history comes from the browser and is the one
       part of this request that is not ours. */
    const history = (Array.isArray(body.history) ? body.history : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: systemPrompt(facts),
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        /* If a safety classifier declines, the server routes to a comparable
           model by refusal category rather than handing the agency an error. */
        fallbacks: 'default',
        messages: [...history, { role: 'user', content: question }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('agency-advisor upstream ' + res.status + ': ' + detail.slice(0, 400));
      return json({ error: 'The advisor could not answer just now. Try again in a moment.' }, 502);
    }

    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      return json({ error: 'The advisor declined to answer that one. Try rephrasing.' }, 200);
    }

    const answer = (data.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n')
      .trim();

    return json({ answer: answer || 'No answer came back. Try asking again.', stage: facts.stage });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('agency-advisor fatal: ' + message);
    return json({ error: message }, 500);
  }
});
