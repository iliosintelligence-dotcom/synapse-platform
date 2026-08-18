/**
 * save-place — turns "my office is in Bodija" into a coordinate, once.
 *
 * WHY THIS EXISTS
 * consumer_profiles stored `work_location` as free text and nothing else. Every
 * non-blank value in it is the literal string "city centre", which cannot be
 * measured against a property even in principle. So the question a buyer
 * actually asks -- "how far is this flat from my office?" -- had no data behind
 * it, and the property page answered with a hardcoded paragraph instead.
 *
 * Geocoding at SAVE time rather than at read time is the whole point:
 *   · it happens once per place, not once per property view
 *   · the coordinate is inspectable, so a bad pin can be found and fixed
 *     rather than silently reproducing itself on every page
 *   · the property page stays fast and works when the geocoder is down
 *
 * A GEOCODE IS A GUESS, AND IS STORED AS ONE. Confidence is recorded, and
 * `failed` is stored rather than thrown away -- knowing we tried and could not
 * place "near my mum's" is worth more than a null that invites another attempt.
 * my_places() withholds anything that failed, so nothing downstream can measure
 * against a coordinate we do not believe.
 *
 * Nominatim, not Google: it needs no key, and GOOGLE_MAPS_API_KEY is not set on
 * this project. If it is set later, add a branch here -- the confidence field
 * already carries the distinction the callers need.
 *
 * POST { kind, label, city? }   Authorization: the user's JWT
 *   kind: workplace | school | gym | worship | family | other
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const KINDS = ['workplace', 'school', 'gym', 'worship', 'family', 'other'];

/* Nominatim asks for a real identifier and rate-limits to 1 req/sec. Both are
   conditions of use, not suggestions -- this runs at save time precisely so we
   make one request per place rather than one per page view. */
const UA = 'Synapse/1.0 (real-estate; ilios.intelligence@gmail.com)';

interface Geo { lat: number; lon: number; confidence: 'exact' | 'approximate'; query: string; matched: string }

/* Nominatim answers "Bodija, Ibadan" with a CLINIC called Bodija, at
   7.4399,3.9202 -- not the neighbourhood most people mean. Tested, not
   assumed. So which attempt matched is a poor confidence signal; what it
   matched is a better one.

   `place` and `boundary` are areas -- a district, a suburb, a town -- which is
   what someone naming a part of town means. Anything else is a specific
   building that happens to share the name, and we should hedge rather than
   measure a commute to a clinic because it borrowed a district's name. */
const AREA_CLASSES = ['place', 'boundary'];

async function geocode(label: string, city: string | null): Promise<Geo | null> {
  /* Ask with the city first. "Bodija" alone matches in several countries;
     "Bodija, Ibadan, Nigeria" does not. Falling back to the bare label after
     is deliberate -- a well-known institution may not need the qualifier and
     may even be hurt by it. */
  const attempts = [
    [label, city, 'Nigeria'].filter(Boolean).join(', '),
    [label, 'Nigeria'].filter(Boolean).join(', '),
  ];

  for (let i = 0; i < attempts.length; i++) {
    const q = attempts[i];
    const url = 'https://nominatim.openstreetmap.org/search'
      + '?format=json&limit=1&countrycodes=ng&q=' + encodeURIComponent(q);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
      if (!r.ok) continue;
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) continue;
      const hit = rows[0];
      if (hit.lat == null || hit.lon == null) continue;
      const cls = String(hit.class ?? '');
      const typ = String(hit.type ?? '');
      /* Exact requires BOTH: that we asked with the city, and that what came
         back is an area rather than a building wearing the same name. */
      const isArea = AREA_CLASSES.includes(cls);
      return {
        lat: Number(hit.lat),
        lon: Number(hit.lon),
        confidence: (i === 0 && isArea) ? 'exact' : 'approximate',
        query: q,
        matched: cls + '/' + typ,
      };
    } catch { /* try the next phrasing */ }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    /* Deliberately the user's own client, not the service role: the row belongs
       to them, RLS already says so, and a definer path here would be a way to
       write a place onto somebody else's profile. */
    const supa = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await supa.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not signed in' }, 401);

    const body = (await req.json().catch(() => ({}))) as
      { kind?: string; label?: string; city?: string };

    const kind = String(body.kind ?? '').trim();
    const label = String(body.label ?? '').trim().slice(0, 120);
    const city = body.city ? String(body.city).trim().slice(0, 80) : null;

    if (!KINDS.includes(kind)) return json({ error: 'Unknown kind: ' + kind }, 400);
    if (label.length < 2) return json({ error: 'Tell me where, in a word or two.' }, 400);

    const geo = await geocode(label, city);

    const row = {
      consumer_id: user.id,
      kind,
      label,
      lat: geo ? geo.lat : null,
      lon: geo ? geo.lon : null,
      geocode_source: geo ? 'nominatim' : null,
      geocoded_at: new Date().toISOString(),
      geocode_confidence: geo ? geo.confidence : 'failed',
      // Includes what Nominatim actually matched, so "why is my office pinned
      // to a clinic" is answerable without re-running the lookup.
      geocode_query: geo
        ? geo.query + ' [matched ' + geo.matched + ']'
        : [label, city].filter(Boolean).join(', ') + ' [no match]',
    };

    const { error } = await supa.from('consumer_places')
      .upsert(row, { onConflict: 'consumer_id,kind,label' });
    if (error) return json({ error: error.message }, 500);

    /* Report the failure honestly rather than as a save. The caller should be
       able to say "I could not find that -- can you name a landmark?" instead
       of pretending it worked and producing no distances later. */
    return json({
      saved: true,
      kind, label,
      located: !!geo,
      confidence: row.geocode_confidence,
      coords: geo ? [geo.lat, geo.lon] : null,
      matched: geo ? geo.matched : null,
      note: !geo
        ? 'Saved, but we could not place it on a map. A nearby landmark or a fuller address would help.'
        : geo.confidence === 'approximate'
          ? 'Saved. We found something close to that name but are not certain it is the right spot — distances from it will be shown as rough.'
          : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('save-place fatal: ' + message);
    return json({ error: message }, 500);
  }
});
