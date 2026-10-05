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
  /* Feed rules only. A Story takes exactly one item -- queue_story_twin
     already trimmed the array to one -- and running the ten-item carousel
     rule over it would pass while meaning nothing, which reads as validation
     that is not there. The Story branch checks the one thing that matters to
     it: that there is a frame at all. */
  if (post.post_format !== 'story') {
    const bad = checkMedia(post, { max: 10, mixed: true, maxVideos: 10, who: 'Instagram' });
    if (bad) return { ok: false, postId: null, provider: 'instagram', error: bad, payload };
  }

  /* Transcoding is the slow part, so the wait is set by whether there is any
     video at all rather than by how many. */
  const hasVideo = post.media_urls.some(isVideoUrl);
  const waitMs = hasVideo ? 300000 : 45000;

  try {
    const caption = post.caption ?? '';
    let creationId: string;

    if (post.post_format === 'story') {
      /* A STORY. One media item, no caption -- the STORIES container accepts
         image_url or video_url and nothing else. No link sticker either,
         which is the whole of what Phase 4 was for; see the migration.

         First, before the single/carousel split, because a Story is not a
         shape of feed post. Deciding it after the media count would make a
         one-image Story and a one-image feed post the same branch with an
         extra condition on it, and the next media rule added here would have
         to remember that. */
      const only = post.media_urls[0];
      if (!only) {
        return {
          ok: false, postId: null, provider: 'instagram',
          error: 'A Story needs one photograph or video.', payload,
        };
      }
      const c = await graph(HOST, '/' + conn.platformAccountId + '/media',
        isVideoUrl(only)
          ? { media_type: 'STORIES', video_url: only, access_token: conn.token }
          : { media_type: 'STORIES', image_url: only, access_token: conn.token });
      creationId = c.id;
      await waitForContainer(HOST, creationId, conn.token, waitMs);
      payload.story = true;
    } else if (post.media_urls.length === 1) {
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

/* X GOES OUT ON SYNAPSE'S ACCOUNT, whoever wrote the post. Agencies cannot
   connect an X account -- there is no X connect flow, and X's own API charges
   per post -- so Eden decided on 2026-09-28: "to synapse X". An agency that
   picks X in the composer is published on Synapse's X through trypost, while
   the row stays the agency's: its short link, and so every tap and enquiry it
   brings, is still credited to them. When agencies can connect X, take it out
   of this set. */
const SYNAPSE_ACCOUNT_ONLY = new Set(['x']);
function onSynapseAccount(p: QueuedPost): boolean {
  return p.leg === 'synapse' || (SYNAPSE_ACCOUNT_ONLY.has(p.platform) && !p.city_channel_id);
}

/** True when this platform should go out through trypost ON THE AGENCY LEG:
 *  it is configured, we have no native adapter, and trypost has a content type
 *  for it. The Synapse leg does not ask this -- see adapterFor. */
function viaTrypost(platform: string): boolean {
  if (!trypostConfigured()) return false;
  if (NATIVE_ADAPTERS[platform]) return false;
  return Boolean(TRYPOST_CONTENT_TYPE[platform]);
}

/* ── X: 280 characters, and it means it ────────────────────────────────────
   Found 2026-09-28 by asking trypost what became of every Synapse X post: of
   thirteen, ONE went live -- the 285-character one, which X counts as under
   280 because a link counts as 23 whatever its length. Every longer one
   failed, and trypost reported each as "An unexpected error occurred while
   publishing". Most were Instagram captions copied across, 300 to 1,200
   characters. The generator is asked for under 240 plus the link, but asking
   is not enforcing, so this is where the limit is kept: whatever caption
   reaches X is fitted to it here, with the listing link kept whole.

   X's counting (twitter-text v3): a URL is 23; most Latin, Greek, Cyrillic
   and common punctuation count 1; everything else counts 2 -- emoji, CJK,
   and symbols like the naira sign. Counting every other code point as 2
   overcounts an emoji sequence slightly, which only ever errs short. */
const X_LIMIT = 280;
const X_URL = /https?:\/\/[^\s]+/g;
const X_TAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

function xWeight(text: string): number {
  let n = 0;
  for (const ch of text.replace(X_URL, 'x'.repeat(23))) {
    const cp = ch.codePointAt(0) ?? 0;
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d)
      || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

/** The caption as X will take it: within 280 weighted characters, the listing
 *  link kept (ours first, if there are several), up to two hashtags if they
 *  leave room, and the words cut at a sentence or a word -- never mid-word. A
 *  caption that already fits goes through untouched. */
function fitForX(caption: string): string {
  const text = (caption ?? '').trim();
  if (xWeight(text) <= X_LIMIT) return text;

  const links = text.match(X_URL) ?? [];
  const link = links.find((u) => /synapsecore\.dev\/s\//.test(u)) ?? links[0] ?? '';
  const tags = (text.match(X_TAG) ?? []).map((t) => t.trim()).slice(0, 2);
  let body = text.replace(X_URL, ' ').replace(X_TAG, ' ')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  const tail = (withTags: boolean) =>
    (link ? '\n\n' + link : '') + (withTags && tags.length ? (link ? ' ' : '\n\n') + tags.join(' ') : '');
  // Hashtags only while they leave most of the post for words.
  const withTags = xWeight(tail(true)) <= 80;
  const budget = X_LIMIT - xWeight(tail(withTags));

  if (xWeight(body) > budget) {
    // Longest prefix that fits with an ellipsis, then back to a sentence end
    // if one is reasonably far in, else to the last space.
    let cut = '';
    for (const ch of body) {
      if (xWeight(cut + ch + '…') > budget) break;
      cut += ch;
    }
    const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '),
      cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
    const space = cut.lastIndexOf(' ');
    body = sentence > cut.length * 0.5
      ? cut.slice(0, sentence + 1).trim()
      : (space > 0 ? cut.slice(0, space) : cut).trim().replace(/[,;:\-–—]+$/, '') + '…';
  }
  return (body + tail(withTags)).trim();
}

const trypostAdapter: Adapter = async (post, conn) => {
  const contentType = TRYPOST_CONTENT_TYPE[post.platform] ?? '';
  const accountId = conn.platformAccountId ?? '';
  const payload = {
    ...buildPayload(post),
    via: 'trypost',
    leg: post.leg,
    /* Whose account it went out on. Differs from leg for an agency's X post,
       which is published on Synapse's X (SYNAPSE_ACCOUNT_ONLY). */
    account: onSynapseAccount(post) ? 'synapse' : 'agency',
    content_type: contentType,
    social_account_id: accountId,
    host: TRYPOST_URL,
  };
  const fail = (error: string) =>
    ({ ok: false, postId: null, provider: 'trypost', error, payload } as PublishResult);
  const isX = post.platform === 'x';
  if (isX) {
    const sent = fitForX(post.caption ?? '');
    Object.assign(payload, { x_fitted: sent !== (post.caption ?? '').trim(), x_weight: xWeight(sent) });
  }

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
        content: isX ? fitForX(post.caption ?? '') : (post.caption ?? ''),
        // X takes four images to a post.
        media: (isX ? post.media_urls.slice(0, 4) : post.media_urls).map((url) => ({ url })),
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

  /* ACCEPTED, NOT LIVE. trypost publishes from its own queue after this, and
     has taken hours on Instagram. delivery 'pending' is what the pipeline
     shows until post-metrics' delivery check hears from trypost that it went
     live (or failed). */
  return {
    ok: true,
    postId: draftId,
    provider: 'trypost',
    error: '',
    payload: { ...payload, dispatched: true, trypost_post_id: draftId,
               delivery: 'pending', sent_at: new Date().toISOString() },
  };
};

/* Platforms this file publishes itself, for an AGENCY. Kept separate from the
   lookup below so viaTrypost() has something to ask, and so "native" is stated
   once. */
/* ── Telegram ────────────────────────────────────────────────────────────
   The one channel where getting somebody from a post to a listing needs no
   workaround. A message carries a real inline button: one tap, no "See more"
   fold to fall below, no Page action button outranking it, and captions that
   linkify. Everything docs/SOCIAL_TO_PLATFORM_ROUTING.md exists to route
   around simply is not here.

   The credential is OUR bot token, one for every agency, stored per account
   by connect_telegram_channel so the publisher reads it exactly as it reads
   every other token. The account id is the numeric chat id, never the
   @username -- a channel can be renamed and its username reassigned. */
const TG_API = 'https://api.telegram.org';
/* Telegram rejects a media caption over 1024 characters outright rather than
   trimming it, so the cut happens here. On a word boundary: a caption ending
   mid-word reads as a bug in the listing, not a limit in the platform. */
const TG_CAPTION_MAX = 1024;

function tgCaption(text: string): string {
  const t = (text ?? '').trim();
  if (t.length <= TG_CAPTION_MAX) return t;
  const cut = t.slice(0, TG_CAPTION_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > TG_CAPTION_MAX - 200 ? cut.slice(0, lastSpace) : cut).trimEnd() + '\u2026';
}

/* THE LINK COMES OUT OF THE CAPTION, rather than being passed in alongside
   it. caption_with_link has already put it there, and reading it back means
   the button and the caption can never disagree -- which they eventually
   would if the adapter were handed the URL by a second route. */
function tgLink(caption: string): string | null {
  const m = (caption ?? '').match(/https?:\/\/[^\s]+\/s\/[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}

const telegramAdapter: Adapter = async (post, conn) => {
  const payload: Record<string, unknown> = {
    ...buildPayload(post), account: conn.username, chat_id: conn.platformAccountId,
  };
  const bad = checkMedia(post, { max: 10, mixed: true, maxVideos: 10, who: 'Telegram' });
  if (bad) return { ok: false, postId: null, provider: 'telegram', error: bad, payload };

  const base = `${TG_API}/bot${conn.token}`;
  const caption = tgCaption(post.caption ?? '');
  const link = tgLink(post.caption ?? '');

  const call = async (method: string, body: Record<string, unknown>) => {
    const r = await fetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({ ok: false, description: 'unreadable reply' }));
    if (!j?.ok) {
      /* Telegram's description is the useful half and is written for a
         person: "chat not found", "not enough rights to send photos". Carried
         through rather than replaced with a status code. */
      throw new Error(j?.description ?? ('Telegram refused ' + method));
    }
    return j.result;
  };

  try {
    const media = post.media_urls ?? [];
    let result: Record<string, unknown>;

    if (media.length === 0) {
      /* No photograph. Telegram is the only platform here that will take a
         listing as text, and a text post with a button is still a route to
         the listing -- better than refusing to post at all. */
      result = await call('sendMessage', {
        chat_id: conn.platformAccountId,
        text: caption,
        ...(link ? { reply_markup: { inline_keyboard: [[{ text: 'View this home', url: link }]] } } : {}),
      });
    } else if (media.length === 1) {
      const only = media[0];
      /* THE BUTTON, which is the whole point and is only available on a
         single item -- Telegram refuses reply_markup on a media group. */
      result = await call(isVideoUrl(only) ? 'sendVideo' : 'sendPhoto', {
        chat_id: conn.platformAccountId,
        [isVideoUrl(only) ? 'video' : 'photo']: only,
        caption,
        ...(link ? { reply_markup: { inline_keyboard: [[{ text: 'View this home', url: link }]] } } : {}),
      });
    } else {
      /* An album. No button available, so the caption carries the link --
         which Telegram linkifies, so it is still one tap. The caption goes on
         the FIRST item only: repeated on every item it renders once and
         counts against the limit ten times. */
      const group = media.slice(0, 10).map((url, i) => ({
        type: isVideoUrl(url) ? 'video' : 'photo',
        media: url,
        ...(i === 0 ? { caption } : {}),
      }));
      const sent = await call('sendMediaGroup', {
        chat_id: conn.platformAccountId,
        media: group,
      });
      /* An album returns an array of messages. The first is the one the
         caption and any reply belong to, and the one a metrics read would
         ask about. */
      result = Array.isArray(sent) ? sent[0] : sent;
      payload.album = group.length;
    }

    const messageId = result?.message_id;
    return {
      ok: true,
      postId: messageId != null ? String(messageId) : null,
      provider: 'telegram',
      error: '',
      payload: { ...payload, had_button: Boolean(link) && media.length <= 1 },
    };
  } catch (err) {
    return {
      ok: false, postId: null, provider: 'telegram',
      error: err instanceof Error ? err.message : String(err),
      payload,
    };
  }
};

/* ── TikTok: photos, sent to the agent's inbox ─────────────────────────────
   Content Posting API, photo mode, post_mode MEDIA_UPLOAD: TikTok puts the
   post in the agent's TikTok inbox and they finish it in the app -- adding a
   sound, which decides most of a TikTok's reach and which the API cannot
   choose well. So "published" here means DELIVERED TO THE INBOX, and the
   payload says so.

   TikTok pulls the photos itself (PULL_FROM_URL is the only source for
   photos) and only from a domain we have verified with it -- which the
   storage host is not. So every photo is addressed through
   www.synapsecore.dev/m/, a Vercel rewrite (a proxy, not a redirect: TikTok
   refuses 3xx) onto Supabase's image renderer, which also fits it inside
   TikTok's 1080 limit. A photo from anywhere else cannot be sent and is left
   out rather than failing the post. */
const TT_API = 'https://open.tiktokapis.com';
const TT_MEDIA_BASE = 'https://www.synapsecore.dev/m/';

function tiktokPhotoUrl(u: string): string | null {
  const store = (Deno.env.get('SUPABASE_URL') ?? '') + '/storage/v1/object/public/';
  if (!u || !u.startsWith(store) || isVideoUrl(u)) return null;
  return TT_MEDIA_BASE + u.slice(store.length);
}

/* ── the Telegram Story kit ──────────────────────────────────────────────
   Telegram does not let a bot post a channel Story -- postStory exists only
   for Business accounts (Bot API reference, checked 2026-09-27). A channel
   Story has to be posted by a person, from the app. So the bot does the part
   it can: the moment a listing goes out on a channel, it messages whoever
   runs that channel a photo ready for the Story, the listing's link on a
   one-tap Copy button (for Telegram's Link sticker, which makes the Story
   tappable), a suggested line of text, and a button into the channel. About
   twenty seconds of their time instead of none at all.

   Who gets it: for a Synapse city channel, the founder chat
   (platform_settings.founder_telegram_chat_id); for an agency's own channel,
   the member who connected it, through their linked Telegram account. Nobody
   linked, nothing sent. */
async function sendStoryKit(admin: ReturnType<typeof createClient>, post: QueuedPost): Promise<void> {
  const token = (Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '').trim();
  if (!token) return;
  const photo = (post.media_urls ?? []).find((u) => u && !isVideoUrl(u));
  const link = tgLink(post.caption ?? '');
  if (!photo || !link) return;

  let chatId = '';
  let channel = '';
  if (post.city_channel_id) {
    const { data: cc } = await admin.from('city_channels')
      .select('handle, title').eq('id', post.city_channel_id).maybeSingle();
    const { data: fs } = await admin.from('platform_settings')
      .select('value').eq('key', 'founder_telegram_chat_id').maybeSingle();
    chatId = String((fs?.value as Record<string, unknown> | null)?.id ?? '').trim();
    channel = String(cc?.handle || cc?.title || 'the channel');
  } else {
    let q = admin.from('social_accounts')
      .select('platform_username, connected_by')
      .eq('agency_id', post.agency_id).eq('platform', 'telegram')
      .eq('is_active', true).is('deleted_at', null)
      .order('connected_at', { ascending: true }).limit(1);
    if (post.social_account_id) q = q.eq('id', post.social_account_id);
    const { data: accs } = await q;
    const acc = (accs ?? [])[0] as { platform_username?: string; connected_by?: string } | undefined;
    if (!acc?.connected_by) return;
    const { data: tl } = await admin.from('telegram_links')
      .select('telegram_user_id').eq('profile_id', acc.connected_by).maybeSingle();
    chatId = tl?.telegram_user_id ? String(tl.telegram_user_id) : '';
    channel = String(acc.platform_username || 'your channel');
  }
  if (!chatId) return;

  /* The first line of the caption that is not the link: the listing, as the
     post itself opened. */
  const line = (post.caption ?? '').split('\n').map((l) => l.trim())
    .find((l) => l && !/^https?:\/\//i.test(l)) ?? '';
  const suggested = line.replace(/^\p{Extended_Pictographic}\s*/u, '').slice(0, 90);
  const handle = channel.startsWith('@') ? channel.slice(1) : '';

  const text = '\u{1F4F2} Story for ' + channel + '\n\n'
    + 'Telegram does not let bots post Stories, so here is one ready for you:\n'
    + '1. Save this photo.\n'
    + '2. Open ' + channel + ', tap its photo at the top, then “Add story”, and choose it.\n'
    + '3. Add a Link sticker and paste the listing link (tap “Copy link” below), so viewers can tap through.\n'
    + (suggested ? '4. Suggested text: ' + suggested + '\n' : '')
    + '\nStories on a channel unlock once it has enough boosts — Telegram’s rule, not ours.';

  const rows: Array<Array<Record<string, unknown>>> = [
    [{ text: 'Copy link', copy_text: { text: link.slice(0, 256) } }],
  ];
  if (handle) rows.push([{ text: 'Open ' + channel, url: 'https://t.me/' + encodeURIComponent(handle) }]);

  const r = await fetch(`${TG_API}/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, photo, caption: text.slice(0, 1024),
      reply_markup: { inline_keyboard: rows },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j?.ok) console.error('social-publish: story kit not delivered for ' + post.id + ': ' + (j?.description ?? r.status));
  else console.log('social-publish: story kit sent for ' + post.id);
}

/* TikTok's fail_reason codes, in words an agent can act on. Unknown codes
   are passed through as they are rather than guessed at. */
function tiktokFailReason(code: string): string {
  const c = code.toLowerCase();
  if (c.includes('pull_failed')) {
    return 'TikTok could not download the photos from synapsecore.dev. In the TikTok developer app, '
      + 'check URL properties: synapsecore.dev must show as verified (for the sandbox too). (' + code + ')';
  }
  if (c.includes('picture_size')) return 'TikTok would not take a photo’s size. (' + code + ')';
  if (c.includes('file_format')) return 'TikTok would not take a photo’s format. (' + code + ')';
  if (c.includes('spam_risk')) return 'TikTok’s limit is reached: at most 5 unfinished drafts in 24 hours. Finish or delete some in TikTok. (' + code + ')';
  if (c.includes('auth_removed')) return 'This TikTok account removed Synapse’s access. Reconnect it. (' + code + ')';
  if (c.includes('private') || c.includes('unaudited')) {
    return 'Until TikTok approves the app, it can only send to a private TikTok account. Set the account to private and try again. (' + code + ')';
  }
  return 'TikTok refused the post: ' + (code || 'no reason given') + '.';
}

const tiktokAdapter: Adapter = async (post, conn) => {
  const payload: Record<string, unknown> = {
    ...buildPayload(post), account: conn.username, mode: 'MEDIA_UPLOAD',
  };
  const photos = (post.media_urls ?? [])
    .map(tiktokPhotoUrl).filter((u): u is string => Boolean(u)).slice(0, 35);
  if (!photos.length) {
    return {
      ok: false, postId: null, provider: 'tiktok', payload,
      error: 'No photo TikTok can take: it only pulls photos stored on Synapse. '
        + '(Sending videos to TikTok is not built yet.)',
    };
  }
  const caption = (post.caption ?? '').trim();
  const title = (caption.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 90);
  try {
    const res = await fetch(TT_API + '/v2/post/publish/content/init/', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + conn.token, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        post_info: { title, description: caption.slice(0, 4000) },
        source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: photos },
        post_mode: 'MEDIA_UPLOAD',
        media_type: 'PHOTO',
      }),
    });
    const j = await res.json().catch(() => ({}));
    const code = j && j.error ? String(j.error.code ?? '') : '';
    if (!res.ok || code !== 'ok') {
      /* TikTok's message is written for a person ("url ownership
         unverified", "spam risk: too many pending uploads") and is the
         useful half, so it is carried through. */
      return {
        ok: false, postId: null, provider: 'tiktok', payload,
        error: 'TikTok refused: ' + ((j && j.error && (j.error.message || j.error.code)) || ('HTTP ' + res.status)),
      };
    }
    const publishId = j.data && j.data.publish_id ? String(j.data.publish_id) : null;

    /* ACCEPTED IS NOT DELIVERED. init only says TikTok took the request;
       it then pulls the photos itself and can still refuse -- a photo it
       could not download, a size it would not take, an account an unaudited
       app may not post to. The first live test was reported "sent" and
       nothing reached the inbox, with no way left to ask why. So the
       outcome is asked for, briefly, and recorded in TikTok's own terms. */
    let st: Record<string, unknown> = {};
    for (let i = 0; publishId && i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const sr = await fetch(TT_API + '/v2/post/publish/status/fetch/', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + conn.token, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ publish_id: publishId }),
      }).catch(() => null);
      const sj = sr ? await sr.json().catch(() => ({})) : {};
      st = (sj && sj.data) || {};
      if (st.status && !String(st.status).startsWith('PROCESSING')) break;
    }
    const status = String(st.status ?? '');
    if (status === 'FAILED') {
      return {
        ok: false, postId: publishId, provider: 'tiktok',
        payload: { ...payload, publish_id: publishId, tiktok_status: status, fail_reason: st.fail_reason ?? null },
        error: tiktokFailReason(String(st.fail_reason ?? '')),
      };
    }
    const inInbox = status === 'SEND_TO_USER_INBOX' || status === 'PUBLISH_COMPLETE';
    return {
      ok: true, postId: publishId, provider: 'tiktok', error: '',
      payload: { ...payload, photos: photos.length, publish_id: publishId, tiktok_status: status || 'unknown',
                 delivered: 'inbox',
                 note: inInbox
                   ? 'In the TikTok inbox: open TikTok, tap the notification in Inbox, add a sound and post.'
                   : 'TikTok is still fetching the photos; the draft reaches the TikTok inbox when it finishes.' },
    };
  } catch (err) {
    return { ok: false, postId: null, provider: 'tiktok', payload,
             error: err instanceof Error ? err.message : String(err) };
  }
};

/* TikTok's access token lives a day. Renewed here, just before a post needs
   it, and written back so the stored credential stays the working one. A
   renewal that fails leaves the account unusable for this batch, which is
   reported as not connected -- the fix is the same, reconnect. */
async function refreshTikTok(
  admin: ReturnType<typeof createClient>,
  accountId: string,
): Promise<string | null> {
  const key = (Deno.env.get('TIKTOK_CLIENT_KEY') ?? '').trim();
  const secret = (Deno.env.get('TIKTOK_CLIENT_SECRET') ?? '').trim();
  if (!key || !secret) return null;
  const { data: rt } = await admin.rpc('social_account_refresh_token', { p_account_id: accountId });
  if (!rt) return null;
  const r = await fetch(TT_API + '/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: key, client_secret: secret, grant_type: 'refresh_token', refresh_token: String(rt),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    console.error('social-publish: tiktok refresh failed for ' + accountId + ': '
      + (j.error ?? r.status) + ' ' + (j.error_description ?? ''));
    return null;
  }
  const { error } = await admin.rpc('update_social_account_tokens', {
    p_account_id: accountId,
    p_access_token: j.access_token,
    p_refresh_token: j.refresh_token ?? null,
    p_expires_at: new Date(Date.now() + (Number(j.expires_in) || 86400) * 1000).toISOString(),
  });
  if (error) console.error('social-publish: tiktok token not saved for ' + accountId + ': ' + error.message);
  return String(j.access_token);
}

/* INSTAGRAM LOGIN TOKENS LAST SIXTY DAYS (Greptile audit). Nothing renewed
   them, so on day sixty every scheduled post for that account failed until
   somebody reconnected, with the account still shown as connected. Instagram
   renews a long-lived token that is at least a day old and not yet expired,
   for another sixty days, with one GET. Renewed here, ten days ahead of the
   end, and written back. A renewal that fails is not fatal: the current token
   still works until it ends, and the next run tries again. Facebook-login
   tokens do not expire this way and are left alone. */
async function refreshInstagram(
  admin: ReturnType<typeof createClient>,
  accountId: string,
  token: string,
): Promise<string> {
  try {
    const r = await fetch('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token='
      + encodeURIComponent(token));
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      console.error('social-publish: instagram refresh failed for ' + accountId + ': '
        + JSON.stringify(j.error ?? r.status).slice(0, 200));
      return token;
    }
    const { error } = await admin.rpc('update_social_account_tokens', {
      p_account_id: accountId,
      p_access_token: j.access_token,
      p_refresh_token: null,
      p_expires_at: new Date(Date.now() + (Number(j.expires_in) || 5184000) * 1000).toISOString(),
    });
    if (error) { console.error('social-publish: instagram token not saved for ' + accountId + ': ' + error.message); return token; }
    return String(j.access_token);
  } catch (e) {
    console.error('social-publish: instagram refresh error for ' + accountId, e);
    return token;
  }
}

const NATIVE_ADAPTERS: Record<string, Adapter> = {
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  telegram: telegramAdapter,
  tiktok: tiktokAdapter,
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
     an OAuth token in social_accounts that does not and should not exist.
     onSynapseAccount also brings an agency's X post here: see
     SYNAPSE_ACCOUNT_ONLY. */
  if (onSynapseAccount(post)) {
    /* Synapse on Telegram is our own bot, not trypost: a city channel is a
       chat the bot administers, and the adapter posts there directly. */
    if (post.platform === 'telegram') return telegramAdapter;
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
 * Synapse's city channels named by this batch (feed_city_channels). A Telegram
 * one is a chat our bot administers, so its token is the bot's own; any other
 * platform publishes through trypost like the rest of our channels.
 */
async function loadCityChannels(
  admin: ReturnType<typeof createClient>,
  ids: string[],
): Promise<Record<string, Connection>> {
  const out: Record<string, Connection> = {};
  if (!ids.length) return out;
  const { data } = await admin
    .from('city_channels')
    .select('id, platform, chat_id, trypost_account_id, handle')
    .in('id', ids)
    .eq('is_active', true);
  const botToken = (Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '').trim();
  for (const c of (data ?? []) as Array<Record<string, string>>) {
    const tg = c.platform === 'telegram';
    const target = tg ? c.chat_id : c.trypost_account_id;
    if (!target || (tg && !botToken)) continue;   // not reachable: reported as not active
    out[c.id] = {
      accountId: c.id,
      platformAccountId: target,
      username: c.handle ?? 'synapse',
      token: tg ? botToken : '',
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
    .select('id, platform, platform_account_id, platform_username, auth_source, token_expires_at')
    .eq('agency_id', agencyId)
    .in('platform', platforms)
    .eq('is_active', true)
    .is('deleted_at', null)
    /* OLDEST FIRST, and the order is load-bearing rather than tidy. The first
       account for a platform becomes the default for posts that name none,
       and unordered that default would change between runs. Oldest is the
       agency's original account -- where every post queued before there was
       anything to choose was already going. */
    .order('connected_at', { ascending: true });

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
      /* A TikTok token within fifteen minutes of its 24-hour end is renewed
         now, not discovered dead at TikTok. */
      if (a.platform === 'tiktok') {
        const exp = a.token_expires_at ? Date.parse(a.token_expires_at) : 0;
        if (!exp || exp - Date.now() < 15 * 60 * 1000) {
          const fresh = await refreshTikTok(admin, a.id);
          if (!fresh) continue;
          token = fresh;
        }
      }
      if (a.platform === 'instagram' && a.auth_source !== 'facebook_login' && a.token_expires_at) {
        const expIg = Date.parse(a.token_expires_at);
        if (expIg && expIg - Date.now() < 10 * 24 * 3600 * 1000 && expIg > Date.now()) {
          token = await refreshInstagram(admin, a.id, token);
        }
      }
    }
    const conn: Connection = {
      accountId: a.id,
      /* Anything that is not explicitly facebook_login is the standalone
         flow, which is what every row predating the column is. */
      authSource: a.auth_source === 'facebook_login' ? 'facebook_login' : 'instagram_login',
      platformAccountId: a.platform_account_id,
      username: a.platform_username,
      token,
    };
    /* TWO KEYS, ONE MAP. Under its own id, so a post that named this account
       gets exactly it; and under the platform name if nothing has claimed
       that yet, so a post that named none gets the agency's first account.
       uuids and platform names cannot collide. */
    out[a.id] = conn;
    if (!(a.platform in out)) out[a.platform] = conn;
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
    if (live && rows.some((r) => !r.dry_run && onSynapseAccount(r) && !r.city_channel_id)) {
      synapseChannels = await loadSynapseChannels(admin);
    }
    let cityChannels: Record<string, Connection> = {};
    const cityIds = [...new Set(rows
      .filter((r) => live && !r.dry_run && r.city_channel_id)
      .map((r) => r.city_channel_id as string))];
    if (cityIds.length) cityChannels = await loadCityChannels(admin, cityIds);

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
      /* THE ACCOUNT THE POST NAMED, falling back to the platform's default.
         An agency with one account behaves exactly as before, because the
         single account is also the platform default.

         A named account that is no longer connected resolves to undefined and
         drops into the no-connection branch below -- deliberately. Quietly
         publishing to a DIFFERENT account because the chosen one was
         disconnected is the one outcome nobody asked for. */
      const conn = rehearsal
        ? NO_CONNECTION
        : onSynapseAccount(post)
          ? (post.city_channel_id ? cityChannels[post.city_channel_id] : synapseChannels[post.platform])
          : (connByAgency[post.agency_id] ?? {})[post.social_account_id || post.platform];

      /* No connected account is a different failure from a platform we cannot
         publish to at all, and it is the one the agency can fix themselves. It
         is reported without an attempt, so a missing connection never burns a
         retry or waits out a backoff. viaTrypost and the synapse leg are
         included for the same reason. */
      const needsAccount = onSynapseAccount(post)
        || Boolean(NATIVE_ADAPTERS[post.platform])
        || viaTrypost(post.platform);
      const result: PublishResult = (!rehearsal && !conn && needsAccount)
        ? {
            ok: false, postId: null, provider: post.platform,
            /* A missing Synapse channel is OUR configuration problem, not the
               agency's. Telling them to go and connect an account they do not
               own would be a dead end and would read as their fault. */
            error: onSynapseAccount(post)
              ? (post.city_channel_id
                  ? 'This Synapse city channel is not active: the bot is not a posting '
                    + 'admin of it, or it has no chat id yet (city_channels).'
                  : 'Synapse has no active ' + post.platform + ' channel. Add it to '
                    + 'synapse_channels with its trypost social_account_id.')
              : notConnected(post.platform),
            payload: buildPayload(post),
          }
        : await adapterFor(post, live)(post, conn ?? NO_CONNECTION);
      if (post.dry_run || !live) dryRun++;

      if (result.ok) {
        /* The provider has the post. Saving that is what stops it being sent
           again, so it is retried, and a save that still fails is reported
           rather than counted as a clean publish (Greptile). */
        const donePatch = {
          status: 'published',
          platform_post_id: result.postId,
          provider: result.provider,
          payload: result.payload,
          published_at: new Date().toISOString(),
          failure_reason: null,
        };
        let saveErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const { error } = await admin.from('social_posts').update(donePatch).eq('id', post.id);
          saveErr = error;
          if (!error) break;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
        if (saveErr) {
          console.error('social-publish: provider accepted ' + post.id + ' but the save failed', saveErr);
          results.push({ id: post.id, platform: post.platform, leg: post.leg, status: 'published_unsaved',
            provider: result.provider, dryRun: post.dry_run, postId: result.postId });
          continue;
        }
        published++;
        /* A Telegram post gets its Story kit: see sendStoryKit. Never allowed
           to fail the post it follows -- the post is already out. */
        if (!rehearsal && post.platform === 'telegram') {
          await sendStoryKit(admin, post)
            .catch((e) => console.error('social-publish: story kit failed for ' + post.id, e));
        }
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
