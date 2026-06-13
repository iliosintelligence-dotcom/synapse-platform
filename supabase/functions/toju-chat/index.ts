/**
 * toju-chat — Toju, the AI property consultant. Deno / Supabase Edge Function.
 *
 * GPT-4o with exactly one tool: search_properties. Runs with the CALLER's
 * JWT so all reads/writes obey RLS (chat_sessions is owner-only; properties
 * exposes only verified+active+live rows to consumers).
 *
 * Hard constraints:
 *  - city is MANDATORY on every search. Toju never shows listings from a
 *    city the user did not ask about.
 *  - No embeddings / vectors / memory service. History lives in
 *    chat_sessions.messages (jsonb), trimmed to the last 30 messages.
 *  - Extracted preferences (city, budget, type) are promoted to columns.
 *
 * Env: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const MAX_MESSAGES = 30;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';

const SYSTEM_PROMPT = `You are Toju, an AI real estate consultant for Synapse in Nigeria.
You ADVISE and RECOMMEND — you are not a search box. You reason out loud and
explain WHY a property fits before showing it.

Conversation style:
- Ask progressive questions in this order when information is missing:
  1) location (which city/area), 2) budget, 3) lifestyle/needs.
- Ask ONE focused question at a time. Be warm, concise, and expert.

Hard rules:
- You may only recommend properties via the search_properties tool.
- city is REQUIRED before any search. If the user has not named a city,
  ask for it — do NOT guess or search a default city.
- Never mention properties from a city the user did not ask about.
- If search returns nothing, say exactly: "I don't have verified listings
  in {city} yet — want me to notify you when one does?" Do not invent
  listings or suggest other cities unprompted.
- All listings are independently verified; you can speak to that trust.
- Naira amounts use the ₦ symbol.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_properties',
      description:
        'Search verified, active Synapse listings. city is mandatory. Returns matching properties to recommend.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City the user is searching in. REQUIRED.' },
          listing_type: { type: 'string', enum: ['sale', 'rent', 'shortlet'] },
          property_type: {
            type: 'string',
            enum: ['apartment', 'house', 'duplex', 'terrace', 'penthouse', 'bungalow', 'land', 'commercial'],
          },
          budget_min: { type: 'number', description: 'Minimum price in naira' },
          budget_max: { type: 'number', description: 'Maximum price in naira' },
          bedrooms_min: { type: 'number' },
        },
        required: ['city'],
      },
    },
  },
];

interface SearchArgs {
  city: string;
  listing_type?: string;
  property_type?: string;
  budget_min?: number;
  budget_max?: number;
  bedrooms_min?: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  property_ids?: string[];
  at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return json({ error: 'Server misconfigured: no OpenAI key' }, 500);

    // Caller-scoped client — RLS enforced on every query.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not authenticated' }, 401);

    const body = (await req.json()) as { session_id?: string; message?: string };
    if (!body.message || !body.message.trim()) {
      return json({ error: 'message is required' }, 400);
    }

    // ── load or create session ──
    let sessionId = body.session_id ?? null;
    let history: ChatMessage[] = [];
    if (sessionId) {
      const { data } = await supabase
        .from('chat_sessions')
        .select('id, messages')
        .eq('id', sessionId)
        .maybeSingle();
      if (data) history = (data.messages as ChatMessage[]) ?? [];
    }
    if (!sessionId) {
      const { data, error } = await supabase
        .from('chat_sessions')
        .insert({ consumer_id: user.id, messages: [] })
        .select('id')
        .single();
      if (error) return json({ error: `Could not start session: ${error.message}` }, 500);
      sessionId = data.id as string;
    }

    const nowIso = new Date().toISOString();
    history.push({ role: 'user', content: body.message, at: nowIso });

    // ── compose OpenAI messages ──
    const oaMessages: { role: string; content: string }[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    // ── first model call (may request the tool) ──
    let recommendedIds: string[] = [];
    let extractedPrefs: SearchArgs | null = null;

    const first = await callOpenAI(openaiKey, oaMessages, TOOLS);
    const choice = first.choices?.[0]?.message;
    let finalText = choice?.content ?? '';

    const toolCall = choice?.tool_calls?.[0];
    if (toolCall && toolCall.function?.name === 'search_properties') {
      const args = JSON.parse(toolCall.function.arguments || '{}') as SearchArgs;
      extractedPrefs = args;

      const { results, ids } = await runSearch(supabase, args);
      recommendedIds = ids;

      // Feed tool result back for the final natural-language answer.
      const toolResultContent =
        results.length > 0
          ? JSON.stringify(results)
          : `NO_RESULTS for city "${args.city}". Use the exact no-listings line.`;

      const second = await callOpenAI(
        openaiKey,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history.map((m) => ({ role: m.role, content: m.content })),
          {
            role: 'assistant',
            content: '',
            tool_calls: [toolCall],
          } as unknown as { role: string; content: string },
          {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultContent,
          } as unknown as { role: string; content: string },
        ],
        undefined,
      );
      finalText = second.choices?.[0]?.message?.content ?? finalText;
    }

    // ── persist assistant turn + trim ──
    history.push({
      role: 'assistant',
      content: finalText,
      property_ids: recommendedIds,
      at: new Date().toISOString(),
    });
    const trimmed = history.slice(-MAX_MESSAGES);

    const sessionUpdate: Record<string, unknown> = { messages: trimmed };
    if (extractedPrefs) {
      sessionUpdate.pref_city = extractedPrefs.city;
      if (extractedPrefs.budget_min !== undefined) sessionUpdate.pref_budget_min = extractedPrefs.budget_min;
      if (extractedPrefs.budget_max !== undefined) sessionUpdate.pref_budget_max = extractedPrefs.budget_max;
      if (extractedPrefs.property_type) sessionUpdate.pref_property_type = extractedPrefs.property_type;
      if (extractedPrefs.listing_type) sessionUpdate.pref_listing_type = extractedPrefs.listing_type;
    }
    await supabase.from('chat_sessions').update(sessionUpdate).eq('id', sessionId);

    return json({ message: finalText, property_ids: recommendedIds, session_id: sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, 500);
  }
});

/* ───────── helpers ───────── */

interface OpenAIResponse {
  choices?: {
    message?: {
      content?: string;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
}

async function callOpenAI(
  key: string,
  messages: unknown[],
  tools?: unknown[],
): Promise<OpenAIResponse> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  return (await res.json()) as OpenAIResponse;
}

interface SearchRow {
  id: string;
  title: string;
  city: string;
  price: number;
  listing_type: string;
  property_type: string;
  bedrooms: number | null;
  trust_score: number | null;
}

async function runSearch(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: SearchArgs,
): Promise<{ results: SearchRow[]; ids: string[] }> {
  // city is mandatory and case-insensitive; RLS already restricts to
  // verified + active + live, but we assert it explicitly for clarity.
  let query = supabase
    .from('properties')
    .select('id, title, city, price, listing_type, property_type, bedrooms, trust_score')
    .ilike('city', args.city)
    .eq('verification_status', 'verified')
    .eq('is_active', true)
    .eq('status', 'live')
    .order('trust_score', { ascending: false, nullsFirst: false })
    .limit(5);

  if (args.listing_type) query = query.eq('listing_type', args.listing_type);
  if (args.property_type) query = query.eq('property_type', args.property_type);
  if (args.budget_min !== undefined) query = query.gte('price', args.budget_min);
  if (args.budget_max !== undefined) query = query.lte('price', args.budget_max);
  if (args.bedrooms_min !== undefined) query = query.gte('bedrooms', args.bedrooms_min);

  const { data, error } = await query;
  if (error) throw new Error(`Search failed: ${error.message}`);
  const results = (data ?? []) as SearchRow[];
  return { results, ids: results.map((r) => r.id) };
}
