/**
 * social-generate — AI caption generation for Synapse social syndication.
 *
 * Given a verified listing + the channels an agency wants to post to, Claude
 * writes a caption for each (Instagram, TikTok, YouTube, Facebook, WhatsApp
 * Status), plus hashtags and a recommended lead channel.
 *
 * WHY THIS WAS REWRITTEN: IT PARAPHRASED ITSELF.
 * The previous prompt distinguished the platforms by VOICE only -- "aspirational
 * + lifestyle", "punchy, trend-aware", "informative + trust-forward" -- and then
 * asked for every channel in one completion. Both halves of that push the same
 * way: told to describe one property five times in five tones, the sensible
 * thing to do is write it once and re-voice it. So an agency got the same
 * sentence in five outfits, and pressing Generate again produced a sixth
 * rewording of it, because nothing here knew what had already been written.
 *
 * Tone was never the missing axis. SUBJECT was. A caption about the commute and
 * a caption about the price are different posts; a caption about the price in a
 * TikTok voice and the same in a Facebook voice are one post, twice.
 *
 * So the angle -- what the caption is ABOUT -- is now the primary axis, it is
 * assigned HERE rather than left to the model, and angles already spent on this
 * property are excluded so regenerating moves on instead of going around again.
 *
 * WHY ASSIGNMENT IS CODE AND NOT A PROMPT RULE
 * "Give each channel a different angle" is exactly the kind of soft constraint a
 * model satisfies approximately -- two of five come back near-identical and
 * nothing catches it. Dealing the angles out in code makes variety a property of
 * the request rather than a hope about the response, and it is what lets the
 * caller persist which angles are spent and get real rotation across sessions.
 *
 * POST { property: {title, price, city, bedrooms, listingType, propertyType,
 *        trustScore, area?, angle?}, channels?: string[],
 *        brand?: {name?, tagline?, voice?, handle?},
 *        usedAngles?: string[] }
 *   -> { captions: {...}, angles: {channel: angleId}, hashtags: string[],
 *        recommendedChannel: string, note: string, anglesUsed: string[] }
 *
 * Deployed with verify_jwt = false so the static prototype can call it.
 * Env: ANTHROPIC_API_KEY.
 */
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-opus-5';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const CHANNELS = ['instagram', 'tiktok', 'youtube', 'facebook', 'whatsapp'] as const;
type Channel = typeof CHANNELS[number];

/* ── THE ANGLES ────────────────────────────────────────────────────────────
   Six different things a caption can BE ABOUT. Not six tones -- six subjects,
   each opening on a different fact, so two captions built from two of these
   cannot be rewordings of one another even when written in the same voice.

   Each carries an `opens` line, because "write about the location" still
   permits a generic caption. Naming the first beat is what makes the outputs
   structurally different rather than thematically adjacent. */
const ANGLES: Record<string, { label: string; brief: string }> = {
  space: {
    label: 'the space itself',
    brief: 'The rooms, the layout, the light, the finish. Opens on something '
      + 'you would notice standing inside it. No mention of price.',
  },
  location: {
    label: 'where it is',
    brief: 'The street and what surrounds it -- what is walkable, what the '
      + 'commute looks like, what the area is like to live in. Opens on the '
      + 'neighbourhood, not the building.',
  },
  value: {
    label: 'the money',
    brief: 'What this costs and what that buys here. Opens on the number. '
      + 'Only the figures given -- never invent a comparison or a market average.',
  },
  trust: {
    label: 'what has been checked',
    brief: 'Verification: which checks passed and what that rules out for a '
      + 'buyer. Opens on the checking, not the home. This is the angle that '
      + 'separates Synapse from a listings board, so it should sound like '
      + 'relief, not like a badge.',
  },
  fit: {
    label: 'who it is for',
    brief: 'One specific person this suits -- an NYSC corper, a couple with a '
      + 'first baby, someone buying to let -- and why it fits them in '
      + 'particular. Opens by naming that person.',
  },
  moment: {
    label: 'why now',
    brief: 'Timing: newly listed, just re-confirmed, how quickly this kind of '
      + 'place goes in this area. Opens on the clock. Never manufacture '
      + 'scarcity that the data does not support.',
  },
};

/* Which angles suit which platform, best first. Preference, not restriction:
   the dealer below falls back to whatever is left, because a guaranteed
   different angle beats a perfectly matched duplicate. */
const AFFINITY: Record<Channel, string[]> = {
  instagram: ['space', 'fit', 'moment', 'location', 'value', 'trust'],
  tiktok: ['moment', 'fit', 'space', 'location', 'trust', 'value'],
  youtube: ['space', 'location', 'value', 'trust', 'fit', 'moment'],
  facebook: ['trust', 'value', 'location', 'fit', 'space', 'moment'],
  whatsapp: ['moment', 'value', 'trust', 'fit', 'space', 'location'],
};

/**
 * Deal one distinct angle to each channel, skipping angles this property has
 * already spent.
 *
 * The reset matters: with six angles, a property that has had a few rounds of
 * generation would eventually have every angle "used", and a strict exclusion
 * would then return nothing at all. When the remaining pool cannot cover the
 * request, the history is dropped and the rotation starts again -- coming back
 * round to an angle after five others is variety, not repetition.
 */
function dealAngles(channels: Channel[], used: string[]): Record<string, string> {
  const all = Object.keys(ANGLES);
  const spent = new Set(used.filter((a) => all.includes(a)));
  let pool = all.filter((a) => !spent.has(a));
  if (pool.length < channels.length) pool = all.slice();   // full rotation done

  const taken = new Set<string>();
  const out: Record<string, string> = {};
  for (const ch of channels) {
    const pick = (AFFINITY[ch] ?? all).find((a) => pool.includes(a) && !taken.has(a))
      ?? pool.find((a) => !taken.has(a))
      ?? all.find((a) => !taken.has(a))
      ?? all[0];
    taken.add(pick);
    out[ch] = pick;
  }
  return out;
}

const VOICE: Record<Channel, string> = {
  instagram: 'aspirational, editorial, warm. 1-2 short lines, a line break, then a soft CTA. 2-4 tasteful emojis.',
  tiktok: 'punchy, spoken-word energy, young Lagos voice. A strong hook in the first line. Emojis fine.',
  youtube: 'a video description under a walkthrough. The hook first (it is what shows before "more"), then 2-3 sentences of real detail, then a clear next step. Minimal emoji.',
  facebook: 'plain, informative, decision-maker tone -- an older, higher-intent reader. Slightly longer. Minimal emoji.',
  whatsapp: 'a WhatsApp Status blurb. Very short, personal, immediate. One emoji at most.',
};

function buildSystem(assigned: Record<string, string>, brandLine: string): string {
  const perChannel = Object.entries(assigned).map(([ch, angle]) => {
    const a = ANGLES[angle];
    return `- ${ch} -- ANGLE: ${a.label} (${angle})\n    ${a.brief}\n    Voice: ${VOICE[ch as Channel]}`;
  }).join('\n');

  return `You are the social copywriter for Synapse, a verified Nigerian real-estate platform.

You are writing about ONE property. Each channel below has been assigned a
DIFFERENT ANGLE -- a different thing to be about. Write each caption to its own
angle and nothing else.

${perChannel}

THE ONE RULE THAT MATTERS MOST:
These captions must not be rewordings of each other. Two of them should read
like posts about different aspects of the same home, written on different days
-- not one post in different outfits. Each opens on a different FACT, per its
angle's brief. If you notice yourself rephrasing a line you have already
written for another channel, you have the wrong subject: go back to that
channel's angle and start from the fact it names.

Do not mention an angle that was not assigned to that channel. If the property
data does not support an angle, say less rather than inventing something -- a
short honest caption beats a padded one.
${brandLine}
RULES:
- These are REAL verified listings. Never invent facts, amenities, numbers,
  distances, landmarks or comparisons that are not in the data given.
- Naira prices exactly as given.
- Always end with a clear next step ("DM to book a viewing", "Tap the link", "Save this").
- No hashtags inside the caption body -- return them separately.
- Nigerian English, Lagos market savvy. Avoid cliches like "dream home come true".

Write a caption for exactly these channels: ${Object.keys(assigned).join(', ')}.
Also return hashtags (separately, none inside a caption), the one channel you
would lead with for THIS listing, and a one-sentence note saying why.

The response shape is enforced by the API -- do not describe it, do not wrap it
in prose or a code fence, and write captions with real line breaks where they
belong rather than avoiding them.`;
}

/* THE RESPONSE SHAPE, ENFORCED BY THE API RATHER THAN ASKED FOR.
   Captions are multi-line by design -- Instagram wants a line break before its
   CTA, YouTube opens with a hook on its own line. A raw newline inside a JSON
   string is invalid JSON, so "reply with a JSON object" was a coin flip: about
   one call in three came back unparseable, which is why this function had a
   loose-regex fallback parser and still returned nothing sometimes.

   output_config.format makes the API guarantee a response matching this
   schema, so the escaping is no longer the model's problem or ours. The
   channel list is baked into `required` per request, which also stops the
   model quietly dropping a channel it found hard. */
function buildSchema(channels: string[]) {
  const captionProps: Record<string, unknown> = {};
  for (const c of channels) captionProps[c] = { type: 'string' };
  return {
    type: 'object',
    properties: {
      captions: {
        type: 'object',
        properties: captionProps,
        required: channels,
        additionalProperties: false,
      },
      hashtags: { type: 'array', items: { type: 'string' } },
      recommendedChannel: { type: 'string', enum: channels },
      note: { type: 'string' },
    },
    required: ['captions', 'hashtags', 'recommendedChannel', 'note'],
    additionalProperties: false,
  };
}

async function claude(key: string, system: string, user: string, maxTokens: number, schema: unknown) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema } },
    }),
  });
  if (!res.ok) return { error: `Anthropic ${res.status}: ${await res.text()}` } as const;
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[]; stop_reason?: string;
  };
  return {
    text: (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''),
    /* Surfaced because running out of tokens mid-JSON is the one failure that
       does not look like one: the reply is a 200 carrying half an object,
       parseLoose returns {}, and the portal shows a generic "try again" for
       something retrying will not fix. */
    truncated: data.stop_reason === 'max_tokens',
  } as const;
}

function parseLoose(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* noop */ } }
  return {};
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = (await req.json().catch(() => ({}))) as {
      property?: Record<string, unknown>; channels?: string[];
      brand?: { name?: string; tagline?: string; voice?: string; handle?: string } | null;
      usedAngles?: string[];
    };
    const p = body.property;
    if (!p || typeof p !== 'object' || !p.title) return json({ error: 'property required' }, 400);
    const requested = (Array.isArray(body.channels) ? body.channels : [])
      .filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c));
    const want: Channel[] = requested.length ? requested : ['instagram', 'tiktok', 'facebook'];

    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ error: 'Server misconfigured: no Anthropic key' }, 500);

    const used = Array.isArray(body.usedAngles)
      ? body.usedAngles.filter((a): a is string => typeof a === 'string')
      : [];
    const assigned = dealAngles(want, used);

    /* The brand block was being SENT by the portal and dropped on the floor
       here -- the composer has posted { brand: {...} } for as long as it has
       existed and this function never read body.brand, so an agency that took
       the trouble to write its own voice got the house voice anyway. Only
       fields the agency actually filled in are passed; an absent voice must
       not become an invented one. */
    const b = body.brand ?? null;
    const brandBits = [
      b?.name && `The agency is ${b.name}.`,
      b?.tagline && `Their tagline: "${b.tagline}".`,
      b?.handle && `Their handle: ${b.handle}.`,
      b?.voice && `THEIR VOICE, which overrides the per-channel voice notes above where the two disagree: ${b.voice}`,
    ].filter(Boolean);
    const brandLine = brandBits.length ? '\n' + brandBits.join(' ') + '\n' : '';

    const listing = {
      title: p.title, price: p.price, city: p.city, area: p.area ?? null,
      bedrooms: p.bedrooms, listingType: p.listingType ?? 'sale',
      propertyType: p.propertyType ?? 'whole', trustScore: p.trustScore ?? null,
    };
    /* A caller-supplied angle is a steer on top of the assignment, not a
       replacement for it -- it used to be the only variety input there was,
       and one angle across every channel is how five identical captions get
       made. */
    const steer = typeof p.angle === 'string' && p.angle
      ? `\nThe agency also asked for this emphasis, applied within each channel's own angle: ${p.angle}`
      : '';

    const user = `Property: ${JSON.stringify(listing)}${steer}\nWrite the captions now.`;
    /* 1400 was too tight, and it failed SILENTLY. Three channels of genuinely
       distinct captions -- the Facebook one runs to a paragraph now that it has
       a subject of its own instead of a reworded sentence -- ran past the cap
       mid-JSON on the first live call after this rewrite: a 200 with an
       unparseable body, which the portal could only report as a network
       hiccup. 8000 is well clear of the longest plausible five-channel reply
       and still inside the non-streaming timeout. */
    const out = await claude(key, buildSystem(assigned, brandLine), user, 8000, buildSchema(want));
    if ('error' in out) return json({ error: out.error }, 502);

    const parsed = parseLoose(out.text) as {
      captions?: Record<string, string>; hashtags?: string[]; recommendedChannel?: string; note?: string;
    };
    const captions: Record<string, string> = {};
    for (const c of want) if (parsed.captions?.[c]) captions[c] = parsed.captions[c];
    /* Fail loudly. This returned 200 with captions:{} whenever the model output
       could not be parsed -- indistinguishable at the portal from a network
       fault, and the reason the truncation above went unnoticed. */
    if (!Object.keys(captions).length) {
      return json({
        error: out.truncated
          ? 'The reply was cut off before it finished — try fewer channels at once.'
          : 'The generator returned something unreadable. Please try again.',
        truncated: out.truncated,
      }, 502);
    }

    const rec = (parsed.recommendedChannel && want.includes(parsed.recommendedChannel as Channel))
      ? parsed.recommendedChannel : want[0];

    /* angles ride back with the captions so the caller can store which ones
       this property has now spent, and send them as usedAngles next time.
       Without that round trip the rotation resets on every page load and the
       second Generate repeats the first. */
    const anglesOut: Record<string, string> = {};
    for (const c of Object.keys(captions)) anglesOut[c] = assigned[c];

    return json({
      captions,
      angles: anglesOut,
      anglesUsed: [...new Set(Object.values(anglesOut))],
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 8) : [],
      recommendedChannel: rec,
      note: typeof parsed.note === 'string' ? parsed.note : '',
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
