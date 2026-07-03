/**
 * toju-demo — public Toju for the marketing/clickable prototype.
 *
 * Conversational endpoint grounded in the digital twin: Claude drives the
 * conversation; once it has a picture it emits criteria; we query verified
 * listings + enrichment + neighbourhood intelligence, then a second Claude
 * pass writes the recommendation the lifestyle-cost way ("slightly over
 * budget, but the school run and yield justify it") with a per-match "why".
 *
 * Server-side memory: pass a `visitorId` (uuid) and the conversation,
 * criteria and matches persist in demo_chat_sessions — so people continue
 * where they left off, and the "Your matches" page can load the real set.
 *
 * Actions (POST body):
 *   { messages, visitorId? }                 → chat (default)
 *   { action: 'restore', visitorId }         → { messages, criteria, matches }
 *   { action: 'matches', visitorId }         → { criteria, matches }
 *
 * Deployed with verify_jwt = false so the static prototype can call it.
 * Env: ANTHROPIC_API_KEY + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
 */
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 700;
const MAX_HISTORY = 14;
const MAX_LEN = 1200;
const MAX_MATCHES = 4;

const SYSTEM_PROMPT = `You are Toju, a warm, sharp real-estate consultant for Synapse in Lagos, Nigeria.
You talk like a knowledgeable friend who happens to be an expert — never robotic,
never filler. Phrases like "Good choice" or "Great!" on their own are banned;
if you acknowledge something, make it specific to what the person actually said.

Your job: understand the person well enough to recommend the right VERIFIED homes.
Across the conversation, naturally find out — in a human order, reacting to what
they say — these things you don't yet know:
  • what they want: to live in, to invest, to rent, or a mix
  • which area or city (Lagos neighbourhoods: Lekki Phase 1, Ikate, Ikoyi, VI,
    Yaba, Ibeju-Lekki, Magodo, Surulere, etc.)
  • their budget (be comfortable asking directly, warmly, once it's relevant)
  • lifestyle/needs: commute, family size, work location, schools, must-haves

Rules of good conversation:
  • Ask ONE focused question per turn — the most useful next question given what
    they JUST said.
  • React briefly and specifically to their last message before asking.
  • Be warm, confident, plain English. Short. A little personality is good.
  • Use real Lagos knowledge: commute realities, value vs prestige, growth areas.
  • Never invent specific listings, prices, or facts about a particular property.

When you have a reasonable picture — roughly their intent + an area or city + a
sense of budget — set "showMatches": true. Until then keep it false and keep the
conversation going.

Whenever "showMatches" is true, ALSO fill "criteria" (null for unknowns):
  • city: Nigerian city if named/implied (e.g. "Lagos", "Abuja"), else null
  • maxPrice: ceiling in whole naira (e.g. 150000000), else null
  • minBedrooms: integer, else null
  • intent: "live" | "invest" | "rent" | null
  • brief: one plain-English sentence summarising who they are and what they
    need (used on their matches page), e.g. "3-bed for a family in Lagos under
    ₦150M, near good schools, short commute to the Island."

Output STRICT JSON ONLY, no markdown, exactly:
{"reply": "<your message>", "showMatches": <true|false>, "criteria": {"city": <string|null>, "maxPrice": <number|null>, "minBedrooms": <number|null>, "intent": <string|null>, "brief": <string|null>}}`;

const ADVISOR_PROMPT = `You are Toju, Synapse's Lagos real-estate consultant, writing the moment you present
verified matches. You are given the person's brief and the real matched homes as
JSON (price, trust score, yield, neighbourhood safety/family/flood/power scores,
what to watch). Write the recommendation the lifestyle-cost way: weigh commute,
schools, flood risk, power, total cost of living — not just price. If something
is slightly over budget but the trade-off is worth it, say so plainly. If a home
has a flood or title flag, name it — trust is the product. Max ~110 words, warm,
specific, no filler. Then give ONE short "why" line per match (max 16 words),
concrete, grounded ONLY in the provided data — never invent facts.

Output STRICT JSON ONLY: {"reply": "<message>", "why": {"<matchId>": "<reason>", ...}}`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

interface Msg { role: 'user' | 'assistant'; content: string }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string; visitorId?: string; messages?: Msg[];
    };
    const visitorId = typeof body.visitorId === 'string' && UUID_RE.test(body.visitorId) ? body.visitorId : null;

    // ── memory endpoints ──
    if (body.action === 'restore' || body.action === 'matches') {
      if (!visitorId) return json({ messages: [], criteria: null, matches: [] });
      const row = await loadSession(visitorId);
      if (body.action === 'matches') return json({ criteria: row?.criteria ?? null, matches: row?.matches ?? [] });
      return json({ messages: row?.messages ?? [], criteria: row?.criteria ?? null, matches: row?.matches ?? [] });
    }

    // ── chat ──
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ error: 'Server misconfigured: no Anthropic key' }, 500);

    const raw = Array.isArray(body.messages) ? body.messages : [];
    const messages = raw
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_LEN) }));
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return json({ error: 'last message must be from the user' }, 400);
    }

    const first = await claude(key, SYSTEM_PROMPT, messages, MAX_TOKENS);
    if ('error' in first) return json({ error: first.error }, 502);
    const parsed = parseLoose(first.text) as {
      reply?: string; showMatches?: boolean;
      criteria?: Criteria & { brief?: string | null };
    };
    let reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : first.text.trim();
    const showMatches = parsed.showMatches === true;
    const criteria = parsed.criteria ?? {};

    // Ground in the digital twin + rewrite the reply lifestyle-cost style.
    let matches: Match[] = [];
    if (showMatches) {
      matches = await fetchMatches(criteria);
      if (matches.length > 0) {
        const advisorInput = JSON.stringify({
          brief: criteria.brief ?? null,
          conversation_tail: messages.slice(-4),
          matches: matches.map((m) => ({
            id: m.id, title: m.title, price: m.price, bedrooms: m.bedrooms,
            trustScore: m.trustScore, yieldPct: m.yieldPct, whatToWatch: m.whatToWatch,
            neighbourhood: m.neighbourhood,
          })),
        });
        const second = await claude(key, ADVISOR_PROMPT, [{ role: 'user', content: advisorInput }], 500);
        if (!('error' in second)) {
          const adv = parseLoose(second.text) as { reply?: string; why?: Record<string, string> };
          if (typeof adv.reply === 'string' && adv.reply.trim()) reply = adv.reply.trim();
          if (adv.why) matches = matches.map((m) => ({ ...m, why: adv.why?.[m.id] ?? null }));
        }
      }
    }

    // Persist memory (fire-and-forget correctness is fine for the demo).
    if (visitorId) {
      const full = [...messages, { role: 'assistant' as const, content: reply }];
      await saveSession(visitorId, full, showMatches ? criteria : undefined, showMatches ? matches : undefined);
    }

    return json({ reply, showMatches, matches });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

// ── Claude helper ──
async function claude(key: string, system: string, messages: Msg[], maxTokens: number):
  Promise<{ text: string } | { error: string }> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) return { error: `Anthropic ${res.status}: ${await res.text()}` };
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return { text: (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('') };
}

// ── session persistence (demo_chat_sessions, service role) ──
function sb() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}
async function loadSession(visitorId: string):
  Promise<{ messages: Msg[]; criteria: unknown; matches: unknown } | null> {
  const s = sb();
  if (!s) return null;
  const res = await fetch(`${s.url}/rest/v1/demo_chat_sessions?visitor_id=eq.${visitorId}&select=messages,criteria,matches`, { headers: s.headers });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ messages: Msg[]; criteria: unknown; matches: unknown }>;
  return rows[0] ?? null;
}
async function saveSession(visitorId: string, messages: Msg[], criteria?: unknown, matches?: unknown) {
  const s = sb();
  if (!s) return;
  const patch: Record<string, unknown> = { visitor_id: visitorId, messages, updated_at: new Date().toISOString() };
  if (criteria !== undefined) patch.criteria = criteria;
  if (matches !== undefined) patch.matches = matches;
  await fetch(`${s.url}/rest/v1/demo_chat_sessions?on_conflict=visitor_id`, {
    method: 'POST',
    headers: { ...s.headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

// ── matches from the digital twin ──
interface Criteria {
  city?: string | null;
  maxPrice?: number | null;
  minBedrooms?: number | null;
  intent?: string | null;
  brief?: string | null;
}
interface Match {
  id: string;
  title: string;
  city: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  trustScore: number;
  fitScore: number;
  yieldPct: number | null;
  whoThisSuits: string | null;
  whatToWatch: string | null;
  summary: string | null;
  agency: string;
  tier: string;
  why?: string | null;
  neighbourhood?: {
    name: string | null; safety: number | null; family: number | null;
    flood: number | null; power: number | null; note: string | null;
  } | null;
}

/** Verified/live listings + enrichment + neighbourhood intelligence. */
async function fetchMatches(c: Criteria): Promise<Match[]> {
  const s = sb();
  if (!s) return [];

  const intent = (c.intent ?? 'live') as string;
  const fitCol = intent === 'invest' ? 'investment_score' : intent === 'rent' ? 'young_professional_score' : 'family_score';

  const conds = [`status=eq.live`, `verification_status=eq.verified`, `is_active=is.true`];
  if (c.city && typeof c.city === 'string') conds.push(`city=ilike.*${encodeURIComponent(c.city.trim())}*`);
  if (typeof c.maxPrice === 'number' && c.maxPrice > 0) conds.push(`price=lte.${Math.round(c.maxPrice * 1.15)}`); // allow the worth-it stretch
  if (typeof c.minBedrooms === 'number' && c.minBedrooms > 0) conds.push(`bedrooms=gte.${Math.round(c.minBedrooms)}`);

  const select =
    'id,title,city,price,bedrooms,bathrooms,trust_score,' +
    'agencies(name,verification_tier),' +
    'neighbourhoods(name,safety_score,family_score,flood_risk,power_reliability,toju_summary),' +
    `property_enrichment!inner(${fitCol},rental_yield_estimate_pct,who_this_suits,what_to_watch,toju_summary)`;
  const q =
    `${s.url}/rest/v1/properties?select=${select}&${conds.join('&')}` +
    `&order=property_enrichment(${fitCol}).desc.nullslast,trust_score.desc&limit=${MAX_MATCHES}`;

  const res = await fetch(q, { headers: s.headers });
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(rows)) return [];

  return rows.map((r) => {
    const ag = (r.agencies ?? {}) as { name?: string; verification_tier?: string };
    const e = (r.property_enrichment ?? {}) as Record<string, unknown>;
    const n = (r.neighbourhoods ?? null) as Record<string, unknown> | null;
    return {
      id: String(r.id),
      title: String(r.title ?? ''),
      city: String(r.city ?? ''),
      price: Number(r.price ?? 0),
      bedrooms: Number(r.bedrooms ?? 0),
      bathrooms: Number(r.bathrooms ?? 0),
      trustScore: Number(r.trust_score ?? 0),
      fitScore: Number(e[fitCol] ?? 0),
      yieldPct: e.rental_yield_estimate_pct == null ? null : Number(e.rental_yield_estimate_pct),
      whoThisSuits: (e.who_this_suits as string) ?? null,
      whatToWatch: (e.what_to_watch as string) ?? null,
      summary: (e.toju_summary as string) ?? null,
      agency: ag.name ?? 'Verified agency',
      tier: ag.verification_tier ?? 'basic',
      neighbourhood: n ? {
        name: (n.name as string) ?? null,
        safety: n.safety_score == null ? null : Number(n.safety_score),
        family: n.family_score == null ? null : Number(n.family_score),
        flood: n.flood_risk == null ? null : Number(n.flood_risk),
        power: n.power_reliability == null ? null : Number(n.power_reliability),
        note: (n.toju_summary as string) ?? null,
      } : null,
    };
  });
}

function parseLoose(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}
