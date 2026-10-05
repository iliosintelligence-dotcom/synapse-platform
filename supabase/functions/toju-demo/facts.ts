/**
 * Tayo's facts: everything about a conversation that must be right, written as
 * plain code so it can be tested and cannot be talked out of it.
 *
 * Tayo used to let the model decide in one breath what the person wanted, whether
 * to look at the database, and what to say about what it found. When the model
 * chose not to look, or looked and mis-stated, the reply stood: "nothing in that
 * range" with three plots in that range on screen. The rule now is:
 *
 *   1. UNDERSTAND  the model reads the message and returns what it means (data, no prose)
 *   2. REMEMBER    this file merges it into the brief and profile kept for the visitor
 *   3. LOOK        the server reads the database (index.ts) and builds evidence
 *   4. SAY         the model writes only from that evidence
 *   5. CHECK       this file reads the reply back against the evidence and refuses it
 *                  if it states something the database did not say
 *
 * Nothing here talks to the network.
 */

/* ───────────────────────── money ───────────────────────── */

export interface Money { min: number | null; max: number | null }

const UNIT: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mil: 1e6, million: 1e6, millions: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9, billions: 1e9,
};

interface Tok { value: number; unit: number | null; cur: boolean; at: number; end: number }

/** Every number in the text that could be an amount of naira, with what follows it. */
function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /(₦|ngn|naira|\bn(?=\s?\d))?\s*(\d[\d,]*(?:\.\d+)?)\s*(thousand|millions?|million|billions?|mil|mn|bn|k|m|b)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[2].replace(/,/g, '');
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    /* A phone number or an id is not a price. */
    if (raw.length >= 10 || (m[2].length >= 7 && /^0/.test(raw) && !m[3])) continue;
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    if (before === '+') continue;
    out.push({ value, unit: m[3] ? UNIT[m[3].toLowerCase()] ?? null : null, cur: !!m[1], at: m.index, end: m.index + m[0].length });
  }
  /* "between 3 and 5 million": the first number takes the unit of the next one. */
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].unit == null && out[i + 1].unit != null) {
      const gap = text.slice(out[i].end, out[i + 1].at);
      if (/^\s*(and|to|-|–|—|&|or)\s*(₦|ngn|n)?\s*$/i.test(gap)) out[i].unit = out[i + 1].unit;
    }
  }
  return out;
}

/** The amounts in a text, in whole naira. A bare small number is not an amount
 *  ("3 bedrooms"); a number is one when it has a unit, a currency sign, or is large. */
export function amountsIn(text: string): number[] {
  const t = String(text ?? '');
  const out: number[] = [];
  for (const k of tokens(t)) {
    const v = k.value * (k.unit ?? 1);
    if (k.unit != null || k.cur || k.value >= 100000) out.push(Math.round(v));
  }
  return out;
}

/**
 * What the person said about price, read by code, not by the model. null when they
 * named no amount. "under 4m" -> max; "between 3 and 5 million" -> both;
 * "at least 20m" -> min; a bare amount ("my budget is 5m", "5m") -> a ceiling.
 */
export function moneyFrom(text: string): Money | null {
  const t = String(text ?? '');
  const toks = tokens(t).filter((k) => k.unit != null || k.cur || k.value >= 100000);
  if (!toks.length) return null;
  const val = (k: Tok) => Math.round(k.value * (k.unit ?? 1));
  const lower = t.toLowerCase();
  if (toks.length >= 2) {
    const a = val(toks[0]), b = val(toks[1]);
    const between = /\b(between|from|range|ranging)\b/.test(lower.slice(0, toks[0].at + 1)) || /(^|\s)(and|to)(\s|$)|[-–—]/.test(lower.slice(toks[0].end, toks[1].at));
    if (between) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const k = toks[0];
  const v = val(k);
  const lead = lower.slice(Math.max(0, k.at - 28), k.at);
  if (/\b(at least|minimum|min|more than|over|above|from|starting|upwards of|no less than)\s*(about\s*)?(₦|ngn)?\s*$/.test(lead)) return { min: v, max: null };
  return { min: null, max: v };
}

/* ───────────────────────── contact details ───────────────────────── */

export function emailIn(text: string): string | null {
  const m = String(text ?? '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

/** A Nigerian mobile number, normalised to +234…; null when there is none. */
export function phoneIn(text: string): string | null {
  const flat = String(text ?? '').replace(/[\s().-]/g, '');
  const m = flat.match(/(?:\+?234|0)([789][01]\d{8})(?!\d)/);
  return m ? '+234' + m[1] : null;
}

/* ───────────────────────── the brief and the profile ───────────────────────── */

export interface Brief {
  place: string | null;          // a city or an area, as they said it
  dealType: 'rent' | 'buy' | 'shared' | null;
  propertyKind: 'land' | 'home' | 'commercial' | null;
  intent: 'live' | 'invest' | null;
  stage: 'completed' | 'off_plan' | 'either' | null;
  paymentPlan: 'outright' | 'mortgage' | 'flexpay' | null;
  minPrice: number | null;
  maxPrice: number | null;
  minBedrooms: number | null;
  anchor: string | null;
  browse: boolean;
}
export const EMPTY_BRIEF: Brief = {
  place: null, dealType: null, propertyKind: null, intent: null, stage: null, paymentPlan: null,
  minPrice: null, maxPrice: null, minBedrooms: null, anchor: null, browse: false,
};

export interface Profile {
  name: string | null;
  household: string | null;
  work: string | null;
  transport: string | null;
  lifestyle: string[];
  timeline: string | null;       // when they need to move or buy
  purpose: string | null;        // what the move or the plot is for, in their words
  financing: string | null;
  phone: string | null;
  email: string | null;
  /** Said yes to the agency being able to reach them with these. */
  contactOk: boolean | null;
  /** Said no or "later" to giving contact details: never ask a third time. */
  contactDeclined: boolean;
  asked: Record<string, number>; // how many times each slot has been asked
}
export const EMPTY_PROFILE: Profile = {
  name: null, household: null, work: null, transport: null, lifestyle: [], timeline: null, purpose: null,
  financing: null, phone: null, email: null, contactOk: null, contactDeclined: false, asked: {},
};

const str = (v: unknown, max = 160): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return t && !/^(null|none|unknown|n\/a|not (sure|given|stated))$/i.test(t) ? t : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const oneOf = <T extends string>(v: unknown, set: readonly T[]): T | null =>
  typeof v === 'string' && (set as readonly string[]).includes(v.toLowerCase()) ? v.toLowerCase() as T : null;

/** The brief we remembered for them, tolerating whatever shape older sessions saved. */
export function briefFromSaved(criteria: unknown): Brief {
  const c = (criteria && typeof criteria === 'object' ? criteria : {}) as Record<string, unknown>;
  const v2 = (c._v2 && typeof c._v2 === 'object' ? (c._v2 as Record<string, unknown>).brief : null) as Record<string, unknown> | null;
  const s = v2 ?? {};
  const pick = (k: string, alt?: string) => s[k] ?? c[alt ?? k];
  return {
    place: str(pick('place', 'city'), 80),
    dealType: oneOf(pick('dealType'), ['rent', 'buy', 'shared'] as const),
    propertyKind: oneOf(pick('propertyKind'), ['land', 'home', 'commercial'] as const),
    intent: oneOf(pick('intent'), ['live', 'invest'] as const),
    stage: oneOf(pick('stage'), ['completed', 'off_plan', 'either'] as const),
    paymentPlan: oneOf(pick('paymentPlan'), ['outright', 'mortgage', 'flexpay'] as const),
    minPrice: num(pick('minPrice')),
    maxPrice: num(pick('maxPrice')),
    minBedrooms: num(pick('minBedrooms')),
    anchor: str(pick('anchor'), 80),
    browse: pick('browse') === true,
  };
}

export function profileFromSaved(criteria: unknown): Profile {
  const c = (criteria && typeof criteria === 'object' ? criteria : {}) as Record<string, unknown>;
  const v2 = (c._v2 && typeof c._v2 === 'object' ? (c._v2 as Record<string, unknown>).profile : null) as Record<string, unknown> | null;
  const old = (c.profile && typeof c.profile === 'object' ? c.profile : {}) as Record<string, unknown>;
  const s = { ...old, ...(v2 ?? {}) } as Record<string, unknown>;
  const asked: Record<string, number> = {};
  if (s.asked && typeof s.asked === 'object') for (const [k, n] of Object.entries(s.asked as Record<string, unknown>)) asked[k] = Number(n) || 0;
  return {
    name: str(s.name, 60), household: str(s.household), work: str(s.work), transport: str(s.transport),
    lifestyle: Array.isArray(s.lifestyle) ? (s.lifestyle as unknown[]).map((x) => str(x, 40)).filter((x): x is string => !!x).slice(0, 12) : [],
    timeline: str(s.timeline, 80), purpose: str(s.purpose, 120), financing: str(s.financing, 80),
    phone: str(s.phone, 20), email: str(s.email, 120),
    contactOk: typeof s.contactOk === 'boolean' ? s.contactOk : null,
    contactDeclined: s.contactDeclined === true,
    asked,
  };
}

/** What the model understood from one message: only what was set or changed. */
export interface Understood {
  intent: 'search' | 'refine' | 'question' | 'chat' | 'details' | 'history';
  reset: boolean;
  brief: Partial<Brief> & { price?: { min?: unknown; max?: unknown } };
  profile: Partial<Omit<Profile, 'asked'>> & Record<string, unknown>;
  priceHistory: { area?: string; city?: string | null; kind?: string } | null;
}

export function readUnderstood(raw: Record<string, unknown>): Understood {
  const intents = ['search', 'refine', 'question', 'chat', 'details', 'history'] as const;
  const b = (raw.brief && typeof raw.brief === 'object' ? raw.brief : {}) as Record<string, unknown>;
  const p = (raw.profile && typeof raw.profile === 'object' ? raw.profile : {}) as Record<string, unknown>;
  const ph = raw.priceHistory && typeof raw.priceHistory === 'object' ? raw.priceHistory as Record<string, unknown> : null;
  return {
    intent: oneOf(raw.intent, intents) ?? 'chat',
    reset: raw.reset === true,
    brief: b as Understood['brief'],
    profile: p as Understood['profile'],
    priceHistory: ph && str(ph.area, 80) ? { area: str(ph.area, 80) as string, city: str(ph.city, 60), kind: str(ph.kind, 12) ?? undefined } : null,
  };
}

/**
 * Fold one message into the brief. A change replaces; silence keeps. `reset`
 * starts the search over (they gave up on the last one), but never forgets who
 * they are. Money comes from the person's own words, read by code: the model's
 * reading is used only when the message named no amount at all.
 */
export function mergeBrief(prev: Brief, u: Understood, userText: string): Brief {
  const base: Brief = u.reset ? { ...EMPTY_BRIEF } : { ...prev };
  const b = u.brief as Record<string, unknown>;
  const next: Brief = { ...base };
  const place = str(b.place ?? b.city, 80); if (place) next.place = place;
  const deal = oneOf(b.dealType, ['rent', 'buy', 'shared'] as const); if (deal) next.dealType = deal;
  const kind = oneOf(b.propertyKind, ['land', 'home', 'commercial'] as const); if (kind) next.propertyKind = kind;
  const intent = oneOf(b.intent, ['live', 'invest'] as const); if (intent) next.intent = intent;
  const stage = oneOf(b.stage, ['completed', 'off_plan', 'either'] as const); if (stage) next.stage = stage;
  const pay = oneOf(b.paymentPlan, ['outright', 'mortgage', 'flexpay'] as const); if (pay) next.paymentPlan = pay;
  const beds = num(b.minBedrooms); if (beds) next.minBedrooms = beds;
  const anchor = str(b.anchor, 80); if (anchor) next.anchor = anchor;
  if (b.browse === true) next.browse = true;
  /* land is bought; investing in land is buying land */
  if (next.propertyKind === 'land' && !next.dealType) next.dealType = 'buy';

  const said = moneyFrom(userText);
  if (said) {
    /* A new amount replaces the old budget outright: "within 4 million" after "between 3 and 5"
       is a ceiling of 4m with no floor, not a floor of 3m left over. */
    next.minPrice = said.min; next.maxPrice = said.max;
  } else {
    const pm = (b.price && typeof b.price === 'object' ? b.price : null) as { min?: unknown; max?: unknown } | null;
    if (pm && (num(pm.min) || num(pm.max))) { next.minPrice = num(pm.min); next.maxPrice = num(pm.max); }
  }
  if (next.minPrice && next.maxPrice && next.minPrice > next.maxPrice) [next.minPrice, next.maxPrice] = [next.maxPrice, next.minPrice];
  return next;
}

export function mergeProfile(prev: Profile, u: Understood, userText: string): Profile {
  const p = u.profile as Record<string, unknown>;
  const next: Profile = { ...prev, lifestyle: [...prev.lifestyle], asked: { ...prev.asked } };
  const set = (k: 'name' | 'household' | 'work' | 'transport' | 'timeline' | 'purpose' | 'financing', max = 160) => { const v = str(p[k], max); if (v) next[k] = v; };
  set('name', 60); set('household'); set('work'); set('transport'); set('timeline', 80); set('purpose', 120); set('financing', 80);
  if (Array.isArray(p.lifestyle)) {
    for (const t of p.lifestyle) { const v = str(t, 40); if (v && !next.lifestyle.some((x) => x.toLowerCase() === v.toLowerCase())) next.lifestyle.push(v); }
    next.lifestyle = next.lifestyle.slice(0, 12);
  }
  /* Contact details are read from what they typed, never from the model's paraphrase. */
  const phone = phoneIn(userText); if (phone) next.phone = phone;
  const email = emailIn(userText); if (email) next.email = email;
  if (phone || email) { next.contactDeclined = false; if (p.contactOk !== false) next.contactOk = true; }
  if (p.contactOk === true) next.contactOk = true;
  if (p.contactDeclined === true && !phone && !email) next.contactDeclined = true;
  return next;
}

/* ───────────────────────── what to ask next ───────────────────────── */

export type Slot = 'place' | 'purpose' | 'budget' | 'timeline' | 'household' | 'landUse' | 'name' | 'contact' | 'stage' | null;

export interface Ask { slot: Slot; hint: string; closed: string[] }

/**
 * The next thing a good advisor would find out. One at a time, in an order that
 * earns each answer: where and what first (so the database can answer at once),
 * then the money and the timing, then who is moving, and only once there is
 * something on screen their name and a way for the agency to reach them. A slot
 * already asked twice is not asked a third time.
 */
export function nextAsk(brief: Brief, profile: Profile, shown: number): Ask {
  const tried = (s: string) => (profile.asked[s] ?? 0) >= 2;
  const land = brief.propertyKind === 'land';
  if (!brief.place && !tried('place')) return { slot: 'place', hint: 'Ask where they want it: a city or an area. Open question.', closed: [] };
  if (!brief.dealType && !brief.propertyKind && !brief.browse && !tried('purpose')) {
    return { slot: 'purpose', hint: 'Ask what they want to do: buy a home, rent, a shared room, buy land, or invest. Open question.', closed: [] };
  }
  if (!brief.maxPrice && !brief.minPrice && !tried('budget')) {
    return { slot: 'budget', hint: 'Ask what they are comfortable spending (annual rent if renting, total price if buying). Frame it as being on their side. Open question.', closed: [] };
  }
  if (!profile.timeline && !tried('timeline')) return { slot: 'timeline', hint: 'Ask when they need to move in or buy by.', closed: [] };
  if (land && !profile.purpose && !tried('landUse')) return { slot: 'landUse', hint: 'Ask what the land is for: build a home, hold it as an investment, farming or commercial use.', closed: [] };
  if (!land && !profile.household && brief.dealType !== 'shared' && !tried('household')) return { slot: 'household', hint: 'Ask who is moving with them. Open question; never ask how many bedrooms.', closed: [] };
  if (brief.dealType === 'buy' && !land && !brief.stage && shown > 0 && !tried('stage')) {
    return { slot: 'stage', hint: 'Ask whether it must be a finished home or whether off-plan (built later, paid in instalments) is fine.', closed: ['Finished only', 'Off-plan is fine'] };
  }
  if (shown > 0 && !profile.name && !tried('name')) return { slot: 'name', hint: 'Ask what you should call them.', closed: [] };
  if (shown > 0 && profile.name && !profile.phone && !profile.email && !profile.contactDeclined && !tried('contact')) {
    return { slot: 'contact', hint: 'Ask for the best phone number or email for the listing agency to reach them once they pick a home, and say plainly that nothing is sent to any agency until they choose to send it.', closed: [] };
  }
  return { slot: null, hint: 'Nothing more is needed. Offer one concrete next step about the homes on screen: open one, compare two, or book a viewing.', closed: [] };
}

/* ───────────────────────── what the database said ───────────────────────── */

/** The rows Tayo may speak about, and the numbers about the place they come from. */
export interface Evidence {
  checked: boolean;                 // the database was read; false means say you could not check
  place: string | null;
  kindLabel: string;                // "land plots", "homes for rent" ...
  liveInPlace: number;              // everything live in that place
  sameKindInPlace: number;          // live in that place and of the kind asked for
  priceRange: { min: number; max: number } | null;   // across the same-kind rows
  budget: { min: number | null; max: number | null };
  exactTotal: number;               // rows inside the budget (and every other hard filter)
  role: 'exact' | 'stretch' | 'closest' | 'none';    // what the cards are
  shown: Array<{ id: string; title: string; price: number; period: string; area: string | null; bedrooms: number; kind: string }>;
  otherPlaces: Array<{ place: string; count: number }>;   // same kind, elsewhere, when the place has none
  note: string | null;
}

export const naira = (n: number): string => {
  if (n >= 1e9) return '₦' + +(n / 1e9).toFixed(2) + 'bn';
  if (n >= 1e6) return '₦' + +(n / 1e6).toFixed(2) + 'm';
  if (n >= 1e3) return '₦' + Math.round(n / 1e3) + 'k';
  return '₦' + n;
};

/** True when `n` is, to within rounding, one of `allowed`. */
const near = (n: number, allowed: number[]) => allowed.some((a) => Math.abs(a - n) <= Math.max(1, a * 0.006));

const NUMWORD: Record<string, number> = { no: 0, zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * Read the reply back against the evidence. Returns the problems, empty when the
 * reply is fit to send. It checks what is checkable without understanding prose:
 * a claim that nothing fits when something does, an amount nobody gave or the
 * database holds, a count that is not a count of anything, and homes presented as
 * a fit when they are outside the budget.
 */
export function checkReply(reply: string, ev: Evidence, userText: string, brief: Brief): string[] {
  const problems: string[] = [];
  const text = reply.replace(/\s+/g, ' ');
  if (!ev.checked) return problems;

  const said = /\b(nothing|none|no (?:land|plots?|homes?|houses?|apartments?|listings?|properties|options?|matches)|not (?:have|got) any|don'?t (?:have|see|hold)|doesn'?t (?:fit|match)|nothing (?:fits|matches|is available|available))\b/i;
  const claimsNone = said.test(text) && !/\bnone of (these|them)\b[^.]*\b(too|over|above|under|below|outside|exactly|quite)\b/i.test(text);
  if (claimsNone && ev.exactTotal > 0) {
    problems.push(`It says nothing is available, but ${ev.exactTotal} live listing(s) are inside the person's budget and criteria. State them; never say there is none.`);
  }
  if (ev.role !== 'exact' && ev.role !== 'none' && ev.shown.length) {
    if (!/\b(outside|over|above|below|under your|beyond|closest|nearest|stretch|more than|less than|just over|just under|nothing (?:inside|within|in))\b/i.test(text)) {
      problems.push('The homes shown are NOT inside the budget, but the reply does not say so. Say plainly that none sits inside it, and how far outside the closest is.');
    }
  }
  if (ev.role === 'none' && ev.sameKindInPlace > 0 && ev.exactTotal === 0 && !claimsNone) {
    problems.push('No home is inside the budget; say so plainly and give the real range from the evidence.');
  }

  /* An amount is allowed if the person said it, the database holds it, or it is a plain difference of two of those. */
  const base = new Set<number>();
  for (const s of ev.shown) base.add(s.price);
  if (ev.priceRange) { base.add(ev.priceRange.min); base.add(ev.priceRange.max); }
  for (const v of [ev.budget.min, ev.budget.max, brief.minPrice, brief.maxPrice]) if (v) base.add(v);
  for (const a of amountsIn(userText)) base.add(a);
  const allowed = [...base];
  const diffs: number[] = [];
  for (const a of allowed) for (const b of allowed) if (a > b) diffs.push(a - b);
  for (const a of amountsIn(text)) {
    /* a rent quoted per month from a yearly price is arithmetic, not a claim */
    const monthly = allowed.map((x) => Math.round(x / 12));
    if (!near(a, allowed) && !near(a, diffs) && !near(a, monthly) && a >= 50000) {
      problems.push(`The reply mentions ${naira(a)}, which is not a price in the evidence or something the person said. Use only amounts from the evidence.`);
      break;
    }
  }

  /* "three plots", "two homes": a count must be a count of something real. */
  const countable = new Set<number>([ev.shown.length, ev.exactTotal, ev.sameKindInPlace, ev.liveInPlace, ...ev.otherPlaces.map((o) => o.count)]);
  const re = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:more\s+|other\s+|live\s+)?(?:land\s+)?(plots?|homes?|houses?|listings?|properties|apartments?|rooms?|options?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMWORD[m[1].toLowerCase()];
    if (n != null && n > 1 && !countable.has(n)) { problems.push(`The reply says "${m[0]}", but the database counts ${[...countable].filter((x) => x > 0).join(', ') || 'none'}. Use only counts from the evidence.`); break; }
  }
  return problems;
}

/**
 * The reply of last resort: built from the evidence alone, so it cannot be wrong.
 * Used when the model's reply keeps failing the check.
 */
export function plainReply(ev: Evidence, brief: Brief, ask: Ask): string {
  if (!ev.checked) return `I couldn't read our listings just now, so I won't guess. Try me again in a moment.`;
  const where = ev.place ?? 'there';
  const budget = brief.minPrice && brief.maxPrice ? `between ${naira(brief.minPrice)} and ${naira(brief.maxPrice)}` : brief.maxPrice ? `under ${naira(brief.maxPrice)}` : brief.minPrice ? `above ${naira(brief.minPrice)}` : null;
  const q = ask.slot ? ' ' + plainQuestion(ask) : '';
  if (ev.role === 'exact') {
    const first = ev.shown[0];
    return `${ev.exactTotal === 1 ? 'One ' + ev.kindLabel.replace(/s$/, '') + ' fits' : ev.exactTotal + ' ' + ev.kindLabel + ' fit'}${budget ? ' ' + budget : ''} in ${where}. The ${first.title} is ${naira(first.price)}.${q}`;
  }
  if (ev.role === 'stretch' || ev.role === 'closest') {
    const c = ev.shown[0];
    return `Nothing in ${where} is ${budget ?? 'in that range'}. The closest is ${c.title} at ${naira(c.price)}, which is outside it.${q}`;
  }
  if (ev.sameKindInPlace > 0 && ev.priceRange) {
    return `Nothing in ${where} is ${budget ?? 'in that range'}. ${ev.kindLabel.charAt(0).toUpperCase() + ev.kindLabel.slice(1)} there run ${naira(ev.priceRange.min)} to ${naira(ev.priceRange.max)}.${q}`;
  }
  if (ev.otherPlaces.length) {
    return `We have no ${ev.kindLabel} in ${where} yet. ${ev.kindLabel.charAt(0).toUpperCase() + ev.kindLabel.slice(1)} are live in ${ev.otherPlaces.map((o) => o.place).join(', ')}.${q}`;
  }
  return `We have nothing live in ${where} yet.${q}`;
}

function plainQuestion(a: Ask): string {
  switch (a.slot) {
    case 'place': return 'Where do you want it?';
    case 'purpose': return 'What are you looking to do: buy, rent, or invest?';
    case 'budget': return 'What are you comfortable spending?';
    case 'timeline': return 'When do you need to move or buy by?';
    case 'household': return 'Who is moving with you?';
    case 'landUse': return 'What is the land for?';
    case 'stage': return 'Does it have to be finished, or is off-plan fine?';
    case 'name': return 'What should I call you?';
    case 'contact': return 'What is the best number or email for the agency to reach you once you pick one? Nothing goes to an agency until you choose to send it.';
    default: return '';
  }
}
