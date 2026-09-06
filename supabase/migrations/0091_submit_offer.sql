-- Tayo taking an offer, and what it is allowed to know.
--
-- A BINARY SEARCH IS A LEAK
-- offer_within_authority answers yes or no for any amount, which felt safe
-- because it never returns the figure. It is not safe in a buyer's hands:
-- twenty calls of halving and doubling recover the floor exactly. Granting it
-- to `authenticated` handed every buyer an oracle for the number the whole
-- table exists to hide. It is service_role only now -- Tayo calls it, buyers
-- do not. Agency staff never needed it; they can read their own floor.
--
-- Verified after the change: a signed-in buyer calling it directly gets
-- "permission denied for function offer_within_authority".
revoke execute on function public.offer_within_authority(uuid, numeric) from authenticated;

-- ── one call, because the pieces must not be separable ───────────────────
-- Recording the offer and judging it are one action. Split, a caller could
-- judge without recording -- which is the oracle again, just with extra steps.
-- This records first and answers second, so every question leaves a trace the
-- agency can see.
create or replace function public.submit_offer(p_lead_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lead     record;
  v_recent   int;
  v_accepted boolean;
  v_handed   boolean;
begin
  select l.id, l.agency_id, l.property_id, l.consumer_id
    into v_lead
  from leads l where l.id = p_lead_id and l.deleted_at is null;

  if v_lead.id is null then
    raise exception 'Lead not found' using errcode = 'no_data_found';
  end if;

  -- The buyer whose enquiry this is, or the agency working it. Nobody else
  -- offers on somebody else's lead: without this, a public endpoint plus a
  -- guessed uuid would let anyone fill an agency's outbox with invented
  -- offers and invented handoffs.
  if not (
    auth.uid() = v_lead.consumer_id
    or coalesce(agency_role(v_lead.agency_id)::text, '') in
       ('agent', 'agency_admin', 'agency_owner')
  ) then
    raise exception 'That is not your enquiry'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'An offer has to be a positive amount'
      using errcode = 'invalid_parameter_value';
  end if;

  /* Slows the search without getting in a real negotiation's way. Eight
     offers in an hour is far more than a person haggling and far fewer than a
     script needs to walk to the floor. It does not make the search
     impossible -- nothing short of refusing to answer would -- but it makes
     it slow, and every attempt is a row the agency can see, with the agent
     already notified from the first one that went under. */
  select count(*) into v_recent
  from negotiation_offers
  where lead_id = p_lead_id and created_at > now() - interval '1 hour';
  if v_recent >= 8 then
    raise exception 'That is a lot of offers in one hour. Give the agent a moment to come back to you.'
      using errcode = 'too_many_rows';
  end if;

  -- Records it, and the trigger decides whether an agent gets told.
  perform public.record_offer(p_lead_id, p_amount, 'buyer');

  v_accepted := public.offer_within_authority(v_lead.property_id, p_amount);

  select exists (
    select 1 from message_outbox
    where lead_id = p_lead_id and template_key = 'handoff_negotiation_limit'
  ) into v_handed;

  -- A decision and nothing else. No floor, no distance from it, no "close" --
  -- "you are nearly there" is the floor in a friendlier font.
  return jsonb_build_object('accepted', v_accepted, 'handedOff', v_handed);
end;
$function$;

revoke all on function public.submit_offer(uuid, numeric) from public;
revoke all on function public.submit_offer(uuid, numeric) from anon;
grant execute on function public.submit_offer(uuid, numeric) to authenticated, service_role;
