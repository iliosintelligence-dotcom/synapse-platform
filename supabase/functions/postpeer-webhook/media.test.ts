import { assertEquals } from 'jsr:@std/assert@1';
import {
  igCropSize, imageSizeFromBytes, instagramSafeMedia, isDailyUploadLimit, oneKindOfMedia, pacificDay, storageCropUrl,
} from './postpeer.ts';

Deno.test('facebook, tiktok and instagram get one kind of media; others keep the gallery', () => {
  const mixed = ['a.jpg', 'b.mp4', 'c.jpg', 'd.mov'];
  assertEquals(oneKindOfMedia('facebook', mixed), ['b.mp4']);
  assertEquals(oneKindOfMedia('tiktok', mixed), ['b.mp4']);
  assertEquals(oneKindOfMedia('facebook', ['a.jpg', 'c.jpg']), ['a.jpg', 'c.jpg']);
  assertEquals(oneKindOfMedia('linkedin', mixed), mixed);   // Instagram joined Facebook and TikTok on 26 Nov
});

Deno.test('instagram crop: the photos PostPeer refused on 26 Nov come out inside 0.8 to 1.91', () => {
  for (const [w, h] of [[591, 1280], [1280, 591], [1080, 1920], [3000, 1000], [1, 1000]]) {
    const c = igCropSize(w, h)!;
    const r = c.width / c.height;
    assertEquals(r >= 0.8 && r <= 1.91 && c.width <= w && c.height <= h, true, `${w}x${h} -> ${c.width}x${c.height}`);
  }
  assertEquals(igCropSize(1080, 1350), null);
  assertEquals(igCropSize(1080, 1080), null);
  assertEquals(igCropSize(0, 10), null);
});

Deno.test('crop url only for public storage, keeps the path, never webp', () => {
  const u = 'https://x.supabase.co/storage/v1/object/public/property-photos/a/b.jpg?t=1';
  assertEquals(storageCropUrl(u, { width: 591, height: 738 }),
    'https://x.supabase.co/storage/v1/render/image/public/property-photos/a/b.jpg?width=591&height=738&resize=cover&quality=90&format=origin');
  assertEquals(storageCropUrl('https://images.unsplash.com/a.jpg', { width: 1, height: 1 }), null);
});

Deno.test('image size from a JPEG and a PNG header', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x05, 0x00, 0x02, 0x4f, 3, 0, 0, 0, 0, 0, 0]);
  assertEquals(imageSizeFromBytes(jpeg), { w: 591, h: 1280 });
  const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47]); png.set([0, 0, 4, 56], 16); png.set([0, 0, 5, 70], 20);
  assertEquals(imageSizeFromBytes(png), { w: 1080, h: 1350 });
  assertEquals(imageSizeFromBytes(new Uint8Array([1, 2, 3])), null);
});

Deno.test('instagramSafeMedia crops a tall storage photo, leaves videos and unreadable photos', async () => {
  Deno.env.set('SUPABASE_URL', 'https://x.supabase.co');
  const tall = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x05, 0x00, 0x02, 0x4f, 3, 0, 0, 0, 0, 0, 0]);
  const fake = ((url: string) => Promise.resolve(url.includes('tall')
    ? new Response(tall, { status: 206 }) : new Response('nope', { status: 404 }))) as unknown as typeof fetch;
  const base = 'https://x.supabase.co/storage/v1/object/public/p/';
  const out = await instagramSafeMedia([base + 'tall.jpg', base + 'gone.jpg', base + 'v.mp4'], fake);
  assertEquals(out[0], base.replace('/object/', '/render/image/') + 'tall.jpg?width=591&height=738&resize=cover&quality=90&format=origin');
  assertEquals(out.slice(1), [base + 'gone.jpg', base + 'v.mp4']);
});

Deno.test('pacific day: winter and summer offsets, and the next midnight', () => {
  const w = pacificDay(new Date('2026-11-26T06:00:00Z'));   // 25 Nov 22:00 PST
  assertEquals(w.start.toISOString(), '2026-11-25T08:00:00.000Z');
  assertEquals(w.next.toISOString(), '2026-11-26T08:00:00.000Z');
  const s = pacificDay(new Date('2026-07-01T12:00:00Z'));   // 1 Jul 05:00 PDT
  assertEquals(s.start.toISOString(), '2026-07-01T07:00:00.000Z');
});

Deno.test('the daily upload limit is recognised in both wordings PostPeer used', () => {
  assertEquals(isDailyUploadLimit('Daily YouTube upload limit reached (5 per day). Resets at midnight Pacific.'), true);
  assertEquals(isDailyUploadLimit("Failed to start YouTube upload session: 429 { \"message\": \"Quota exceeded for quota metric 'Video Uploads'"), true);
  assertEquals(isDailyUploadLimit('YouTube takes video only.'), false);
});

import { allowanceOf, ppLimitOf } from './postpeer.ts';

Deno.test('plan limits are said in terms of the plan, never the posting service, and say what happens next', () => {
  for (const status of [402, 403, 429]) {
    const l = ppLimitOf({ status, body: { message: 'x' } })!;
    assertEquals(/postpeer/i.test(l.message), false);
    assertEquals(/plan/i.test(l.message), true);
  }
  assertEquals(ppLimitOf({ status: 402, body: {} })!.retryInMin, 60);
  assertEquals(ppLimitOf({ status: 403, body: {} })!.retryInMin, null);
  assertEquals(ppLimitOf({ status: 200, body: {} }), null);
  assertEquals(ppLimitOf({ status: 500, body: {} }), null);
});

Deno.test('allowance: paused only when monthly and purchased are both used', () => {
  const r = (m: number, p: number) => ({ status: 200, body: { balance: { monthly: { remaining: m, cycleEnd: '2026-12-25T12:52:05.000Z' }, purchased: { remaining: p } } } });
  assertEquals(allowanceOf(r(1999, 0)).paused, false);
  assertEquals(allowanceOf(r(0, 5)).paused, false);
  assertEquals(allowanceOf(r(0, 0)), { remaining: 0, resetsAt: '2026-12-25T12:52:05.000Z', paused: true });
  assertEquals(allowanceOf({ status: 500, body: {} }).paused, false);
});

Deno.test('instagramSafeMedia never fetches an address outside our own Storage', async () => {
  Deno.env.set('SUPABASE_URL', 'https://x.supabase.co');
  const seen: string[] = [];
  const spy = ((url: string) => { seen.push(url); return Promise.resolve(new Response('x', { status: 404 })); }) as unknown as typeof fetch;
  const out = await instagramSafeMedia([
    'http://169.254.169.254/latest/meta-data/a.jpg',
    'https://other.supabase.co/storage/v1/object/public/p/a.jpg',
    'https://x.supabase.co/storage/v1/object/public/p/ok.jpg',
  ], spy);
  assertEquals(seen, ['https://x.supabase.co/storage/v1/object/public/p/ok.jpg']);
  assertEquals(out[0], 'http://169.254.169.254/latest/meta-data/a.jpg');
});

Deno.test('pacific day on both daylight-saving change days', () => {
  const fall = pacificDay(new Date('2026-11-01T20:00:00Z'));     // 1 Nov: PDT until 02:00, PST after
  assertEquals(fall.start.toISOString(), '2026-11-01T07:00:00.000Z');
  assertEquals(fall.next.toISOString(), '2026-11-02T08:00:00.000Z');
  const spring = pacificDay(new Date('2026-03-08T20:00:00Z'));   // 8 Mar: PST until 02:00, PDT after
  assertEquals(spring.start.toISOString(), '2026-03-08T08:00:00.000Z');
  assertEquals(spring.next.toISOString(), '2026-03-09T07:00:00.000Z');
});

import { ig45Size, mp4Seconds, videoSeconds } from './postpeer.ts';

Deno.test('instagram takes one kind of media: a mixed gallery goes out as its video alone', () => {
  assertEquals(oneKindOfMedia('instagram', ['a.jpg', 'v.mp4', 'b.jpg']), ['v.mp4']);
  assertEquals(oneKindOfMedia('instagram', ['a.jpg', 'b.jpg']), ['a.jpg', 'b.jpg']);
});

Deno.test('instagram carousel: every photo cropped to exactly 4:5, never narrower', () => {
  for (const [w, h] of [[1280, 591], [591, 1280], [1080, 1080], [1200, 1600], [1600, 1200], [1131, 1600], [1279, 1600]]) {
    const c = ig45Size(w, h);
    const r = c ? c.width / c.height : w / h;
    assertEquals(r >= 0.8 && r < 0.805 && (!c || (c.width <= w && c.height <= h)), true, `${w}x${h}`);
  }
});

Deno.test('instagramSafeMedia crops a carousel uniformly to 4:5', async () => {
  Deno.env.set('SUPABASE_URL', 'https://x.supabase.co');
  const jpeg = (w: number, h: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0]);
  const fake = ((url: string) => Promise.resolve(new Response(url.includes('wide') ? jpeg(1280, 591) : jpeg(1080, 1080), { status: 206 }))) as unknown as typeof fetch;
  const base = 'https://x.supabase.co/storage/v1/object/public/p/';
  const out = await instagramSafeMedia([base + 'wide.jpg', base + 'square.jpg'], fake);
  assertEquals(out[0].includes('width=473&height=591'), true, out[0]);
  assertEquals(out[1].includes('width=864&height=1080'), true, out[1]);
});

Deno.test('mp4Seconds reads mvhd (version 0 and 1); videoSeconds never reads another host', async () => {
  const v0 = new Uint8Array(64); v0.set([0, 0, 0, 108, 0x6d, 0x76, 0x68, 0x64, 0, 0, 0, 0], 4);
  v0.set([0, 0, 3, 232], 4 + 8 + 12); v0.set([0, 4, 247, 162], 4 + 8 + 16);         // timescale 1000, duration 325538
  assertEquals(mp4Seconds(v0), 325.538);
  const v1 = new Uint8Array(80); v1.set([0x6d, 0x76, 0x68, 0x64, 1, 0, 0, 0], 8);
  v1.set([0, 0, 0, 30], 8 + 8 + 16); v1.set([0, 0, 0, 0, 0, 0, 6, 64], 8 + 8 + 20);   // timescale 30, duration 1600
  assertEquals(Math.round(mp4Seconds(v1)! * 100) / 100, 53.33);
  assertEquals(mp4Seconds(new Uint8Array(10)), null);
  Deno.env.set('SUPABASE_URL', 'https://x.supabase.co');
  let called = false;
  const spy = (() => { called = true; return Promise.resolve(new Response('')); }) as unknown as typeof fetch;
  assertEquals(await videoSeconds('https://evil.example/v.mp4', spy), null);
  assertEquals(called, false);
});

import { cropIntoRange, cropToRatio, TIKTOK_SHAPES, tiktokSafeMedia } from './postpeer.ts';

Deno.test('tiktok: the 26 Nov 3pm carousel (1086x1448 beside other shapes) comes out one shape, each inside 1:2.13..2.13:1', async () => {
  Deno.env.set('SUPABASE_URL', 'https://x.supabase.co');
  const jpeg = (w: number, h: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0]);
  const sizes: Record<string, [number, number]> = { a: [1086, 1448], b: [1280, 591], c: [1080, 1080], d: [591, 1280] };
  const fake = ((url: string) => {
    const k = url.split('/').pop()!.split('.')[0];
    return Promise.resolve(new Response(jpeg(...sizes[k]), { status: 206 }));
  }) as unknown as typeof fetch;
  const base = 'https://x.supabase.co/storage/v1/object/public/p/';
  const out = await tiktokSafeMedia(['a', 'b', 'c', 'd'].map((k) => base + k + '.jpg'), fake);
  const ratios = out.map((u, i) => {
    const m = u.match(/width=(\d+)&height=(\d+)/);
    const [w, h] = m ? [Number(m[1]), Number(m[2])] : sizes['abcd'[i]];
    return w / h;
  });
  for (const r of ratios) assertEquals(r >= 0.75 && r < 0.755, true, String(ratios));
  const single = cropIntoRange(1280, 591, TIKTOK_SHAPES.min, TIKTOK_SHAPES.max)!;
  assertEquals(single.width / single.height <= 2.13 && single.width <= 1280, true);
  assertEquals(cropIntoRange(1080, 1920, TIKTOK_SHAPES.min, TIKTOK_SHAPES.max), null);   // 9:16 is fine as it is
  assertEquals(cropToRatio(1086, 1448, 0.75), null);                                     // already 3:4
});
