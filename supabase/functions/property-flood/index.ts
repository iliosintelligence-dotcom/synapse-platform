/**
 * property-flood — is this listing inside the modelled river flood zone, and how deep?
 *
 * Reads the JRC / Copernicus GloFAS v2.1.2 flood DEPTH rasters (10-year and 100-year return
 * periods, 90 m) straight from their public cloud-optimised GeoTIFFs at the listing's exact pin
 * (property_private, falling back to the public rounded pin) and stores the answer in
 * property_flood. One read per listing, not per visitor.
 *
 * HONEST SCOPE: this is a RIVER flood model. It says nothing about heavy-rain drainage flooding
 * or coastal and lagoon surge. "Outside the zone" therefore means only "not in the modelled river
 * flood extent"; the page shows that caveat with every result.
 *
 * POST { property_id }  -> { in_zone_100, depth_100_m, in_zone_10, depth_10_m, covered, checked_at }
 * Public by design (verify_jwt = false) because the property page is public, but it is cheap and
 * idempotent: an existing answer is returned as it is, nothing is recomputed, and only live
 * listings are looked up. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fromUrl } from 'npm:geotiff@2.1.3';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const BASE = 'https://data.source.coop/nlebovits/jrc-glofas';
/* The four 10-degree tiles that cover Nigeria. The raster's own bounding box is used for the
   pixel maths; w/s/e/n here only choose the tile. */
const TILES: Array<{ id: string; w: number; s: number; e: number; n: number }> = [
  { id: 'ID118_N10_W0', w: 0, s: 0, e: 10, n: 10 },
  { id: 'ID117_N20_W0', w: 0, s: 10, e: 10, n: 20 },
  { id: 'ID126_N10_E10', w: 10, s: 0, e: 20, n: 10 },
  { id: 'ID125_N20_E10', w: 10, s: 10, e: 20, n: 20 },
];

async function depthAt(rp: 10 | 100, tileId: string, lat: number, lng: number): Promise<number> {
  const url = `${BASE}/depth-rp${rp}/${tileId}/${tileId}_RP${rp}_depth.tif`;
  const tiff = await fromUrl(url);
  const img = await tiff.getImage();
  const [x0, y0, x1, y1] = img.getBoundingBox();
  const w = img.getWidth(), h = img.getHeight();
  const px = Math.floor(((lng - x0) / (x1 - x0)) * w), py = Math.floor(((y1 - lat) / (y1 - y0)) * h);
  if (px < 0 || py < 0 || px >= w || py >= h) return 0;
  /* A 3x3 window, not one pixel: a pin on a river bank sits within 90 m of the model's edge, and
     one pixel is a coin flip. The deepest of the nine is what "this spot floods" should mean. */
  const win = [Math.max(px - 1, 0), Math.max(py - 1, 0), Math.min(px + 2, w), Math.min(py + 2, h)];
  const r = await img.readRasters({ window: win });
  const nodata = img.getGDALNoData() ?? -9999;
  let best = 0;
  for (const v of r[0] as ArrayLike<number>) if (v !== nodata && v > best && v < 100) best = v;
  return best;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { property_id } = await req.json().catch(() => ({}));
    if (!property_id || !/^[0-9a-f-]{36}$/i.test(String(property_id))) return json({ error: 'property_id required' }, 400);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: have } = await admin.from('property_flood').select('*').eq('property_id', property_id).maybeSingle();
    if (have) return json(have);

    const { data: p } = await admin.from('properties').select('id,latitude,longitude,status,deleted_at').eq('id', property_id).maybeSingle();
    if (!p || p.deleted_at || p.status !== 'live') return json({ error: 'not found' }, 404);
    const { data: priv } = await admin.from('property_private').select('latitude,longitude').eq('property_id', property_id).maybeSingle();
    const lat = Number(priv?.latitude ?? p.latitude), lng = Number(priv?.longitude ?? p.longitude);
    if (!isFinite(lat) || !isFinite(lng)) return json({ error: 'no pin' }, 422);

    const tile = TILES.find((t) => lng >= t.w && lng < t.e && lat >= t.s && lat < t.n);
    let row;
    if (!tile) {
      row = { property_id, in_zone_100: false, depth_100_m: null, in_zone_10: false, depth_10_m: null, covered: false };
    } else {
      const [d100, d10] = await Promise.all([depthAt(100, tile.id, lat, lng), depthAt(10, tile.id, lat, lng)]);
      row = {
        property_id, covered: true,
        in_zone_100: d100 > 0, depth_100_m: d100 > 0 ? Math.round(d100 * 100) / 100 : null,
        in_zone_10: d10 > 0, depth_10_m: d10 > 0 ? Math.round(d10 * 100) / 100 : null,
      };
    }
    const { data: saved, error } = await admin.from('property_flood').upsert(row, { onConflict: 'property_id' }).select('*').single();
    if (error) return json({ error: error.message }, 500);
    return json(saved);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'failed' }, 502);
  }
});
