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

const SYSTEM_PROMPT = `You are Toju, a warm, sharp real-estate consultant for Synapse in Nigeria.
You work the way a good doctor takes a history: people tell you what they WANT
("a house in Ibadan"), and your questions uncover what they actually NEED. You
never jump to the prescription. You never open with property specs.

THE INTAKE — learn these, in a natural order, ONE question per turn, always
reacting specifically to what they just said:
  1. The move itself — what's prompting it, and which city/area. Their city is
     law: if they say Ibadan, everything downstream is Ibadan. Never substitute
     Lagos or anywhere else.
  2. The household — who's moving with them: spouse, kids and ages, parents,
     flatmates, staff, pets. This is how you learn size — NEVER ask "how many
     bedrooms"; infer it from the household and confirm later.
  3. Work and movement — what they do, where work is, car or ride-hailing,
     remote/hybrid/office, school runs.
  4. The rhythm of their life — do they cook or eat out, gym, church/mosque,
     host guests, nightlife or quiet evenings, weekends.
  5. The deal and the money, warmly and last — FIRST pin down the deal type:
     are they RENTING a whole place, BUYING, or open to a SHARED home (a
     verified private room in a shared house, rent per room per year — the
     affordable route for students and young people starting out; suggest it
     yourself when the budget is tight for a whole place)? Never show homes
     before this is clear — a renter shown purchase prices is a broken promise.
     Then the payment route if it comes up naturally: outright, mortgage, or a
     FlexPay-style plan (Synapse lets renters split annual rent into monthly
     payments, and buyers pay verified homes in structured installments).
     Then a comfortable budget — ANNUAL RENT if renting, TOTAL PRICE if buying
     — framed as being on their side: "so I only show you homes that genuinely
     make sense for you." If they give monthly income, translate: roughly 25–30%
     of annual income is a sane annual rent ceiling; say the number you're using.

How to sound: a knowledgeable friend, not a form. 2–3 sentences per turn, max.
Between questions, give one small, real insight about their city (commute
realities, value corridors, what ₦X actually buys there). Filler like "Good
choice!" is banned — react to the substance of what they said.

PRECISION RULE: if the person states exactly what they want in one go (city +
rent/buy + budget and/or size), do NOT keep interviewing. Confirm it back in
one line, set showMatches true immediately, and AFTER presenting, offer ONE
optional question — "want me to factor in your commute or schools to sharpen
these?" — framed as optional, never a gate. Same if they push for matches
early: show them, then say what you'd still love to know.

Never invent specific listings, prices, or facts about a particular property.

When you have the real picture — their city + household + RENT-OR-BUY + a sense
of budget — set "showMatches": true. Until then keep it false and keep taking
the history.

Whenever "showMatches" is true, ALSO fill "criteria" (null for unknowns):
  • city: EXACTLY the city they named (e.g. "Ibadan" if they said Ibadan)
  • dealType: "rent" | "buy" | "shared" — REQUIRED before matches; never guess
  • maxPrice: their ceiling in whole naira — ANNUAL RENT if renting (e.g.
    1000000 for ₦1M/yr), TOTAL PRICE if buying (e.g. 150000000), else null
  • minBedrooms: inferred from the household (couple + 2 kids → 3), else null
  • intent: "live" | "invest" | null (what the home is FOR; dealType is the deal)
  • paymentPlan: "outright" | "mortgage" | "flexpay" | null
  • brief: one plain sentence for their matches page, e.g. "Renting a 1-bed in
    Ibadan around ₦700k–1M/yr for a young analyst; no car, gyms nearby."
  • profile: what you learned about their LIFE — {"household": <string|null>,
    "work": <string|null>, "transport": <string|null>,
    "lifestyle": [<short tags like "cooks at home","gym","church","hosts guests","has car","remote work">]}

ALWAYS also fill "suggestions": 2–4 short tap-to-answer options for the exact
question you just asked, written in the USER's voice, each ≤ 5 words. Examples:
you asked about household → ["Married with kids","Married, no kids","Just me","With relatives"];
you asked rent or buy → ["Renting","Buying","Open to a shared room"];
you asked budget → ["Under ₦1M/yr","₦1–2M/yr","Not sure — advise me"].
When showing matches, make them next steps → ["Cheaper options","Tell me about the first","Why these areas?"].

Output STRICT JSON ONLY, no markdown, exactly:
{"reply": "<your message>", "showMatches": <true|false>, "suggestions": [<string>], "criteria": {"city": <string|null>, "dealType": <string|null>, "maxPrice": <number|null>, "minBedrooms": <number|null>, "intent": <string|null>, "paymentPlan": <string|null>, "brief": <string|null>, "profile": {"household": <string|null>, "work": <string|null>, "transport": <string|null>, "lifestyle": [<string>]}}}`;

const ADVISOR_PROMPT = `You are Toju, Synapse's Nigerian real-estate consultant, writing the moment you
present verified matches. You are given the person's brief, their lifestyle
profile, and the real matched homes as JSON (price, trust score, yield,
neighbourhood safety/family/flood/power scores, what to watch). Write the
recommendation the lifestyle-cost way: connect homes to THEIR life — the school
run, the home office, the cooking, the car or lack of one — and weigh flood
risk, power, total cost of living, not just price. If something is slightly
over budget but the trade-off is worth it, say so plainly. If a home has a
flood or title flag, name it — trust is the product. If the search had to be
relaxed (noted in the input), be honest about it — especially if the matches are
from a DIFFERENT city than asked: open by saying these are the closest fits and
where they are. RENTALS are priced PER YEAR — always say "₦900k/yr", never
present rent like a purchase price. Shared homes are a private ROOM priced per
year — use the room facts when given (housemates in, gender preference, ensuite,
bills included, house vibe). If money is
tight: renters can split annual rent into monthly payments with FlexPay; buyers
can ask about mortgage (~20% down) or structured installments — mention the one
that fits their profile, once, naturally. Max ~110 words, warm, specific, no
filler. Then give ONE short "why" line per match (max 16 words), concrete,
grounded ONLY in the provided data — never invent facts.

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
      reply?: string; showMatches?: boolean; suggestions?: unknown;
      criteria?: Criteria & { brief?: string | null };
    };
    let reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : first.text.trim();
    const showMatches = parsed.showMatches === true;
    const criteria = parsed.criteria ?? {};
    const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 42))
      .slice(0, 4);

    // Ground in the digital twin + rewrite the reply lifestyle-cost style.
    let matches: Match[] = [];
    if (showMatches) {
      const found = await fetchMatchesRelaxed(criteria);
      matches = found.matches;
      if (matches.length > 0) {
        const advisorInput = JSON.stringify({
          brief: criteria.brief ?? null,
          profile: (criteria as { profile?: unknown }).profile ?? null,
          search_note: found.note,
          conversation_tail: messages.slice(-4),
          matches: matches.map((m) => ({
            id: m.id, title: m.title, deal: m.listingType, pricePeriod: m.pricePeriod,
            price: m.price, bedrooms: m.bedrooms, city: m.city,
            trustScore: m.trustScore, yieldPct: m.yieldPct, whatToWatch: m.whatToWatch,
            neighbourhood: m.neighbourhood, room: m.room ?? null,
          })),
        });
        const second = await claude(key, ADVISOR_PROMPT, [{ role: 'user', content: advisorInput }], 900);
        if (!('error' in second)) {
          const adv = parseLoose(second.text) as { reply?: string; why?: Record<string, string> };
          // Salvage from truncated/imperfect JSON rather than silently falling
          // back to pass-1's one-line stub ("Pulling those up now").
          const advReply = (typeof adv.reply === 'string' && adv.reply.trim()) ? adv.reply.trim() : salvageReply(second.text);
          if (advReply) reply = advReply;
          const whys = adv.why ?? salvageWhys(second.text);
          if (whys) matches = matches.map((m) => ({ ...m, why: whys[m.id] ?? null }));
        }
      } else if (criteria.city) {
        // Honest zero-state: never show homes from a different city or deal type.
        const dt = criteria.dealType === 'rent' ? 'rentals' : criteria.dealType === 'shared' ? 'shared homes' : 'homes for sale';
        reply = `${reply}\n\nOne honest note — I checked our verified ${dt} in ${criteria.city} and nothing fits that brief yet. Want me to widen the budget or size a little, or alert you the moment something lands?`;
      }
    }

    // Persist memory (fire-and-forget correctness is fine for the demo).
    if (visitorId) {
      const full = [...messages, { role: 'assistant' as const, content: reply }];
      await saveSession(visitorId, full, showMatches ? criteria : undefined, showMatches ? matches : undefined);
    }

    return json({ reply, showMatches, matches, suggestions });
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
  dealType?: string | null;   // rent | buy | shared
  maxPrice?: number | null;   // annual rent when renting, total price when buying
  minBedrooms?: number | null;
  intent?: string | null;
  paymentPlan?: string | null;
  brief?: string | null;
  profile?: {
    household?: string | null;
    work?: string | null;
    transport?: string | null;
    lifestyle?: string[];
  } | null;
}
interface Match {
  id: string;
  title: string;
  city: string;
  listingType: string;   // sale | rent | shortlet
  pricePeriod: string;   // total | per_year | ...
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
  room?: {
    totalRooms: number; housematesIn: number; genderPreference: string;
    furnished: boolean; ensuite: boolean; billsIncluded: boolean; vibe: string | null;
  } | null;
}

/**
 * Progressive relaxation — Toju must always have SOMETHING honest to show:
 *  1. exact brief → 2. relax size → 3. relax budget (same city)
 *  4. the named place may be an AREA, not a city (e.g. "Lekki", "Wuse") —
 *     resolve it against neighbourhoods and retry with the real city
 *  5. last resort: closest fits in other cities, flagged loudly.
 * The DEAL TYPE never relaxes; a compromise is only ever silent-free.
 */
async function fetchMatchesRelaxed(c: Criteria): Promise<{ matches: Match[]; note: string | null }> {
  const r = await relaxWithinCity(c);
  if (r.matches.length > 0) return r;

  if (c.city) {
    const realCity = await resolveAreaToCity(c.city);
    if (realCity && realCity.toLowerCase() !== c.city.trim().toLowerCase()) {
      const r2 = await relaxWithinCity({ ...c, city: realCity });
      if (r2.matches.length > 0) {
        return { matches: r2.matches, note: `"${c.city}" is an area in ${realCity}${r2.note ? '; ' + r2.note : ''}` };
      }
    }
    const r3 = await relaxWithinCity({ ...c, city: null });
    if (r3.matches.length > 0) {
      return { matches: r3.matches, note: `NOTHING verified in ${c.city} for this deal type — these are the closest fits in OTHER cities. Open by saying so and offer to alert them when ${c.city} inventory lands.` };
    }
  }
  return { matches: [], note: null };
}

async function relaxWithinCity(c: Criteria): Promise<{ matches: Match[]; note: string | null }> {
  let m = await fetchMatches(c);
  if (m.length > 0) return { matches: m, note: null };
  if (c.minBedrooms) {
    m = await fetchMatches({ ...c, minBedrooms: null });
    if (m.length > 0) return { matches: m, note: 'no exact-size fit — showing the closest sizes' };
  }
  if (c.maxPrice) {
    m = await fetchMatches({ ...c, maxPrice: null, minBedrooms: null });
    if (m.length > 0) return { matches: m, note: 'nothing inside budget — showing the closest available; be upfront about prices' };
  }
  return { matches: [], note: null };
}

/** "Lekki" / "Wuse" / "Ugbowo" → the city whose neighbourhood matches. */
async function resolveAreaToCity(term: string): Promise<string | null> {
  const s = sb();
  if (!s) return null;
  const res = await fetch(
    `${s.url}/rest/v1/neighbourhoods?select=name&name=ilike.*${encodeURIComponent(term.trim())}*&limit=1`,
    { headers: s.headers },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ name?: string }>;
  const m = rows[0]?.name?.match(/\(([^)]+)\)/);
  return m ? m[1] : null;
}

/** Verified/live listings + enrichment + neighbourhood intelligence. */
async function fetchMatches(c: Criteria): Promise<Match[]> {
  const s = sb();
  if (!s) return [];

  const intent = (c.intent ?? 'live') as string;
  const shared = c.dealType === 'shared';
  const renting = c.dealType === 'rent' || shared;
  const fitCol = intent === 'invest' ? 'investment_score' : shared ? 'student_score' : renting ? 'young_professional_score' : 'family_score';

  // The deal type is a hard wall: buyers see sales, renters see whole-home
  // rentals (₦/yr), and shared means a private ROOM in a shared home.
  const conds = [`status=eq.live`, `verification_status=eq.verified`, `is_active=is.true`,
    `listing_type=eq.${renting ? 'rent' : 'sale'}`,
    `property_type=${shared ? 'eq' : 'neq'}.shared`];
  if (c.city && typeof c.city === 'string') conds.push(`city=ilike.*${encodeURIComponent(c.city.trim())}*`);
  if (typeof c.maxPrice === 'number' && c.maxPrice > 0) conds.push(`price=lte.${Math.round(c.maxPrice * 1.15)}`); // allow the worth-it stretch
  if (typeof c.minBedrooms === 'number' && c.minBedrooms > 0 && !shared) conds.push(`bedrooms=gte.${Math.round(c.minBedrooms)}`);

  const select =
    'id,title,city,listing_type,price_period,price,bedrooms,bathrooms,trust_score,' +
    'agencies(name,verification_tier),' +
    'neighbourhoods(name,safety_score,family_score,flood_risk,power_reliability,toju_summary),' +
    'shared_room_details(total_rooms,housemates_in,gender_preference,room_furnished,ensuite,bills_included,house_vibe),' +
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
    const rd = (r.shared_room_details ?? null) as Record<string, unknown> | null;
    return {
      id: String(r.id),
      title: String(r.title ?? ''),
      city: String(r.city ?? ''),
      listingType: String(r.listing_type ?? 'sale'),
      pricePeriod: String(r.price_period ?? 'total'),
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
      room: rd ? {
        totalRooms: Number(rd.total_rooms ?? 0),
        housematesIn: Number(rd.housemates_in ?? 0),
        genderPreference: String(rd.gender_preference ?? 'any'),
        furnished: rd.room_furnished === true,
        ensuite: rd.ensuite === true,
        billsIncluded: rd.bills_included === true,
        vibe: (rd.house_vibe as string) ?? null,
      } : null,
    };
  });
}

/** Pull "reply" out of truncated/broken advisor JSON. */
function salvageReply(raw: string): string | null {
  const m = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!m) return null;
  const text = m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
  return text.length > 30 ? text : null;
}

/** Pull per-match "why" pairs out of truncated/broken advisor JSON. */
function salvageWhys(raw: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/"([0-9a-f-]{36})"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    out[m[1]] = m[2].replace(/\\"/g, '"').trim();
  }
  return Object.keys(out).length ? out : null;
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
