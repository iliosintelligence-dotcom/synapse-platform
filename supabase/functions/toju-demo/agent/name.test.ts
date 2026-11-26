import { assertEquals } from 'jsr:@std/assert@1';
import { AGENT_PROMPT } from './prompt.ts';

Deno.test('the reasoning agent calls itself Tayo, never the internal name', () => {
  assertEquals(AGENT_PROMPT.startsWith('You are Tayo,'), true);
  assertEquals(/\bToju\b/.test(AGENT_PROMPT), false);
});
