/**
 * toju-offer — withdrawn.
 *
 * This let a buyer put a priced offer to an agency: Tayo recorded it, measured
 * it against the agency's negotiation floor, and called a person in when it
 * could not agree. That is not how Synapse works. Buyers do not put offers to
 * agencies; an offer is a figure the AGENCY records, having heard it on the
 * phone, on WhatsApp or at a viewing.
 *
 * The database side is gone with it (migration 0092): submit_offer is dropped,
 * and record_offer -- which was granted to `authenticated` with no check of
 * its own -- is now agency staff only.
 *
 * Kept as a refusal rather than deleted. A deployed function cannot be removed
 * from here, and one that 500s because the function it calls no longer exists
 * reads as a fault somebody should fix. This says what happened instead.
 *
 * The floor itself stays and still does its job: it is the authority Tayo
 * negotiates inside, and an offer recorded below it still hands the lead to a
 * human.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // 410, not 404: this endpoint existed, was removed deliberately, and is not
  // coming back at another address.
  return new Response(
    JSON.stringify({
      error: 'Synapse does not take offers from buyers. An agency records an '
        + 'offer it has been given.',
    }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
