/**
 * property-flood, river flood exposure for one listing, and the flood map around it.
 *
 * Reads the JRC / Copernicus GloFAS v2.1.2 flood DEPTH rasters (10-year and 100-year return
 * periods, 90 m) straight from their public cloud-optimised GeoTIFFs and stores the answer in
 * property_flood: inside the 100-year / 10-year river flood extent or not, the modelled depth, and
 * how far the nearest flood water is (within 3.5 km). One read per listing, not per visitor.
 *
 * HONEST SCOPE: a RIVER flood model. Nothing about heavy-rain drainage flooding or coastal and
 * lagoon surge. The page says so in its tooltips and on the flood map's legend.
 *
 * POST { property_id }               -> the stored row (computed once)
 * POST { property_id, grid: true }   -> { bbox:[w,s,e,n], cols, rows, depth_b64 } the 100-year depth
 *      around the home, 3.5 km each way, depth in 5 cm steps (uint8) base64, for drawing the flood
 *      map. It is centred on the PUBLIC (rounded) pin, never the exact one, so it cannot be used to
 *      work out where the exact address is.
 *
 * Public (verify_jwt = false) because the property page is public; cheap and idempotent. Only live
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
const TILES: Array<{ id: string; w: number; s: number; e: number; n: number }> = [
  { id: 'ID118_N10_W0', w: 0, s: 0, e: 10, n: 10 },
  { id: 'ID117_N20_W0', w: 0, s: 10, e: 10, n: 20 },
  { id: 'ID126_N10_E10', w: 10, s: 0, e: 20, n: 10 },
  { id: 'ID125_N20_E10', w: 10, s: 10, e: 20, n: 20 },
];
const RADIUS_DEG = 0.0315; // about 3.5 km

// deno-lint-ignore no-explicit-any
async function openTile(rp: 10 | 100, tileId: string): Promise<any> {
  const tiff = await fromUrl(`${BASE}/depth-rp${rp}/${tileId}/${tileId}_RP${rp}_depth.tif`);
  const img = await tiff.getImage();
  const [x0, y0, x1, y1] = img.getBoundingBox();
  return { img, x0, y0, x1, y1, w: img.getWidth(), h: img.getHeight(), nodata: img.getGDALNoData() ?? -9999 };
}

// deno-lint-ignore no-explicit-any
function px(t: any, lat: number, lng: number) {
  return {
    x: Math.floor(((lng - t.x0) / (t.x1 - t.x0)) * t.w),
    y: Math.floor(((t.y1 - lat) / (t.y1 - t.y0)) * t.h),
  };
}

// deno-lint-ignore no-explicit-any
async function windowAround(t: any, lat: number, lng: number, deg: number) {
  const a = px(t, lat + deg, lng - deg), b = px(t, lat - deg, lng + deg);
  const x0 = Math.max(0, a.x), y0 = Math.max(0, a.y), x1 = Math.min(t.w, b.x), y1 = Math.min(t.h, b.y);
  if (x1 <= x0 || y1 <= y0) return null;
  const r = await t.img.readRasters({ window: [x0, y0, x1, y1] });
  return { data: r[0] as ArrayLike<number>, cols: x1 - x0, rows: y1 - y0, x0, y0, x1, y1 };
}

// deno-lint-ignore no-explicit-any
function depthHere(t: any, win: any, lat: number, lng: number): number {
  const c = px(t, lat, lng);
  let best = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = c.x + dx - win.x0, cy = c.y + dy - win.y0;
    if (cx < 0 || cy < 0 || cx >= win.cols || cy >= win.rows) continue;
    const v = win.data[cy * win.cols + cx];
    if (v !== t.nodata && v > best && v < 100) best = v;
  }
  return best;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const property_id = String(body.property_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(property_id)) return json({ error: 'property_id required' }, 400);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: p } = await admin.from('properties').select('id,latitude,longitude,status,deleted_at').eq('id', property_id).maybeSingle();
    if (!p || p.deleted_at || p.status !== 'live') return json({ error: 'not found' }, 404);

    /* ── the flood map: depth around the PUBLIC pin ── */
    if (body.grid) {
      const lat = Number(p.latitude), lng = Number(p.longitude);
      const tile = TILES.find((t) => lng >= t.w && lng < t.e && lat >= t.s && lat < t.n);
      if (!tile) return json({ error: 'outside coverage' }, 422);
      const t = await openTile(100, tile.id);
      const win = await windowAround(t, lat, lng, RADIUS_DEG);
      if (!win) return json({ error: 'no data' }, 422);
      const out = new Uint8Array(win.cols * win.rows);
      for (let i = 0; i < out.length; i++) {
        const v = win.data[i];
        out[i] = v === t.nodata || v <= 0 || v >= 100 ? 0 : Math.min(255, Math.max(1, Math.round(v * 20)));
      }
      let bin = '';
      for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
      const west = t.x0 + (win.x0 / t.w) * (t.x1 - t.x0), east = t.x0 + (win.x1 / t.w) * (t.x1 - t.x0);
      const north = t.y1 - (win.y0 / t.h) * (t.y1 - t.y0), south = t.y1 - (win.y1 / t.h) * (t.y1 - t.y0);
      return json({ bbox: [west, south, east, north], cols: win.cols, rows: win.rows, depth_b64: btoa(bin), step_m: 0.05 });
    }

    /* ── the stored answer ── */
    const { data: have } = await admin.from('property_flood').select('*').eq('property_id', property_id).maybeSingle();
    if (have && (have.measured || have.covered === false)) return json(have);

    const { data: priv } = await admin.from('property_private').select('latitude,longitude').eq('property_id', property_id).maybeSingle();
    const lat = Number(priv?.latitude ?? p.latitude), lng = Number(priv?.longitude ?? p.longitude);
    if (!isFinite(lat) || !isFinite(lng)) return json({ error: 'no pin' }, 422);

    const tile = TILES.find((t) => lng >= t.w && lng < t.e && lat >= t.s && lat < t.n);
    let row;
    if (!tile) {
      row = { property_id, in_zone_100: false, depth_100_m: null, in_zone_10: false, depth_10_m: null, covered: false, nearest_flood_m: null, measured: true };
    } else {
      const [t100, t10] = await Promise.all([openTile(100, tile.id), openTile(10, tile.id)]);
      const [w100, w10] = await Promise.all([windowAround(t100, lat, lng, RADIUS_DEG), windowAround(t10, lat, lng, 0.002)]);
      const d100 = w100 ? depthHere(t100, w100, lat, lng) : 0;
      const d10 = w10 ? depthHere(t10, w10, lat, lng) : 0;
      /* distance to the nearest flooded cell in the 3.5 km window, in metres */
      let nearest: number | null = null;
      if (w100) {
        const c = px(t100, lat, lng), cx = c.x - w100.x0, cy = c.y - w100.y0;
        let best = Infinity;
        for (let y = 0; y < w100.rows; y++) for (let x = 0; x < w100.cols; x++) {
          const v = w100.data[y * w100.cols + x];
          if (v !== t100.nodata && v > 0 && v < 100) {
            const d = Math.hypot(x - cx, y - cy);
            if (d < best) best = d;
          }
        }
        if (best !== Infinity) nearest = Math.round(best * 92); // 90 m cells, ~92 m at this latitude
      }
      row = {
        property_id, covered: true, measured: true,
        in_zone_100: d100 > 0, depth_100_m: d100 > 0 ? Math.round(d100 * 100) / 100 : null,
        in_zone_10: d10 > 0, depth_10_m: d10 > 0 ? Math.round(d10 * 100) / 100 : null,
        nearest_flood_m: d100 > 0 ? 0 : nearest,
      };
    }
    const { data: saved, error } = await admin.from('property_flood').upsert(row, { onConflict: 'property_id' }).select('*').single();
    if (error) return json({ error: error.message }, 500);
    return json(saved);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'failed' }, 502);
  }
});
