/**
 * Toju's memory, in three layers (see docs/toju-agent-architecture.md):
 *   A. the conversation (kept by the caller; this file only condenses old turns)
 *   B. the preference profile: what the person wants, each fact with where it came from
 *   C. the active task and search state
 *
 * A preference is never a bare value. It records whether the person SAID it or the model inferred it, how sure we are, whether it is a
 * hard requirement, whether it is for this search or lasting, and what it replaced. A guess never overwrites something the person said;
 * a correction always does.
 */

export type PrefValue = string | number | boolean | string[];
export interface PrefEntry {
  value: PrefValue;
  source: 'stated' | 'inferred';
  confidence: number;          // 0..1; stated is 1
  hard: boolean;               // a deal-breaker rather than a wish
  scope: 'lasting' | 'search';
  status: 'active' | 'superseded' | 'rejected';
  at: number;                  // index of the user message it came from
  updated: string;             // ISO time
  previous?: Array<{ value: PrefValue; source: 'stated' | 'inferred'; at: number }>;
}
export type Prefs = Record<string, PrefEntry>;

export interface PrefUpdate {
  key: string;
  value?: PrefValue | null;
  action?: 'set' | 'clear' | 'reject';
  source?: 'stated' | 'inferred';
  confidence?: number;
  hard?: boolean;
  scope?: 'lasting' | 'search';
}

export interface SearchState {
  stage: 'exploring' | 'comparing' | 'ready_to_view';
  lastQuery: Record<string, unknown> | null;
  shownIds: string[];
  rejected: Array<{ id: string; reason: string | null }>;
  pending: { type: 'contact_agent'; listingId: string; summary: string; turn: number } | null;
  unresolved: string[];
}
export const EMPTY_STATE: SearchState = { stage: 'exploring', lastQuery: null, shownIds: [], rejected: [], pending: null, unresolved: [] };

const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const MAX_KEYS = 48;

/** Keys the search understands. Anything else is still remembered (the schema is open) and is shown to the model, just not used as a filter. */
export const SEARCH_KEYS = ['place', 'excludedPlaces', 'dealType', 'propertyKind', 'maxPrice', 'minPrice', 'bedrooms', 'bathrooms', 'furnished', 'amenities', 'anchor'] as const;

function clean(v: unknown): PrefValue | null {
  if (typeof v === 'string') { const t = v.replace(/\s+/g, ' ').trim().slice(0, 200); return t || null; }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) { const a = v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 20); return a.length ? a : null; }
  return null;
}
const same = (a: PrefValue, b: PrefValue) => JSON.stringify(a) === JSON.stringify(b);

export interface ApplyResult { prefs: Prefs; applied: string[]; ignored: Array<{ key: string; reason: string }> }

/** Fold updates into the profile. `at` is the index of the user message the updates came from. Pure: returns a new object. */
export function applyUpdates(prefs: Prefs, updates: PrefUpdate[], at: number, now = new Date().toISOString()): ApplyResult {
  const out: Prefs = JSON.parse(JSON.stringify(prefs));
  const applied: string[] = [];
  const ignored: ApplyResult['ignored'] = [];
  for (const u of updates.slice(0, 24)) {
    if (!u || typeof u.key !== 'string' || !KEY.test(u.key)) { ignored.push({ key: String(u?.key ?? ''), reason: 'not a valid preference name' }); continue; }
    const key = u.key;
    const source = u.source === 'inferred' ? 'inferred' : 'stated';
    const cur = out[key];
    const action = u.action ?? 'set';

    if (action === 'clear') {
      if (cur && cur.status === 'active') { cur.status = 'superseded'; cur.updated = now; applied.push(key); }
      continue;
    }
    if (action === 'reject') {
      /* "not Lekki": kept as an exclusion, not as a wish */
      const v = clean(u.value);
      if (typeof v !== 'string') { ignored.push({ key, reason: 'a rejection needs a value' }); continue; }
      const ex = out.excludedPlaces && out.excludedPlaces.status === 'active' && Array.isArray(out.excludedPlaces.value) ? out.excludedPlaces.value : [];
      if (!ex.some((x) => x.toLowerCase() === v.toLowerCase())) ex.push(v);
      out.excludedPlaces = { value: ex, source, confidence: source === 'stated' ? 1 : 0.6, hard: true, scope: 'lasting', status: 'active', at, updated: now };
      /* if the rejected place was the active one, it is no longer wanted */
      if (key === 'place' && out.place && out.place.status === 'active' && typeof out.place.value === 'string' && out.place.value.toLowerCase() === v.toLowerCase()) out.place.status = 'superseded';
      applied.push('excludedPlaces');
      continue;
    }

    const value = clean(u.value);
    if (value === null) { ignored.push({ key, reason: 'empty value' }); continue; }
    const confidence = source === 'stated' ? 1 : Math.min(0.9, Math.max(0.1, typeof u.confidence === 'number' ? u.confidence : 0.5));

    if (cur && cur.status === 'active') {
      if (same(cur.value, value)) {
        // the same fact again: a guess becomes certain when the person says it themselves
        if (source === 'stated' && cur.source === 'inferred') { cur.source = 'stated'; cur.confidence = 1; cur.updated = now; applied.push(key); }
        continue;
      }
      if (cur.source === 'stated' && source === 'inferred') { ignored.push({ key, reason: 'a guess does not replace what the person said' }); continue; }
      if (cur.source === 'inferred' && source === 'inferred' && confidence < cur.confidence) { ignored.push({ key, reason: 'a weaker guess' }); continue; }
      cur.previous = [...(cur.previous ?? []), { value: cur.value, source: cur.source, at: cur.at }].slice(-3);
    } else if (!cur && Object.keys(out).length >= MAX_KEYS) { ignored.push({ key, reason: 'too many preferences kept' }); continue; }

    const prev = cur ? (cur.previous ?? []) : [];
    out[key] = {
      value, source, confidence, hard: u.hard === true, scope: u.scope === 'search' ? 'search' : 'lasting', status: 'active', at, updated: now,
      ...(prev.length ? { previous: prev } : {}),
    };
    if (cur && cur.status === 'active' && !same(cur.value, value)) out[key].previous = [...(cur.previous ?? []), { value: cur.value, source: cur.source, at: cur.at }].slice(-3);
    applied.push(key);
  }
  return { prefs: out, applied, ignored };
}

export const active = (prefs: Prefs, key: string): PrefValue | undefined => (prefs[key] && prefs[key].status === 'active' ? prefs[key].value : undefined);

/** The filters a search can use, from the active preferences. Only what the person said or a confident inference; weak guesses stay out. */
export function searchCriteria(prefs: Prefs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SEARCH_KEYS) {
    const e = prefs[k];
    if (!e || e.status !== 'active') continue;
    if (e.source === 'inferred' && e.confidence < 0.6) continue;
    out[k] = e.value;
  }
  return out;
}

/** A short, readable account of what is known, for the model. Distinguishes what was said from what was guessed. */
export function summarisePrefs(prefs: Prefs): string {
  const lines: string[] = [];
  for (const [k, e] of Object.entries(prefs)) {
    if (e.status !== 'active') continue;
    const v = Array.isArray(e.value) ? e.value.join(', ') : String(e.value);
    lines.push(`- ${k}: ${v} (${e.source === 'stated' ? 'said by the person' : 'guessed, confidence ' + e.confidence.toFixed(1)}${e.hard ? ', a hard requirement' : ''}${e.scope === 'search' ? ', for this search only' : ''})`);
  }
  const old = Object.entries(prefs).filter(([, e]) => e.status !== 'active').map(([k]) => k);
  return (lines.length ? lines.join('\n') : '- nothing yet') + (old.length ? `\n(changed or dropped earlier: ${old.join(', ')})` : '');
}

/** Old turns, condensed without a model call: the person's own earlier messages, shortened. The recent turns are always sent in full. */
export function condenseHistory(messages: Array<{ role: string; content: string }>, keep = 10): { summary: string | null; recent: Array<{ role: string; content: string }> } {
  if (messages.length <= keep) return { summary: null, recent: messages };
  const older = messages.slice(0, messages.length - keep).filter((m) => m.role === 'user').slice(-8);
  const summary = 'Earlier in this conversation the person said: ' + older.map((m) => '"' + m.content.replace(/\s+/g, ' ').slice(0, 140) + '"').join('; ');
  return { summary, recent: messages.slice(-keep) };
}

/** Bring a session saved by the older pipeline (brief + profile) into this shape. Everything old counts as said by the person. */
export function fromLegacy(criteria: unknown): Prefs {
  const c = (criteria && typeof criteria === 'object' ? criteria : {}) as Record<string, unknown>;
  const v2 = (c._v2 && typeof c._v2 === 'object' ? c._v2 : {}) as Record<string, Record<string, unknown>>;
  const b = v2.brief ?? {}, p = v2.profile ?? {};
  const ups: PrefUpdate[] = [];
  const map: Array<[string, unknown]> = [
    ['place', b.place], ['dealType', b.dealType === 'buy' ? 'buy' : b.dealType], ['propertyKind', b.propertyKind], ['maxPrice', b.maxPrice], ['minPrice', b.minPrice],
    ['bedrooms', b.minBedrooms], ['anchor', b.anchor], ['purpose', p.purpose], ['household', p.household], ['work', p.work], ['transport', p.transport],
    ['timeline', p.timeline], ['financing', p.financing], ['horizon', p.horizon], ['plotSize', p.plotSize], ['titleNeeds', p.titleNeeds], ['name', p.name],
  ];
  for (const [key, value] of map) if (value !== null && value !== undefined && value !== '') ups.push({ key, value: value as PrefValue, source: 'stated' });
  if (Array.isArray(p.lifestyle) && p.lifestyle.length) ups.push({ key: 'lifestyle', value: p.lifestyle as string[], source: 'stated' });
  return applyUpdates({}, ups, 0).prefs;
}

/** What the older pages (Your matches, What Tayo remembers) read: the brief and profile derived from the preferences. */
export function toLegacy(prefs: Prefs): { brief: Record<string, unknown>; profile: Record<string, unknown> } {
  const g = (k: string) => { const v = active(prefs, k); return v === undefined ? null : v; };
  const str = (k: string) => { const v = g(k); return typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : null; };
  const num = (k: string) => { const v = g(k); return typeof v === 'number' ? v : null; };
  return {
    brief: {
      place: str('place'), dealType: str('dealType'), propertyKind: str('propertyKind'), intent: null, stage: null, paymentPlan: null,
      minPrice: num('minPrice'), maxPrice: num('maxPrice'), minBedrooms: num('bedrooms'), anchor: str('anchor'), browse: false,
    },
    profile: {
      name: str('name'), household: str('household'), work: str('work'), transport: str('transport'),
      lifestyle: Array.isArray(g('lifestyle')) ? g('lifestyle') : [], timeline: str('timeline'), purpose: str('purpose'), financing: str('financing'),
      horizon: str('horizon'), plotSize: str('plotSize'), titleNeeds: str('titleNeeds'), experience: str('experience'),
      phone: null, email: null, contactOk: null, contactDeclined: false, asked: {},
    },
  };
}
