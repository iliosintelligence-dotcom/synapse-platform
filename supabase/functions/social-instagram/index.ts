/**
 * social-instagram -- publishes to Instagram professional accounts, renews their tokens.
 *
 * CONNECTING stays in social-connect, for the same reason as Facebook: the
 * OAuth redirect registered with Meta is /functions/v1/social-connect. Two
 * kinds of account arrive from there and both are published here:
 *   facebook_login   connected with its Page: holds the PAGE token and is
 *                    addressed on graph.facebook.com. Never expires on a timer.
 *   instagram_login  connected on its own: holds its own token, addressed on
 *                    graph.instagram.com, and lasts sixty days -- renewed here
 *                    ten days before the end.
 *
 * Moved out of social-publish on 2026-11-05 with its behaviour unchanged:
 * Stories, Reels for a lone video, carousels of up to ten mixed items, the
 * container poll. Two additions: an image that is not a JPEG is refused before
 * Meta is asked (Instagram publishes JPEG only, and said so only as a failed
 * container), and the processing timeout now says how long it actually waited.
 */
import {
  buildPayload, checkMedia, type Connection, fail, isVideoUrl, markAccountError, platformFunction,
  type PublishResult, type QueuedPost, saveTokens,
} from '../_shared/social/core.ts';
import { FB_GRAPH, graph, GraphError, IG_GRAPH } from '../_shared/social/meta.ts';

/* Instagram's Content Publishing API takes JPEG images only. The extension is
   the evidence we have without downloading the file. */
const NOT_JPEG = /\.(png|webp|heic|heif|gif|avif|bmp|tiff?)$/i;
function nonJpeg(urls: string[]): string | null {
  return urls.find((u) => !isVideoUrl(u) && NOT_JPEG.test(u.split('#')[0].split('?')[0])) ?? null;
}

/* A container is built asynchronously. Poll rather than sleep-and-hope, and
   give up before the function's own clock does. 45 s for photographs; video
   transcoding routinely takes minutes, so it gets five. */
async function waitForContainer(host: string, id: string, token: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  let delay = 1000;
  for (;;) {
    const r = await graph(host, '/' + id, { fields: 'status_code,status', access_token: token }, 'GET');
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      throw new GraphError('Instagram could not process the media: ' + (r.status ?? r.status_code),
        { status_code: r.status_code }, true);
    }
    if (Date.now() + delay > deadline) {
      throw new GraphError('Instagram was still processing the media after ' + Math.round(ms / 1000)
        + ' seconds. The post stays queued and will be retried.', { status_code: r.status_code }, false);
    }
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(delay * 2, 8000);
  }
}

async function publish(post: QueuedPost, conn: Connection): Promise<PublishResult> {
  const HOST = conn.authSource === 'facebook_login' ? FB_GRAPH : IG_GRAPH;
  const payload: Record<string, unknown> = { ...buildPayload(post), account: conn.username, ig_user_id: conn.platformAccountId };
  const story = post.post_format === 'story';

  if (!story) {
    const bad = checkMedia(post.media_urls, { max: 10, mixed: true, maxVideos: 10, who: 'Instagram' });
    if (bad) return fail('instagram', bad, payload, true);
  }
  const png = nonJpeg(story ? post.media_urls.slice(0, 1) : post.media_urls);
  if (png) {
    return fail('instagram', 'Instagram only publishes JPEG photographs, and one of these is not a JPEG ('
      + png.split('?')[0].split('/').pop() + '). Save it as JPEG and upload it again.', payload, true);
  }

  const waitMs = post.media_urls.some(isVideoUrl) ? 300000 : 45000;
  const me = '/' + conn.platformAccountId;

  try {
    const caption = post.caption ?? '';
    let creationId: string;

    if (story) {
      /* One item, no caption, no link sticker: all the STORIES container takes. */
      const only = post.media_urls[0];
      if (!only) return fail('instagram', 'A Story needs one photograph or video.', payload, true);
      const c = await graph(HOST, me + '/media', isVideoUrl(only)
        ? { media_type: 'STORIES', video_url: only, access_token: conn.token }
        : { media_type: 'STORIES', image_url: only, access_token: conn.token });
      creationId = String(c.id);
      await waitForContainer(HOST, creationId, conn.token, waitMs);
      payload.story = true;
    } else if (post.media_urls.length === 1) {
      /* A lone video is a REEL: the only shape the API takes for one video. */
      const only = post.media_urls[0];
      const c = await graph(HOST, me + '/media', isVideoUrl(only)
        ? { media_type: 'REELS', video_url: only, caption, access_token: conn.token }
        : { image_url: only, caption, access_token: conn.token });
      creationId = String(c.id);
      await waitForContainer(HOST, creationId, conn.token, waitMs);
    } else {
      /* Children in sequence (Meta rate-limits container creation per user),
         no caption of their own; a video child is VIDEO, never REELS. */
      const children: string[] = [];
      for (const url of post.media_urls) {
        const child = await graph(HOST, me + '/media', isVideoUrl(url)
          ? { media_type: 'VIDEO', video_url: url, is_carousel_item: 'true', access_token: conn.token }
          : { image_url: url, is_carousel_item: 'true', access_token: conn.token });
        children.push(String(child.id));
      }
      for (const id of children) await waitForContainer(HOST, id, conn.token, waitMs);
      const parent = await graph(HOST, me + '/media',
        { media_type: 'CAROUSEL', children: children.join(','), caption, access_token: conn.token });
      creationId = String(parent.id);
      await waitForContainer(HOST, creationId, conn.token, waitMs);
      payload.carousel_children = children;
    }

    /* The only call that makes anything public. */
    const published = await graph(HOST, me + '/media_publish', { creation_id: creationId, access_token: conn.token });
    return { ok: true, postId: String(published.id), provider: 'instagram', error: '',
      payload: { ...payload, creation_id: creationId, dispatched: true } };
  } catch (err) {
    const ge = err instanceof GraphError ? err : null;
    if (ge?.tokenDead) await markAccountError(conn, 'Instagram says this account’s permission has ended. Connect it again.');
    return fail('instagram', err instanceof Error ? err.message : 'Unknown Instagram error',
      { ...payload, meta_error: ge?.detail ?? {} }, ge?.permanent ?? false);
  }
}

/* Instagram Login tokens last sixty days and are renewed with one GET while
   still valid. Facebook-login (Page) tokens do not expire this way. */
async function refresh(conn: Connection): Promise<string | null> {
  if (conn.authSource === 'facebook_login' || !conn.token) return null;
  const r = await fetch('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token='
    + encodeURIComponent(conn.token)).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok || !j.access_token) {
    console.error('social-instagram: refresh failed for ' + conn.accountId + ': ' + JSON.stringify(j.error ?? r?.status).slice(0, 200));
    return null;
  }
  await saveTokens(conn.accountId, String(j.access_token), null, Number(j.expires_in) || 5184000);
  return String(j.access_token);
}

platformFunction({
  platform: 'instagram',
  status: () => ({
    with_facebook: Boolean(Deno.env.get('META_APP_ID') && Deno.env.get('META_APP_SECRET')),
    on_its_own: Boolean(Deno.env.get('META_IG_APP_ID') && Deno.env.get('META_IG_APP_SECRET')),
    connect: 'social-connect?action=start&platform=instagram (or facebook, for an account linked to a Page)',
  }),
  publish,
  refresh,
  refreshWithin: 10 * 24 * 3600 * 1000,
});
