import { assertEquals } from 'jsr:@std/assert@1';
import { cleanupVerdict, deliveryOf, mediaTypeOf, ppConnectFor, ppPublishOn, ppSignatureOk } from './postpeer.ts';

Deno.test('cleanup: an account connected again here is never removed at PostPeer', () => {
  assertEquals(cleanupVerdict(true, null, ''), { done: true, outcome: 'kept: connected again here', error: null });
  assertEquals(cleanupVerdict(true, 500, 'x').done, true);
});

Deno.test('cleanup: removed or already gone is done; anything else is retried with the reason', () => {
  assertEquals(cleanupVerdict(false, 200, '').outcome, 'removed at PostPeer');
  assertEquals(cleanupVerdict(false, 204, '').outcome, 'removed at PostPeer');
  assertEquals(cleanupVerdict(false, 404, 'Not found').outcome, 'already gone at PostPeer');
  assertEquals(cleanupVerdict(false, 500, 'boom'), { done: false, outcome: null, error: 'HTTP 500: boom' });
  assertEquals(cleanupVerdict(false, 401, 'bad key').done, false);
  assertEquals(cleanupVerdict(false, null, 'could not reach PostPeer'),
    { done: false, outcome: null, error: 'could not reach PostPeer' });
});

const enc = new TextEncoder();
async function sign(secret: string, ts: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(ts + '.' + raw)));
  return 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.test('a correctly signed, fresh webhook is accepted', async () => {
  const now = 1_800_000_000, ts = String(now), raw = '{"id":"evt_1","type":"post.published"}';
  assertEquals(await ppSignatureOk('s3cret', ts, raw, await sign('s3cret', ts, raw), now), true);
});

Deno.test('a wrong secret, an edited body, a missing header or an old timestamp is refused', async () => {
  const now = 1_800_000_000, ts = String(now), raw = '{"id":"evt_1"}';
  const good = await sign('s3cret', ts, raw);
  assertEquals(await ppSignatureOk('other', ts, raw, good, now), false);
  assertEquals(await ppSignatureOk('s3cret', ts, raw + ' ', good, now), false);
  assertEquals(await ppSignatureOk('s3cret', null, raw, good, now), false);
  assertEquals(await ppSignatureOk('s3cret', ts, raw, null, now), false);
  assertEquals(await ppSignatureOk('', ts, raw, good, now), false);
  const old = String(now - 301);
  assertEquals(await ppSignatureOk('s3cret', old, raw, await sign('s3cret', old, raw), now), false);
});

Deno.test('the switches: off unless the key, the platform and the agency are all named', () => {
  const set = (k: string, v: string) => Deno.env.set(k, v);
  set('POSTPEER_API_KEY', ''); set('POSTPEER_PLATFORMS', 'instagram,TikTok'); set('POSTPEER_AGENCIES', 'all');
  assertEquals(ppConnectFor('a1', 'instagram'), false);           // no key
  assertEquals(ppPublishOn('instagram'), false);
  set('POSTPEER_API_KEY', 'k');
  assertEquals(ppConnectFor('a1', 'instagram'), true);
  assertEquals(ppConnectFor('a1', 'tiktok'), true);               // case-insensitive
  assertEquals(ppConnectFor('a1', 'youtube'), false);             // platform not listed
  set('POSTPEER_AGENCIES', 'A1, a2');
  assertEquals(ppConnectFor('a1', 'instagram'), true);
  assertEquals(ppConnectFor('a3', 'instagram'), false);           // agency not listed
  assertEquals(ppConnectFor('', 'instagram'), false);             // status asks with no agency: only "all" counts
  set('POSTPEER_AGENCIES', '');
  assertEquals(ppConnectFor('a1', 'instagram'), false);
  assertEquals(ppPublishOn('instagram'), true);                   // publishing needs only key + platform
  set('POSTPEER_PLATFORMS', '');
  assertEquals(ppPublishOn('instagram'), false);                  // removing the platform pauses it
});

Deno.test('media type from the file name, as social-publish reads it', () => {
  assertEquals(mediaTypeOf('https://x.supabase.co/storage/v1/object/public/property-photos/a/b.MP4?t=1'), 'video');
  assertEquals(mediaTypeOf('https://x/m/a.mov#x'), 'video');
  assertEquals(mediaTypeOf('https://x/m/a.jpg'), 'image');
  assertEquals(mediaTypeOf(''), 'image');
});

Deno.test('PostPeer statuses become our delivery states', () => {
  assertEquals(deliveryOf('published'), 'live');
  assertEquals(deliveryOf('failed'), 'failed');
  assertEquals(deliveryOf('publishing'), 'pending');
  assertEquals(deliveryOf('partial'), 'pending');
  assertEquals(deliveryOf(''), 'pending');
});
