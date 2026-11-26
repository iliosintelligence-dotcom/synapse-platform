import { assertEquals } from 'jsr:@std/assert@1';
import { studioCanConnect, studioPostBody } from './postpeer.ts';

Deno.test('studio offers only what agencies are offered, and only through PostPeer', () => {
  assertEquals(studioCanConnect('instagram', true, true), true);
  assertEquals(studioCanConnect('instagram', false, true), false);   // agencies are not offered it: nor is the studio
  assertEquals(studioCanConnect('x', true, false), false);           // PostPeer posting paused for X
  assertEquals(studioCanConnect('facebook', true, true), true);      // Facebook through PostPeer since 2026-11-26
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
  const ttSpec = ((tt.body.platforms as Array<Record<string, any>>)[0]).platformSpecificData;
  assertEquals(ttSpec.draft, false);                      // posts directly, not to the TikTok inbox
  assertEquals(ttSpec.privacyLevel, 'PUBLIC_TO_EVERYONE');
  const xs = studioPostBody('x', 'x', ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'], 'i', 'p');
  if (!('body' in xs)) throw new Error(xs.error);
  assertEquals((xs.body.mediaItems as unknown[]).length, 4);
  assertEquals('error' in studioPostBody('facebook', 'x', ['1.jpg'], 'i', 'p'), false);   // a Page post with a photo
});

Deno.test('studio Facebook goes through PostPeer: offered when switched on, one kind of media, text alone allowed', () => {
  assertEquals(studioCanConnect('facebook', true, true), true);
  assertEquals(studioCanConnect('facebook', true, false), false);
  type Built = { body: { mediaItems: unknown; platforms: Array<{ platform: string }> } };
  const mixed = studioPostBody('facebook', 'Hi', ['a.jpg', 'b.mp4'], 'acc', 'p1') as Built;
  assertEquals(mixed.body.mediaItems, [{ type: 'video', url: 'b.mp4' }]);
  assertEquals(mixed.body.platforms[0].platform, 'facebook');
  const text = studioPostBody('facebook', 'Just words', [], 'acc', 'p2') as Built;
  assertEquals(text.body.mediaItems, []);
});

import { studioComposeProblem } from './postpeer.ts';

Deno.test('studio Create accepts PostPeer channels with the sender\'s own media rules', () => {
  const photo = ['https://a/1.jpg'], video = ['https://a/v.mp4'], both = ['https://a/1.jpg', 'https://a/v.mp4'];
  assertEquals(studioComposeProblem('instagram', '@greenlight.estate', 'New home', photo, true), null);
  assertEquals(studioComposeProblem('instagram', '@greenlight.estate', 'New home', both, true), null);   // goes as a Reel
  assertEquals(studioComposeProblem('tiktok', '@synapse_naij', 'New home', video, true), null);
  assertEquals(studioComposeProblem('facebook', 'Page', 'Just words', [], true), null);
  assertEquals(studioComposeProblem('x', '@x', 'New home', photo, true), null);
  assertEquals(studioComposeProblem('instagram', '@g', 'x', [], true), 'Instagram needs at least one photo or video, or untick @g.');
  assertEquals(studioComposeProblem('tiktok', '@t', 'x', [], true), 'TikTok needs a photo or video, or untick @t.');
  assertEquals(studioComposeProblem('youtube', 'YT', 'x', photo, true)?.startsWith('YouTube takes video only'), true);
  assertEquals(studioComposeProblem('instagram', '@g', 'x', photo, false), '@g is switched off for posting right now.');
  assertEquals(studioComposeProblem('telegram', 'T', 'x', photo, true), 'T cannot take studio posts yet.');
});
