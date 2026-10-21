import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { briefFromSaved, profileFromSaved } from './facts.ts';
import { forget, memoryFacts } from './memory-panel.ts';

const saved = {
  _v2: {
    brief: { place: 'Bodija', dealType: 'buy', maxPrice: 50_000_000, minBedrooms: 3, browse: true },
    profile: { name: 'Tolu', lifestyle: ['quiet', 'near school'], phone: '0803', email: 'a@b.co', contactOk: true, asked: { name: 2 } },
  },
};
const brief = briefFromSaved(saved);
const profile = profileFromSaved(saved);

Deno.test('lists what was said, in words, and nothing internal', () => {
  const f = memoryFacts(brief, profile);
  assertEquals(f.find((x) => x.key === 'dealType')?.value, 'Buy');
  assertEquals(f.find((x) => x.key === 'maxPrice')?.value, '₦50,000,000');
  assertEquals(f.find((x) => x.key === 'minBedrooms')?.value, '3');
  assertEquals(f.find((x) => x.key === 'lifestyle')?.value, 'quiet, near school');
  assertEquals(f.some((x) => x.key === 'asked' || x.key === 'browse'), false);
});

Deno.test('forgetting one fact leaves the rest', () => {
  const r = forget(brief, profile, ['maxPrice', 'name']);
  assertEquals(r.brief.maxPrice, null);
  assertEquals(r.brief.place, 'Bodija');
  assertEquals(r.profile.name, null);
  assertEquals(r.profile.email, 'a@b.co');
});

Deno.test('forgetting the phone or email also withdraws the permission to use them', () => {
  const r = forget(brief, profile, ['phone']);
  assertEquals(r.profile.phone, null);
  assertEquals(r.profile.contactOk, null);
});

Deno.test('forget everything, and ignore keys that are not facts', () => {
  assertEquals(memoryFacts(forget(brief, profile, 'all').brief, forget(brief, profile, 'all').profile), []);
  const r = forget(brief, profile, ['__proto__', 'asked', 5, null]);
  assertEquals(memoryFacts(r.brief, r.profile).length, memoryFacts(brief, profile).length);
});
