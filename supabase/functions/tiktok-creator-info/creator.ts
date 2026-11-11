/**
 * TikTok's creator_info answer, in the shape the scheduler's TikTok panel needs. Kept apart from index.ts so it can be
 * tested without network or database.
 *
 * Content Posting API, Query Creator Info (read 2026-11-11): POST /v2/post/publish/creator_info/query/, scope
 * video.publish. data: creator_nickname, creator_username, creator_avatar_url, privacy_level_options, comment_disabled,
 * duet_disabled, stitch_disabled, max_video_post_duration_sec. These error codes arrive with HTTP 200 and mean the
 * creator cannot post right now: spam_risk_too_many_posts, spam_risk_user_banned_from_posting, reached_active_user_cap.
 */
export const TT_CREATOR_INFO = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';

export const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
};

export type CreatorInfo =
  | {
    ok: true;
    nickname: string;
    username: string;
    avatar: string | null;
    privacy_options: { value: string; label: string }[];
    comment_disabled: boolean;
    duet_disabled: boolean;
    stitch_disabled: boolean;
    max_video_sec: number | null;
  }
  | { ok: false; reason: string; code: string };

const BLOCKED: Record<string, string> = {
  spam_risk_too_many_posts: 'This TikTok account has reached TikTok’s daily post limit. Try again tomorrow.',
  spam_risk_user_banned_from_posting: 'TikTok is not letting this account post right now.',
  reached_active_user_cap: 'Synapse has reached TikTok’s daily limit of accounts posting. Try again tomorrow.',
  access_token_invalid: 'TikTok no longer accepts this connection. Reconnect TikTok under Channels.',
  scope_not_authorized: 'This TikTok connection cannot post directly yet. Reconnect TikTok under Channels to allow it.',
  rate_limit_exceeded: 'TikTok asked us to slow down. Try again in a minute.',
};

/** TikTok's JSON (and HTTP status) -> what the panel shows. Unknown codes are passed through, not guessed at. */
export function creatorInfoFrom(status: number, j: unknown): CreatorInfo {
  const body = (j && typeof j === 'object') ? j as Record<string, any> : {};
  const code = String(body?.error?.code ?? '').trim();
  if (code && code !== 'ok') {
    return { ok: false, code, reason: BLOCKED[code] ?? ('TikTok said: ' + (body?.error?.message || code)) };
  }
  if (status >= 500) return { ok: false, code: 'server', reason: 'TikTok is not answering right now. Try again shortly.' };
  if (status !== 200) return { ok: false, code: 'http_' + status, reason: 'TikTok refused the request (HTTP ' + status + ').' };
  const d = (body.data && typeof body.data === 'object') ? body.data as Record<string, any> : {};
  const opts = Array.isArray(d.privacy_level_options) ? d.privacy_level_options.map(String) : [];
  if (!opts.length) return { ok: false, code: 'no_privacy', reason: 'TikTok gave no privacy options for this account.' };
  const max = Number(d.max_video_post_duration_sec);
  return {
    ok: true,
    nickname: String(d.creator_nickname ?? '').trim() || String(d.creator_username ?? '').trim() || 'TikTok account',
    username: String(d.creator_username ?? '').trim(),
    avatar: typeof d.creator_avatar_url === 'string' && d.creator_avatar_url ? d.creator_avatar_url : null,
    privacy_options: opts.map((v: string) => ({ value: v, label: PRIVACY_LABEL[v] ?? v })),
    comment_disabled: d.comment_disabled === true,
    duet_disabled: d.duet_disabled === true,
    stitch_disabled: d.stitch_disabled === true,
    max_video_sec: Number.isFinite(max) && max > 0 ? Math.floor(max) : null,
  };
}
