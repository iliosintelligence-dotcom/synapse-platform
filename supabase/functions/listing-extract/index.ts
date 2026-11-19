/**
 * listing-extract, reads an agent's free-text description and returns the
 * listing form's fields, for the agent to check before saving.
 *
 * Eden, 2026-10-02: agents "keep typing long descriptions that can't be used
 * to do anything ... find a solution for how to transfer that information and
 * autofill the slots". The portal's "Fill from my description" button sends
 * the title and description here and fills only the fields that come back.
 *
 * Nothing is saved here and nothing is invented: a field the text does not
 * state is left out of the answer, so the form keeps whatever the agent had.
 *
 * POST { title?, description } -> { fields: { ... } }
 * Deployed with verify_jwt = true, and the caller must belong to an agency.
 * Env: GEMINI_API_KEY (same key and models as social-generate), SUPABASE_URL, SUPABASE_ANON_KEY.
 * Eden, 2026-10-11: the primary AI is Gemini now. This still called Anthropic, so the button
 * always answered "Could not read the description just now".
 *
 * THE FAST MODELS FIRST (2026-11-19). It called Gemini alone, with no time limit and up to four tries, and when Gemini was
 * slow the button sat on "Reading your description..." for over a minute (measured: 65 s) -- to the agent, broken. It now
 * asks the same fast models as Tayo and the studio's captions (_shared/llm.ts, 15 s), then Gemini with a limit on every
 * call, and gives up by DEADLINE_MS with a plain answer rather than hang.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { fastLlm } from '../_shared/llm.ts';
import { parseFields, PROMPT } from './extract.ts';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = Deno.env.get('SOCIAL_GEMINI_MODEL') ?? 'gemini-3.8-flash';
const FALLBACK_MODEL = Deno.env.get('SOCIAL_GEMINI_FALLBACK_MODEL') ?? 'gemini-3.5-flash-lite';
/* The whole answer, fast models and Gemini together, inside this. The page gives up a little after it. */
const DEADLINE_MS = 35000;
const GEMINI_CALL_MS = 15000;


Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Sign in first' }, 401);
    const key = Deno.env.get('GEMINI_API_KEY');

    const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return json({ error: 'Sign in first' }, 401);
    const { data: m } = await userClient.from('agency_members').select('agency_id').eq('profile_id', u.user.id).is('deleted_at', null).limit(1);
    if (!m || !m.length) return json({ error: 'Only agency members can use this' }, 403);

    const body = (await req.json().catch(() => ({}))) as { title?: string; description?: string };
    const text = [String(body.title ?? '').slice(0, 200), String(body.description ?? '').slice(0, 6000)].filter(Boolean).join('\n\n');
    if (text.trim().length < 20) return json({ error: 'Write a little more in the description first' }, 400);

    const started = Date.now();
    const left = () => DEADLINE_MS - (Date.now() - started);

    /* 1. The fast models (Groq, then Cerebras). */
    let fields: Record<string, unknown> = {};
    let via = '';
    const fast = await fastLlm({
      system: PROMPT, messages: [{ role: 'user', content: text }], maxTokens: 1200, temperature: 0.1, timeoutMs: 15000,
    });
    if (fast && 'text' in fast) {
      fields = parseFields(fast.text);
      via = 'fast';
    } else if (fast && 'error' in fast) {
      console.error('listing-extract: fast models failed, trying Gemini: ' + fast.error.slice(0, 200));
    }

    /* 2. Gemini, only if the fast models gave nothing, and never past the deadline. */
    if (!via && key) {
      const gbody = {
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { maxOutputTokens: 1200, temperature: 0.1, responseMimeType: 'application/json' },
      };
      outer: for (const model of [...new Set([MODEL, FALLBACK_MODEL])]) {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (left() < 3000) break outer;
          if (attempt) await new Promise((r) => setTimeout(r, 200));
          let res: Response;
          try {
            res = await fetch(`${GEMINI_API_URL}/${encodeURIComponent(model)}:generateContent`, {
              method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(gbody),
              signal: AbortSignal.timeout(Math.min(GEMINI_CALL_MS, left())),
            });
          } catch (e) {
            console.error('listing-extract gemini ' + model + ' timed out or failed: ' + (e instanceof Error ? e.message : String(e)));
            continue;
          }
          if (res.ok) {
            const out = await res.json().catch(() => ({})) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
            const raw = (out.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
            if (raw) { fields = parseFields(raw); via = 'gemini'; break outer; }
            continue;
          }
          if (![429, 500, 502, 503, 504].includes(res.status)) { console.error('listing-extract gemini', res.status, (await res.text()).slice(0, 300)); break; }
        }
      }
    }

    console.log(JSON.stringify({ at: 'listing-extract', via: via || 'none', ms: Date.now() - started, fields: Object.keys(fields).length }));
    if (!via) return json({ error: 'Could not read the description just now. Try again in a moment, or fill the boxes in below.' }, 502);
    return json({ fields });
  } catch (err) {
    console.error('listing-extract', err instanceof Error ? err.message : err);
    return json({ error: 'Could not read the description just now' }, 500);
  }
});

