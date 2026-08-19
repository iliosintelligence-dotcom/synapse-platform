/**
 * property-intelligence — finds what is really around a property, and stores it.
 *
 * WHY THIS EXISTS
 * The property page shipped with "Neighbourhood intelligence — Lekki Phase 1"
 * written into the HTML: six invented score bars and a note about a rising
 * corridor, rendered identically on every listing in the database. A
 * one-bedroom flat at 13 Aafin Iyanu, Ologuneru, in Ibadan carried Lekki's
 * numbers, 130km away.
 *
 * Patching the text would only have moved the problem. There was nowhere for
 * per-property surroundings to live, so there was no true answer available to
 * render. This function produces that answer, and property_places stores it.
 *
 * WHY SERVER-SIDE AND STORED, NOT FETCHED FROM THE PAGE
 *  - the Google key never reaches a browser, where it would be world-readable
 *  - one fetch per listing, not one per visitor, which is also what keeps the
 *    bill finite
 *  - every visitor sees the same answer, and it survives Google being down
 *  - it is queryable: "4 schools within 2km" becomes a count over real rows
 *    rather than a sentence someone typed
 *
 * A house in Benin City gets Benin City's places, because every query is driven
 * by that property's own latitude and longitude. Nothing here is city-specific.
 *
 * POST { property_id: uuid, refresh?: boolean }
 *   or { city: string, limit?: number }   — backfill every live listing in a city
 *
 * Requires GOOGLE_MAPS_API_KEY with **Places API (New)** and **Routes API**
 * enabled. Not the legacy Places/Distance Matrix APIs, which Google no longer
 * activates for new projects -- the first real key returned REQUEST_DENIED
 * against both.
 * Without it this returns 503 and writes nothing: an empty section is honest,
 * a guessed one is not.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/* What a buyer actually asks about a home, in the order they ask it. Each maps
   to a Google Places type and a radius that suits it: you will walk to a
   pharmacy and drive to a university, so searching both at 1km is wrong twice. */
const CATEGORIES: Array<{ category: string; type: string; radius: number; keep: number }> = [
  { category: 'school',      type: 'school',           radius: 3000,  keep: 3 },
  { category: 'hospital',    type: 'hospital',         radius: 6000,  keep: 2 },
  { category: 'pharmacy',    type: 'pharmacy',         radius: 2500,  keep: 1 },
  { category: 'supermarket', type: 'supermarket',      radius: 3000,  keep: 2 },
  { category: 'market',      type: 'shopping_mall',    radius: 8000,  keep: 2 },
  { category: 'bank',        type: 'bank',             radius: 3000,  keep: 1 },
  { category: 'university',  type: 'university',       radius: 15000, keep: 1 },
  { category: 'transit',     type: 'transit_station',  radius: 5000,  keep: 1 },
  { category: 'park',        type: 'park',             radius: 4000,  keep: 1 },
];

interface Place {
  provider_place_id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  distance_m: number;
  rating: number | null;
  ratings_count: number | null;
  drive_seconds: number | null;
  drive_text: string | null;
}

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

async function nearby(key: string, lat: number, lon: number, spec: typeof CATEGORIES[number]): Promise<Place[]> {
  /* Places API (NEW), not the legacy Nearby Search.
     Google no longer enables the legacy endpoints on new projects -- the first
     real call with a working key came back REQUEST_DENIED, "You're calling a
     legacy API". The new API is a POST with a JSON body, and it requires an
     explicit field mask: it returns nothing at all unless you name the fields,
     which fails loudly rather than silently, and is a good deal better than the
     old behaviour of quietly charging for fields nobody asked for. */
  const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount',
    },
    body: JSON.stringify({
      includedTypes: [spec.type],
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lon }, radius: spec.radius },
      },
    }),
  });

  if (!r.ok) {
    /* The new API reports its faults as real HTTP errors with a message worth
       surfacing -- a disabled API, a restricted key, no billing account. The
       legacy one buried these in a 200, which is why the old code had to
       inspect the body. */
    const detail = await r.text().catch(() => '');
    let msg = detail.slice(0, 300);
    try { msg = JSON.parse(detail)?.error?.message ?? msg; } catch { /* keep raw */ }
    throw new Error(`places ${spec.type}: HTTP ${r.status} — ${msg}`);
  }

  const d = await r.json();
  // No places nearby is an empty object, not an error.
  return (d.places ?? [])
    .filter((p: Record<string, never>) => p.id && p.displayName?.text && p.location)
    .map((p: Record<string, never>) => {
      const g = p.location;
      return {
        provider_place_id: String(p.id),
        name: String(p.displayName.text),
        category: spec.category,
        lat: Number(g.latitude),
        lon: Number(g.longitude),
        distance_m: haversineM(lat, lon, Number(g.latitude), Number(g.longitude)),
        rating: p.rating != null ? Number(p.rating) : null,
        ratings_count: p.userRatingCount != null ? Number(p.userRatingCount) : null,
        drive_seconds: null,
        drive_text: null,
      } as Place;
    })
    /* Nearest first, but a landmark slightly further out beats a nameless
       shopfront next door -- userRatingCount is the honest proxy for "is this
       somewhere people actually go". */
    .sort((a: Place, b: Place) =>
      (a.distance_m - b.distance_m) - Math.min(400, ((b.ratings_count ?? 0) - (a.ratings_count ?? 0)) * 2))
    .slice(0, spec.keep);
}

/* Real driving times, from the Routes API.
   Distance Matrix is the other legacy endpoint Google no longer enables, so
   this is computeRouteMatrix: one origin, many destinations, one call.

   Two things worth knowing about its shape. It answers with a STREAM of
   elements rather than a matrix, each carrying its own destinationIndex, so
   results must be matched by that index and not by arrival order. And an
   unreachable destination comes back as an element with no duration rather
   than as an error -- which is correct, and is why each is checked
   individually instead of trusting the call as a whole. */
async function addDriveTimes(key: string, lat: number, lon: number, places: Place[]): Promise<string | null> {
  /* Returns why routing produced nothing, rather than failing silently. Every
     listing came back "routed: 0" and the cause was invisible, which is its own
     small version of the problem this whole function exists to fix. */
  let note: string | null = null;
  const CHUNK = 24;
  for (let i = 0; i < places.length; i += CHUNK) {
    const batch = places.slice(i, i + CHUNK);
    try {
      const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
        },
        body: JSON.stringify({
          origins: [{ waypoint: { location: { latLng: { latitude: lat, longitude: lon } } } }],
          destinations: batch.map((p) => ({
            waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lon } } },
          })),
          travelMode: 'DRIVE',
        }),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        try { note = JSON.parse(detail)?.error?.message ?? detail.slice(0, 200); }
        catch { note = 'HTTP ' + r.status + ' ' + detail.slice(0, 160); }
        continue;                               // distances still stand on their own
      }
      const rows = await r.json();
      if (!Array.isArray(rows)) continue;

      for (const el of rows) {
        const k = Number(el?.destinationIndex);
        if (!Number.isInteger(k) || !batch[k]) continue;
        if (el.condition && el.condition !== 'ROUTE_EXISTS') continue;
        // duration arrives as a protobuf string: "1234s".
        const secs = typeof el.duration === 'string'
          ? Number(el.duration.replace(/s$/, ''))
          : null;
        if (secs == null || !isFinite(secs)) continue;
        batch[k].drive_seconds = Math.round(secs);
        const m = Math.round(secs / 60);
        batch[k].drive_text = m >= 60
          ? Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '')
          : m + ' min';
      }
    } catch (e) {
      /* Leave the batch unrouted. A distance we measured is still true; a
         duration we did not measure would be the fabrication this replaces. */
      note = note ?? (e instanceof Error ? e.message : 'routing call failed');
    }
  }
  return note;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const key = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  try {
    if (!serviceKey) return json({ error: 'Server misconfigured: no service role key' }, 500);
    if (!key) {
      return json({
        error: 'Google Maps is not configured on this project yet.',
        detail: 'Set GOOGLE_MAPS_API_KEY with the Places API and Distance Matrix API enabled. '
          + 'Until then no places are written, and the property page shows an honest empty state.',
      }, 503);
    }

    const admin = createClient(url, serviceKey);
    const body = (await req.json().catch(() => ({}))) as
      { property_id?: string; refresh?: boolean; city?: string; limit?: number };

    // Which listings to do: one, or every live one in a city.
    let targets: Array<{ id: string; latitude: number; longitude: number; title: string; city: string }> = [];
    if (body.property_id) {
      const { data } = await admin.from('properties')
        .select('id,latitude,longitude,title,city')
        .eq('id', body.property_id).is('deleted_at', null).limit(1);
      targets = (data ?? []) as typeof targets;
    } else if (body.city) {
      const { data } = await admin.from('properties')
        .select('id,latitude,longitude,title,city')
        .ilike('city', body.city).eq('status', 'live').is('deleted_at', null)
        .limit(Math.min(Math.max(Number(body.limit) || 25, 1), 100));
      targets = (data ?? []) as typeof targets;
    } else {
      return json({ error: 'Pass property_id, or city to backfill.' }, 400);
    }

    if (!targets.length) return json({ error: 'No matching listing.' }, 404);

    const results: Array<Record<string, unknown>> = [];

    for (const t of targets) {
      if (t.latitude == null || t.longitude == null) {
        results.push({ id: t.id, title: t.title, skipped: 'no coordinates on this listing' });
        continue;
      }

      if (!body.refresh) {
        const { count } = await admin.from('property_places')
          .select('id', { count: 'exact', head: true })
          .eq('property_id', t.id);
        if ((count ?? 0) > 0) {
          results.push({ id: t.id, title: t.title, skipped: 'already has places (pass refresh:true)' });
          continue;
        }
      }

      const found: Place[] = [];
      let failed: string | null = null;
      for (const spec of CATEGORIES) {
        try {
          found.push(...await nearby(key, t.latitude, t.longitude, spec));
        } catch (e) {
          failed = e instanceof Error ? e.message : 'places lookup failed';
          break;   // a key/billing fault will fail every category; stop asking
        }
      }
      if (failed) { results.push({ id: t.id, title: t.title, error: failed }); continue; }

      if (!found.length) {
        results.push({ id: t.id, title: t.title, places: 0, note: 'Google mapped nothing near this address' });
        continue;
      }

      /* One place can satisfy two categories -- a pharmacy that is also a
         supermarket comes back under both, with the same Google place id. An
         upsert whose batch contains that id twice is rejected outright:
         "ON CONFLICT DO UPDATE command cannot affect row a second time", which
         threw away all fourteen places for the Ring Road listing rather than
         the one duplicate. Keep the nearest sighting of each id; the category
         it was first found under is the one it is filed as. */
      const seenIds = new Set<string>();
      const unique = found
        .slice()
        .sort((a, b) => a.distance_m - b.distance_m)
        .filter((p) => (seenIds.has(p.provider_place_id) ? false : (seenIds.add(p.provider_place_id), true)));

      const routeError = await addDriveTimes(key, t.latitude, t.longitude, unique);

      const { error: upErr } = await admin.from('property_places').upsert(
        unique.map((p) => ({ ...p, property_id: t.id, source: 'google_places', fetched_at: new Date().toISOString() })),
        { onConflict: 'property_id,provider_place_id' },
      );
      if (upErr) { results.push({ id: t.id, title: t.title, error: upErr.message }); continue; }

      results.push({
        id: t.id, title: t.title, city: t.city,
        places: unique.length,
        routed: unique.filter((p) => p.drive_seconds != null).length,
        routingNote: routeError,
        nearest: unique[0]?.name ?? null,
      });
    }

    return json({ processed: results.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('property-intelligence fatal: ' + message);
    return json({ error: message }, 500);
  }
});
