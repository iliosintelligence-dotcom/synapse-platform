/**
 * Toju's tools. Each has a description (shown to the model), validated arguments, a predictable result, and honest handling of an empty
 * result. Tools reach Synapse only through `Deps`, which the caller supplies, so the agent never touches the database directly and tests
 * can stand in for it. A tool never reports success it did not achieve.
 */
import { affordability } from './affordability.ts';
import { applyUpdates, searchCriteria, type PrefUpdate, type Prefs, type SearchState } from './memory.ts';

export interface Listing {
  id: string; title: string; place: string; price: number; priceText: string; period: string; kind: string;
  bedrooms: number | null; bathrooms: number | null; areaSqm: number | null; verification: string;
  [k: string]: unknown;
}
export interface SearchArgs {
  place?: string; excludePlaces?: string[]; dealType?: string; propertyKind?: string; maxPrice?: number; minPrice?: number; bedrooms?: number; limit?: number;
  anchor?: string; browse?: boolean;
}
export interface Deps {
  search(a: SearchArgs): Promise<{ total: number; listings: Listing[]; priceRange?: { min: number; max: number } | null }>;
  getProperty(id: string): Promise<(Listing & Record<string, unknown>) | null>;
  /** Not every deployment can contact an agent from here; when absent the tool says so honestly. */
  contactAgent?(listingId: string, summary: string): Promise<{ ok: boolean; detail: string }>;
}
export interface ToolCtx {
  deps: Deps; prefs: Prefs; state: SearchState; turn: number; atMessage: number;
  /** Every listing a tool returned during this run: the only listings that may be shown to the person. */
  seen: Map<string, Listing>;
  prefLog: string[];
}
export interface ToolResult { ok: boolean; data?: unknown; error?: string }
export interface Tool {
  name: string; description: string; args: string;
  run(raw: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max = 80): string | undefined => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined);
const num = (v: unknown): number | undefined => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN; return Number.isFinite(n) && n > 0 ? n : undefined; };
const strs = (v: unknown, n = 10): string[] | undefined => Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x).slice(0, n) : undefined;
const bad = (error: string): ToolResult => ({ ok: false, error });

const remember = (ctx: ToolCtx, ls: Listing[]) => { for (const l of ls) ctx.seen.set(l.id, l); };

const searchProperties: Tool = {
  name: 'search_properties',
  description: 'Search live Synapse listings. Every argument is optional: say only what matters for this search; anything you leave out falls back to what the person has already told us. A partial search is fine.',
  args: '{place?: string, excludePlaces?: string[], dealType?: "rent"|"buy"|"shared", propertyKind?: "home"|"land"|"commercial", maxPrice?: number (naira; annual rent if renting), minPrice?: number, bedrooms?: number, anchor?: string, limit?: number (max 8)}',
  async run(raw, ctx) {
    const base = searchCriteria(ctx.prefs);
    const a: SearchArgs = {
      place: str(raw.place) ?? (base.place as string | undefined),
      excludePlaces: strs(raw.excludePlaces) ?? (base.excludedPlaces as string[] | undefined),
      dealType: ['rent', 'buy', 'shared'].includes(String(raw.dealType)) ? String(raw.dealType) : (base.dealType as string | undefined),
      propertyKind: ['home', 'land', 'commercial'].includes(String(raw.propertyKind)) ? String(raw.propertyKind) : (base.propertyKind as string | undefined),
      maxPrice: num(raw.maxPrice) ?? (base.maxPrice as number | undefined),
      minPrice: num(raw.minPrice) ?? (base.minPrice as number | undefined),
      bedrooms: num(raw.bedrooms) ?? (base.bedrooms as number | undefined),
      anchor: str(raw.anchor) ?? (base.anchor as string | undefined),
      limit: Math.min(8, Math.max(1, Math.round(num(raw.limit) ?? 6))),
    };
    if (a.minPrice && a.maxPrice && a.minPrice > a.maxPrice) [a.minPrice, a.maxPrice] = [a.maxPrice, a.minPrice];
    let r;
    try { r = await ctx.deps.search(a); } catch (e) { return bad('The listing search failed: ' + (e instanceof Error ? e.message : 'unknown')); }
    const ex = (a.excludePlaces ?? []).map((x) => x.toLowerCase());
    const rej = new Set(ctx.state.rejected.map((x) => x.id));
    let listings = r.listings.filter((l) => !rej.has(l.id) && !ex.some((x) => l.place.toLowerCase().includes(x)));
    listings = listings.slice(0, a.limit);
    remember(ctx, listings);
    ctx.state.lastQuery = { ...a } as Record<string, unknown>;
    ctx.state.shownIds = [...new Set([...ctx.state.shownIds, ...listings.map((l) => l.id)])].slice(-40);
    const data: Record<string, unknown> = { total: r.total, returned: listings.length, listings, searchedWith: a };
    if (!listings.length) {
      data.note = 'Nothing live matches this exactly. Say so plainly. You may offer to loosen one criterion, and the price range below is real.';
      if (r.priceRange) data.priceRangeInThatPlace = r.priceRange;
    }
    return { ok: true, data };
  },
};

const getProperty: Tool = {
  name: 'get_property',
  description: 'Get the details Synapse holds for one listing, by id. Returns only fields the listing actually has.',
  args: '{id: string (a listing id from an earlier search)}',
  async run(raw, ctx) {
    const id = str(raw.id, 64);
    if (!id || !UUID.test(id)) return bad('id must be a listing id returned by a search');
    let p;
    try { p = await ctx.deps.getProperty(id); } catch (e) { return bad('Could not read the listing: ' + (e instanceof Error ? e.message : 'unknown')); }
    if (!p) return bad('That listing is not live or does not exist.');
    remember(ctx, [p]);
    return { ok: true, data: p };
  },
};

const compareProperties: Tool = {
  name: 'compare_properties',
  description: 'Compare two to four listings on the facts Synapse holds. Gives the facts side by side and the real differences; you explain the trade-offs in light of the person\'s priorities.',
  args: '{ids: string[] (2 to 4 listing ids)}',
  async run(raw, ctx) {
    const ids = strs(raw.ids, 4)?.filter((x) => UUID.test(x));
    if (!ids || ids.length < 2) return bad('give two to four listing ids');
    const rows: Array<Listing & Record<string, unknown>> = [];
    for (const id of [...new Set(ids)]) {
      const known = ctx.seen.get(id);
      let p: (Listing & Record<string, unknown>) | null = null;
      try { p = await ctx.deps.getProperty(id); } catch { /* fall through to what we saw */ }
      const row = p ?? (known as (Listing & Record<string, unknown>) | undefined);
      if (!row) return bad('Listing ' + id + ' could not be read.');
      rows.push(row);
    }
    remember(ctx, rows);
    const priced = rows.filter((r) => r.price > 0);
    const cheapest = priced.length ? priced.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    const differences: string[] = [];
    if (cheapest && priced.length > 1) {
      const dearest = priced.reduce((a, b) => (a.price >= b.price ? a : b));
      differences.push(`${cheapest.title} is the lowest price (${cheapest.priceText}); ${dearest.title} is the highest (${dearest.priceText}), a difference of ${Math.round(dearest.price - cheapest.price).toLocaleString('en-NG')} naira.`);
    }
    const beds = new Set(rows.map((r) => r.bedrooms));
    if (beds.size > 1) differences.push('Bedrooms differ: ' + rows.map((r) => `${r.title} ${r.bedrooms ?? 'not stated'}`).join('; ') + '.');
    const ver = new Set(rows.map((r) => r.verification));
    if (ver.size > 1) differences.push('Verification differs: ' + rows.map((r) => `${r.title} ${r.verification}`).join('; ') + '.');
    ctx.state.stage = 'comparing';
    return { ok: true, data: { listings: rows, differences, note: 'Only these facts are known. Anything not listed is not known; say so rather than guess.' } };
  },
};

const calculateAffordability: Tool = {
  name: 'calculate_affordability',
  description: 'Work out what a home really costs up front, from the listing\'s own stated fees and the person\'s budget. Arithmetic is done by code. Fees that are not stated come back under "unknown": never fill them in yourself.',
  args: '{listingId?: string, kind?: "rent"|"buy", amount?: number (annual rent or price; taken from the listing if you give listingId), budget?: number, annualIncome?: number, agencyFeePct?: number, legalFeePct?: number, cautionPct?: number, serviceCharge?: number}',
  async run(raw, ctx) {
    const id = str(raw.listingId, 64);
    let amount = num(raw.amount), kind: 'rent' | 'buy' | undefined = raw.kind === 'rent' || raw.kind === 'buy' ? raw.kind : undefined;
    let agency: { amount?: number; pct?: number } | null = num(raw.agencyFeePct) ? { pct: num(raw.agencyFeePct) } : null;
    let legal: { amount?: number; pct?: number } | null = num(raw.legalFeePct) ? { pct: num(raw.legalFeePct) } : null;
    let caution: { amount?: number; pct?: number } | null = num(raw.cautionPct) ? { pct: num(raw.cautionPct) } : null;
    let service = num(raw.serviceCharge) ?? null;
    let listingService: number | null = null;
    if (id) {
      if (!UUID.test(id)) return bad('listingId must be a listing id returned by a search');
      let p; try { p = await ctx.deps.getProperty(id); } catch { p = null; }
      if (!p) return bad('That listing could not be read.');
      remember(ctx, [p]);
      amount = amount ?? (p.price > 0 ? p.price : undefined);
      kind = kind ?? (p.kind === 'rent' ? 'rent' : 'buy');
      const f = p as Record<string, unknown>;
      const money = (v: unknown) => { const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN; return Number.isFinite(n) && n >= 0 ? { amount: n } : null; };
      agency = agency ?? money(f.agencyFee); legal = legal ?? money(f.legalFee); caution = caution ?? money(f.caution);
      listingService = typeof f.serviceCharge === 'number' && f.serviceCharge > 0 ? f.serviceCharge : null;
    }
    if (!amount) return bad('give an amount, or a listingId whose price is known');
    const budgetPref = ctx.prefs.maxPrice && ctx.prefs.maxPrice.status === 'active' && typeof ctx.prefs.maxPrice.value === 'number' ? ctx.prefs.maxPrice.value : null;
    try {
      const r = affordability({ kind: kind ?? 'rent', amount, agencyFee: agency, legalFee: legal, caution, serviceCharge: service, budget: num(raw.budget) ?? budgetPref, annualIncome: num(raw.annualIncome) ?? null });
      const data: Record<string, unknown> = { ...r };
      if (listingService !== null) { data.listingServiceCharge = listingService; r.notes.push('The listing states a service charge, but not whether it is per month or per year, so it is NOT included in the totals. Ask the agency.'); }
      return { ok: true, data };
    } catch (e) { return bad(e instanceof Error ? e.message : 'could not calculate'); }
  },
};

const updatePreferences: Tool = {
  name: 'update_preferences',
  description: 'Record what the person has told you, or what you reasonably infer, so it is remembered. Use "stated" for what they said, "inferred" (with a confidence) for a reasonable guess. A guess never replaces something they said. Use action "reject" for places they do not want and "clear" when they drop a preference.',
  args: '{updates: [{key: string, value?: string|number|boolean|string[], action?: "set"|"reject"|"clear", source?: "stated"|"inferred", confidence?: number, hard?: boolean, scope?: "lasting"|"search"}]}  Common keys: place, dealType, propertyKind, maxPrice, minPrice, bedrooms, bathrooms, furnished, amenities, commute, household, work, purpose, timeline, lifestyle. Any short key is allowed.',
  async run(raw, ctx) {
    const list = Array.isArray(raw.updates) ? (raw.updates as PrefUpdate[]) : [];
    if (!list.length) return bad('updates must be a non-empty list');
    const r = applyUpdates(ctx.prefs, list, ctx.atMessage);
    ctx.prefs = r.prefs;
    ctx.prefLog.push(...r.applied);
    return { ok: true, data: { saved: r.applied, notSaved: r.ignored } };
  },
};

const rejectProperty: Tool = {
  name: 'reject_property',
  description: 'Note that the person does not want a listing, with the reason if they gave one, so it is not offered again.',
  args: '{id: string, reason?: string}',
  async run(raw, ctx) {
    const id = str(raw.id, 64);
    if (!id || !UUID.test(id)) return bad('id must be a listing id');
    if (!ctx.state.rejected.some((x) => x.id === id)) ctx.state.rejected.push({ id, reason: str(raw.reason, 160) ?? null });
    return { ok: true, data: { rejected: id } };
  },
};

const requestAgentContact: Tool = {
  name: 'request_agent_contact',
  description: 'Prepare to introduce the person to the agency for a listing. This does NOT contact anyone. It asks the person to confirm; tell them exactly what will be shared and wait for their yes.',
  args: '{listingId: string, summary: string (what you would share with the agent: needs, budget, timing; no contact details)}',
  async run(raw, ctx) {
    const id = str(raw.listingId, 64), summary = str(raw.summary, 600);
    if (!id || !UUID.test(id)) return bad('listingId must be a listing id');
    if (!summary) return bad('give the summary you would share');
    ctx.state.pending = { type: 'contact_agent', listingId: id, summary, turn: ctx.turn };
    ctx.state.stage = 'ready_to_view';
    return { ok: true, data: { status: 'needs_confirmation', message: 'Nothing has been sent. Ask the person to confirm, and say what would be shared.' } };
  },
};

const confirmAgentContact: Tool = {
  name: 'confirm_agent_contact',
  description: 'Carry out a pending agent introduction. Only call this after the person has clearly said yes, in a turn AFTER the one where you asked. Fails if nothing is pending.',
  args: '{}',
  async run(_raw, ctx) {
    const p = ctx.state.pending;
    if (!p || p.type !== 'contact_agent') return bad('There is nothing waiting for confirmation.');
    if (p.turn >= ctx.turn) return bad('The person has not had a chance to confirm yet. Ask them first and wait for their answer in their next message.');
    if (!ctx.deps.contactAgent) return { ok: true, data: { status: 'not_available', message: 'Introductions cannot be sent from the chat yet. Tell the person to use the "Introduce me" button on the home so the agent gets their details properly.' } };
    let r; try { r = await ctx.deps.contactAgent(p.listingId, p.summary); } catch (e) { return bad('The introduction failed: ' + (e instanceof Error ? e.message : 'unknown')); }
    if (r.ok) ctx.state.pending = null;
    return { ok: r.ok, data: { status: r.ok ? 'sent' : 'failed', detail: r.detail } };
  },
};

export const TOOLS: Tool[] = [searchProperties, getProperty, compareProperties, calculateAffordability, updatePreferences, rejectProperty, requestAgentContact, confirmAgentContact];
export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

export function describeTools(): string {
  return TOOLS.map((t) => `- ${t.name}(${t.args})\n    ${t.description}`).join('\n');
}
