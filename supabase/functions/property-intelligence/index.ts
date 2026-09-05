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

/* EVERYTHING GOOGLE WILL GIVE US, NOT A CURATED HANDFUL.

   This list used to carry a `keep` per row -- 3 schools, 2 hospitals, 1 bank
   -- and they summed to 14, which was exactly the number of places stored
   against every property in the database. The map was not thin because the
   neighbourhood was thin. It was thin because the code threw the rest away
   after paying for it.

   `keep` is gone. A map is a description of what is physically there; you
   filter it for display, you do not delete it at the source. Everything that
   comes back is stored, and the front end decides what to draw for the tab
   you are on.

   THE ONE LIMIT LEFT IS GOOGLE'S, NOT OURS. Nearby Search (New) returns at
   most 20 results per request -- maxResultCount is capped at 20 by the API,
   so asking for 100 returns 20. The way to get more coverage is therefore
   more TYPES, not a bigger number, which is why this list is now long and
   granular: primary_school and secondary_school find schools that plain
   `school` misses, grocery_store finds shops that `supermarket` does not.

   Each row is one request, charged once per property and then cached, so the
   cost is per listing rather than per visitor. At roughly 30 rows that is
   ~30 Places calls to survey a home, once, for its lifetime.

   Categories repeat on purpose: several types feed one category, because the
   front end's legend, filters and pin colours are keyed on the category, not
   on Google's type. A category outside that vocabulary would pin correctly
   and then be missing from every tab. */
const CATEGORIES: Array<{ category: string; type: string; radius: number }> = [
  // learning
  { category: 'school',      type: 'school',            radius: 4000 },
  { category: 'school',      type: 'primary_school',    radius: 4000 },
  { category: 'school',      type: 'secondary_school',  radius: 4000 },
  { category: 'university',  type: 'university',        radius: 15000 },
  { category: 'other',       type: 'library',           radius: 5000 },

  // health
  { category: 'hospital',    type: 'hospital',          radius: 8000 },
  { category: 'hospital',    type: 'doctor',            radius: 4000 },
  { category: 'hospital',    type: 'dental_clinic',     radius: 4000 },
  { category: 'pharmacy',    type: 'pharmacy',          radius: 4000 },
  { category: 'pharmacy',    type: 'drugstore',         radius: 4000 },

  // shopping and money
  { category: 'supermarket', type: 'supermarket',       radius: 4000 },
  { category: 'supermarket', type: 'grocery_store',     radius: 4000 },
  { category: 'supermarket', type: 'convenience_store', radius: 3000 },
  { category: 'market',      type: 'shopping_mall',     radius: 10000 },
  { category: 'market',      type: 'market',            radius: 6000 },
  { category: 'market',      type: 'department_store',  radius: 8000 },
  { category: 'bank',        type: 'bank',              radius: 4000 },
  { category: 'bank',        type: 'atm',               radius: 3000 },

  // eating and living
  { category: 'restaurant',  type: 'restaurant',        radius: 3000 },
  { category: 'restaurant',  type: 'meal_takeaway',     radius: 3000 },
  { category: 'restaurant',  type: 'bakery',            radius: 3000 },
  { category: 'cafe',        type: 'cafe',              radius: 3000 },
  { category: 'gym',         type: 'gym',               radius: 4000 },
  { category: 'gym',         type: 'fitness_center',    radius: 4000 },
  { category: 'park',        type: 'park',              radius: 5000 },
  { category: 'other',       type: 'hotel',             radius: 5000 },

  // getting about
  { category: 'transit',     type: 'bus_station',       radius: 8000 },
  { category: 'transit',     type: 'transit_station',   radius: 6000 },
  { category: 'transit',     type: 'train_station',     radius: 15000 },
  { category: 'transit',     type: 'taxi_stand',        radius: 5000 },
  { category: 'fuel',        type: 'gas_station',       radius: 4000 },

  // safety and worship
  { category: 'police',      type: 'police',            radius: 6000 },
  { category: 'police',      type: 'fire_station',      radius: 8000 },
  { category: 'church',      type: 'church',            radius: 3000 },
  { category: 'mosque',      type: 'mosque',            radius: 3000 },
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
  drive_seconds_morning: number | null;
  drive_seconds_midday: number | null;
  drive_seconds_evening: number | null;
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
    /* The status travels with the error because the caller has to tell two
       very different failures apart: a type this API does not recognise (400,
       this one row is unusable) versus a key, billing or quota fault (401,
       403, 429, every row is unusable). Before, both aborted the whole
       property. With a type list this long that would mean one unrecognised
       name costing a listing its entire survey. */
    throw Object.assign(new Error(`places ${spec.type}: HTTP ${r.status} — ${msg}`),
      { status: r.status });
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
        drive_seconds_morning: null,
        drive_seconds_midday: null,
        drive_seconds_evening: null,
      } as Place;
    })
    /* Nearest first, but a landmark slightly further out beats a nameless
       shopfront next door -- userRatingCount is the honest proxy for "is this
       somewhere people actually go". */
    .sort((a: Place, b: Place) =>
      (a.distance_m - b.distance_m) - Math.min(400, ((b.ratings_count ?? 0) - (a.ratings_count ?? 0)) * 2));
  /* No slice. Everything Google returned is kept and stored -- the ordering
     above decides what the page shows FIRST, not what survives. */
}

/* Driving times at the hours people actually travel.
   The page carries morning / midday / evening buttons. They used to multiply an
   invented number by another invented number; Google will answer the real
   question instead. computeRouteMatrix takes a departureTime and
   routingPreference TRAFFIC_AWARE, so 7:30am and 6pm are two measurements, not
   one measurement and two guesses.

   Four passes: free-flow, then the three departures. Each is a separate call
   because departureTime is per-request. A pass that fails leaves its column
   NULL -- never a multiple of another column, which is the whole point.

   Two shape notes. computeRouteMatrix answers with a STREAM of elements each
   carrying its own destinationIndex, so results are matched by that index and
   not by arrival order. And departureTime must be in the FUTURE, so each slot
   resolves to the next occurrence of that hour, not today's. */
const SLOTS: Array<{ key: 'morning' | 'midday' | 'evening'; hour: number }> = [
  { key: 'morning', hour: 7 },
  { key: 'midday', hour: 13 },
  { key: 'evening', hour: 18 },
];

/** Next occurrence of `hour` in West Africa Time (UTC+1), as RFC3339. */
function nextDeparture(hour: number): string {
  const now = new Date();
  const d = new Date(now);
  d.setUTCHours(hour - 1, 30, 0, 0);              // WAT is UTC+1, no DST
  if (d.getTime() <= now.getTime() + 60_000) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

async function routeMatrix(
  key: string, lat: number, lon: number, batch: Place[], departure: string | null,
): Promise<{ secs: Array<number | null>; error: string | null }> {
  const body: Record<string, unknown> = {
    origins: [{ waypoint: { location: { latLng: { latitude: lat, longitude: lon } } } }],
    destinations: batch.map((p) => ({
      waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lon } } },
    })),
    travelMode: 'DRIVE',
  };
  if (departure) {
    body.departureTime = departure;
    body.routingPreference = 'TRAFFIC_AWARE';
  }

  const out: Array<number | null> = batch.map(() => null);
  try {
    const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      let msg = detail.slice(0, 200);
      try { msg = JSON.parse(detail)?.error?.message ?? msg; } catch { /* keep raw */ }
      return { secs: out, error: msg };
    }
    const rows = await r.json();
    if (!Array.isArray(rows)) return { secs: out, error: 'unexpected Routes API shape' };
    for (const el of rows) {
      const k = Number(el?.destinationIndex);
      if (!Number.isInteger(k) || k < 0 || k >= out.length) continue;
      if (el.condition && el.condition !== 'ROUTE_EXISTS') continue;
      const secs = typeof el.duration === 'string' ? Number(el.duration.replace(/s$/, '')) : null;
      if (secs == null || !isFinite(secs)) continue;
      out[k] = Math.round(secs);
    }
    return { secs: out, error: null };
  } catch (e) {
    return { secs: out, error: e instanceof Error ? e.message : 'routing call failed' };
  }
}

/* Drive times are the expensive half and the slow half: four Routes calls per
   24 places -- free-flow plus three departure hours. That was fine against 14
   places. Against a full survey of several hundred it would be dozens of calls
   and a function that runs out of wall clock before it writes anything.

   So the survey is complete and the ROUTING is bounded. The nearest 40 get
   measured drive times; everything beyond that is still stored, still pinned,
   still searchable, and simply has no drive time attached -- which is the
   honest state for a place nobody has asked how long it takes to reach. */
const ROUTE_LIMIT = 40;

async function addDriveTimes(key: string, lat: number, lon: number, all: Place[]): Promise<string | null> {
  let note: string | null = null;
  const places = all.slice(0, ROUTE_LIMIT);
  const CHUNK = 24;
  for (let i = 0; i < places.length; i += CHUNK) {
    const batch = places.slice(i, i + CHUNK);

    const base = await routeMatrix(key, lat, lon, batch, null);
    if (base.error) note = note ?? base.error;
    base.secs.forEach((sv, k) => {
      if (sv == null) return;
      batch[k].drive_seconds = sv;
      const m = Math.round(sv / 60);
      batch[k].drive_text = m >= 60
        ? Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '')
        : m + ' min';
    });

    for (const slot of SLOTS) {
      const res = await routeMatrix(key, lat, lon, batch, nextDeparture(slot.hour));
      if (res.error) { note = note ?? res.error; continue; }
      res.secs.forEach((sv, k) => {
        if (sv == null) return;
        if (slot.key === 'morning') batch[k].drive_seconds_morning = sv;
        else if (slot.key === 'midday') batch[k].drive_seconds_midday = sv;
        else batch[k].drive_seconds_evening = sv;
      });
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
      const skippedTypes: string[] = [];
      for (const spec of CATEGORIES) {
        try {
          found.push(...await nearby(key, t.latitude, t.longitude, spec));
        } catch (e) {
          const status = (e as { status?: number }).status ?? 0;
          const msg = e instanceof Error ? e.message : 'places lookup failed';
          /* 400 means Google does not recognise THIS type -- its Table A
             changes, and a long list will eventually name something it has
             retired. That is one row's problem. Anything else (401, 403, 429,
             a network fault) will fail every remaining row too, so stop and
             say so rather than making thirty doomed calls. */
          if (status === 400) { skippedTypes.push(spec.type); continue; }
          failed = msg;
          break;
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
        // Named so a retired Google type shows up as a line in the response
        // rather than as places quietly going missing.
        skippedTypes: skippedTypes.length ? skippedTypes : undefined,
        routed: unique.filter((p) => p.drive_seconds != null).length,
        routedByHour: unique.filter((p) => p.drive_seconds_morning != null).length,
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
