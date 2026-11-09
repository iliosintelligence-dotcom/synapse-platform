/**
 * Turning YouTube's videos.list?part=statistics answer into the numbers a post card shows.
 * Kept apart from index.ts so it can be tested without network or database.
 *
 * YouTube Data API v3, videos resource, statistics (read 2026-11-10): viewCount, likeCount, commentCount arrive as
 * decimal STRINGS ("1234"); likeCount and commentCount are absent when the owner hid them or comments are off, which
 * is not the same as zero -- absent stays null, so the dashboard shows "-" rather than a false 0. dislikeCount is
 * private since 2021 and not read. One request takes at most 50 ids.
 */
export const YT_VIDEOS = 'https://www.googleapis.com/youtube/v3/videos';
export const YT_BATCH = 50;

export type Stats = { views: number | null; likes: number | null; comments: number | null };

function count(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** id -> stats for every video YouTube answered about. A video it did not return (deleted, or not this channel's)
 *  is simply missing from the map. */
export function statsById(items: unknown): Map<string, Stats> {
  const out = new Map<string, Stats>();
  if (!Array.isArray(items)) return out;
  for (const it of items as Array<Record<string, any>>) {
    const id = typeof it?.id === 'string' ? it.id : '';
    if (!id) continue;
    const s = it.statistics ?? {};
    out.set(id, { views: count(s.viewCount), likes: count(s.likeCount), comments: count(s.commentCount) });
  }
  return out;
}

/** Split ids into requests of at most 50. */
export function batches<T>(xs: T[], size = YT_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
