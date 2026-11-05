/**
 * Meta Graph, shared by social-facebook and social-instagram: the same API
 * with different nouns. Meta returns errors inside a 200 as often as not, so
 * the body is inspected rather than only the status.
 */
export const IG_GRAPH = 'https://graph.instagram.com/v21.0';
export const FB_GRAPH = 'https://graph.facebook.com/v21.0';

/* Codes Meta itself calls temporary (throttling, a service hiccup). Anything
   else on a 4xx is the post or the permission being wrong, and sending it
   again will not change that. */
const TRANSIENT = new Set([1, 2, 4, 17, 32, 341, 368, 613]);

export class GraphError extends Error {
  detail: Record<string, unknown>;
  permanent: boolean;
  /** Code 190: the token is dead. The account must be connected again. */
  tokenDead: boolean;
  constructor(message: string, detail: Record<string, unknown>, permanent: boolean, tokenDead = false) {
    super(message);
    this.detail = detail;
    this.permanent = permanent;
    this.tokenDead = tokenDead;
  }
}

export async function graph(
  host: string,
  path: string,
  params: Record<string, string>,
  method: 'GET' | 'POST' = 'POST',
  // deno-lint-ignore no-explicit-any
): Promise<Record<string, any>> {
  const qs = new URLSearchParams(params);
  const res = method === 'GET'
    ? await fetch(host + path + '?' + qs.toString())
    : await fetch(host + path, { method: 'POST', body: qs });
  // deno-lint-ignore no-explicit-any
  const body = await res.json().catch(() => ({} as Record<string, any>));
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    const code = Number(e.code ?? 0);
    const transient = res.status >= 500 || e.is_transient === true || TRANSIENT.has(code);
    /* Meta's own message is the useful one and is written for a human. Passed
       through, with the codes kept for support. */
    throw new GraphError(
      e.message ?? ('HTTP ' + res.status + ' from ' + host),
      { code: e.code, subcode: e.error_subcode, type: e.type, fbtrace_id: e.fbtrace_id, status: res.status },
      !transient,
      code === 190,
    );
  }
  return body;
}
