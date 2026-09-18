/**
 * geocode-listings — puts a map pin on every listing that has an address.
 *
 * WHY THIS IS SERVER-SIDE. The portal's listing form geocodes as you type, and
 * that is worth keeping: the agent sees the pin land and can correct it. But a
 * form is not a guarantee. It only runs when somebody uses that form, in a
 * browser, with the network holding — and it does nothing for a listing that
 * arrives by import, by API, or from any screen written later. Every listing a
 * real agency had uploaded before this was unplaced, and nothing anywhere said
 * so, because the 501 seeded rows had coordinates written directly and made the
 * board look healthy.
 *
 * So the form is the fast path and this is the guarantee. It is idempotent and
 * safe to run as often as you like: it only ever fills coordinates that are
 * NULL, and never touches one that is already set — including one an agent
 * placed by hand, which must always win over anything guessed from text.
 *
 * THE LADDER, and why it ends at the area. Measured against Nominatim:
 *
 *     "Number 4, Ekiti street, Bodija, Ibadan, Oyo, Nigeria"   no match
 *     "Ekiti street, Bodija, Ibadan, Nigeria"                  7.41636, 3.90264
 *
 * Nigerian OSM holds streets but almost no house numbers, so a leading
 * "Number 4," guarantees a miss on an address that is otherwise findable. And
 * "Awolowo Road, Bodija" and "Okeola Agbowo Street" miss even with the number
 * stripped — those streets are not mapped at all — while "Bodija, Ibadan" and
 * "Agbowo, Ibadan" both resolve. The area is the thing this map data actually
 * has, and a pin in the right neighbourhood is worth far more than no pin: it
 * puts the home in the part of town a buyer is choosing between.
 *
 * POST body (all optional):
 *   { "id": "<uuid>" }   just this one, newly posted
 *   { "limit": 25 }      how many unplaced listings to work through
 *   { "dryRun": true }   report what it would do, write nothing
 */
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/* Nominatim's usage policy asks for an identifying User-Agent and no more than
   one request a second. Both are kept below. A free service we are guests on
   gets treated like one — the alternative is being blocked, and then no
   listing anywhere gets a pin. */
const UA = 'Synapse/1.0 (+https://www.synapsecore.dev; ilios.intelligence@gmail.com)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const PAUSE_MS = 1100;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Same expression the portal form uses. Kept deliberately narrow: it strips a
   LEADING house number only, never a number in the middle of a street name
   ("Road 7 Estate" keeps its 7). */
const HOUSE_NO =
  /^\s*(?:(?:no|number|nos|house|flat|plot|suite|apt|apartment|block)\s*\.?\s*)?\d+\s*[a-z]?\s*(?:[,/-]\s*|\s+)/i;

interface Row {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  neighbourhoods: { name: string | null } | null;
}

type Rung = { q: string; how: 'address' | 'street' | 'area' | 'city' };

export function geoLadder(addr: string, hood: string, city: string, state: string): Rung[] {
  const A = (addr ?? '').trim();
  const H = (hood ?? '').trim();
  const C = (city ?? '').trim();
  const S = (state ?? '').trim();
  /* The area belongs in the street rungs too, unless the address already says
     it — several cities have a street of the same name and the area is what
     separates them. Skipped when already present so the query does not read
     "...Bodija, Bodija, Ibadan". */
  const near = H && A.toLowerCase().indexOf(H.toLowerCase()) < 0 ? [H] : [];
  const tail = [C, S, 'Nigeria'].filter(Boolean);
  const rungs: Rung[] = [];
  if (A) rungs.push({ q: [A, ...near, ...tail].join(', '), how: 'address' });
  const street = A.replace(HOUSE_NO, '').trim();
  /* Only worth a second request when stripping changed something, and only
     when what is left still names a street rather than a bare number. */
  if (street && street !== A && /[a-z]/i.test(street)) {
    rungs.push({ q: [street, ...near, ...tail].join(', '), how: 'street' });
  }
  if (H) rungs.push({ q: [H, ...tail].join(', '), how: 'area' });
  if (C) rungs.push({ q: tail.join(', '), how: 'city' });
  return rungs;
}

async function askNominatim(q: string): Promise<{ lat: number; lon: number } | null> {
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=ng&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    const hit = Array.isArray(rows) && rows[0];
    if (!hit || hit.lat == null || hit.lon == null) return null;
    const lat = Number(hit.lat), lon = Number(hit.lon);
    /* A number that is not a number, or a pin outside Nigeria, is a miss and
       not a result. countrycodes=ng should make the second impossible; it is
       checked anyway because a bad pin is worse than no pin, and this writes
       to every listing on the map. */
    if (!isFinite(lat) || !isFinite(lon)) return null;
    if (lat < 4 || lat > 14 || lon < 2 || lon > 15) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

async function place(r: Row): Promise<{ lat: number; lon: number; how: string } | null> {
  const rungs = geoLadder(r.address ?? '', r.neighbourhoods?.name ?? '', r.city ?? '', r.state ?? '');
  for (let i = 0; i < rungs.length; i++) {
    const hit = await askNominatim(rungs[i].q);
    if (hit) return { ...hit, how: rungs[i].how };
    if (i < rungs.length - 1) await sleep(PAUSE_MS);   // only paid on a miss
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SB_URL || !SERVICE_KEY) return json({ error: 'Server misconfigured' }, 500);

  const body = (await req.json().catch(() => ({}))) as { id?: string; limit?: number; dryRun?: boolean };
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 50);
  const dryRun = body.dryRun === true;

  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

  /* Only rows that need it: live, not deleted, carrying an address, and with
     NO coordinates. That last clause is what makes this safe to run on a
     schedule — a listing an agent pinned by hand is never revisited. */
  const conds = [
    'status=eq.live',
    'is_active=is.true',
    'deleted_at=is.null',
    'address=not.is.null',
    'address=neq.',
    'or=(latitude.is.null,longitude.is.null)',
    /* NO geo_precision FILTER HERE, and that is deliberate after measuring it.
       `geo_precision=not.eq.manual` looks like sensible belt-and-braces against
       overwriting a hand-placed pin, and it matched 0 of 503 rows: PostgREST
       renders it as NOT (col = 'manual'), which is NULL — and therefore false —
       for every row whose precision is unset, which is all of them. It would
       have disabled this function completely and silently.

       It is also unnecessary. 'manual' means a human typed coordinates, so such
       a row HAS them, and the clause above already excludes anything placed.
       One correct condition beats two where the second quietly negates it. */
  ];
  if (body.id) conds.push(`id=eq.${body.id}`);

  const q = `${SB_URL}/rest/v1/properties`
    + `?select=id,address,city,state,neighbourhoods(name)&${conds.join('&')}`
    + `&order=created_at.desc&limit=${limit}`;

  const res = await fetch(q, { headers: h });
  if (!res.ok) return json({ error: `read failed ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);
  const rows = (await res.json()) as Row[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ looked_at: 0, placed: 0, unplaced: 0, results: [], note: 'nothing needs a pin' });
  }

  const results: unknown[] = [];
  let placed = 0, unplaced = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const got = await place(r);
    if (!got) {
      unplaced++;
      results.push({ id: r.id, address: r.address, placed: false });
    } else if (dryRun) {
      placed++;
      results.push({ id: r.id, address: r.address, placed: true, how: got.how, lat: got.lat, lon: got.lon, dryRun: true });
    } else {
      /* Written one row at a time on purpose. A failure here must cost that
         listing its pin and nothing else — a batch that half-applies leaves
         nobody able to say which half. */
      const up = await fetch(`${SB_URL}/rest/v1/properties?id=eq.${r.id}`, {
        method: 'PATCH',
        headers: { ...h, Prefer: 'return=minimal' },
        /* The rung goes in with the coordinates, in the same write. A pin
           whose precision is unknown is a pin that gets drawn as though it
           were surveyed, which is exactly what the column exists to stop —
           and two rows written a moment apart, one with precision and one
           without, is how that gap appears. */
        body: JSON.stringify({ latitude: got.lat, longitude: got.lon, geo_precision: got.how }),
      });
      if (up.ok) {
        placed++;
        results.push({ id: r.id, address: r.address, placed: true, how: got.how, lat: got.lat, lon: got.lon });
      } else {
        unplaced++;
        results.push({ id: r.id, address: r.address, placed: false, error: `write ${up.status}` });
      }
    }
    if (i < rows.length - 1) await sleep(PAUSE_MS);
  }

  return json({ looked_at: rows.length, placed, unplaced, dryRun, results });
});
