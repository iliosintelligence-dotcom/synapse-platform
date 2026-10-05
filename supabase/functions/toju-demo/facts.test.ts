import { assertEquals } from 'jsr:@std/assert@1';
import {
  amountsIn, briefFromSaved, checkReply, EMPTY_BRIEF, EMPTY_PROFILE, emailIn, Evidence, mergeBrief, mergeProfile, moneyFrom, nextAsk,
  phoneIn, plainReply, readUnderstood,
} from './facts.ts';

Deno.test('money: ceilings, floors and ranges are read by code', () => {
  assertEquals(moneyFrom('I want land within 4 million'), { min: null, max: 4_000_000 });
  assertEquals(moneyFrom('between 3 and 5 million naira'), { min: 3_000_000, max: 5_000_000 });
  assertEquals(moneyFrom('3m - 5m'), { min: 3_000_000, max: 5_000_000 });
  assertEquals(moneyFrom('under ₦800k'), { min: null, max: 800_000 });
  assertEquals(moneyFrom('at least 20m'), { min: 20_000_000, max: null });
  assertEquals(moneyFrom('my budget is 1.5m a year'), { min: null, max: 1_500_000 });
  assertEquals(moneyFrom('₦2,500,000'), { min: null, max: 2_500_000 });
});

Deno.test('money: sizes and phone numbers are not prices', () => {
  assertEquals(moneyFrom('a 3 bedroom flat'), null);
  assertEquals(moneyFrom('call me on 08031234567'), null);
  assertEquals(moneyFrom('my number is +234 803 123 4567'), null);
  assertEquals(amountsIn('2 plots of 500 sqm'), []);
});

Deno.test('contact details are read from what was typed', () => {
  assertEquals(phoneIn('reach me on 0803 123 4567'), '+2348031234567');
  assertEquals(phoneIn('+234 703 111 2222'), '+2347031112222');
  assertEquals(phoneIn('I am 25'), null);
  assertEquals(emailIn('Joshua@Example.com please'), 'joshua@example.com');
});

Deno.test('a new amount replaces the old budget, it does not stack on it', () => {
  const prev = { ...EMPTY_BRIEF, place: 'Ibadan', propertyKind: 'land' as const, dealType: 'buy' as const, minPrice: 3_000_000, maxPrice: 5_000_000 };
  const u = readUnderstood({ intent: 'refine', brief: {} });
  const next = mergeBrief(prev, u, 'make it within 4 million');
  assertEquals([next.minPrice, next.maxPrice, next.place, next.propertyKind], [null, 4_000_000, 'Ibadan', 'land']);
});

Deno.test('silence keeps what we knew; a reset starts the search again but not the person', () => {
  const prev = { ...EMPTY_BRIEF, place: 'Ibadan', dealType: 'rent' as const, maxPrice: 1_000_000 };
  assertEquals(mergeBrief(prev, readUnderstood({ intent: 'question', brief: {} }), 'is it safe?').maxPrice, 1_000_000);
  const reset = mergeBrief(prev, readUnderstood({ intent: 'search', reset: true, brief: { place: 'Lagos', propertyKind: 'land' } }), 'actually show me land in Lagos');
  assertEquals([reset.place, reset.dealType, reset.maxPrice, reset.propertyKind], ['Lagos', 'buy', null, 'land']);
  const p = mergeProfile({ ...EMPTY_PROFILE, name: 'Joshua' }, readUnderstood({ profile: {} }), 'ok');
  assertEquals(p.name, 'Joshua');
});

Deno.test('old saved sessions still load', () => {
  const b = briefFromSaved({ city: 'Ibadan', dealType: 'buy', maxPrice: 150000000, propertyKind: 'land' });
  assertEquals([b.place, b.dealType, b.maxPrice, b.propertyKind], ['Ibadan', 'buy', 150000000, 'land']);
});

Deno.test('what to ask next: where, what, money, timing, household, then who they are', () => {
  const p = { ...EMPTY_PROFILE };
  assertEquals(nextAsk(EMPTY_BRIEF, p, 0).slot, 'place');
  assertEquals(nextAsk({ ...EMPTY_BRIEF, place: 'Ibadan' }, p, 0).slot, 'purpose');
  assertEquals(nextAsk({ ...EMPTY_BRIEF, place: 'Ibadan', dealType: 'rent' }, p, 0).slot, 'budget');
  const b = { ...EMPTY_BRIEF, place: 'Ibadan', dealType: 'rent' as const, maxPrice: 1_000_000 };
  assertEquals(nextAsk(b, p, 0).slot, 'timeline');
  assertEquals(nextAsk(b, { ...p, timeline: 'next month' }, 0).slot, 'household');
  const known = { ...p, timeline: 'next month', household: 'couple' };
  assertEquals(nextAsk(b, known, 0).slot, null);       // nothing on screen yet: no name or contact asked
  assertEquals(nextAsk(b, known, 3).slot, 'name');
  assertEquals(nextAsk(b, { ...known, name: 'Joshua' }, 3).slot, 'contact');
  assertEquals(nextAsk(b, { ...known, name: 'Joshua', contactDeclined: true }, 3).slot, null);
  assertEquals(nextAsk(b, { ...known, name: 'Joshua', asked: { contact: 2 } }, 3).slot, null);
  const land = { ...EMPTY_BRIEF, place: 'Ibadan', propertyKind: 'land' as const, dealType: 'buy' as const, maxPrice: 4_000_000 };
  assertEquals(nextAsk(land, { ...p, timeline: 'soon' }, 0).slot, 'landUse');
});

const ev = (over: Partial<Evidence> = {}): Evidence => ({
  checked: true, place: 'Ibadan', kindLabel: 'land plots', liveInPlace: 3, sameKindInPlace: 3,
  priceRange: { min: 1_500_000, max: 26_000_000 }, budget: { min: null, max: 4_000_000 }, exactTotal: 2, role: 'exact',
  shown: [
    { id: 'a', title: 'Itura Garden Estate, Moniya', price: 3_500_000, period: 'total', area: 'Moniya', bedrooms: 0, kind: 'land' },
    { id: 'b', title: 'Ibadan Riviera Park', price: 1_500_000, period: 'total', area: 'Ido', bedrooms: 0, kind: 'land' },
  ], otherPlaces: [], note: null, ...over,
});

Deno.test('a reply that says there is none when something fits is refused', () => {
  const b = { ...EMPTY_BRIEF, place: 'Ibadan', maxPrice: 4_000_000 };
  const bad = checkReply('Nothing in that range right now in Ibadan.', ev(), 'land within 4 million', b);
  assertEquals(bad.length > 0, true);
  assertEquals(checkReply('Two plots fit under ₦4m. Moniya at ₦3.5m is my pick.', ev(), 'land within 4 million', b), []);
});

Deno.test('an amount nobody gave is refused; one from the evidence, the person, or a difference is not', () => {
  const b = { ...EMPTY_BRIEF, place: 'Ibadan', maxPrice: 4_000_000 };
  assertEquals(checkReply('Moniya is ₦3.5m, ₦500k under your ceiling.', ev(), 'within 4 million', b), []);
  assertEquals(checkReply('Moniya is about ₦6m these days.', ev(), 'within 4 million', b).length, 1);
});

Deno.test('homes outside the budget must be called outside the budget', () => {
  const b = { ...EMPTY_BRIEF, place: 'Ibadan', maxPrice: 1_000_000 };
  const e = ev({ role: 'closest', exactTotal: 0, budget: { min: null, max: 1_000_000 }, shown: [ev().shown[1]] });
  assertEquals(checkReply('Here is a lovely plot at ₦1.5m.', e, 'under 1 million', b).length, 1);
  assertEquals(checkReply('Nothing sits inside ₦1m; the closest is ₦1.5m, ₦500k over.', e, 'under 1 million', b), []);
});

Deno.test('counts must be counts of something real', () => {
  const b = { ...EMPTY_BRIEF, place: 'Ibadan', maxPrice: 4_000_000 };
  assertEquals(checkReply('I have five plots for you.', ev(), 'within 4 million', b).length, 1);
  assertEquals(checkReply('Two plots fit.', ev(), 'within 4 million', b), []);
});

Deno.test('the last-resort reply is built from the evidence and passes its own check', () => {
  const b = { ...EMPTY_BRIEF, place: 'Ibadan', maxPrice: 4_000_000 };
  const r = plainReply(ev(), b, { slot: 'timeline', hint: '', closed: [] });
  assertEquals(checkReply(r, ev(), 'within 4 million', b), []);
  const none = ev({ role: 'none', exactTotal: 0, shown: [], budget: { min: null, max: 1_000_000 } });
  const r2 = plainReply(none, { ...b, maxPrice: 1_000_000 }, { slot: null, hint: '', closed: [] });
  assertEquals(checkReply(r2, none, 'under 1 million', { ...b, maxPrice: 1_000_000 }), []);
});
