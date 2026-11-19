/* listing-extract's pure parts (2026-11-19): the instructions, what may come back, and how an answer is read. Kept apart
   from index.ts so they can be tested without a network or a model. */

export const PROMPT = `You read a Nigerian property listing an estate agent typed and pull out
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

/** The fields out of a model's answer, whatever wraps them: {"fields": {...}}, a bare {...}, or text around it. */
export function parseFields(raw: string): Record<string, unknown> {
  const match = String(raw ?? '').match(/\{[\s\S]*\}/);
  if (!match) return {};
  let parsed: { fields?: Record<string, unknown> } = {};
  try { parsed = JSON.parse(match[0]); } catch { return {}; }
  const f = parsed && typeof parsed === 'object' && parsed.fields && typeof parsed.fields === 'object' ? parsed.fields : parsed;
  return clean((f ?? {}) as Record<string, unknown>);
}

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
export function clean(f: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, vals] of Object.entries(ENUMS)) if (typeof f[k] === 'string' && vals.includes(f[k] as string)) o[k] = f[k];
  for (const k of NUMS) { const n = Number(f[k]); if (f[k] != null && isFinite(n) && n >= 0) o[k] = n; }
  if (typeof f.handover_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.handover_date)) o.handover_date = f.handover_date;
  if (typeof f.address === 'string' && f.address.trim()) o.address = f.address.trim().slice(0, 200);
  if (Array.isArray(f.amenities)) o.amenities = f.amenities.filter((a) => typeof a === 'string').map((a) => (a as string).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
  return o;
}
