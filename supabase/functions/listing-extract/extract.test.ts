import { assertEquals } from 'jsr:@std/assert@1';
import { clean, parseFields, PROMPT } from './extract.ts';

Deno.test('reads {"fields": {...}}, a bare object, and text around it', () => {
  const want = { property_type: 'duplex', price: 85000000, bedrooms: 4 };
  assertEquals(parseFields('{"fields":{"property_type":"duplex","price":85000000,"bedrooms":4}}'), want);
  assertEquals(parseFields('{"property_type":"duplex","price":85000000,"bedrooms":4}'), want);
  assertEquals(parseFields('Here you go:\n{"fields":{"property_type":"duplex","price":85000000,"bedrooms":4}}\nDone.'), want);
});

Deno.test('a broken or empty answer fills nothing, never throws', () => {
  assertEquals(parseFields(''), {});
  assertEquals(parseFields('no json here'), {});
  assertEquals(parseFields('{"fields": {'), {});
});

Deno.test('only known keys and shapes reach the form', () => {
  assertEquals(clean({ property_type: 'castle', price: -5, bedrooms: '3', title_type: 'c_of_o', made_up: 'x' }),
    { title_type: 'c_of_o', bedrooms: 3 });
  assertEquals(clean({ amenities: ['  Borehole ', 7, ''], handover_date: '2027-03-01', address: '  Bodija, Ibadan ' }),
    { amenities: ['Borehole'], handover_date: '2027-03-01', address: 'Bodija, Ibadan' });
});

Deno.test('the instructions still ask for the fields object', () => {
  assertEquals(PROMPT.includes('{"fields": {...}}'), true);
});

Deno.test('the place: city and state come through, trimmed', () => {
  assertEquals(parseFields('{"fields":{"address":"Bodija, Ibadan","city":" Ibadan ","state":"Oyo"}}'),
    { address: 'Bodija, Ibadan', city: 'Ibadan', state: 'Oyo' });
  assertEquals(parseFields('{"fields":{"city":"","state":7}}'), {});
});
