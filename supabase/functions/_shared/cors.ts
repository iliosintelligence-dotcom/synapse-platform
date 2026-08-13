// Shared CORS headers for Synapse Edge Functions.
// Mobile (Expo) and the dashboard both invoke these cross-origin.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  // GET is here for social-connect's ?action=start, which the agency portal
  // fetches to obtain an authorization URL. Widening the list is safe: it says
  // which methods a browser may attempt, not which any function accepts.
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/** Standard JSON response with CORS applied. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
