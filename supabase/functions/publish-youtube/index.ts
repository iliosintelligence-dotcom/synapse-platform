/**
 * publish-youtube: the HTTP entry for the youtube adapter in adapter.ts.
 *
 * WHO MAY CALL. Only social-publish, which owns the queue (claim, retries, dry_run, saving the outcome) and resolves the
 * account and its token before calling here. It proves itself with the service role key in the Authorization header,
 * compared in constant time; any other caller is refused before a byte of the body is read. The gateway checks the JWT
 * too (verify_jwt = true in config.toml), so this is the second lock, not the only one.
 *
 * THE TOKEN ARRIVES IN THE BODY, over Supabase's own HTTPS, from the one function allowed to decrypt it
 * (social_account_token is service_role only). It is used for the platform call and never written back out: no payload,
 * log line or error message here carries it.
 *
 * POST { post, conn } -> the adapter's PublishResult, always 200 once the caller is accepted -- a platform refusing the
 * post IS the result, and social-publish decides retries from it. 401/403/400 mean the caller or request was wrong.
 */
import { youtubeAdapter, buildPayload, type Connection, type PublishResult, type QueuedPost } from './adapter.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Equal without leaking how much of it matched: both sides are hashed to the same length, then compared in full. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]).then((d) => d.map((buf) => new Uint8Array(buf)));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey) return json({ error: 'Server misconfigured: no service role key' }, 500);
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return json({ error: 'Missing Authorization header' }, 401);
  if (!(await sameSecret(bearer, serviceKey))) return json({ error: 'Only social-publish may call this function' }, 403);

  const body = (await req.json().catch(() => null)) as { post?: QueuedPost; conn?: Connection } | null;
  const post = body?.post;
  const conn = body?.conn;
  if (!post || typeof post.id !== 'string' || !Array.isArray(post.media_urls) || !conn || typeof conn !== 'object') {
    return json({ error: 'Expected { post, conn }' }, 400);
  }
  if (post.platform !== 'youtube') return json({ error: 'This function publishes youtube only; got ' + post.platform }, 400);

  try {
    return json(await youtubeAdapter(post, conn));
  } catch (err) {
    /* The adapters catch their own failures; this is the net under them, so social-publish always gets a result. */
    const result: PublishResult = {
      ok: false, postId: null, provider: 'youtube',
      error: err instanceof Error ? err.message : 'Unknown youtube error',
      payload: buildPayload(post),
    };
    return json(result);
  }
});
