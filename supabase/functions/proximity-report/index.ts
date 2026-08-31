/**
 * proximity-report — a device says where it is; the SERVER decides everything else.
 *
 * The client (notify.js) reports a position at most once a minute while a page
 * is open. This function:
 *   1. moves that person's geofence watch to the new point,
 *   2. asks Postgres for candidates via proximity_candidates(),
 *   3. records each one in `notifications`,
 *   4. sends the web push.
 *
 * ALL the judgement lives in proximity_candidates(): radius, brief matching,
 * verified-only, the 14-day freshness rule, quiet hours, the daily cap and
 * per-property de-duplication. This function deliberately re-implements none
 * of it — two copies of a notification policy is how people get buzzed at 3am
 * after someone edits one of them.
 *
 * PRIVACY. The raw fix is never stored. It is rounded to ~3 decimal places
 * (about 100m) before it touches the database, which is far finer than the
 * 1.2km default radius needs and much coarser than a movement trail. No
 * agency can read these rows: the watch is keyed to the visitor, and the
 * agency only ever learns that someone nearby saw a listing.
 *
 * verify_jwt = false: proximity is offered to anonymous visitors, who are
 * identified by the same visitor_id Toju already uses. A signed-in user is
 * matched by user_id when a bearer token is present.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

/* ── VAPID ────────────────────────────────────────────────────────────────
   Keys are stored in the standard base64url form that `npx web-push
   generate-vapid-keys` produces, because that is the command everyone can
   find. WebCrypto wants JWK, so they are converted here rather than making
   the operator hand-assemble a JWK. */
const b64urlToBytes = (s: string): Uint8Array => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};
const bytesToB64url = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function vapidSigningKey(privB64: string, pubB64: string): Promise<CryptoKey> {
  const priv = b64urlToBytes(privB64);
  const pub = b64urlToBytes(pubB64);           // 65 bytes: 0x04 || X(32) || Y(32)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be an uncompressed P-256 point');
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: bytesToB64url(priv),
    ext: true, key_ops: ['sign'],
  };
  return await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** VAPID JWT (ES256), scoped to the push service's own origin. */
async function vapidAuth(endpoint: string, subject: string, privB64: string, pubB64: string) {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64url(new TextEncoder().encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject,
  })));
  const key = await vapidSigningKey(privB64, pubB64);
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${body}`),
  ));
  return { jwt: `${header}.${body}.${bytesToB64url(sig)}` };
}

/* ── RFC 8291 payload encryption (aes128gcm) ──────────────────────────────
   Written out rather than pulled from a library: this runs on an edge
   runtime where a Node-targeted push library tends to fail on `crypto`, and
   the whole scheme is ~60 lines of WebCrypto. */
const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) => {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
};
const concat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0; for (const x of a) { out.set(x, o); o += x.length; }
  return out;
};

async function encryptPayload(plaintext: string, p256dhB64: string, authB64: string) {
  const clientPub = b64urlToBytes(p256dhB64);
  const authSecret = b64urlToBytes(authB64);

  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const clientKey = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, local.privateKey, 256));

  const enc = new TextEncoder();
  const prk = await hkdf(
    authSecret, shared,
    concat(enc.encode('WebPush: info\0'), clientPub, localPubRaw), 32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // the record is padded with a single 0x02 delimiter (last record)
  const body = concat(enc.encode(plaintext), new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, body));

  // aes128gcm header: salt(16) | rs(4) | idlen(1) | keyid(65)
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([localPubRaw.length]), localPubRaw, ct);
}

async function sendPush(sub: { endpoint: string; p256dh: string; auth_key: string }, payload: unknown) {
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:partnerships@synapse.ng';
  if (!priv || !pub) return { ok: false, status: 0, reason: 'vapid-not-configured' };

  const bodyBytes = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth_key);
  const { jwt } = await vapidAuth(sub.endpoint, subject, priv, pub);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '900',                                   // a proximity ping is worthless tomorrow
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Urgency: 'normal',
      Authorization: `vapid t=${jwt}, k=${pub}`,
    },
    body: bodyBytes,
  });
  return { ok: res.ok, status: res.status, reason: res.ok ? null : await res.text().catch(() => '') };
}

/* ── handler ─────────────────────────────────────────────────────────────── */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = createClient(url, svc, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({})) as { lat?: number; lon?: number; visitorId?: string };
    const lat = Number(body.lat), lon = Number(body.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return json({ error: 'lat/lon required' }, 400);
    }
    // ~100m. Finer than the radius needs, coarser than a trail.
    const rlat = Math.round(lat * 1000) / 1000;
    const rlon = Math.round(lon * 1000) / 1000;

    // Who is this? A bearer token wins; otherwise the visitor id.
    let userId: string | null = null;
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token && token !== Deno.env.get('SUPABASE_ANON_KEY')) {
      const { data } = await db.auth.getUser(token);
      userId = data?.user?.id ?? null;
    }
    const visitorId = typeof body.visitorId === 'string' ? body.visitorId : null;
    if (!userId && !visitorId) return json({ error: 'no identity' }, 400);

    // Move the watch. No watch means proximity was never switched on: say so
    // rather than quietly creating one — consent is granted in the app, not here.
    const sel = db.from('geofence_watches').select('id, enabled').limit(1);
    const { data: watches } = userId
      ? await sel.eq('user_id', userId)
      : await sel.eq('visitor_id', visitorId!);
    const watch = watches?.[0];
    if (!watch) return json({ ok: true, matched: 0, note: 'no active watch' });
    if (!watch.enabled) return json({ ok: true, matched: 0, note: 'watch disabled' });

    const { error: upErr } = await db
      .from('geofence_watches')
      .update({
        last_point: `SRID=4326;POINT(${rlon} ${rlat})`,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', watch.id);
    if (upErr) return json({ error: upErr.message }, 500);

    // Postgres owns the policy. Whatever comes back is already allowed to send.
    const { data: candidates, error: cErr } = await db.rpc('proximity_candidates', { p_watch_id: watch.id });
    if (cErr) return json({ error: cErr.message }, 500);
    if (!candidates?.length) return json({ ok: true, matched: 0 });

    // Their push endpoints. Customer side only — an agency device must never
    // receive a buyer's proximity alert.
    const psel = db.from('push_subscriptions').select('id, endpoint, p256dh, auth_key').eq('side', 'customer');
    const { data: subs } = userId
      ? await psel.eq('user_id', userId)
      : await psel.eq('visitor_id', visitorId!);

    let sent = 0;
    const delivered: string[] = [];
    for (const c of candidates as Array<Record<string, unknown>>) {
      const propertyId = String(c.property_id);
      const distance = Math.round(Number(c.distance_m) || 0);
      const payload = {
        kind: 'proximity_match',
        title: 'A verified home, right here',
        body: `${c.title} · ${distance}m away · verified`,
        route: `/app/property.html?id=${propertyId}`,
        propertyId,
      };

      // Record first. If the send fails the row still blocks a re-send of the
      // same property, which is the behaviour we want: better a missed ping
      // than the same house twice.
      const { data: nRow, error: nErr } = await db.from('notifications').insert({
        recipient_id: userId,
        visitor_id: userId ? null : visitorId,
        channel: 'push',
        kind: 'proximity_match',
        side: 'customer',
        route: payload.route,
        property_id: propertyId,
        payload,
        status: 'pending',
      }).select('id').single();
      if (nErr || !nRow) continue;

      let anySent = false;
      for (const s of subs ?? []) {
        if (!s.p256dh || !s.auth_key) continue;
        const r = await sendPush(s as never, payload);
        if (r.ok) { sent++; anySent = true; continue; }
        // 404/410 mean the browser threw the subscription away. Drop it, or it
        // is retried forever on every future position report.
        if (r.status === 404 || r.status === 410) {
          await db.from('push_subscriptions').delete().eq('id', s.id);
        }
      }
      if (anySent) delivered.push(nRow.id as string);
    }

    // Only the rows that actually went out are marked sent — by id, so a
    // concurrent report cannot flip somebody else's row.
    if (delivered.length) {
      await db.from('notifications')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .in('id', delivered);
    }

    return json({ ok: true, matched: candidates.length, sent });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unknown' }, 500);
  }
});
