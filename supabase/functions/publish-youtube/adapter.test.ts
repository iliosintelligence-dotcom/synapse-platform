import { assert, assertEquals } from 'jsr:@std/assert@1';
import { youtubeAdapter, youtubeError, ytDescription, ytTitle } from './adapter.ts';

Deno.test('the title is the first line that is not a link, without < or >, at most 100 characters', () => {
  assertEquals(ytTitle('https://x/s/a\n<b>4-bed</b> in Ikoyi\nmore'), 'b4-bed/b in Ikoyi');
  const long = ytTitle('A '.repeat(120));
  assert([...long].length <= 100, 'length ' + [...long].length);
  assertEquals(ytTitle(''), 'New listing');
});

Deno.test('the description is cut to 5000 bytes of UTF-8 without splitting a character', () => {
  const d = ytDescription('₦'.repeat(3000)); // 3 bytes each
  assert(new TextEncoder().encode(d).length <= 5000, 'bytes ' + new TextEncoder().encode(d).length);
  assert(d.endsWith('…'));
});

Deno.test('Google reasons become something an agent can act on', () => {
  assert(youtubeError(401, '', '').includes('Reconnect'));
  assert(youtubeError(400, 'uploadLimitExceeded', '').includes('upload limit'));
  assertEquals(youtubeError(400, 'somethingNew', 'Bad thing'), 'YouTube refused: Bad thing.');
});

Deno.test('a post with photos only is refused before any call to Google', async () => {
  const post = {
    id: 'p1', agency_id: 'a1', property_id: null, platform: 'youtube', caption: 'A home', leg: 'agency',
    media_urls: ['https://x/front.jpg'], status: 'scheduled', dry_run: false, attempts: 1, max_attempts: 3,
    social_account_id: null,
  } as unknown as Parameters<typeof youtubeAdapter>[0];
  const conn = { accountId: 'c', platformAccountId: 'UC1', username: 'u', token: 't', authSource: 'instagram_login' as const };
  const r = await youtubeAdapter(post, conn);
  assertEquals(r.ok, false);
  assert(r.error.startsWith('YouTube only takes video'));
});
