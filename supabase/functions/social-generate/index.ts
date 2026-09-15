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

/* X IS PUBLISHABLE AND WAS NOT WRITABLE. social-publish has had x_post in its
   content-type map all along, and Synapse's own X account has been carrying
   every listing as a twin -- so posts were going out on X that no agency had
   ever been offered the chance to write. The twin reworded the caption meant
   for somewhere else, on the one platform where length is the whole craft.
   Adding it here is what lets the composer offer it. */
const CHANNELS = ['instagram', 'tiktok', 'youtube', 'facebook', 'whatsapp', 'x'] as const;
type Channel = typeof CHANNELS[number];

/* ── THE ANGLES ────────────────────────────────────────────────────────────
   Eleven different things a caption can BE ABOUT. Not eleven tones -- eleven
   subjects,
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

  /* SIX WAS NOT ENOUGH, and the arithmetic says so plainly: one generation
     over five channels spends five of six, so the rotation resets almost every
     round and the second batch is the first batch again. Eleven means a
     property gets two genuinely different rounds before anything comes back.

     Each of these is tied to a field the fact block now actually carries --
     an angle with no data behind it produces the short generic caption this
     was reported for, so adding subjects without adding facts would have made
     the problem worse rather than better. */
  cost: {
    label: 'what it really costs to move in',
    brief: 'The total, not the headline: rent plus service charge plus what '
      + 'must be paid before the keys change hands. Opens on the true number. '
      + 'This is the single most common complaint about Nigerian listings -- '
      + 'the advertised price is never the price -- so being straight about it '
      + 'is the whole point. Only the figures given; if a cost is not in the '
      + 'data, say what IS known and stop.',
  },
  amenity: {
    label: 'the specific things it has',
    brief: 'The listed amenities, named exactly and not padded. In Nigeria '
      + 'security and running water are not features, they are the difference '
      + 'between a place that works and one that does not, so treat them as '
      + 'the point rather than as a list at the bottom. Opens on the one that '
      + 'matters most. Never add an amenity that is not in the data.',
  },
  objection: {
    label: 'the thing a careful buyer would worry about',
    brief: 'Name the obvious hesitation about THIS listing -- what is not '
      + 'verified yet, what the photos do not show, what the price implies -- '
      + 'and answer it honestly. Opens on the worry, in the reader\'s own '
      + 'words. This builds more trust than any claim, and it must never '
      + 'invent a reassurance: if the answer is "we have not checked that '
      + 'yet", that is the answer.',
  },
  process: {
    label: 'what happens if you enquire',
    brief: 'The next step, concretely: how a viewing is arranged, who the '
      + 'reader would be dealing with, what is checked before money moves. '
      + 'Opens on the action, not the home. Never promise a timeline the data '
      + 'does not support.',
  },
  question: {
    label: 'a question put to the reader',
    brief: 'Open with a direct question this listing answers, then answer it '
      + 'in two lines. A real question somebody house-hunting would ask -- not '
      + 'a rhetorical hook. Changes the SHAPE of the post, so avoid it when '
      + 'another channel in the same batch already has it.',
  },
};

/* Which angles suit which platform, best first. Preference, not restriction:
   the dealer below falls back to whatever is left, because a guaranteed
   different angle beats a perfectly matched duplicate. */
const AFFINITY: Record<Channel, string[]> = {
  /* EVERY LIST RUNS THE FULL ELEVEN. They were six long, so the five angles
     added alongside them could only ever be reached by the dealer's fallback
     -- present in the catalogue, last in every queue, and in practice never
     chosen while any of the original six remained. Ranking all of them is what
     actually puts the new subjects into rotation. */
  instagram: ['space', 'fit', 'amenity', 'moment', 'location', 'question', 'objection', 'value', 'cost', 'process', 'trust'],
  tiktok: ['moment', 'fit', 'question', 'space', 'amenity', 'location', 'objection', 'cost', 'trust', 'value', 'process'],
  youtube: ['space', 'location', 'process', 'amenity', 'cost', 'value', 'trust', 'objection', 'fit', 'moment', 'question'],
  facebook: ['trust', 'cost', 'objection', 'value', 'location', 'process', 'fit', 'amenity', 'space', 'moment', 'question'],
  whatsapp: ['moment', 'cost', 'value', 'process', 'fit', 'amenity', 'trust', 'question', 'space', 'objection', 'location'],
  /* Cost and the single sharp number read well in 240 characters; the space
     and the process do not. */
  x: ['cost', 'value', 'question', 'moment', 'objection', 'trust', 'amenity', 'fit', 'location', 'space', 'process'],
};

/**
 * Deal one distinct angle to each channel, skipping angles this property has
 * already spent.
 *
 * The reset matters: a property that has had a few rounds of
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
  /* THESE USED TO ASK FOR PROSE and got exactly that: "1-2 short lines then a
     soft CTA", "2-3 sentences of real detail". Well-turned essays that buried
     the price inside a sentence. The market writes spec sheets. */
  instagram: 'the FULL form: caps headline, hook line, location, spec lines, price, '
    + 'charges, next step, then the hashtag block. Warm on the hook line, factual '
    + 'everywhere below it. Line breaks between blocks -- this is scanned, not read.',
  tiktok: 'the form, compressed. Caps headline, hook, location, the three specs that '
    + 'matter most, the price, the next step. Young Lagos voice in the hook only; '
    + 'the numbers stay plain.',
  youtube: 'the full form as a video description. Headline first, since it is what '
    + 'shows before "more", then location, specs, price, charges, next step.',
  facebook: 'the full form, and the most complete version of it -- an older, '
    + 'higher-intent reader who will read every charge. Always include the whole '
    + 'Other Charges block. No emoji beyond the line markers.',
  whatsapp: 'headline, price, charges, next step. Nothing else. This is a Status '
    + 'blurb somebody screenshots and forwards, so it has to stand on its own.',
  /* The only channel where the constraint IS the craft. Under 280 characters
     including the link, so one idea, no windup, no list. A thread is not an
     option here -- the publisher sends a single post. */
  x: 'one post, hard limit 240 characters before the link. A single sharp '
    + 'observation or a number that stops the scroll. No emoji spam, no hashtag '
    + 'stack, no "thread below". Nigerian, dry, confident.',
};

/* THE FORM THE MARKET ACTUALLY USES.
   Taken from real Lagos listing accounts -- rentzhq, lingoluxuryhomes,
   demaxon_re, mintandmodern, restellehouse -- rather than invented here.

   What we were writing was an ESSAY: flowing prose, one idea per paragraph,
   nicely turned. What the market writes is a SPEC SHEET with a hook on top.
   Nobody reads a property caption; they scan it for four things -- what,
   where, how much, and what else it will cost -- in that order. Prose hides
   all four inside sentences. That is the difference between a caption that
   reads well and one that sells.

   Three forms, because a rental, a sale and a shortlet are bought by three
   different people asking three different questions. Two details carry more
   weight than anything else in the set:

     THE ITEMISED CHARGES BLOCK on a rental -- service charge, agency, legal,
     caution. The advertised rent is never the real cost and every Nigerian
     renter knows it, so the accounts that itemise are the ones people trust.

     THE TITLE LINE on a sale -- Governor's Consent, C of O. A buyer asks about
     the papers before anything else. We hold title_type and have never used it.

   THE ANGLE STILL DECIDES WHAT LEADS. The form is the skeleton; the angle
   picks the hook, which block is pulled up top, and what the closing line
   argues. A cost angle opens on the charges, a fit angle on the person. Same
   skeleton, different emphasis -- which is how these accounts vary their own
   posts day to day. */
const MARKET_FORM = `
HOW A LAGOS PROPERTY CAPTION IS BUILT (follow this shape -- it is what the
market reads):

Nobody reads these top to bottom. They SCAN for what, where, how much, and what
else it will cost. Put each on its own line. Short lines, line breaks between
blocks, and never bury a number inside a sentence.

FOR A RENTAL:
  1. Headline in caps: property type, bedrooms, FOR RENT.
     e.g. PREMIUM 3-BEDROOM FLAT FOR RENT AT IKATE, LEKKI
  2. One line on who it suits or how it feels.
  3. \ud83d\udccd Area, City
  4. The specs, one per line, not sentences: bedrooms, bathrooms, each amenity
     given. Under a bare heading like "Features" when there are three or more.
  5. Rent: <amount> per annum   (or per month, if the data says so)
  6. "Other Charges:" then one bulleted line per charge in the data --
     service charge, move-in cost, agency, legal, caution. THIS BLOCK MATTERS
     MORE THAN ANY OTHER. The advertised rent is never the real cost, and the
     accounts that itemise are the ones people trust. List ONLY charges present
     in the data. Never invent a percentage.
  7. A closing line naming who this is right for.
  8. The next step: "Ready to make this your next address? Contact <agency> to
     schedule an inspection."

FOR A SALE:
  1. Headline in caps: condition, bedrooms, type, and the two or three standout
     features joined with +.
     e.g. NEWLY BUILT 4 BEDROOM DUPLEX + BQ + POOL
  2. \ud83d\udccd Location: <estate or street>, <area>, <city>
  3. \ud83d\udcb0 Guide Price: <amount>   -- add "(Negotiable)" ONLY if the data says so.
  4. Title: <the title type given>   -- include this line ONLY when a title
     type is in the data. A buyer asks about the papers before anything else,
     and inventing "Governor's Consent" would be the worst thing this product
     could do.
  5. "Highlights" then one \ud83c\udf1f line per real feature.
  6. The next step: arrange a viewing.

FOR A SHORTLET OR STAY:
  1. Open on a question to the reader. \ud83d\udc40
  2. The price as "from <amount>" -- shortlets quote a floor, not a fixed figure.
  3. \ud83d\udccd Area, City
  4. \ud83d\udd17 Link in bio to book

A fourth opening worth knowing, the most scannable in the set -- the pipe
headline: 2 bed | Ikate-Lekki | N250m | Furnished

ALWAYS:
- Prices exactly as given. Both N1.2M and N1,200,000 are fine; a number that is
  not in the data is not.
- \ud83d\udccd for place, \ud83d\udcb0 for price, \ud83d\udcde for contact, \ud83d\udd17 for the link. These are LINE
  MARKERS, not decoration: one per line at most, never mid-sentence.
- Hashtags are returned SEPARATELY, not written into the caption -- each channel
  has its own cap and they are appended per channel. Choose them the way these
  accounts do: specific, not generic. The area, the city plus RealEstate, the
  category, the agency. #LekkiRealEstate beats #home.
`;

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

${MARKET_FORM}
THE FORM AND THE ANGLE DO DIFFERENT JOBS. The form above is the skeleton every
caption uses. The angle decides what the HEADLINE leads on, which block is
pulled up under it, and what the closing line argues -- a cost angle opens on
the charges, a fit angle on the person it suits, an objection angle on the
worry. Same skeleton, different emphasis. That is how these accounts vary their
own posts, and it is why two captions in one batch will not read alike.

INSTAGRAM, FACEBOOK and YOUTUBE take the full form. WHATSAPP takes the
headline, the price, the charges and the next step, nothing else. X cannot
carry a spec sheet at all: there it is one line, one number, one point.
${brandLine}
RULES:
- These are REAL verified listings. Never invent facts, amenities, numbers,
  distances, landmarks or comparisons that are not in the data given.
- Naira prices exactly as given. Where a service charge or a move-in cost is
  given, treating the headline rent as the whole cost is the one dishonesty
  this product exists to remove -- so never imply it is.
- NEVER print a street number or a full address, even though a street name is
  given. Name the street or the area, never the door. A caption is public and
  permanent and somebody lives there.
- Always end with a clear next step, and use the one the FORM gives for that
  listing type -- an inspection for a rental, a viewing for a sale, a booking
  for a shortlet. "Tap the link" is the weakest of them; prefer the specific.
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

    /* EIGHT FIELDS WAS THE WHOLE PROBLEM.
       This sent title, price, city, area, bedrooms, listingType, propertyType
       and trustScore -- and then asked for six captions, each about a
       DIFFERENT subject. Four of those subjects had nothing to work from:
       "the rooms, the layout, the light" had `bedrooms: 1`; "what is walkable,
       what the commute looks like" had `city: Ibadan`; "which checks passed"
       had `trustScore: null`; "newly listed, just re-confirmed" had no dates
       at all. The prompt correctly says to say less rather than invent, so it
       said less -- and every caption converged on the two facts it actually
       had. That reads as no variety, and it is not the model's fault.

       The row carries about fifty columns. These are the ones that are TRUE,
       PUBLISHABLE and give a subject something to be about. Nulls are stripped
       below rather than sent, because "furnished: null" invites a sentence
       about furnishing nobody has established.

       NOT sent, deliberately: the street number. `address` holds a door number
       and a caption naming it publishes where a specific person lives, to an
       audience of strangers, permanently. The street and area go; the number
       does not. */
    /* One loose view of the row. Every field below is optional and arrives
       from a client, so narrowing each one individually would be forty guards
       for no safety that the null-strip does not already provide. */
    const pr = p as Record<string, any>;
    const addr = typeof pr.address === 'string' ? pr.address : '';
    const street = addr.replace(/^[\s]*[0-9]+[a-zA-Z]?[,\s/-]+/, '').trim() || null;

    const daysSince = (v: unknown) => {
      const t = v ? Date.parse(String(v)) : NaN;
      return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 86400000)) : null;
    };
    const daysUntil = (v: unknown) => {
      const t = v ? Date.parse(String(v)) : NaN;
      return Number.isFinite(t) ? Math.max(0, Math.round((t - Date.now()) / 86400000)) : null;
    };

    const raw: Record<string, unknown> = {
      title: pr.title,
      /* The agent's own words about the property, and the single most
         valuable field here -- it is the only place the listing says anything
         a form could not capture. On the listing that prompted this report it
         reads "A newly vacated room and parlour in Agbowo perfect for a
         student or NYSC corper", which alone answers two of the angles. */
      description: pr.description ?? null,

      price: pr.price,
      currency: pr.currency ?? 'NGN',
      pricePeriod: pr.price_period ?? pr.pricePeriod ?? null,
      serviceCharge: pr.service_charge ?? pr.serviceCharge ?? null,
      moveInCost: pr.move_in_cost ?? pr.moveInCost ?? null,
      negotiable: pr.is_negotiable ?? pr.negotiable ?? null,

      city: pr.city,
      state: pr.state ?? null,
      area: pr.area ?? pr.neighbourhood ?? null,
      street,

      bedrooms: pr.bedrooms,
      bathrooms: pr.bathrooms ?? null,
      toilets: pr.toilets ?? null,
      areaSqm: pr.area_sqm ?? pr.areaSqm ?? null,
      parkingSpaces: pr.parking_spaces ?? pr.parkingSpaces ?? null,
      floorLevel: pr.floor_level ?? pr.floorLevel ?? null,
      yearBuilt: pr.year_built ?? pr.yearBuilt ?? null,
      furnished: pr.furnished ?? null,
      condition: pr.property_condition ?? pr.condition ?? null,
      amenities: Array.isArray(pr.amenities) && pr.amenities.length ? pr.amenities : null,

      listingType: pr.listingType ?? pr.listing_type ?? 'sale',
      propertyType: pr.propertyType ?? pr.property_type ?? 'whole',
      titleType: pr.title_type ?? pr.titleType ?? null,

      verified: (pr.verification_status ?? pr.verificationStatus) === 'verified',
      verificationStatus: pr.verification_status ?? pr.verificationStatus ?? null,
      trustScore: pr.trustScore ?? pr.trust_score ?? null,
      photos: Array.isArray(pr.media) ? pr.media.length : null,

      daysListed: daysSince(pr.listed_at ?? pr.listedAt),
      daysLeft: daysUntil(pr.expires_at ?? pr.expiresAt),
      lastConfirmedDaysAgo: daysSince(pr.availability_confirmed_at ?? pr.availabilityConfirmedAt),
    };

    /* Nulls stripped. A field the model cannot see is a field it cannot be
       tempted to write around, and an explicit null reads to a model as an
       invitation to explain the absence. */
    const listing: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v !== null && v !== undefined && v !== '') listing[k] = v;
    }
    /* A caller-supplied angle is a steer on top of the assignment, not a
       replacement for it -- it used to be the only variety input there was,
       and one angle across every channel is how five identical captions get
       made. */
    const steer = typeof p.angle === 'string' && p.angle
      ? `\nThe agency also asked for this emphasis, applied within each channel's own angle: ${p.angle}`
      : '';

    const user = `Property: ${JSON.stringify(listing)}${steer}\nWrite the captions now.`;
    /* THE CEILING, raised twice, and both times because running out of tokens
       mid-JSON is the one failure that does not look like one: the reply is a
       200 carrying half an object, parseLoose returns {}, and the portal can
       only report a generic "try again" for something retrying will not fix.

       1400 was too tight for prose. 12000 is the room a SPEC SHEET needs: the
       Facebook form alone carries a headline, a hook, a location, a spec list,
       a price, an itemised charges block, a closing line and a CTA -- two to
       three times the prose it replaced, across six channels. */
    const out = await claude(key, buildSystem(assigned, brandLine), user, 12000, buildSchema(want));
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
