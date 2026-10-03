/**
 * listing-extract — reads an agent's free-text description and returns the
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
 * Env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const MODEL = 'claude-opus-4-8';
const PROMPT = `You read a Nigerian property listing an estate agent typed and pull out
structured fields. Return STRICT JSON only: {"fields": {...}}, including ONLY
keys the text actually states or makes unambiguous. Never guess, never fill a
default. Numbers are plain numbers (naira as whole numbers: "26m" = 26000000,
"1.5M" = 1500000, "N450k" = 450000).

Keys (all optional):
 property_type: "apartment"|"house"|"duplex"|"terrace"|"penthouse"|"bungalow"|"land"|"commercial"|"shared"
   ("self contain", "room and parlour", "single room", "BQ" for rent -> "shared";
    "flat" -> "apartment"; "detached"/"semi-detached" -> "duplex" unless a bungalow)
 deal_structure: "outright"|"rent"|"shortlet"|"lease"|"off_plan"|"joint_venture"|"development_financing"|"rent_to_own"
   (off-plan / pre-construction / "buy now, completion in" -> "off_plan";
    "JV" / landowner partnership -> "joint_venture"; investors funding a build -> "development_financing")
 build_stage: "completed"|"under_construction"|"not_started"
 handover_date: "YYYY-MM-DD" (a stated delivery/completion month -> its first day)
 build_progress_pct: 0-100
 payment_plan: "outright"|"instalments"
 deposit_pct: 0-100 (initial deposit as a percentage of the price)
 instalment_months: integer
 units_available: integer (how many identical units/plots are available)
 price: number (the asking price of ONE unit)
 price_period: "total"|"per_year"|"per_month"|"per_night"
 bedrooms, bathrooms, toilets, parking_spaces: integers
 area_sqm: number (building or land size in square metres)
 plot_count: number; plot_size_sqm: number ("1 plot (600sqm)" -> plot_count 1, plot_size_sqm 600)
 title_type: "c_of_o"|"governors_consent"|"registered_deed"|"excision"|"gazette"|"allocation"
 furnished: "unfurnished"|"semi"|"fully"
 service_charge: number (per year)
 agency_fee: number; legal_fee: number
 min_investment: number; investment_term_months: integer; stated_return_pct: number
 address: the street address or estate, exactly as written, if one is given
 amenities: array of short lowercase phrases actually listed (e.g. "borehole", "24hr power", "gated estate", "fitted kitchen")`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Sign in first' }, 401);
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ error: 'Not available right now' }, 503);

    const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return json({ error: 'Sign in first' }, 401);
    const { data: m } = await userClient.from('agency_members').select('agency_id').eq('profile_id', u.user.id).is('deleted_at', null).limit(1);
    if (!m || !m.length) return json({ error: 'Only agency members can use this' }, 403);

    const body = (await req.json().catch(() => ({}))) as { title?: string; description?: string };
    const text = [String(body.title ?? '').slice(0, 200), String(body.description ?? '').slice(0, 6000)].filter(Boolean).join('\n\n');
    if (text.trim().length < 20) return json({ error: 'Write a little more in the description first' }, 400);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 900, system: PROMPT, messages: [{ role: 'user', content: text }] }),
    });
    const out = await res.json().catch(() => ({})) as { content?: Array<{ type: string; text?: string }> };
    if (!res.ok) return json({ error: 'Could not read the description just now' }, 502);
    const raw = (out.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    const match = raw.match(/\{[\s\S]*\}/);
    let parsed: { fields?: Record<string, unknown> } = {};
    try { parsed = match ? JSON.parse(match[0]) : {}; } catch { parsed = {}; }
    return json({ fields: clean(parsed.fields ?? {}) });
  } catch (err) {
    console.error('listing-extract', err instanceof Error ? err.message : err);
    return json({ error: 'Could not read the description just now' }, 500);
  }
});

/* Only known keys, only the right shapes: whatever the model says, the form
   receives nothing it cannot hold. */
const ENUMS: Record<string, string[]> = {
  property_type: ['apartment', 'house', 'duplex', 'terrace', 'penthouse', 'bungalow', 'land', 'commercial', 'shared'],
  deal_structure: ['outright', 'rent', 'shortlet', 'lease', 'off_plan', 'joint_venture', 'development_financing', 'rent_to_own'],
  build_stage: ['completed', 'under_construction', 'not_started'],
  payment_plan: ['outright', 'instalments'],
  price_period: ['total', 'per_year', 'per_month', 'per_night'],
  title_type: ['c_of_o', 'governors_consent', 'registered_deed', 'excision', 'gazette', 'allocation'],
  furnished: ['unfurnished', 'semi', 'fully'],
};
const NUMS = ['build_progress_pct', 'deposit_pct', 'instalment_months', 'units_available', 'price', 'bedrooms', 'bathrooms',
  'toilets', 'parking_spaces', 'area_sqm', 'plot_count', 'plot_size_sqm', 'service_charge', 'agency_fee', 'legal_fee',
  'min_investment', 'investment_term_months', 'stated_return_pct'];
function clean(f: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, vals] of Object.entries(ENUMS)) if (typeof f[k] === 'string' && vals.includes(f[k] as string)) o[k] = f[k];
  for (const k of NUMS) { const n = Number(f[k]); if (f[k] != null && isFinite(n) && n >= 0) o[k] = n; }
  if (typeof f.handover_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.handover_date)) o.handover_date = f.handover_date;
  if (typeof f.address === 'string' && f.address.trim()) o.address = f.address.trim().slice(0, 200);
  if (Array.isArray(f.amenities)) o.amenities = f.amenities.filter((a) => typeof a === 'string').map((a) => (a as string).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
  return o;
}
