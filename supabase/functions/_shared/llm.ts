/**
 * llm.ts — the fast path for every short AI job (Tayo's replies, captions, rewrites).
 *
 * WHY (Eden, 2026-10-13): replies and captions took five to ten seconds. A person talking to Tayo expects a
 * human pace: two to three seconds. The slowness is the model host, not the prompts: a general "flash" model
 * answers in several seconds, while Llama served on a purpose-built inference chip answers in a fraction of one.
 * Groq and Cerebras both speak the OpenAI chat-completions format, so this is one small client for either.
 *
 * Which one runs is decided by environment, nothing is hard-wired:
 *   LLM_PROVIDER   'groq' | 'cerebras'   (default: whichever of GROQ_API_KEY / CEREBRAS_API_KEY is set)
 *   GROQ_API_KEY / CEREBRAS_API_KEY
 *   LLM_MODEL        the writing model          (default llama-3.3-70b-versatile on Groq, llama-3.3-70b on Cerebras)
 *   LLM_FAST_MODEL   the small reading model    (default llama-3.1-8b-instant on Groq, llama3.1-8b on Cerebras)
 *
 * With no key set, fastLlm() returns null and the caller carries on with Gemini exactly as before. Any error
 * from the fast host also comes back as { error } so the caller can fall back to Gemini for that one call:
 * a slow answer is better than none.
 */

export interface FastMsg { role: 'user' | 'assistant'; content: string }
export type FastResult = { text: string; truncated?: boolean } | { error: string } | null;

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key: 'GROQ_API_KEY', model: 'llama-3.3-70b-versatile', fast: 'llama-3.1-8b-instant',
  },
  cerebras: {
    url: 'https://api.cerebras.ai/v1/chat/completions',
    key: 'CEREBRAS_API_KEY', model: 'gpt-oss-120b', fast: 'gpt-oss-120b',
  },
} as const;

function pick(): { name: 'groq' | 'cerebras'; key: string } | null {
  const want = (Deno.env.get('LLM_PROVIDER') ?? '').toLowerCase();
  const order: Array<'groq' | 'cerebras'> = want === 'cerebras' ? ['cerebras', 'groq'] : ['groq', 'cerebras'];
  for (const name of order) {
    const key = Deno.env.get(PROVIDERS[name].key);
    if (key) return { name, key };
  }
  return null;
}

/** true when a fast provider is configured (so callers can skip Gemini-only work such as web-search tools). */
export const fastLlmConfigured = (): boolean => pick() !== null;

/**
 * One JSON answer. `small` picks the small reading model (extraction, classification) over the writing model.
 * `schema` is told to the model in words (the OpenAI JSON mode has no schema), and the caller still parses
 * defensively as it always did.
 */
export async function fastLlm(o: {
  system: string; messages: FastMsg[]; maxTokens: number; temperature?: number; small?: boolean; schema?: unknown; timeoutMs?: number; model?: string;
}): Promise<FastResult> {
  const p = pick();
  if (!p) return null;
  const cfg = PROVIDERS[p.name];
  const model = o.model ?? (o.small
    ? (Deno.env.get('LLM_FAST_MODEL') ?? cfg.fast)
    : (Deno.env.get('LLM_MODEL') ?? cfg.model));
  /* JSON mode needs the word JSON in the prompt; a schema, when there is one, is spelled out. */
  const system = o.system + '\n\nReturn ONLY one valid JSON object, no prose around it.'
    + (o.schema ? ' It must match this JSON schema: ' + JSON.stringify(o.schema) : '');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('timeout'), o.timeoutMs ?? 12000);
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
    if (!res.ok) return { error: `${p.name} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 400)}` };
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
