import { assertEquals } from 'jsr:@std/assert@1';
import { studioCanConnect, studioPostBody } from './postpeer.ts';

Deno.test('studio offers only what agencies are offered, and only through PostPeer', () => {
  assertEquals(studioCanConnect('instagram', true, true), true);
  assertEquals(studioCanConnect('instagram', false, true), false);   // agencies are not offered it: nor is the studio
  assertEquals(studioCanConnect('x', true, false), false);           // PostPeer posting paused for X
  assertEquals(studioCanConnect('facebook', true, true), false);     // Facebook keeps the studio's own Page login
  assertEquals(studioCanConnect('telegram', true, true), false);     // Telegram keeps our bot
});

Deno.test('studio post body: account, platform name, idempotency', () => {
  const r = studioPostBody('x', 'New home https://www.synapsecore.dev/s/abc123', ['https://a/1.jpg'], 'int_1', 'p1');
  if (!('body' in r)) throw new Error(r.error);
  const p = (r.body.platforms as Array<Record<string, unknown>>)[0];
  assertEquals(p.platform, 'twitter');
  assertEquals(p.accountId, 'int_1');
  assertEquals(r.body.idempotencyKey, 'synapse-studio-p1');
  assertEquals(r.body.publishNow, true);
});

Deno.test('studio post body: media rules', () => {
  assertEquals('error' in studioPostBody('instagram', 'x', [], 'i', 'p'), true);
  assertEquals('error' in studioPostBody('youtube', 'x', ['https://a/1.jpg'], 'i', 'p'), true);
  const yt = studioPostBody('youtube', 'Duplex in Lekki\nhttps://x', ['https://a/1.jpg', 'https://a/v.mp4'], 'i', 'p');
  if (!('body' in yt)) throw new Error(yt.error);
  assertEquals((yt.body.mediaItems as unknown[]).length, 1);
  const spec = ((yt.body.platforms as Array<Record<string, any>>)[0]).platformSpecificData;
  assertEquals(spec.title, 'Duplex in Lekki');
  const tt = studioPostBody('tiktok', 'x', ['https://a/1.jpg'], 'i', 'p');
  if (!('body' in tt)) throw new Error(tt.error);
  assertEquals(((tt.body.platforms as Array<Record<string, any>>)[0]).platformSpecificData.draft, true);
  const xs = studioPostBody('x', 'x', ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'], 'i', 'p');
  if (!('body' in xs)) throw new Error(xs.error);
  assertEquals((xs.body.mediaItems as unknown[]).length, 4);
  assertEquals('error' in studioPostBody('facebook', 'x', ['1.jpg'], 'i', 'p'), true);
});
