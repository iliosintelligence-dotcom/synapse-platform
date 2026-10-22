/**
 * "What Tayo remembers": the visitor can see what is kept about them and delete any of it.
 *
 * Only the things a person told Tayo are listed (what they want, who they are). Nothing derived or internal (negotiation state,
 * how often a question was asked) is shown or touched. Forgetting works on whole facts, by a closed set of keys, so a request
 * cannot name anything else.
 */
import { type Brief, EMPTY_BRIEF, type Profile } from './facts.ts';

export interface Fact { key: string; label: string; value: string }

const BRIEF_FACTS: Array<[keyof Brief, string]> = [
  ['place', 'Where'], ['dealType', 'Rent or buy'], ['propertyKind', 'Kind of place'], ['intent', 'To live in or invest'],
  ['stage', 'Finished or off-plan'], ['paymentPlan', 'How you will pay'], ['minPrice', 'Lowest price'], ['maxPrice', 'Budget'],
  ['minBedrooms', 'Bedrooms'], ['anchor', 'Close to'],
];
const PROFILE_FACTS: Array<[keyof Profile, string]> = [
  ['name', 'Your name'], ['household', 'Who it is for'], ['work', 'Work'], ['transport', 'Getting around'], ['lifestyle', 'Lifestyle'],
  ['timeline', 'When'], ['purpose', 'What it is for'], ['horizon', 'How long you would hold'], ['financing', 'Financing'],
  ['plotSize', 'Plot size'], ['titleNeeds', 'Documents that matter'], ['phone', 'Phone'], ['email', 'Email'],
];

export const FORGETTABLE = new Set<string>([...BRIEF_FACTS.map(([k]) => k), ...PROFILE_FACTS.map(([k]) => k)]);

const WORDS: Record<string, string> = {
  rent: 'Rent', buy: 'Buy', shared: 'Shared', land: 'Land', home: 'A home', commercial: 'Commercial', live: 'To live in', invest: 'To invest',
  completed: 'Finished', off_plan: 'Off-plan', either: 'Either', outright: 'Outright', mortgage: 'Mortgage', flexpay: 'Flexpay',
};
const money = (n: number) => '₦' + n.toLocaleString('en-NG');

export function memoryFacts(brief: Brief, profile: Profile): Fact[] {
  const out: Fact[] = [];
  for (const [k, label] of BRIEF_FACTS) {
    const v = brief[k];
    if (v == null || v === false) continue;
    out.push({ key: k, label, value: typeof v === 'number' ? (k === 'minBedrooms' ? String(v) : money(v)) : (WORDS[String(v)] ?? String(v)) });
  }
  for (const [k, label] of PROFILE_FACTS) {
    const v = profile[k];
    if (Array.isArray(v) ? !v.length : v == null || v === '') continue;
    out.push({ key: k, label, value: Array.isArray(v) ? v.join(', ') : String(v) });
  }
  return out;
}

/** `keys` is a list of fact keys, or 'all'. Unknown keys are ignored. */
export function forget(brief: Brief, profile: Profile, keys: unknown): { brief: Brief; profile: Profile } {
  const all = keys === 'all';
  const set = new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string' && FORGETTABLE.has(k)) : []);
  const b = { ...brief } as Record<string, unknown>;
  const p = { ...profile } as Record<string, unknown>;
  for (const [k] of BRIEF_FACTS) if (all || set.has(k)) b[k] = EMPTY_BRIEF[k];
  if (all || set.has('place')) b.browse = false;
  for (const [k] of PROFILE_FACTS) if (all || set.has(k)) p[k] = k === 'lifestyle' ? [] : null;
  if (all || set.has('phone') || set.has('email')) { p.contactOk = null; p.contactDeclined = false; }
  return { brief: b as unknown as Brief, profile: p as unknown as Profile };
}
