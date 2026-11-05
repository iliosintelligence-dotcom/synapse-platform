/**
 * social-facebook -- publishes to Facebook Pages, and reads their engagement back.
 *
 * CONNECTING stays in social-connect. Facebook's OAuth redirect is registered
 * in the Meta app as /functions/v1/social-connect, and moving it here would
 * mean changing the Meta app before a single agency could reconnect. The
 * account it saves (social_accounts, auth_source facebook_login, a Page token
 * in Vault) is exactly what this function reads.
 *
 * Moved out of social-publish on 2026-11-05 with its behaviour unchanged: one
 * photo posts directly, several are uploaded unpublished and attached to one
 * feed story, a video goes to /videos. What is new is that a refusal Meta
 * calls permanent fails at once instead of three times, and a dead token
 * (code 190) is written on the account so the portal can say "reconnect".
 *
 * Metrics and comments for Facebook are still read by post-metrics (sweepMeta),
 * which already does both; this function's sweep is not used for it.
 */
import {
  buildPayload, checkMedia, type Connection, fail, isVideoUrl, markAccountError, platformFunction,
  type PublishResult, type QueuedPost,
} from '../_shared/social/core.ts';
import { FB_GRAPH, graph, GraphError } from '../_shared/social/meta.ts';

async function publish(post: QueuedPost, conn: Connection): Promise<PublishResult> {
  const payload: Record<string, unknown> = { ...buildPayload(post), account: conn.username, page_id: conn.platformAccountId };
  const bad = checkMedia(post.media_urls, { max: 10, mixed: true, maxVideos: 10, who: 'Facebook' });
  if (bad) return fail('facebook', bad, payload, true);

  try {
    const caption = post.caption ?? '';
    const page = '/' + conn.platformAccountId;
    const videos = post.media_urls.filter(isVideoUrl);
    const photos = post.media_urls.filter((u) => !isVideoUrl(u));

    /* Video lives on /videos with file_url. With photos as well, the video is
       the post: Facebook has no call that interleaves the two. */
    if (videos.length >= 1) {
      const vid = await graph(FB_GRAPH, page + '/videos', { file_url: videos[0], description: caption, access_token: conn.token });
      return {
        ok: true, postId: String(vid.post_id ?? vid.id), provider: 'facebook', error: '',
        payload: { ...payload, video_id: vid.id, dispatched: true,
          ...(photos.length ? { photos_omitted: photos.length,
            note: 'Facebook posted the video; it cannot interleave photos with it in one post.' } : {}) },
      };
    }

    if (photos.length === 1) {
      const photo = await graph(FB_GRAPH, page + '/photos', { url: photos[0], caption, access_token: conn.token });
      return { ok: true, postId: String(photo.post_id ?? photo.id), provider: 'facebook', error: '',
        payload: { ...payload, photo_id: photo.id, dispatched: true } };
    }

    /* Several photos: uploaded unpublished, then attached to one story, so the
       Page shows one post with a gallery rather than six in a row. */
    const ids: string[] = [];
    for (const url of photos) {
      const photo = await graph(FB_GRAPH, page + '/photos', { url, published: 'false', access_token: conn.token });
      ids.push(String(photo.id));
    }
    const attached: Record<string, string> = {};
    ids.forEach((id, i) => { attached['attached_media[' + i + ']'] = JSON.stringify({ media_fbid: id }); });
    const story = await graph(FB_GRAPH, page + '/feed', { message: caption, ...attached, access_token: conn.token });
    return { ok: true, postId: String(story.id), provider: 'facebook', error: '',
      payload: { ...payload, photo_ids: ids, dispatched: true } };
  } catch (err) {
    const ge = err instanceof GraphError ? err : null;
    if (ge?.tokenDead) await markAccountError(conn, 'Facebook says this Page’s permission has ended. Connect it again.');
    return fail('facebook', err instanceof Error ? err.message : 'Unknown Facebook error',
      { ...payload, meta_error: ge?.detail ?? {} }, ge?.permanent ?? false);
  }
}

platformFunction({
  platform: 'facebook',
  status: () => ({
    ready: Boolean(Deno.env.get('META_APP_ID') && Deno.env.get('META_APP_SECRET')),
    connect: 'social-connect?action=start&platform=facebook',
  }),
  publish,
});
