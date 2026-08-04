/**
 * social-generate — AI caption generation for Synapse social syndication.
 *
 * Given a verified listing + the channels an agency wants to post to, Claude
 * writes a platform-tailored caption for each (Instagram, TikTok, YouTube,
 * Facebook, WhatsApp Status), plus hashtags and a recommended lead channel.
 * This powers the "Guided Post Creation" step of the Agency OS social studio
 * — one upload, captions everywhere, reach maximised.
 *
 * POST { property: {title, price, city, bedrooms, listingType, propertyType,
 *        trustScore, area?, angle?}, channels?: string[] }
 *   -> { captions: {instagram?,tiktok?,youtube?,facebook?,whatsapp?}, hashtags: string[],
 *        recommendedChannel: string, note: string }
 *
 * Deployed with verify_jwt = false so the static prototype can call it.
 * Env: ANTHROPIC_API_KEY.
 */
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-opus-4-8';

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

const SYSTEM = `You are the social copywriter for Synapse, a verified Nigerian real-estate platform.
Write scroll-stopping, authentic captions for one specific verified property, tailored to each platform:

- instagram: aspirational + lifestyle. 1-2 short lines, a line break, then a soft CTA. 2-4 tasteful emojis. Warm, editorial.
- tiktok: punchy, trend-aware, spoken-word energy. A strong hook first line. Casual, young Lagos voice. Emojis ok.
- youtube: written for a video description under a walkthrough. Open with the one-line hook a viewer sees before "more", then 2-3 sentences of real detail (layout, area, price), then a clear next step. Minimal emoji, no hashtag stuffing.
- facebook: informative + trust-forward. Slightly longer, plain, decision-maker tone (older, higher buy-intent). Minimal emoji.
- whatsapp: a WhatsApp Status blurb. Very short, urgent, personal. One emoji max.

RULES:
- These are REAL verified listings. Lead with trust where it fits ("verified", the trust score, "all 7 checks passed").
- Naira prices exactly as given. Never invent facts, amenities, or numbers not provided.
- Always include a clear next step ("DM to book a viewing", "Tap the link", "Save this").
- No hashtags inside the caption body - return hashtags separately.
- Nigerian English, Lagos market savvy. Avoid clichE9s like "dream home come true".

Return ONLY a JSON object, no prose:
{"captions":{"instagram":"...","tiktok":"...","youtube":"...","facebook":"...","whatsapp":"..."},
 "hashtags":["#..."],"recommendedChannel":"instagram|tiktok|youtube|facebook|whatsapp",
 "note":"one sentence on why that channel is best for THIS listing"}
Only include the channels requested.`;

async function claude(key: string, system: string, user: string, maxTokens: number) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) return { error: `Anthropic ${res.status}: ${await res.text()}` } as const;
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return { text: (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('') } as const;
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
    };
    const p = body.property;
    if (!p || typeof p !== 'object' || !p.title) return json({ error: 'property required' }, 400);
    const requested = (Array.isArray(body.channels) ? body.channels : [])
      .filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c));
    const want: Channel[] = requested.length ? requested : ['instagram', 'tiktok', 'facebook'];

    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ error: 'Server misconfigured: no Anthropic key' }, 500);

    const listing = {
      title: p.title, price: p.price, city: p.city, area: p.area ?? null,
      bedrooms: p.bedrooms, listingType: p.listingType ?? 'sale',
      propertyType: p.propertyType ?? 'whole', trustScore: p.trustScore ?? null,
      angle: p.angle ?? null,
    };
    const user = `Property: ${JSON.stringify(listing)}\nChannels requested: ${want.join(', ')}\nWrite the captions now.`;
    const out = await claude(key, SYSTEM, user, 900);
    if ('error' in out) return json({ error: out.error }, 502);

    const parsed = parseLoose(out.text) as {
      captions?: Record<string, string>; hashtags?: string[]; recommendedChannel?: string; note?: string;
    };
    const captions: Record<string, string> = {};
    for (const c of want) if (parsed.captions?.[c]) captions[c] = parsed.captions[c];
    const rec = (parsed.recommendedChannel && want.includes(parsed.recommendedChannel as Channel))
      ? parsed.recommendedChannel : want[0];
    return json({
      captions,
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 8) : [],
      recommendedChannel: rec,
      note: typeof parsed.note === 'string' ? parsed.note : '',
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
