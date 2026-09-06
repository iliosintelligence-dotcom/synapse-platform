/**
 * toju-offer — Tayo taking an offer, inside the authority the agency gave it.
 *
 * WHY THIS IS NOT PART OF toju-demo
 * toju-demo already has a `negotiate` action and it is the opposite of this
 * one: it is the BUYER's assistant, coaching them on what to offer and which
 * flags to use as leverage. Putting the agency's floor anywhere near that
 * prompt would eventually put the floor in advice written for the person it is
 * hidden from. Two jobs, two functions, and the floor is only ever in this one.
 *
 * WHAT IT KNOWS
 * Nothing. It asks submit_offer, which records the offer and answers with a
 * boolean. The floor is never fetched here, never in a prompt, never in a
 * response body. There is no value in this process to leak.
 *
 * WHY THE REPLY IS NOT WRITTEN BY THE MODEL
 * There are two outcomes. A model would add a network call, a failure mode and
 * a cost to a decision that is already made, and its one freedom would be to
 * phrase how near the offer came -- which is the floor in a friendlier font.
 * Tayo's voice lives in the sentences below instead.
 *
 * TAYO DOES NOT BIND THE AGENCY. Even an offer inside authority is put
 * forward, not accepted: the agency closes its own deals.
 *
 * POST { leadId: uuid, amount: number }   Authorization: the buyer's JWT
 *   -> { accepted, handedOff, reply }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    /* The caller's own token, not the service role. submit_offer decides
       whether this person may offer on this lead, and it can only decide that
       if it knows who is asking -- called as the service role, auth.uid() is
       null and the check would pass nobody or, worse, be removed later for
       "not working". */
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Sign in to make an offer' }, 401);

    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = (await req.json().catch(() => ({}))) as
      { leadId?: string; amount?: number };

    if (!body.leadId || !UUID_RE.test(body.leadId)) {
      return json({ error: 'leadId is required' }, 400);
    }
    const amount = Number(body.amount);
    if (!isFinite(amount) || amount <= 0) {
      return json({ error: 'An offer has to be a positive amount' }, 400);
    }

    const { data, error } = await asCaller.rpc('submit_offer', {
      p_lead_id: body.leadId,
      p_amount: amount,
    });

    if (error) {
      /* Postgres wrote these for a person to read -- "That is not your
         enquiry", "That is a lot of offers in one hour" -- so they are passed
         through rather than flattened into "something went wrong". */
      const msg = error.message || 'That offer could not be recorded';
      const status = /not your enquiry/i.test(msg) ? 403
        : /lot of offers/i.test(msg) ? 429
        : /not found/i.test(msg) ? 404 : 400;
      return json({ error: msg }, status);
    }

    const accepted = (data as { accepted?: boolean })?.accepted === true;
    const handedOff = (data as { handedOff?: boolean })?.handedOff === true;

    /* Neither branch says anything about the floor: not the number, not the
       distance, not whether it was close. "You are nearly there" would be the
       oracle all over again, given away one sentence at a time. */
    const reply = accepted
      ? 'That works. I am putting it to the agency now, and someone will confirm '
        + 'with you directly — I can carry an offer, but only they can accept it.'
      : 'That one is below what I can agree to here, so I have passed it to the '
        + 'agent handling this home and they will come back to you. You are '
        + 'welcome to put a different number to me in the meantime.';

    return json({ accepted, handedOff, reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`toju-offer fatal: ${message}`);
    return json({ error: message }, 500);
  }
});
