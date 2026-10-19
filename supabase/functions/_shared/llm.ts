/**
 * llm.ts — the fast path for every short AI job (Tayo's replies, captions, rewrites).
 *
 * WHY (Eden, 2026-10-13): replies and captions took five to ten seconds. A person talking to Tayo expects a
 * human pace: two to three seconds. The slowness was the model host: a general "flash" model answers in several
 * seconds, while an open model served on a purpose-built inference chip answers in a fraction of one.
 *
 * Two hosts, both OpenAI-chat-compatible, tried in order, then the caller's own Gemini as the last resort:
 *   1. the first choice (LLM_PROVIDER, default groq: 0.1 to 0.4 s a call; Cerebras' free tier hit its per-minute request limit)
 *   2. the other one, if it has a key (a stall or an outage on one host costs a retry, not a slow answer)
 *   3. null/error back to the caller, which carries on with Gemini exactly as before
 *
 * Models are what each account actually lists (checked with the llm_ping action, 2026-10-13): neither account
 * offers Llama chat models today. Both offer OpenAI's open-source gpt-oss (120b, and 20b on Groq), which is what
 * runs here. It reasons before it answers, so it runs at LOW effort.
 *   CEREBRAS_API_KEY / GROQ_API_KEY       the keys (a host with no key is skipped)
 *   LLM_PROVIDER                          'groq' | 'cerebras'  (which first, default groq)
 *   CEREBRAS_MODEL, CEREBRAS_FAST_MODEL, GROQ_MODEL, GROQ_FAST_MODEL    override a model name
 */

export interface FastMsg { role: 'user' | 'assistant'; content: string }
export type FastResult = { text: string; truncated?: boolean } | { error: string } | null;

type Name = 'cerebras' | 'groq';
const PROVIDERS: Record<Name, { url: string; key: string; model: string; fast: string }> = {
  cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', key: 'CEREBRAS_API_KEY', model: 'gpt-oss-120b', fast: 'gpt-oss-120b' },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY', model: 'qwen/qwen3.8-27b', fast: 'openai/gpt-oss-20b' },
};

function chain(): Array<{ name: Name; key: string }> {
  const first = (Deno.env.get('LLM_PROVIDER') ?? 'groq').toLowerCase() === 'cerebras' ? 'cerebras' : 'groq';
  const order: Name[] = first === 'cerebras' ? ['cerebras', 'groq'] : ['groq', 'cerebras'];
  return order.flatMap((name) => {
    const key = Deno.env.get(PROVIDERS[name].key);
    return key ? [{ name, key }] : [];
  });
}

/** true when a fast provider is configured (so callers can skip Gemini-only work such as web-search tools). */
export const fastLlmConfigured = (): boolean => chain().length > 0;

async function one(p: { name: Name; key: string }, o: {
  system: string; messages: FastMsg[]; maxTokens: number; temperature?: number; small?: boolean; schema?: unknown; timeoutMs?: number; model?: string;
}): Promise<{ text: string; truncated?: boolean } | { error: string }> {
  const cfg = PROVIDERS[p.name];
  const up = p.name.toUpperCase();
  const model = o.model ?? (o.small
    ? (Deno.env.get(`${up}_FAST_MODEL`) ?? cfg.fast)
    : (Deno.env.get(`${up}_MODEL`) ?? cfg.model));
  /* JSON mode needs the word JSON in the prompt; a schema, when there is one, is spelled out. */
  const system = o.system + '\n\nReturn ONLY one valid JSON object, no prose around it.'
    + (o.schema ? ' It must match this JSON schema: ' + JSON.stringify(o.schema) : '');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('timeout'), o.timeoutMs ?? 5000);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: o.temperature ?? 0.25, max_tokens: o.maxTokens,
        response_format: { type: 'json_object' },
        ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {}),
        messages: [{ role: 'system', content: system }, ...o.messages.map((m) => ({ role: m.role, content: m.content }))],
      }),
      signal: ctl.signal,
    });
    if (!res.ok) return { error: `${p.name} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}` };
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
    const c = data.choices?.[0];
    const text = c?.message?.content ?? '';
    if (!text) return { error: `${p.name} returned nothing` };
    return { text, truncated: c?.finish_reason === 'length' };
  } catch (e) {
    return { error: `${p.name} ${e instanceof Error ? e.message : 'failed'}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One JSON answer. `small` picks the small reading model (extraction, classification) over the writing model.
 * `schema` is told to the model in words (the OpenAI JSON mode has no schema), and the caller still parses
 * defensively as it always did. `provider` pins one host (used by the llm_ping diagnostic).
 */
export async function fastLlm(o: {
  system: string; messages: FastMsg[]; maxTokens: number; temperature?: number; small?: boolean; schema?: unknown;
  timeoutMs?: number; model?: string; provider?: string;
}): Promise<FastResult> {
  let hosts = chain();
  if (o.provider) hosts = hosts.filter((h) => h.name === o.provider);
  if (!hosts.length) return null;
  let last = '';
  for (const h of hosts) {
    const r = await one(h, o);
    if ('text' in r) return r;
    last = r.error;
    console.error('fast llm host failed: ' + last.slice(0, 200));
  }
  return { error: last };
}
