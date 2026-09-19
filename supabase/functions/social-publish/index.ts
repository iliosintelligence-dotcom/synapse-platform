/**
 * social-publish -- drains the social queue through a provider adapter.
 *
 * WHY THIS EXISTS IN THIS SHAPE
 * The pipeline is complete and the provider is one swappable function. The
 * mock adapter records exactly what WOULD be sent and returns a synthetic id;
 * the real adapters sit beside it. Connecting an account and clearing dry_run
 * on a row is all that stands between a rehearsal and a real post.
 *
 * THE RULE THAT MATTERS
 * A dry run must never be mistakable for a real post. `dry_run` is stamped on
 * the row at queue time and cannot be changed afterwards, the adapter that
 * handled it is recorded in `provider`, and the exact payload is kept in
 * `payload`. Nothing here may write `published` with `dry_run = true` and no
 * network call behind it without that being visible in the row.
 *
 * Mirrors send-outbox deliberately: same atomic claim, same retry ladder, same
 * agency scoping. That pattern is already proven here.
 *
 * POST { limit?: number, live?: boolean }
 *   live:true still only sends rows that were queued with dry_run = false.
 *   Two independent switches, because publishing is public and irreversible.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto-injected).
 * Tokens come from social_account_token, never from the environment.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
/* Inlined rather than imported from ../_shared. The import escapes the
   function's own directory, which the deploy flattens away -- the file simply
   is not there at runtime, and the failure is a cold-start module error rather
   than anything visible in the code. social-connect already inlines these for
   the same reason. Keep in step with _shared/cors.ts. */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface QueuedPost {
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
}

interface PublishResult {
  ok: boolean;
  postId: string | null;
  provider: string;
  error: string;
  /** Exactly what was, or would have been, sent. Stored either way. */
  payload: Record<string, unknown>;
}

/* -- adapters ---------------------------------------------------------------
   Each takes a queued post plus the agency's connection for that platform, and
   returns a PublishResult. Adding a real provider means adding one entry here;
   nothing else in this file changes. */

/** What a real adapter needs beyond the post: which account it is posting as,
 *  and the token to post with. Read once per platform per batch, through the
 *  one path tokens are allowed to leave storage by -- `social_account_token`,
 *  which is service_role only. */
interface Connection {
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

type Adapter = (post: QueuedPost, conn: Connection) => Promise<PublishResult>;

/** Builds the request body a real adapter would send. Shared by every adapter
 *  so the rehearsal record is the same shape as the real one. */
function buildPayload(post: QueuedPost): Record<string, unknown> {
  return {
    platform: post.platform,
    caption: post.caption ?? '',
    caption_length: (post.caption ?? '').length,
    media: post.media_urls,
    media_count: post.media_urls.length,
    property_id: post.property_id,
  };
}

/**
 * The mock. Makes no network call, and says so in every field it writes.
 * Its post id is deliberately prefixed and obviously synthetic -- nobody should
 * be able to paste it into a provider dashboard and wonder why it 404s.
 */
const mockAdapter: Adapter = (post) =>
  Promise.resolve({
    ok: true,
    postId: 'mock_' + post.platform + '_' + crypto.randomUUID().slice(0, 8),
    provider: 'mock',
    error: '',
    payload: { ...buildPayload(post), dispatched: false, note: 'No network call was made.' },
  });

/**
 * Providers we have not written an adapter for. Returning a clear "not
 * implemented" is honest; a stub that pretends to succeed would put a fake post
 * id in a row marked as live.
 */
const notConfigured = (name: string): Adapter => (post) =>
  Promise.resolve({
    ok: false,
    postId: null,
    provider: name,
    error: name + ' publishing is not implemented on this project yet.',
    payload: buildPayload(post),
  });

/* -- Meta Graph -------------------------------------------------------------
   Instagram and Facebook are the same API with different nouns, so they share
   one caller. Meta returns errors inside a 200 as often as not, which is why
   the body is inspected rather than only the status. */

const IG_GRAPH = 'https://graph.instagram.com/v21.0';
const FB_GRAPH = 'https://graph.facebook.com/v21.0';

class GraphError extends Error {
  detail: Record<string, unknown>;
  constructor(message: string, detail: Record<string, unknown>) {
    super(message);
    this.detail = detail;
  }
}

async function graph(
  host: string,
  path: string,
  params: Record<string, string>,
  method: 'GET' | 'POST' = 'POST',
): Promise<Record<string, any>> {
  const qs = new URLSearchParams(params);
  const res = method === 'GET'
    ? await fetch(host + path + '?' + qs.toString())
    : await fetch(host + path, { method: 'POST', body: qs });

  const body = await res.json().catch(() => ({} as Record<string, any>));
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    /* Meta's own message is the useful one and is written for a human -- it
       says "The account is not a professional account" rather than "code 100".
       Pass it through instead of paraphrasing, and keep the codes for support. */
    throw new GraphError(
      e.message ?? ('HTTP ' + res.status + ' from ' + host),
      { code: e.code, subcode: e.error_subcode, type: e.type, fbtrace_id: e.fbtrace_id, status: res.status },
    );
  }
  return body;
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
function isVideoUrl(u: string): boolean {
  return VIDEO_EXT.test(String(u || '').split('#')[0].split('?')[0]);
}

interface MediaRules {
  max: number;
  /* X allows four images OR one video and never a mix. That is Twitter's
     rule rather than a preference, so it is stated here instead of being
     discovered as a rejection. */
  mixed: boolean;
  maxVideos: number;
  who: string;
}

function checkMedia(post: QueuedPost, rules: MediaRules | number): string {
  const r: MediaRules = typeof rules === 'number'
    ? { max: rules, mixed: true, maxVideos: rules, who: 'Meta' }
    : rules;

  if (!post.media_urls.length) {
    return 'This post has no media, and ' + r.who + ' requires at least one photo or video.';
  }
  if (post.media_urls.length > r.max) {
    return r.who + ' accepts at most ' + r.max + ' items in one post; this has '
      + post.media_urls.length + '.';
  }
  const bad = post.media_urls.find((u) => !/^https:\/\//i.test(u));
  if (bad) return 'Media must be a public https URL ' + r.who + ' can fetch. Got: ' + bad.slice(0, 80);

  const videos = post.media_urls.filter(isVideoUrl);
  if (videos.length > r.maxVideos) {
    return r.who + ' accepts at most ' + r.maxVideos + ' video'
      + (r.maxVideos === 1 ? '' : 's') + ' in one post; this has ' + videos.length + '.';
  }
  if (!r.mixed && videos.length > 0 && videos.length !== post.media_urls.length) {
    return r.who + ' cannot mix video and photos in one post — send the video on its own, '
      + 'or photos on their own.';
  }
  return '';
}

/* An Instagram container is built asynchronously: Meta fetches the image on its
   own schedule, and publishing before it is FINISHED fails. Poll rather than
   sleep-and-hope, and give up before the function's own wall clock does -- a
   timeout that reports honestly is worth more than one that gets killed. */
async function waitForContainer(host: string, id: string, token: string, ms = 45000): Promise<void> {
  /* 45s is generous for a photograph and nowhere near enough for video --
     Meta routinely spends two to five minutes transcoding one. A deadline
     that fires before the work could possibly have finished reports a
     failure that did not happen, and the post is marked failed while
     Instagram is still busy succeeding. Callers pass the longer window when
     the post carries video. */
  const deadline = Date.now() + ms;
  let delay = 1000;
  for (;;) {
    const r = await graph(host, '/' + id, { fields: 'status_code,status', access_token: token }, 'GET');
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      throw new GraphError(
        'Instagram could not process the media: ' + (r.status ?? r.status_code),
        { status_code: r.status_code },
      );
    }
    if (Date.now() + delay > deadline) {
      throw new GraphError(
        'Instagram was still processing the media after 45 seconds. The post stays queued and will be retried.',
        { status_code: r.status_code },
      );
    }
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(delay * 2, 8000);
  }
}

/**
 * Instagram. Two shapes: one image is a single container, several are carousel
 * children gathered into a parent. Both end at /media_publish, which is the
 * only call that actually makes anything public.
 */
const instagramAdapter: Adapter = async (post, conn) => {
  /* An Instagram account reached through Facebook Login is addressed on
     graph.facebook.com with the Page's token. One reached through Instagram
     Login is addressed on graph.instagram.com with its own. The endpoints
     and parameters below are identical either way -- only the host differs,
     and sending a token to the wrong one fails with an error that never
     mentions the host. */
  const HOST = conn.authSource === 'facebook_login' ? FB_GRAPH : IG_GRAPH;
  const payload: Record<string, unknown> = {
    ...buildPayload(post), account: conn.username, ig_user_id: conn.platformAccountId,
  };
  /* Instagram will mix video and photos inside one carousel, which is the
     whole point of allowing it here. */
  const bad = checkMedia(post, { max: 10, mixed: true, maxVideos: 10, who: 'Instagram' });
  if (bad) return { ok: false, postId: null, provider: 'instagram', error: bad, payload };

  /* Transcoding is the slow part, so the wait is set by whether there is any
     video at all rather than by how many. */
  const hasVideo = post.media_urls.some(isVideoUrl);
  const waitMs = hasVideo ? 300000 : 45000;

  try {
    const caption = post.caption ?? '';
    let creationId: string;

    if (post.media_urls.length === 1) {
      const only = post.media_urls[0];
      /* A lone video is a REEL. Since 2024 that is the only shape the Graph
         API accepts for a single video -- there is no "video feed post" to
         ask for any more, and sending image_url with an mp4 fails in the
         container poll rather than at the call. */
      const c = await graph(HOST, '/' + conn.platformAccountId + '/media',
        isVideoUrl(only)
          ? { media_type: 'REELS', video_url: only, caption: caption, access_token: conn.token }
          : { image_url: only, caption: caption, access_token: conn.token });
      creationId = c.id;
      await waitForContainer(HOST, creationId, conn.token, waitMs);
    } else {
      /* Children carry no caption of their own -- the parent holds it. Built in
         sequence rather than in parallel: Meta rate-limits container creation
         per IG user, and a burst of ten is the reliable way to hit it. */
      const children: string[] = [];
      for (const url of post.media_urls) {
        /* A video CHILD is media_type VIDEO -- not REELS, which is only for a
           standalone post and is rejected inside a carousel. */
        const child = await graph(HOST, '/' + conn.platformAccountId + '/media',
          isVideoUrl(url)
            ? {
              media_type: 'VIDEO', video_url: url,
              is_carousel_item: 'true', access_token: conn.token,
            }
            : { image_url: url, is_carousel_item: 'true', access_token: conn.token });
        children.push(child.id);
      }
      for (const id of children) await waitForContainer(HOST, id, conn.token, waitMs);

      const parent = await graph(HOST, '/' + conn.platformAccountId + '/media', {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption: caption,
        access_token: conn.token,
      });
      creationId = parent.id;
      await waitForContainer(HOST, creationId, conn.token, waitMs);
      payload.carousel_children = children;
    }

    const published = await graph(HOST, '/' + conn.platformAccountId + '/media_publish', {
      creation_id: creationId,
      access_token: conn.token,
    });

    return {
      ok: true,
      postId: String(published.id),
      provider: 'instagram',
      error: '',
      payload: { ...payload, creation_id: creationId, dispatched: true },
    };
  } catch (err) {
    const detail = err instanceof GraphError ? err.detail : {};
    return {
      ok: false, postId: null, provider: 'instagram',
      error: err instanceof Error ? err.message : 'Unknown Instagram error',
      payload: { ...payload, meta_error: detail },
    };
  }
};

/**
 * Facebook Pages. One photo posts directly; several are uploaded unpublished
 * and then attached to a single feed story, so the agency's page shows one post
 * with a gallery rather than six separate photo posts in a row.
 */
const facebookAdapter: Adapter = async (post, conn) => {
  const payload: Record<string, unknown> = {
    ...buildPayload(post), account: conn.username, page_id: conn.platformAccountId,
  };
  const bad = checkMedia(post, { max: 10, mixed: true, maxVideos: 10, who: 'Facebook' });
  if (bad) return { ok: false, postId: null, provider: 'facebook', error: bad, payload };

  try {
    const caption = post.caption ?? '';
    const videos = post.media_urls.filter(isVideoUrl);
    const photos = post.media_urls.filter((u) => !isVideoUrl(u));

    /* Video lives on a different edge entirely: /videos with file_url, not
       /photos with url. Sending an mp4 to /photos is rejected outright. */
    if (videos.length === 1 && photos.length === 0) {
      const vid = await graph(FB_GRAPH, '/' + conn.platformAccountId + '/videos', {
        file_url: videos[0],
        description: caption,
        access_token: conn.token,
      });
      return {
        ok: true,
        postId: String(vid.post_id ?? vid.id),
        provider: 'facebook',
        error: '',
        payload: { ...payload, video_id: vid.id, dispatched: true },
      };
    }

    /* Facebook has no single call that interleaves video and photos the way
       an Instagram carousel does. With both, the video is the post -- it is
       the thing someone filmed -- and the photographs follow in their own
       attachment. Stated here because it is a real difference in what the
       two platforms will show, not an oversight. */
    if (videos.length >= 1) {
      const vid = await graph(FB_GRAPH, '/' + conn.platformAccountId + '/videos', {
        file_url: videos[0],
        description: caption,
        access_token: conn.token,
      });
      return {
        ok: true,
        postId: String(vid.post_id ?? vid.id),
        provider: 'facebook',
        error: '',
        payload: {
          ...payload, video_id: vid.id, dispatched: true,
          photos_omitted: photos.length,
          note: 'Facebook posted the video; it cannot interleave photos with it in one post.',
        },
      };
    }

    if (post.media_urls.length === 1) {
      const photo = await graph(FB_GRAPH, '/' + conn.platformAccountId + '/photos', {
        url: post.media_urls[0],
        caption: caption,
        access_token: conn.token,
      });
      return {
        ok: true,
        postId: String(photo.post_id ?? photo.id),
        provider: 'facebook',
        error: '',
        payload: { ...payload, photo_id: photo.id, dispatched: true },
      };
    }

    const ids: string[] = [];
    for (const url of post.media_urls) {
      const photo = await graph(FB_GRAPH, '/' + conn.platformAccountId + '/photos', {
        url: url,
        published: 'false',
        access_token: conn.token,
      });
      ids.push(photo.id);
    }

    const attached: Record<string, string> = {};
    ids.forEach((id, i) => {
      attached['attached_media[' + i + ']'] = JSON.stringify({ media_fbid: id });
    });

    const story = await graph(FB_GRAPH, '/' + conn.platformAccountId + '/feed', {
      message: caption,
      ...attached,
      access_token: conn.token,
    });

    return {
      ok: true,
      postId: String(story.id),
      provider: 'facebook',
      error: '',
      payload: { ...payload, photo_ids: ids, dispatched: true },
    };
  } catch (err) {
    const detail = err instanceof GraphError ? err.detail : {};
    return {
      ok: false, postId: null, provider: 'facebook',
      error: err instanceof Error ? err.message : 'Unknown Facebook error',
      payload: { ...payload, meta_error: detail },
    };
  }
};

/* -- trypost ----------------------------------------------------------------
   A trypost instance, used as a DELIVERY ROUTE for the platforms this file has
   no native adapter for -- TikTok, LinkedIn, X and the rest -- and for EVERY
   Synapse-owned channel, whatever its platform.

   IT IS NOT USED FOR AN AGENCY'S INSTAGRAM OR FACEBOOK, deliberately. Those
   adapters already work, and routing them through a third party would hand
   somebody else's codebase a live Meta token for no gain at all.

   WHAT STAYS HERE. The queue, the atomic claim, the retry ladder, dry_run, and
   the short link minted into the caption by queue_social_post are all ours and
   all unchanged. trypost receives a finished caption and posts it. It is the
   last mile, not the pipeline -- which is also what keeps it at arm's length:
   a separate service reached over HTTP, not a library linked into this one.
   trypost is AGPL-3.0 and that distinction is doing real work.

   THE ACCOUNT LIVES IN TRYPOST, NOT HERE. For an agency platform,
   social_accounts.platform_account_id carries trypost's social_account_id; for
   a Synapse channel it is synapse_channels.trypost_account_id. Either way
   there is NO OAuth token on our side, and loadConnections deliberately does
   not ask for one. We cannot leak a token we were never given. */
const TRYPOST_URL = (Deno.env.get('TRYPOST_URL') ?? '').replace(/\/+$/, '');
const TRYPOST_KEY = Deno.env.get('TRYPOST_API_KEY') ?? '';
const trypostConfigured = (): boolean => Boolean(TRYPOST_URL && TRYPOST_KEY);

/* Our social_platform values -> trypost content_type.
   Taken from GET /api/content-types, not guessed. The first version of this
   map WAS guessed, from the <platform>_<kind> pattern, and shipped
   'youtube_video' -- which does not exist. Two of the three inferred values
   happened to be right, which is the problem with inferring: you cannot tell
   which.

   THE CHOICE IS DRIVEN BY WHAT WE ACTUALLY SEND, WHICH IS PHOTOGRAPHS.
   media_urls on a social_post comes from property_media: a listing's pictures.
   Several platforms split their types by medium, so the right value depends on
   the payload, not only on the platform:

     tiktok      tiktok_video | tiktok_photo    -> photo, because we send images
     youtube     youtube_short ONLY             -> no image type exists at all
     linkedin    linkedin_post (a person)
                 linkedin_page_post (a company) -> a page, because an agency
                                                   posts as itself
     x           x_post
     instagram   instagram_feed | _reel | _story    ) native adapters, never
     facebook    facebook_post | _reel | _story     ) routed through trypost

   YOUTUBE IS DELIBERATELY ABSENT. Its only content type is a Shorts video, so
   a listing's photographs can never be a valid YouTube post through trypost.
   Leaving it mapped would have produced a validation failure on every single
   attempt, three times each, before giving up. Absent, it falls through to
   notConfigured() and says plainly that we do not publish there -- which is
   true, and is the honest version of the same outcome.

   IF VIDEO IS EVER QUEUED, tiktok must move back to tiktok_video and youtube
   becomes possible as youtube_short. Nothing here inspects the medium yet
   because nothing upstream produces one. */
const TRYPOST_CONTENT_TYPE: Record<string, string> = {
  tiktok: 'tiktok_photo',
  linkedin: 'linkedin_page_post',
  x: 'x_post',
  /* Instagram and Facebook are here ONLY for the Synapse leg. An agency's
     Instagram is connected through social-connect and publishes natively --
     viaTrypost() refuses them for that reason. But SYNAPSE'S own Instagram
     lives in the trypost workspace like every other channel we own, so a
     synapse-leg post needs a content type for it. Same platform, different
     account, different route. */
  instagram: 'instagram_feed',
  facebook: 'facebook_post',
};

/** True when this platform should go out through trypost ON THE AGENCY LEG:
 *  it is configured, we have no native adapter, and trypost has a content type
 *  for it. The Synapse leg does not ask this -- see adapterFor. */
function viaTrypost(platform: string): boolean {
  if (!trypostConfigured()) return false;
  if (NATIVE_ADAPTERS[platform]) return false;
  return Boolean(TRYPOST_CONTENT_TYPE[platform]);
}

const trypostAdapter: Adapter = async (post, conn) => {
  const contentType = TRYPOST_CONTENT_TYPE[post.platform] ?? '';
  const accountId = conn.platformAccountId ?? '';
  const payload = {
    ...buildPayload(post),
    via: 'trypost',
    leg: post.leg,
    content_type: contentType,
    social_account_id: accountId,
    host: TRYPOST_URL,
  };
  const fail = (error: string) =>
    ({ ok: false, postId: null, provider: 'trypost', error, payload } as PublishResult);

  if (!trypostConfigured()) return fail('trypost is not configured: set TRYPOST_URL and TRYPOST_API_KEY.');
  if (!contentType) return fail('trypost has no content type for ' + post.platform + '.');
  if (!accountId) {
    return fail(post.leg === 'synapse'
      ? 'Synapse has no trypost account id for ' + post.platform
        + '. Add it to synapse_channels.'
      : 'No trypost account is mapped for ' + post.platform
        + '. Connect it inside trypost, then put its social_account_id in '
        + 'social_accounts.platform_account_id for this agency.');
  }

  const headers = {
    Authorization: 'Bearer ' + TRYPOST_KEY,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  /* TWO CALLS, because trypost creates a draft and publishes it separately.
     POST /api/posts returns 201 with a draft; PUT /api/posts/{id} with
     status 'publishing' is what actually sends it. */
  let draftId = '';
  try {
    const res = await fetch(TRYPOST_URL + '/api/posts', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        platforms: [{ social_account_id: accountId, content_type: contentType }],
        content: post.caption ?? '',
        media: post.media_urls.map((url) => ({ url })),
      }),
    });
    const body = await res.json().catch(() => ({}));
    draftId = String((body as Record<string, unknown>)?.id ?? '');
    if (!res.ok || !draftId) {
      return fail('trypost refused the draft (HTTP ' + res.status + '): '
        + JSON.stringify(body).slice(0, 300));
    }
  } catch (e) {
    return fail('trypost unreachable while creating the draft: '
      + (e instanceof Error ? e.message : String(e)));
  }

  try {
    const res = await fetch(TRYPOST_URL + '/api/posts/' + encodeURIComponent(draftId), {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'publishing' }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      /* THE HALF-DONE STATE, NAMED. The draft exists in trypost and did not
         go out. Retrying this row creates a SECOND draft rather than
         resuming this one, so the message says where the first is: somebody
         has to publish it or delete it there. Silently retrying is how an
         agency ends up posting the same listing twice. */
      return fail('trypost created draft ' + draftId + ' but would not publish it (HTTP '
        + res.status + '): ' + body.slice(0, 240)
        + ' -- the draft is still in trypost; publish or delete it there, because a retry '
        + 'here will create another one.');
    }
  } catch (e) {
    return fail('trypost created draft ' + draftId + ' but the publish call failed: '
      + (e instanceof Error ? e.message : String(e))
      + ' -- the draft is still in trypost; a retry here will create another one.');
  }

  return {
    ok: true,
    postId: draftId,
    provider: 'trypost',
    error: '',
    payload: { ...payload, dispatched: true, trypost_post_id: draftId },
  };
};

/* Platforms this file publishes itself, for an AGENCY. Kept separate from the
   lookup below so viaTrypost() has something to ask, and so "native" is stated
   once. */
const NATIVE_ADAPTERS: Record<string, Adapter> = {
  instagram: instagramAdapter,
  facebook: facebookAdapter,
};

const ADAPTERS: Record<string, Adapter> = {
  mock: mockAdapter,
  ...NATIVE_ADAPTERS,
};

/** No connection for this platform. Distinct from "not implemented": the
 *  adapter exists and works, nobody has connected an account to it. */
function notConnected(platform: string): string {
  return 'No ' + platform + ' account is connected to this agency. Connect one in the portal, then publish.';
}

/** A dry run always goes to the mock, whatever the platform -- that is what
 *  makes it a rehearsal.
 *
 *  Order after that: our own adapter, then trypost, then an honest refusal.
 *  Native first is the point -- trypost is the fallback for what we have not
 *  written, never a replacement for what works. */
function adapterFor(post: QueuedPost, live: boolean): Adapter {
  if (post.dry_run || !live) return ADAPTERS.mock;

  /* THE LEG IS ASKED FIRST, because it answers whose account this is and the
     platform only answers what it is called. Every Synapse channel lives in
     the trypost workspace -- including our Instagram, which an agency would
     have published natively. Deciding on the platform alone would have sent a
     synapse-leg Instagram post to the Meta adapter, which would then look for
     an OAuth token in social_accounts that does not and should not exist. */
  if (post.leg === 'synapse') {
    if (!trypostConfigured()) {
      return notConfigured('Synapse ' + post.platform
        + ' (trypost is not configured: set TRYPOST_URL and TRYPOST_API_KEY)');
    }
    if (!TRYPOST_CONTENT_TYPE[post.platform]) {
      return notConfigured('Synapse ' + post.platform + ' (no trypost content type)');
    }
    return trypostAdapter;
  }

  const native = NATIVE_ADAPTERS[post.platform];
  if (native) return native;
  if (viaTrypost(post.platform)) return trypostAdapter;
  return notConfigured(post.platform);
}

/** Stands in for a Connection when the batch is a rehearsal. The mock never
 *  reads it, and no token is fetched for a run that makes no network call. */
const NO_CONNECTION: Connection = {
  accountId: '', platformAccountId: '', username: 'rehearsal', token: '',
  /* Never read -- a rehearsal makes no network call, so no host is chosen.
     Present because Connection requires it, and the standalone flow is the
     right thing for a placeholder to claim to be. */
  authSource: 'instagram_login',
};

/**
 * Synapse's own channels. Loaded ONCE for the whole batch, not once per agency
 * -- they belong to no agency, which is exactly why they cannot live in
 * social_accounts. There is no token: trypost holds every one of these grants,
 * and platformAccountId carries its social_account_id instead.
 */
async function loadSynapseChannels(
  admin: ReturnType<typeof createClient>,
): Promise<Record<string, Connection>> {
  const out: Record<string, Connection> = {};
  const { data } = await admin
    .from('synapse_channels')
    .select('id, platform, trypost_account_id, handle')
    .eq('is_active', true);
  for (const c of (data ?? []) as Array<Record<string, string>>) {
    out[c.platform] = {
      accountId: c.id,
      platformAccountId: c.trypost_account_id,
      username: c.handle ?? 'synapse',
      token: '',
      /* A Synapse channel publishes through trypost, which holds the grant
         and addresses no Graph host of ours. The value is inert here; it is
         set rather than omitted so the shape is one thing everywhere. */
      authSource: 'instagram_login',
    };
  }
  return out;
}

/**
 * Loads the agency's live connections, one per platform, and the token for
 * each. Tokens are read once per batch rather than once per post: a batch of
 * ten Instagram posts is one decrypt, not ten.
 *
 * A platform with no row here is not connected, which is a different failure
 * from a platform we cannot publish to at all -- the caller distinguishes them.
 */
async function loadConnections(
  admin: ReturnType<typeof createClient>,
  agencyId: string,
  platforms: string[],
): Promise<Record<string, Connection>> {
  const out: Record<string, Connection> = {};
  if (!platforms.length) return out;

  const { data: accounts } = await admin
    .from('social_accounts')
    .select('id, platform, platform_account_id, platform_username, auth_source')
    .eq('agency_id', agencyId)
    .in('platform', platforms)
    .eq('is_active', true)
    .is('deleted_at', null);

  for (const a of (accounts ?? []) as Array<Record<string, string>>) {
    /* NO TOKEN IS DECRYPTED FOR A TRYPOST PLATFORM, and there is none to
       decrypt: trypost holds that OAuth grant, not us. The row here exists
       only to say the agency has the account and to carry trypost's
       social_account_id for it. Asking social_account_token for one would
       return nothing and skip the row, which is how these would have looked
       "not connected" forever. */
    let token = '';
    if (!viaTrypost(a.platform)) {
      const { data } = await admin.rpc('social_account_token', { p_account_id: a.id });
      if (!data) continue;  // connected but revoked: treated as not connected
      token = data as unknown as string;
    }
    out[a.platform] = {
      accountId: a.id,
      /* Anything that is not explicitly facebook_login is the standalone
         flow, which is what every row predating the column is. */
      authSource: a.auth_source === 'facebook_login' ? 'facebook_login' : 'instagram_login',
      platformAccountId: a.platform_account_id,
      username: a.platform_username,
      token,
    };
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!serviceKey) return json({ error: 'Server misconfigured: no service role key' }, 500);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    /* SCHEDULED DRAIN.
       "Scheduled" used to be a label on a row and nothing else. This function
       only ever ran for the agency of a signed-in user, so a post scheduled
       for 9am published when a human opened the portal and pressed a button --
       which is not scheduling, it is a reminder. Nothing in cron touched the
       queue, so a row could sit at status='scheduled' indefinitely.

       pg_cron now posts here with the service role key (drain_social_queue,
       migration 0081). That caller has no user and belongs to no agency, so it
       is recognised by its bearer token and drains what is DUE across every
       agency instead.

       This does not widen what can go out. dry_run is stamped on the row at
       queue time, defaults to true, and still decides mock versus real for
       every row individually -- a scheduled drain publishes for real only what
       somebody deliberately queued as real. */
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const scheduled = serviceKey.length > 0 && bearer === serviceKey;

    const admin = createClient(url, serviceKey);
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    /* Who is asking, and for whom. The drain runs as the service role, so
       without this any signed-in account could push another agency's queue
       out in public. Skipped only for the scheduled caller, which proved
       itself with the service role key above. */
    let agencyId: string | null = null;
    if (!scheduled) {
      const { data: userData } = await userClient.auth.getUser();
      const user = userData.user;
      if (!user) return json({ error: 'Not authenticated' }, 401);

      const { data: membership } = await admin
        .from('agency_members')
        .select('agency_id, role')
        .eq('profile_id', user.id)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();

      if (!membership) return json({ error: 'You are not a member of an agency' }, 403);
      if (!['agent', 'agency_admin', 'agency_owner'].includes(membership.role as string)) {
        return json({ error: 'You cannot publish for this agency' }, 403);
      }
      agencyId = membership.agency_id as string;
    }

    const body = (await req.json().catch(() => ({}))) as {
      limit?: number; live?: boolean; action?: string;
    };

    /* WHAT TRYPOST WILL ACTUALLY ACCEPT, read from trypost rather than
       remembered. TRYPOST_CONTENT_TYPE above is a hardcoded map, and its own
       comment records that the first version was inferred from the
       <platform>_<kind> pattern and shipped 'youtube_video', which does not
       exist — two of three guesses happened to be right, which is the problem
       with guessing. A map like that drifts silently: nothing fails until a
       post fails.

       It also carries max_media_count, which is the number that decides how
       many photographs a carousel may hold. The portal caps galleries at ten
       because that is Meta's limit; this is how to check trypost agrees rather
       than assume it. Read-only, and it returns no credential. */
    if (body.action === 'content-types') {
      if (!trypostConfigured()) return json({ error: 'trypost is not configured' }, 400);
      const res = await fetch(TRYPOST_URL + '/api/content-types', {
        headers: { Authorization: 'Bearer ' + TRYPOST_KEY, Accept: 'application/json' },
      }).catch(() => null);
      if (!res || !res.ok) {
        return json({ error: 'trypost content-types failed: ' + (res ? res.status : 'unreachable') }, 502);
      }
      const cat = await res.json().catch(() => null);
      const list: Array<Record<string, unknown>> = Array.isArray(cat)
        ? cat
        : (Array.isArray((cat as { data?: unknown })?.data) ? (cat as { data: Array<Record<string, unknown>> }).data : []);
      /* Only what we use, and only what is safe to echo: the id, the media
         ceiling, and whether our map still points at something real. */
      const ours = new Set(Object.values(TRYPOST_CONTENT_TYPE));
      return json({
        mapped: TRYPOST_CONTENT_TYPE,
        catalogue: list.map((c) => ({
          id: c.id ?? c.content_type ?? c.type ?? null,
          max_media_count: c.max_media_count ?? c.media_max ?? null,
          used_by_us: ours.has(String(c.id ?? c.content_type ?? c.type ?? '')),
        })),
        missing: [...ours].filter((id) =>
          !list.some((c) => String(c.id ?? c.content_type ?? c.type ?? '') === id)),
      });
    }
    const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 50);
    /* A human has to ask for a live run explicitly, because the portal's
       ordinary button is a rehearsal. The scheduler cannot ask, so it always
       runs live and lets each row's own dry_run decide -- otherwise every
       scheduled post would rehearse forever and never go out. */
    const live = scheduled ? true : body.live === true;

    const { data: claimed, error: claimErr } = scheduled
      ? await admin.rpc('claim_social_due_any', { p_limit: limit })
      : await admin.rpc('claim_social_batch', { p_agency_id: agencyId, p_limit: limit });
    if (claimErr) return json({ error: `Could not claim work: ${claimErr.message}` }, 500);

    const rows = (claimed ?? []) as QueuedPost[];
    if (!rows.length) {
      return json({ claimed: 0, mode: scheduled ? 'scheduled' : 'manual',
        published: 0, failed: 0, dryRun: 0, results: [] });
    }

    /* Tokens are fetched once per agency, and only for a live run -- a
       rehearsal decrypts nothing, because it sends nothing.

       Keyed by agency because a scheduled batch spans them. Reading one
       agency's connections and applying them to every row would have posted
       one agency's listing to another agency's Instagram, which is the worst
       thing this file could do. */
    const connByAgency: Record<string, Record<string, Connection>> = {};
    if (live) {
      const wanted = new Map<string, Set<string>>();
      for (const r of rows) {
        if (r.dry_run) continue;
        if (!wanted.has(r.agency_id)) wanted.set(r.agency_id, new Set<string>());
        (wanted.get(r.agency_id) as Set<string>).add(r.platform);
      }
      for (const [aid, plats] of wanted) {
        connByAgency[aid] = await loadConnections(admin, aid, [...plats]);
      }
    }

    /* One read for the whole batch, and only when something in it is ours.
       Synapse's channels are global, so this is not keyed by agency -- but a
       batch of nothing but agency posts should still not read the table. */
    let synapseChannels: Record<string, Connection> = {};
    if (live && rows.some((r) => !r.dry_run && r.leg === 'synapse')) {
      synapseChannels = await loadSynapseChannels(admin);
    }

    let published = 0;
    let failed = 0;
    let dryRun = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const post of rows) {
      const rehearsal = post.dry_run || !live;
      /* Whose account: ours from synapse_channels, or the agency's from
         social_accounts. Reading the agency's connection for a synapse-leg
         post would have published a listing to the AGENCY'S Instagram while
         recording it as Synapse amplification -- the same post twice on one
         account, and the attribution pointing at the wrong leg. */
      const conn = rehearsal
        ? NO_CONNECTION
        : post.leg === 'synapse'
          ? synapseChannels[post.platform]
          : (connByAgency[post.agency_id] ?? {})[post.platform];

      /* No connected account is a different failure from a platform we cannot
         publish to at all, and it is the one the agency can fix themselves. It
         is reported without an attempt, so a missing connection never burns a
         retry or waits out a backoff. viaTrypost and the synapse leg are
         included for the same reason. */
      const needsAccount = post.leg === 'synapse'
        || Boolean(NATIVE_ADAPTERS[post.platform])
        || viaTrypost(post.platform);
      const result: PublishResult = (!rehearsal && !conn && needsAccount)
        ? {
            ok: false, postId: null, provider: post.platform,
            /* A missing Synapse channel is OUR configuration problem, not the
               agency's. Telling them to go and connect an account they do not
               own would be a dead end and would read as their fault. */
            error: post.leg === 'synapse'
              ? 'Synapse has no active ' + post.platform + ' channel. Add it to '
                + 'synapse_channels with its trypost social_account_id.'
              : notConnected(post.platform),
            payload: buildPayload(post),
          }
        : await adapterFor(post, live)(post, conn ?? NO_CONNECTION);
      if (post.dry_run || !live) dryRun++;

      if (result.ok) {
        await admin
          .from('social_posts')
          .update({
            status: 'published',
            platform_post_id: result.postId,
            provider: result.provider,
            payload: result.payload,
            published_at: new Date().toISOString(),
            failure_reason: null,
          })
          .eq('id', post.id);
        published++;
        results.push({
          id: post.id, platform: post.platform, leg: post.leg, status: 'published',
          provider: result.provider, dryRun: post.dry_run, postId: result.postId,
        });
        continue;
      }

      // attempts was incremented by the claim, so this row has had `attempts`
      // tries including the one that just failed.
      const exhausted = post.attempts >= post.max_attempts;
      // Widening backoff: 1 min, then 5, then 25. A provider that is down
      // stays down for a while.
      const delayMinutes = Math.pow(5, Math.max(0, post.attempts - 1));
      const nextAttempt = new Date(Date.now() + delayMinutes * 60_000).toISOString();

      await admin
        .from('social_posts')
        .update(
          exhausted
            ? { status: 'failed', failure_reason: result.error, provider: result.provider, payload: result.payload }
            : { status: 'scheduled', failure_reason: result.error, provider: result.provider,
                payload: result.payload, scheduled_at: nextAttempt },
        )
        .eq('id', post.id);

      failed++;
      results.push({
        id: post.id, platform: post.platform, leg: post.leg,
        status: exhausted ? 'failed' : 'scheduled',
        provider: result.provider, error: result.error,
      });
    }

    return json({
      claimed: rows.length,
      // Named so a cron log can be read at a glance, and so a scheduled run
      // is never mistaken for somebody pressing the button.
      mode: scheduled ? 'scheduled' : 'manual',
      published,
      failed,
      dryRun,
      // Stated plainly so a caller cannot mistake a rehearsal for a send.
      note: dryRun === rows.length
        ? 'Every post in this batch was a rehearsal. No network call was made.'
        : undefined,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`social-publish fatal: ${message}`);
    return json({ error: message }, 500);
  }
});
