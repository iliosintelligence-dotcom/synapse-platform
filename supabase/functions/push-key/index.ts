/**
 * push-key — hands the browser the VAPID PUBLIC key.
 *
 * The public key is public by definition: it ships to every subscriber and is
 * embedded in the subscription itself. The PRIVATE key never leaves Supabase
 * secrets and is only ever read by proximity-report when it signs a push.
 * They are deliberately split across two functions so nothing that serves the
 * browser has any reason to hold the private half.
 *
 * verify_jwt = false: an anonymous visitor can enable proximity alerts before
 * they ever create an account, so this has to answer without a session.
 *
 * When VAPID_PUBLIC_KEY is unset this returns 200 with an empty body rather
 * than an error. notify.js already reads that as "push not configured yet"
 * (`if (!k || !k.publicKey) return null;`) and quietly skips subscribing, so
 * an unconfigured deployment degrades to no push instead of a console full of
 * failures.
 */
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';

  return new Response(
    JSON.stringify(publicKey ? { publicKey } : {}),
    {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        // The key rotates approximately never; let the browser keep it.
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
});
