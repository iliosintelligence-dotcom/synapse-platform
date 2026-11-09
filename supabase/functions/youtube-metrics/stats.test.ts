import { assertEquals } from 'jsr:@std/assert@1';
import { batches, statsById } from './stats.ts';

Deno.test('counts arrive as strings and become numbers', () => {
  const m = statsById([{ id: 'v1', statistics: { viewCount: '1234', likeCount: '56', commentCount: '7' } }]);
  assertEquals(m.get('v1'), { views: 1234, likes: 56, comments: 7 });
});

Deno.test('a hidden like or comment count stays unknown, not zero', () => {
  const m = statsById([{ id: 'v2', statistics: { viewCount: '10' } }]);
  assertEquals(m.get('v2'), { views: 10, likes: null, comments: null });
});

Deno.test('rubbish in the answer is ignored', () => {
  const m = statsById([{ statistics: { viewCount: '5' } }, { id: 'v3', statistics: { viewCount: '-1', likeCount: 'x' } }, null]);
  assertEquals(m.size, 1);
  assertEquals(m.get('v3'), { views: null, likes: null, comments: null });
  assertEquals(statsById(undefined).size, 0);
});

Deno.test('ids go to YouTube fifty at a time', () => {
  const ids = Array.from({ length: 120 }, (_, i) => 'v' + i);
  assertEquals(batches(ids).map((b) => b.length), [50, 50, 20]);
  assertEquals(batches([]).length, 0);
});
