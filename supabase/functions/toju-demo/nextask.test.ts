import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { discoveryDone, EMPTY_BRIEF, EMPTY_PROFILE, nextAsk, type Brief, type Profile } from './facts.ts';

const land: Brief = { ...EMPTY_BRIEF, place: 'Ibadan', dealType: 'buy', propertyKind: 'land', intent: 'invest' };
const p = (o: Partial<Profile> = {}): Profile => ({ ...EMPTY_PROFILE, asked: {}, ...o });

Deno.test('a land investor is asked, in order: budget, what the land is for, how long, how they pay, plot size, documents, when', () => {
  const seq: string[] = [];
  let brief = { ...land };
  let profile = p();
  for (let i = 0; i < 12; i++) {
    const a = nextAsk(brief, profile, 3);
    if (!a.slot) break;
    seq.push(a.slot);
    if (a.slot === 'budget') brief = { ...brief, maxPrice: 10_000_000 };
    else if (a.slot === 'landUse') profile = { ...profile, purpose: 'hold and sell later' };
    else if (a.slot === 'horizon') profile = { ...profile, horizon: '3 to 5 years, resell' };
    else if (a.slot === 'payment') profile = { ...profile, financing: 'instalments' };
    else if (a.slot === 'plotSize') profile = { ...profile, plotSize: 'one plot' };
    else if (a.slot === 'titles') profile = { ...profile, titleNeeds: 'C of O' };
    else if (a.slot === 'experience') profile = { ...profile, experience: 'first time, has a lawyer' };
    else if (a.slot === 'timeline') profile = { ...profile, timeline: '3 months' };
    else if (a.slot === 'name') profile = { ...profile, name: 'Tolu' };
  }
  assertEquals(seq, ['budget', 'landUse', 'horizon', 'payment', 'plotSize', 'titles', 'experience', 'timeline', 'name']);
});

Deno.test('a land buyer is never asked about commutes or what improves daily life at home', () => {
  const full = p({ purpose: 'build a home', financing: 'outright', plotSize: 'one plot', titleNeeds: 'survey', experience: 'bought before', timeline: 'soon', name: 'Ada' });
  const a = nextAsk({ ...land, intent: 'live', maxPrice: 8_000_000 }, full, 4);
  assertEquals(a.slot, null);
});

Deno.test('building on land does not ask how long they will hold it', () => {
  const b = { ...land, intent: 'live' as const, maxPrice: 5_000_000 };
  const a = nextAsk(b, p({ purpose: 'build a home' }), 2);
  assertEquals(a.slot, 'payment');
});

Deno.test('an investor in homes is asked how long and how they will be paid', () => {
  const home: Brief = { ...EMPTY_BRIEF, place: 'Lekki', dealType: 'buy', propertyKind: 'home', intent: 'invest', maxPrice: 90_000_000 };
  assertEquals(nextAsk(home, p(), 1).slot, 'horizon');
  assertEquals(nextAsk(home, p({ horizon: 'rent it out' }), 1).slot, 'payment');
});

Deno.test('a slot asked twice is not asked a third time', () => {
  const a = nextAsk({ ...land, maxPrice: 10_000_000 }, p({ asked: { landUse: 2 } }), 1);
  assertEquals(a.slot, 'horizon');
});

Deno.test('renting a home keeps its original order', () => {
  const rent: Brief = { ...EMPTY_BRIEF, place: 'Bodija', dealType: 'rent', propertyKind: 'home' };
  assertEquals(nextAsk(rent, p(), 0).slot, 'budget');
  assertEquals(nextAsk({ ...rent, maxPrice: 2_000_000 }, p(), 0).slot, 'timeline');
});

Deno.test('no specific plot is shown to a land investor until Tayo knows what it is for and what they can spend', () => {
  assertEquals(discoveryDone({ ...land }, p()), false);
  assertEquals(discoveryDone({ ...land, maxPrice: 10_000_000 }, p()), false);
  assertEquals(discoveryDone({ ...land, maxPrice: 10_000_000 }, p({ purpose: 'hold and sell later' })), true);
  assertEquals(discoveryDone({ ...land }, p({ asked: { budget: 2, landUse: 2 } })), true);
});

Deno.test('discovery gating leaves renting a home, and browsing, alone', () => {
  assertEquals(discoveryDone({ ...EMPTY_BRIEF, place: 'Bodija', dealType: 'rent', propertyKind: 'home' }, p()), true);
  assertEquals(discoveryDone({ ...land, browse: true }, p()), true);
});

Deno.test('an investor in homes is gated on budget and how long they would hold', () => {
  const home: Brief = { ...EMPTY_BRIEF, place: 'Lekki', dealType: 'buy', propertyKind: 'home', intent: 'invest' };
  assertEquals(discoveryDone({ ...home, maxPrice: 90_000_000 }, p()), false);
  assertEquals(discoveryDone({ ...home, maxPrice: 90_000_000 }, p({ horizon: 'rent it out' })), true);
});
