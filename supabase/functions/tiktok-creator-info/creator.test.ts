import { assertEquals } from 'jsr:@std/assert@1';
import { creatorInfoFrom } from './creator.ts';

Deno.test('a normal answer becomes the panel shape, with labels for the privacy options', () => {
  const r = creatorInfoFrom(200, {
    data: {
      creator_nickname: 'Lekki Homes', creator_username: 'lekkihomes', creator_avatar_url: 'https://x/a.jpg',
      privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
      comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 300,
    },
    error: { code: 'ok' },
  });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.nickname, 'Lekki Homes');
    assertEquals(r.privacy_options, [{ value: 'PUBLIC_TO_EVERYONE', label: 'Everyone' }, { value: 'SELF_ONLY', label: 'Only me' }]);
    assertEquals([r.comment_disabled, r.duet_disabled, r.stitch_disabled], [false, true, false]);
    assertEquals(r.max_video_sec, 300);
  }
});

Deno.test('the codes that mean "cannot post now" stop the panel with a plain reason', () => {
  const r = creatorInfoFrom(200, { data: {}, error: { code: 'spam_risk_too_many_posts', message: 'x' } });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, 'spam_risk_too_many_posts');
  const s = creatorInfoFrom(401, { error: { code: 'scope_not_authorized' } });
  assertEquals(!s.ok && s.reason.startsWith('This TikTok connection cannot post directly yet'), true);
});

Deno.test('no privacy options, a server error, or rubbish are refused rather than guessed', () => {
  assertEquals(creatorInfoFrom(200, { data: { privacy_level_options: [] }, error: { code: 'ok' } }).ok, false);
  assertEquals(creatorInfoFrom(503, null).ok, false);
  assertEquals(creatorInfoFrom(200, 'nonsense').ok, false);
});
