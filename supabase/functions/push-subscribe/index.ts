/**
 * push-subscribe — the only way a browser gets a row into push_subscriptions
 * or geofence_watches.
 *
 * WHY THIS EXISTS. notify.js used to POST to /rest/v1 directly. Both tables
 * carry a single policy (`authenticated` AND user_id = auth.uid()), so an
 * anonymous visitor was refused outright — "new row violates row-level
 * security policy" — and proximity alerts could never be switched on without
 * an account. Proximity is deliberately offered before sign-up, the same way
 * Toju is, so the fix is not to loosen RLS for anonymous writers. It is to
 * keep both tables closed to browsers entirely and let one reviewed endpoint
 * do the writing, which is how create-lead already works here.
 *
 * IDENTITY. A bearer token wins and binds the row to user_id. Otherwise the
 * row is bound to the caller's visitor_id — the same id Toju already uses.
 * A caller can therefore only ever write its own row: every statement below
 * is scoped by one or the other, never by anything taken from the body.
 *
 * verify_jwt = false so an anonymous visitor can reach it at all.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const DEAL_TYPES = ['rent', 'sale', 'shortlet'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? '');

    /* Identity is resolved here and never read from the body beyond the
       visitor id, so a caller cannot write a row for somebody else. */
    let userId: string | null = null;
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token && token !== Deno.env.get('SUPABASE_ANON_KEY')) {
      const { data } = await db.auth.getUser(token);
      userId = data?.user?.id ?? null;
    }
    const visitorId = typeof body.visitorId === 'string' && body.visitorId.trim()
      ? body.visitorId.trim().slice(0, 64) : null;
    if (!userId && !visitorId) return json({ error: 'no identity' }, 400);

    const owner = userId ? { user_id: userId } : { visitor_id: visitorId };
    const scope = <T extends { eq: (c: string, v: unknown) => T }>(q: T): T =>
      userId ? q.eq('user_id', userId) : q.eq('visitor_id', visitorId);

    /* ── store a push endpoint ───────────────────────────────────────── */
    if (action === 'subscribe') {
      const sub = (body.subscription ?? {}) as Record<string, string>;
      const endpoint = String(sub.endpoint ?? '');
      // Only ever a real push service URL: this string is later fetched by
      // proximity-report, so an attacker-supplied host would turn the sender
      // into a request forwarder.
      if (!/^https:\/\/[^\s]+$/i.test(endpoint)) return json({ error: 'bad endpoint' }, 400);
      const side = body.side === 'agency' ? 'agency' : 'customer';

      // One row per endpoint. A browser re-subscribing must update, not
      // accumulate, or every future push is sent several times over.
      const { data: existing } = await db.from('push_subscriptions')
        .select('id').eq('endpoint', endpoint).limit(1);

      const row = {
        ...owner,
        endpoint,
        p256dh: sub.p256dh ?? null,
        auth_key: sub.auth ?? sub.auth_key ?? null,
        platform: 'web',
        side,
      };
      const res = existing?.[0]
        ? await db.from('push_subscriptions').update(row).eq('id', existing[0].id)
        : await db.from('push_subscriptions').insert(row);
      if (res.error) return json({ error: res.error.message }, 500);
      return json({ ok: true });
    }

    /* ── create or move the geofence watch ─────────────────────────────── */
    if (action === 'watch') {
      const c = (body.criteria ?? {}) as Record<string, unknown>;
      const num = (v: unknown, lo: number, hi: number): number | null => {
        const n = Number(v);
        return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
      };
      const deal = typeof c.dealType === 'string' && DEAL_TYPES.includes(c.dealType) ? c.dealType : null;

      const row: Record<string, unknown> = {
        ...owner,
        city: typeof c.city === 'string' && c.city.trim() ? c.city.trim().slice(0, 80) : null,
        deal_type: deal,
        max_price: num(c.maxPrice, 0, 1e12),
        min_bedrooms: num(c.minBedrooms, 0, 20),
        // clamped: the radius decides how often somebody is interrupted, so it
        // is not something a client gets to set to 50km.
        radius_m: num(c.radiusM, 200, 5000) ?? 1200,
        enabled: true,
      };

      const { data: existing } = await scope(db.from('geofence_watches').select('id')).limit(1);
      const res = existing?.[0]
        ? await db.from('geofence_watches').update(row).eq('id', existing[0].id)
        : await db.from('geofence_watches').insert(row);
      if (res.error) return json({ error: res.error.message }, 500);
      return json({ ok: true });
    }

    /* ── switch it off ───────────────────────────────────────────────
       Turning it off in the UI has to stop it on the SERVER too. Until now
       it only cleared the local watch, so the row stayed enabled and would
       have resumed sending the moment a position was reported again. */
    if (action === 'disable') {
      const { error } = await scope(
        db.from('geofence_watches').update({ enabled: false }) as never,
      );
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unknown' }, 500);
  }
});
