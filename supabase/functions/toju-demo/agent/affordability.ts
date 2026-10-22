/**
 * Affordability, worked out by code, never by the model. Every figure either came from the listing or the person, or is marked unknown.
 * No fee is assumed to be universal: when a fee is not given it is listed under `unknown`, not guessed.
 */
export interface AffordabilityInput {
  kind: 'rent' | 'buy';
  /** Annual rent when renting; total price when buying. */
  amount: number;
  /** Fees as the listing states them: a fixed naira amount, or a percentage of `amount`. Omitted means not stated. */
  agencyFee?: { amount?: number; pct?: number } | null;
  legalFee?: { amount?: number; pct?: number } | null;
  caution?: { amount?: number; pct?: number } | null;      // refundable deposit
  serviceCharge?: number | null;                           // per year
  /** What the person said they can spend on this home. */
  budget?: number | null;
  /** The person's own yearly income, only if they gave it. */
  annualIncome?: number | null;
}

export interface CostLine { label: string; amount: number; source: 'listing' | 'person' | 'calculated'; refundable?: boolean }
export interface AffordabilityResult {
  kind: 'rent' | 'buy';
  base: number;
  lines: CostLine[];
  upfrontKnown: number;            // base plus every fee that is known, before refunds
  firstYearKnown: number | null;   // upfront plus the known service charge, when renting
  unknown: string[];               // costs that exist in practice but were not given: never guessed
  withinBudget: boolean | null;    // null when no budget was given
  budgetGap: number | null;        // positive: how far over the budget the known costs already are
  rentToIncomePct: number | null;  // only when income was given, only for rent
  notes: string[];
}

const fee = (f: { amount?: number; pct?: number } | null | undefined, base: number): number | null => {
  if (!f) return null;
  if (typeof f.amount === 'number' && f.amount >= 0) return Math.round(f.amount);
  if (typeof f.pct === 'number' && f.pct >= 0 && f.pct <= 100) return Math.round(base * f.pct / 100);
  return null;
};

export function affordability(i: AffordabilityInput): AffordabilityResult {
  if (!Number.isFinite(i.amount) || i.amount <= 0) throw new Error('amount must be a positive number');
  const lines: CostLine[] = [{ label: i.kind === 'rent' ? 'Annual rent' : 'Price', amount: Math.round(i.amount), source: 'listing' }];
  const unknown: string[] = [];
  const add = (label: string, f: ReturnType<typeof fee>, refundable = false) => {
    if (f === null) unknown.push(label);
    else lines.push({ label, amount: f, source: 'listing', refundable });
  };
  add('Agency fee', fee(i.agencyFee, i.amount));
  add('Legal fee', fee(i.legalFee, i.amount));
  if (i.kind === 'rent') add('Caution (refundable deposit)', fee(i.caution, i.amount), true);
  if (i.kind === 'buy') { unknown.push('Stamp duty and registration', 'Survey and title searches'); }
  let svc: number | null = null;
  if (i.kind === 'rent') {
    if (typeof i.serviceCharge === 'number' && i.serviceCharge >= 0) { svc = Math.round(i.serviceCharge); lines.push({ label: 'Service charge (per year)', amount: svc, source: 'listing' }); }
    else unknown.push('Service charge');
  }
  const upfrontKnown = lines.filter((l) => !l.label.startsWith('Service charge')).reduce((s, l) => s + l.amount, 0);
  const firstYearKnown = i.kind === 'rent' ? upfrontKnown + (svc ?? 0) : null;
  const total = firstYearKnown ?? upfrontKnown;
  const budget = typeof i.budget === 'number' && i.budget > 0 ? i.budget : null;
  const notes: string[] = [];
  if (unknown.length) notes.push('These costs are not stated for this home and are not included: ' + unknown.join(', ') + '. Ask the agency.');
  if (lines.some((l) => l.refundable)) notes.push('The caution is a refundable deposit, but it has to be paid up front.');
  return {
    kind: i.kind, base: Math.round(i.amount), lines, upfrontKnown, firstYearKnown, unknown,
    withinBudget: budget === null ? null : total <= budget,
    budgetGap: budget === null ? null : Math.max(0, total - budget),
    rentToIncomePct: i.kind === 'rent' && typeof i.annualIncome === 'number' && i.annualIncome > 0 ? Math.round((i.amount / i.annualIncome) * 1000) / 10 : null,
    notes,
  };
}
