/**
 * publish-youtube -- uploads one queued post's video to a YouTube channel.
 *
 * Called only by social-publish (the queue: claim, retries, dry_run, saving the outcome), never by a browser: index.ts
 * refuses any caller that does not present the service role key. Self-contained on purpose, like the other publish-*
 * functions: the deploy flattens away imports from outside a function's own folder, and a change here redeploys only
 * this function.
 */

export interface QueuedPost {
  id: string;
  agency_id: string;
  property_id: string | null;
  platform: string;
  caption: string | null;
  media_urls: string[];
  attempts: number;
  max_attempts: number;
  dry_run: boolean;
  /* 'agency' (the agency's own connected account) or 'synapse' (a channel we
     own, amplifying the listing for free). It decides WHOSE ACCOUNT this goes
     to, which is the real routing question -- not which platform it is. */
  leg: string;
  /* WHICH of the agency's accounts, now that there can be more than one on a
     platform. NULL means the agency's default, which is what every row queued
     before the column existed means -- so nothing already in the queue changes
     its destination. Rides along free: claim_social_due_any returns
     `setof social_posts`. */
  social_account_id: string | null;
  /* 'feed' or 'story'. A Story is a different MEDIA TYPE on the same account,
     not a different platform, so it travels on the row rather than in the
     routing. Undefined on rows queued before the column existed, which read
     as 'feed' -- which is what they are. */
  post_format?: string | null;
  /* Set on a post the city feed queued (feed_city_channels): which Synapse
     city channel it goes to. Only a synapse-leg post carries one. */
  city_channel_id?: string | null;
}

export interface PublishResult {
  ok: boolean;
  postId: string | null;
  provider: string;
  error: string;
  /** Exactly what was, or would have been, sent. Stored either way. */
  payload: Record<string, unknown>;
}

/** What a real adapter needs beyond the post: which account it is posting as,
 *  and the token to post with. Read once per platform per batch, through the
 *  one path tokens are allowed to leave storage by -- `social_account_token`,
 *  which is service_role only. */
export interface Connection {
  accountId: string;
  /** The IG user id or the Facebook Page id -- whatever the provider addresses. */
  platformAccountId: string;
  username: string;
  token: string;
  /** WHICH OAUTH FLOW ISSUED THE TOKEN, and therefore which Graph host will
   *  accept it. An Instagram account connected through Facebook Login holds
   *  the PAGE's token and must be addressed on graph.facebook.com;
   *  graph.instagram.com refuses it, and says only that it is invalid. */
  authSource: 'instagram_login' | 'facebook_login';
}

export type Adapter = (post: QueuedPost, conn: Connection) => Promise<PublishResult>;

/** Builds the request body a real adapter would send. Shared by every adapter
 *  so the rehearsal record is the same shape as the real one. */
export function buildPayload(post: QueuedPost): Record<string, unknown> {
  return {
    platform: post.platform,
    caption: post.caption ?? '',
    caption_length: (post.caption ?? '').length,
    media: post.media_urls,
    media_count: post.media_urls.length,
    property_id: post.property_id,
  };
}

/** Meta will not fetch media from a URL it cannot reach, and a signed URL that
 *  expires mid-publish fails halfway through a carousel. Catch it here, where
 *  the message can name the URL, rather than as a generic Graph error. */
/* The same test agency-listings.js applies when it records media_type and
   the property page applies when it chooses an element. media_urls is a
   text[] of bare URLs, so the type has to be re-derived here -- and by the
   same rule, because two different guesses about one string is how a video
   gets handed to Meta as a photograph.

   Query and fragment are stripped first: a Supabase public URL can arrive
   with ?t= on it, and ".mp4?t=1" matches nothing. */
const VIDEO_EXT = /\.(mp4|mov|m4v|qt)$/i;
export function isVideoUrl(u: string): boolean {
  return VIDEO_EXT.test(String(u || '').split('#')[0].split('?')[0]);
}

/* -- YouTube ---------------------------------------------------------------------
   YouTube Data API v3, videos.insert, resumable upload (read 2026-11-07): a POST that opens an upload session and returns
   its address in Location, then one PUT of the video bytes, answered 201 with the new video.

   VIDEO ONLY. YouTube takes nothing else, and a listing is usually photographs. Turning photographs into a video is not
   built yet, so a post without a video is refused here with that said plainly, rather than left to fail at YouTube.

   STREAMED, NOT HELD. The video goes from its public URL to YouTube as a stream, with its length from the source's
   Content-Length (which the PUT must state up front), so a large tour never sits whole in this function's memory.

   THE TOKEN is a Google access token that lives an hour; social-publish renews it from the stored refresh token before
   calling here (refreshYouTube), the same way it renews TikTok's.

   LIMITS, from the videos resource: title at most 100 characters, description at most 5000 bytes, neither may contain
   < or >. Uploads draw on a separate allowance of 100 videos.insert calls a day per project (1 unit each).
   Interrupted uploads are not resumed: the post is reported failed and social-publish retries it from the start on its
   usual ladder, which is simpler than resuming and costs one allowance unit. */
const YT_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
const YT_TITLE_MAX = 100;
const YT_DESCRIPTION_MAX_BYTES = 5000;

/** `<` and `>` are refused anywhere in a title or description. */
function ytClean(text: string): string {
  return (text ?? '').replace(/[<>]/g, '').trim();
}

/** The first line of the caption that is not a link, cut to 100 characters at a word. */
export function ytTitle(caption: string): string {
  const line = ytClean(caption).split('\n').map((l) => l.trim()).find((l) => l && !/^https?:\/\//i.test(l)) ?? '';
  if ([...line].length <= YT_TITLE_MAX) return line || 'New listing';
  const cut = [...line].slice(0, YT_TITLE_MAX - 1).join('');
  const space = cut.lastIndexOf(' ');
  return (space > 60 ? cut.slice(0, space) : cut).trimEnd() + '…';
}

/** The whole caption, cut to 5000 bytes of UTF-8 without splitting a character. */
export function ytDescription(caption: string): string {
  const text = ytClean(caption);
  const enc = new TextEncoder();
  if (enc.encode(text).length <= YT_DESCRIPTION_MAX_BYTES) return text;
  let out = '';
  for (const ch of text) {
    if (enc.encode(out + ch + '…').length > YT_DESCRIPTION_MAX_BYTES) break;
    out += ch;
  }
  return out.trimEnd() + '…';
}

/** Google's error reasons, in words an agent can act on. Anything else is Google's own message. */
export function youtubeError(status: number, reason: string, message: string): string {
  const r = reason.toLowerCase();
  if (status === 401) return 'YouTube no longer accepts this connection. Reconnect the YouTube account. (' + (reason || status) + ')';
  if (r === 'uploadlimitexceeded') return 'This YouTube channel has reached its upload limit for now. The post stays queued and will be retried. (' + reason + ')';
  if (r === 'quotaexceeded' || r === 'dailylimitexceeded') return 'Synapse has used today\'s YouTube upload allowance. The post stays queued and will be retried. (' + reason + ')';
  if (r === 'forbiddenprivacysetting') return 'YouTube refused the privacy setting for this channel. (' + reason + ')';
  if (r === 'forbidden' || r === 'insufficientpermissions') return 'This YouTube connection may not upload. Reconnect it and allow uploading videos. (' + reason + ')';
  if (r === 'invalidtitle' || r === 'invaliddescription') return 'YouTube refused the title or description. (' + reason + ')';
  return 'YouTube refused: ' + (message || reason || ('HTTP ' + status)) + '.';
}

export const youtubeAdapter: Adapter = async (post, conn) => {
  const video = (post.media_urls ?? []).find((u) => /^https:\/\//i.test(u) && isVideoUrl(u));
  const title = ytTitle(post.caption ?? '');
  const payload: Record<string, unknown> = { ...buildPayload(post), account: conn.username, channel_id: conn.platformAccountId, title };
  if (!video) {
    return {
      ok: false, postId: null, provider: 'youtube', payload,
      error: 'YouTube only takes video, and this post has photos only. (Turning listing photos into a video is not built yet.)',
    };
  }
  try {
    /* The source first: its length is needed to open the session, and a dead link should fail before YouTube is asked. */
    const src = await fetch(video);
    const length = Number(src.headers.get('content-length') ?? 0);
    const type = (src.headers.get('content-type') ?? '').split(';')[0].trim() || 'video/mp4';
    if (!src.ok || !src.body) throw new Error('Could not fetch the video (' + src.status + '): ' + video.slice(0, 80));
    if (!length) {
      await src.body.cancel().catch(() => {});
      throw new Error('The video\'s host did not say how large it is, which YouTube needs before the upload. ' + video.slice(0, 80));
    }

    const meta = {
      snippet: { title, description: ytDescription(post.caption ?? '') },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    };
    const open = await fetch(YT_UPLOAD + '?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + conn.token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(length),
        'X-Upload-Content-Type': type,
      },
      body: JSON.stringify(meta),
    });
    const session = open.headers.get('location');
    if (!open.ok || !session) {
      await src.body.cancel().catch(() => {});
      const j = await open.json().catch(() => ({})) as Record<string, any>;
      const e = j?.error ?? {};
      return { ok: false, postId: null, provider: 'youtube', payload,
               error: youtubeError(open.status, String(e?.errors?.[0]?.reason ?? ''), String(e?.message ?? '')) };
    }

    const put = await fetch(session, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + conn.token, 'Content-Length': String(length), 'Content-Type': type },
      body: src.body,
      // A streamed request body must say it is half-duplex.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const j = await put.json().catch(() => ({})) as Record<string, any>;
    if (put.status !== 200 && put.status !== 201) {
      const e = j?.error ?? {};
      return { ok: false, postId: null, provider: 'youtube', payload,
               error: youtubeError(put.status, String(e?.errors?.[0]?.reason ?? ''), String(e?.message ?? '')) };
    }
    if (!j?.id) throw new Error('YouTube accepted the upload but returned no video id.');
    return {
      ok: true, postId: String(j.id), provider: 'youtube', error: '',
      payload: { ...payload, video_bytes: length, privacy: 'public', dispatched: true },
    };
  } catch (err) {
    return { ok: false, postId: null, provider: 'youtube', payload,
             error: err instanceof Error ? err.message : 'Unknown YouTube error' };
  }
};
