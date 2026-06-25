/**
 * toju-chat — Toju, the AI property consultant. Deno / Supabase Edge Function.
 *
 * Provider-agnostic, prompt-versioned AI gateway (Layer 3 → enables 7.7 "AI
 * Property OS" without an architecture rewrite). The LLM backend is swappable
 * behind an `LLMProvider` adapter, the system prompt comes from a versioned
 * registry, and tools come from a registry the gateway iterates. Toju's
 * behaviour is unchanged — same prompt text, same single `search_properties`
 * tool, same mandatory-city rule, same 30-message trim, same no-listings line.
 *
 * Defaults to Claude (`claude-opus-4-8`); OpenAI (`gpt-4o`) remains available
 * via TOJU_LLM_PROVIDER=openai. Both run with the CALLER's JWT so all
 * reads/writes obey RLS (chat_sessions is owner-only; properties exposes only
 * verified+active+live rows to consumers).
 *
 * Hard constraints:
 *  - city is MANDATORY on every search. Toju never shows listings from a
 *    city the user did not ask about.
 *  - No embeddings / vectors / memory service. History lives in
 *    chat_sessions.messages (jsonb), trimmed to the last 30 messages. Each
 *    assistant turn records the prompt version + model that produced it.
 *  - Extracted preferences (city, budget, type) are promoted to columns.
 *
 * Env: ANTHROPIC_API_KEY (default provider) and/or OPENAI_API_KEY,
 *      optional TOJU_LLM_PROVIDER ('anthropic' | 'openai', default 'anthropic'),
 *      SUPABASE_URL, SUPABASE_ANON_KEY (auto-injected).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const MAX_MESSAGES = 30;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 1024;

/* ───────── prompt registry ─────────
 * Versioned source for Toju's system prompt. The active version is recorded on
 * every assistant turn so prompt changes are traceable (and A/B-able later). */

interface PromptVersion {
  id: string;
  version: string;
  text: string;
}

const TOJU_SYSTEM_V1: PromptVersion = {
  id: 'toju-system',
  version: '2026-06-25.1',
  text: `You are Toju, an AI real estate consultant for Synapse in Nigeria.
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
- Naira amounts use the ₦ symbol.`,
};

const PROMPT_REGISTRY: Record<string, PromptVersion> = {
  [TOJU_SYSTEM_V1.version]: TOJU_SYSTEM_V1,
};

const ACTIVE_PROMPT = TOJU_SYSTEM_V1;
// `PROMPT_REGISTRY` is the lookup surface for future versioned prompts; the
// active one is exported via ACTIVE_PROMPT. Referenced to keep it live.
void PROMPT_REGISTRY;

/* ───────── tool registry ─────────
 * Gateway-neutral tool definitions. Each provider adapter translates these into
 * its own wire format, and the gateway dispatches a tool call to `run` by name.
 * Adding a tool later means appending an entry here — no edits to request bodies. */

interface GatewayTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  // deno-lint-ignore no-explicit-any
  run(supabase: any, args: Record<string, unknown>): Promise<{ content: string; ids: string[] }>;
}

const TOOLS: GatewayTool[] = [
  {
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
    async run(supabase, args) {
      const searchArgs = args as unknown as SearchArgs;
      const { results, ids } = await runSearch(supabase, searchArgs);
      // Feed tool result back for the final natural-language answer.
      const content =
        results.length > 0
          ? JSON.stringify(results)
          : `NO_RESULTS for city "${searchArgs.city}". Use the exact no-listings line.`;
      return { content, ids };
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

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
  prompt_version?: string;
  model?: string;
  at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    let provider: LLMProvider;
    try {
      provider = resolveProvider();
    } catch (e) {
      return json({ error: `Server misconfigured: ${(e as Error).message}` }, 500);
    }

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

    // ── run the gateway (may call a tool, then answer) ──
    const { text: finalText, ids: recommendedIds, toolArgs } = await runGateway(
      provider,
      supabase,
      ACTIVE_PROMPT.text,
      history,
    );
    const extractedPrefs = toolArgs as SearchArgs | null;

    // ── persist assistant turn + trim ──
    history.push({
      role: 'assistant',
      content: finalText,
      property_ids: recommendedIds,
      prompt_version: ACTIVE_PROMPT.version,
      model: provider.model,
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

/* ───────── AI gateway ─────────
 * A normalized conversation model that each provider adapter translates into
 * its own wire format. This is the swappable seam: the handler talks to
 * `LLMProvider`, never to a specific vendor's request shape. */

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

type GatewayMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'assistant_tool_call'; toolCall: ToolCall }
  | { role: 'tool_result'; toolCallId: string; toolName: string; content: string };

interface GatewayResponse {
  text: string;
  toolCall: ToolCall | null;
}

interface LLMProvider {
  readonly id: string;
  readonly model: string;
  complete(system: string, messages: GatewayMessage[], tools: GatewayTool[]): Promise<GatewayResponse>;
}

function resolveProvider(): LLMProvider {
  const choice = (Deno.env.get('TOJU_LLM_PROVIDER') ?? 'anthropic').toLowerCase();
  if (choice === 'openai') {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) throw new Error('no OpenAI key');
    return new OpenAIProvider(key);
  }
  // Default: Claude. New AI work defaults to the latest Claude models.
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('no Anthropic key');
  return new AnthropicProvider(key);
}

/**
 * The two-call flow: ask the model (with tools), and if it requests a known
 * tool, run it and ask again (without tools) for the final answer. Provider-
 * agnostic — the adapter handles each vendor's message/tool-call shape.
 */
async function runGateway(
  provider: LLMProvider,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  system: string,
  history: ChatMessage[],
): Promise<{ text: string; ids: string[]; toolArgs: Record<string, unknown> | null }> {
  const messages: GatewayMessage[] = history.map((m) => ({ role: m.role, content: m.content }));

  const first = await provider.complete(system, messages, TOOLS);
  let finalText = first.text;
  let ids: string[] = [];
  let toolArgs: Record<string, unknown> | null = null;

  const call = first.toolCall;
  if (call && TOOL_BY_NAME.has(call.name)) {
    const tool = TOOL_BY_NAME.get(call.name)!;
    toolArgs = call.arguments;

    const { content, ids: foundIds } = await tool.run(supabase, call.arguments);
    ids = foundIds;

    const followUp: GatewayMessage[] = [
      ...messages,
      { role: 'assistant_tool_call', toolCall: call },
      { role: 'tool_result', toolCallId: call.id, toolName: call.name, content },
    ];
    const second = await provider.complete(system, followUp, []);
    finalText = second.text || finalText;
  }

  return { text: finalText, ids, toolArgs };
}

/* ───────── provider adapters ───────── */

interface OpenAIResponse {
  choices?: {
    message?: {
      content?: string;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
}

/**
 * OpenAI Chat Completions: `system` is the first message in the array; an
 * assistant tool request carries a `tool_calls` array with stringified JSON
 * arguments; the result returns as a `tool` role message keyed by tool_call_id.
 */
class OpenAIProvider implements LLMProvider {
  readonly id = 'openai';
  readonly model = 'gpt-4o';
  constructor(private readonly key: string) {}

  async complete(system: string, messages: GatewayMessage[], tools: GatewayTool[]): Promise<GatewayResponse> {
    const oaMessages: unknown[] = [
      { role: 'system', content: system },
      ...messages.map(toOpenAIMessage),
    ];
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: oaMessages,
      temperature: 0.4,
    };
    if (tools.length > 0) {
      requestBody.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      requestBody.tool_choice = 'auto';
    }

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as OpenAIResponse;
    const choice = data.choices?.[0]?.message;
    const tc = choice?.tool_calls?.[0];
    const toolCall: ToolCall | null = tc
      ? { id: tc.id, name: tc.function.name, arguments: safeJsonParse(tc.function.arguments) }
      : null;
    return { text: choice?.content ?? '', toolCall };
  }
}

function toOpenAIMessage(m: GatewayMessage): unknown {
  switch (m.role) {
    case 'user':
      return { role: 'user', content: m.content };
    case 'assistant':
      return { role: 'assistant', content: m.content };
    case 'assistant_tool_call':
      return {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: m.toolCall.id,
            type: 'function',
            function: { name: m.toolCall.name, arguments: JSON.stringify(m.toolCall.arguments) },
          },
        ],
      };
    case 'tool_result':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  }
}

interface AnthropicResponse {
  content?: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }[];
}

/**
 * Anthropic Messages API: `system` is a top-level field (not a message); an
 * assistant tool request is a `tool_use` content block with the arguments as a
 * parsed `input` object; the result returns as a `user` message containing a
 * `tool_result` block keyed by tool_use_id. No `temperature` — it is rejected
 * on claude-opus-4-8.
 */
class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly model = 'claude-opus-4-8';
  constructor(private readonly key: string) {}

  async complete(system: string, messages: GatewayMessage[], tools: GatewayTool[]): Promise<GatewayResponse> {
    const requestBody: Record<string, unknown> = {
      model: this.model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system,
      messages: messages.map(toAnthropicMessage),
    };
    if (tools.length > 0) {
      requestBody.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      // tool_choice defaults to auto when tools are present.
    }

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.key,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as AnthropicResponse;
    let text = '';
    let toolCall: ToolCall | null = null;
    for (const block of data.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        text += block.text;
      } else if (block.type === 'tool_use' && !toolCall && block.id && block.name) {
        toolCall = { id: block.id, name: block.name, arguments: block.input ?? {} };
      }
    }
    return { text, toolCall };
  }
}

function toAnthropicMessage(m: GatewayMessage): unknown {
  switch (m.role) {
    case 'user':
      return { role: 'user', content: m.content };
    case 'assistant':
      return { role: 'assistant', content: m.content };
    case 'assistant_tool_call':
      return {
        role: 'assistant',
        content: [{ type: 'tool_use', id: m.toolCall.id, name: m.toolCall.name, input: m.toolCall.arguments }],
      };
    case 'tool_result':
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
      };
  }
}

function safeJsonParse(raw: string | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

/* ───────── search ───────── */

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
