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
 * Requires GOOGLE_MAPS_API_KEY (Places API + Distance Matrix API enabled).
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
  const url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
    + `?location=${lat},${lon}&radius=${spec.radius}&type=${spec.type}&key=${encodeURIComponent(key)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`places ${spec.type} http ${r.status}`);
  const d = await r.json();

  // Google reports its own errors in the body with HTTP 200. REQUEST_DENIED
  // almost always means the key is missing an API or a billing account, and it
  // must surface rather than look like "no places here".
  if (d.status && !['OK', 'ZERO_RESULTS'].includes(d.status)) {
    throw new Error(`places ${spec.type}: ${d.status}${d.error_message ? ' — ' + d.error_message : ''}`);
  }

  return (d.results ?? [])
    .filter((p: Record<string, never>) => p.place_id && p.name && p.geometry?.location)
    .map((p: Record<string, never>) => {
      const g = p.geometry.location;
      return {
        provider_place_id: String(p.place_id),
        name: String(p.name),
        category: spec.category,
        lat: Number(g.lat),
        lon: Number(g.lng),
        distance_m: haversineM(lat, lon, Number(g.lat), Number(g.lng)),
        rating: p.rating != null ? Number(p.rating) : null,
        ratings_count: p.user_ratings_total != null ? Number(p.user_ratings_total) : null,
        drive_seconds: null,
        drive_text: null,
      } as Place;
    })
    /* Nearest first, but a landmark slightly further out beats a nameless
       shopfront next door -- ratings_count is the honest proxy for "is this
       somewhere people actually go". */
    .sort((a: Place, b: Place) =>
      (a.distance_m - b.distance_m) - Math.min(400, ((b.ratings_count ?? 0) - (a.ratings_count ?? 0)) * 2))
    .slice(0, spec.keep);
}

/** Real driving times, in one call for up to 25 destinations. */
async function addDriveTimes(key: string, lat: number, lon: number, places: Place[]): Promise<void> {
  for (let i = 0; i < places.length; i += 25) {
    const batch = places.slice(i, i + 25);
    const dests = batch.map((p) => `${p.lat},${p.lon}`).join('|');
    const url = 'https://maps.googleapis.com/maps/api/distancematrix/json'
      + `?origins=${lat},${lon}&destinations=${encodeURIComponent(dests)}`
      + `&mode=driving&key=${encodeURIComponent(key)}`;
    try {
      const r = await fetch(url);
      const d = await r.json();
      const row = d?.rows?.[0]?.elements ?? [];
      batch.forEach((p, k) => {
        const el = row[k];
        if (el?.status === 'OK' && el.duration) {
          p.drive_seconds = Number(el.duration.value);
          p.drive_text = String(el.duration.text);
        }
        // else: left NULL. Distance is still true; a time we did not measure
        // would be exactly the fabrication this replaces.
      });
    } catch {
      /* leave the batch unrouted; distances stand on their own */
    }
  }
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

      await addDriveTimes(key, t.latitude, t.longitude, found);

      const { error: upErr } = await admin.from('property_places').upsert(
        found.map((p) => ({ ...p, property_id: t.id, source: 'google_places', fetched_at: new Date().toISOString() })),
        { onConflict: 'property_id,provider_place_id' },
      );
      if (upErr) { results.push({ id: t.id, title: t.title, error: upErr.message }); continue; }

      results.push({
        id: t.id, title: t.title, city: t.city,
        places: found.length,
        routed: found.filter((p) => p.drive_seconds != null).length,
        nearest: found.slice().sort((a, b) => a.distance_m - b.distance_m)[0]?.name ?? null,
      });
    }

    return json({ processed: results.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('property-intelligence fatal: ' + message);
    return json({ error: message }, 500);
  }
});
