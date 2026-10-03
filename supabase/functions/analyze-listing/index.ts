/**
 * analyze-listing — AI analysis of a property at upload time (build-plan v2.0,
 * Phase 1 / Week 3). Deno / Supabase Edge Function.
 *
 * Runs as a system process (service role) the moment a property is created.
 * Reads the agency's input + media and produces a normalized, structured
 * analysis: a likely target buyer profile, key selling points, and a match tag
 * set — written to the property's ai_* columns, kept SEPARATE from the agency's
 * own fields (it never overwrites what the agency typed).
 *
 * Provider-agnostic and prompt-versioned, mirroring toju-chat: defaults to
 * Claude (claude-opus-4-8), OpenAI (gpt-4o) available via ANALYZE_LLM_PROVIDER.
 * This is a single structured-JSON completion — no tools, no conversation.
 *
 * Invoke with { "property_id": "<uuid>" } (e.g. from a DB insert webhook or the
 * upload flow). Idempotent: re-running re-analyzes and overwrites only ai_*.
 *
 * Env: ANTHROPIC_API_KEY (default) and/or OPENAI_API_KEY,
 *      optional ANALYZE_LLM_PROVIDER ('anthropic' | 'openai', default 'anthropic'),
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

const PROMPT_VERSION = '2026-06-26.1';
const SYSTEM_PROMPT = `You are Synapse's listing analyst for the Nigerian property market.
Given a property an agency uploaded, return STRICT JSON (no prose, no markdown)
with exactly these keys:
{
  "target_buyer_profile": one of "family" | "investor" | "young_professional" | "shared",
  "selling_points": array of 2-5 short factual phrases drawn ONLY from the input,
  "tags": array of 4-10 lowercase snake_case match tags (e.g. "gated_estate", "near_lekki", "serviced", "off_plan"),
  "summary": one neutral sentence describing the property for matching
}
Rules:
- Use ONLY facts present in the input. Never invent amenities, locations, or numbers.
- If the input is too thin to judge a field, choose the most defensible value and keep tags conservative.
- Output JSON only.`;

interface Analysis {
  target_buyer_profile: string;
  selling_points: string[];
  tags: string[];
  summary: string;
}

const VALID_PROFILES = new Set(['family', 'investor', 'young_professional', 'shared']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!serviceKey) return json({ error: 'Server misconfigured: no service role key' }, 500);

    let provider: LLMProvider;
    try {
      provider = resolveProvider();
    } catch (e) {
      return json({ error: `Server misconfigured: ${(e as Error).message}` }, 500);
    }

    const body = (await req.json().catch(() => ({}))) as { property_id?: string };
    if (!body.property_id) return json({ error: 'property_id is required' }, 400);

    const admin = createClient(url, serviceKey);

    // Read the agency's input + media filenames for context.
    const { data: property, error: pErr } = await admin
      .from('properties')
      .select('id, title, description, property_type, listing_type, price, bedrooms, bathrooms, city, state, address, amenities')
      .eq('id', body.property_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (pErr) return json({ error: `Lookup failed: ${pErr.message}` }, 500);
    if (!property) return json({ error: 'property not found' }, 404);

    const { data: media } = await admin
      .from('property_media')
      .select('media_type')
      .eq('property_id', body.property_id);
    const mediaSummary = `${(media ?? []).filter((m) => m.media_type === 'image').length} photos, ` +
      `${(media ?? []).filter((m) => m.media_type === 'video').length} videos`;

    const userInput = JSON.stringify({ ...property, media: mediaSummary });

    let analysis: Analysis;
    try {
      const raw = await provider.complete(SYSTEM_PROMPT, userInput);
      analysis = normalize(parseJsonLoose(raw));
    } catch (e) {
      return json({ error: `Analysis failed: ${(e as Error).message}` }, 502);
    }

    // Write ONLY the ai_* columns — never touch the agency's input fields.
    const { error: uErr } = await admin
      .from('properties')
      .update({
        ai_analysis: { ...analysis, prompt_version: PROMPT_VERSION, model: provider.model, analyzed_at: new Date().toISOString() },
        ai_tags: analysis.tags,
        target_buyer_profile: analysis.target_buyer_profile,
      })
      .eq('id', body.property_id);
    if (uErr) return json({ error: `Update failed: ${uErr.message}` }, 500);

    return json({
      property_id: body.property_id,
      target_buyer_profile: analysis.target_buyer_profile,
      tags: analysis.tags,
      prompt_version: PROMPT_VERSION,
      model: provider.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, 500);
  }
});

/* ───────── normalization ───────── */

function normalize(obj: Record<string, unknown>): Analysis {
  const profileRaw = String(obj.target_buyer_profile ?? '').toLowerCase().replace(/\s+/g, '_');
  const target_buyer_profile = VALID_PROFILES.has(profileRaw) ? profileRaw : 'family';
  const selling_points = asStringArray(obj.selling_points).slice(0, 5);
  const tags = asStringArray(obj.tags)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .slice(0, 10);
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  return { target_buyer_profile, selling_points, tags, summary };
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') as string[] : [];
}

/** Tolerate a stray code fence or surrounding text around the JSON object. */
function parseJsonLoose(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(slice) as Record<string, unknown>;
}

/* ───────── providers (single completion, JSON out) ───────── */

interface LLMProvider {
  readonly id: string;
  readonly model: string;
  complete(system: string, userInput: string): Promise<string>;
}

function resolveProvider(): LLMProvider {
  const choice = (Deno.env.get('ANALYZE_LLM_PROVIDER') ?? 'anthropic').toLowerCase();
  if (choice === 'openai') {
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) throw new Error('no OpenAI key');
    return new OpenAIProvider(key);
  }
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('no Anthropic key');
  return new AnthropicProvider(key);
}

class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly model = 'claude-opus-4-8';
  constructor(private readonly key: string) {}
  async complete(system: string, userInput: string): Promise<string> {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': this.key, 'anthropic-version': ANTHROPIC_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: userInput }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  }
}

class OpenAIProvider implements LLMProvider {
  readonly id = 'openai';
  readonly model = 'gpt-4o';
  constructor(private readonly key: string) {}
  async complete(system: string, userInput: string): Promise<string> {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: userInput }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }
}
