/**
 * toju-demo — public, stateless Toju for the marketing/clickable prototype.
 *
 * Unlike toju-chat (authenticated, RLS-scoped, writes chat_sessions, searches
 * the real DB), this is a no-auth conversational endpoint for the landing-site
 * demo: it takes the running message history and returns a coherent, in-persona
 * reply from Claude. No database, no user, no tools — just a great conversation.
 *
 * Deployed with verify_jwt = false so the static prototype can call it. Guarded
 * by history/length caps; add real rate-limiting before any high-traffic launch.
 *
 * Body:  { messages: { role: 'user' | 'assistant', content: string }[] }
 * Reply: { reply: string, showMatches: boolean }
 *
 * Env: ANTHROPIC_API_KEY.
 */
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 600;
const MAX_HISTORY = 14;
const MAX_LEN = 1200;

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
  • lifestyle/needs: commute, family size, work location, must-haves

Rules of good conversation:
  • Ask ONE focused question per turn — the most useful next question given what
    they JUST said. If they mention a new job or a pay rise, the natural next
    move is budget or where they want to be relative to work — not "good choice".
  • React briefly and specifically to their last message before asking.
  • Be warm, confident, plain English. Short. A little personality is good.
  • Use real Lagos knowledge: commute realities, value vs prestige, growth areas.
  • Never invent specific listings, prices, or facts about a particular property.

When you have a reasonable picture — roughly their intent + an area + a sense of
budget — set "showMatches": true and give a short, reasoned lead-in to your
recommendations (the app will then display the matching verified homes). Until
you have that, keep "showMatches": false and keep the conversation going.

Output STRICT JSON ONLY, no markdown, exactly:
{"reply": "<your message>", "showMatches": <true|false>}`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ error: 'Server misconfigured: no Anthropic key' }, 500);

    const body = (await req.json().catch(() => ({}))) as { messages?: Msg[] };
    const raw = Array.isArray(body.messages) ? body.messages : [];
    const messages = raw
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_LEN) }));
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return json({ error: 'last message must be from the user' }, 400);
    }

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages }),
    });
    if (!res.ok) return json({ error: `Anthropic ${res.status}: ${await res.text()}` }, 502);

    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');

    const parsed = parseLoose(text);
    const reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : text.trim();
    const showMatches = parsed.showMatches === true;
    return json({ reply, showMatches });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

function parseLoose(raw: string): { reply?: string; showMatches?: boolean } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return {};
  }
}
