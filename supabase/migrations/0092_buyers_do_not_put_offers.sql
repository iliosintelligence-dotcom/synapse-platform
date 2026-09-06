-- Buyers do not put offers to agencies.
--
-- The buyer-facing path is removed from the app, and removing a button is not
-- removing a capability: both functions behind it were callable by any signed-
-- in account, so this closes them at the database where the rule actually
-- holds.
--
-- submit_offer existed only for that path -- it took an offer from the person
-- whose enquiry it was. Dropped rather than restricted, because a function
-- that no longer has a caller is the next person's confusion.
drop function if exists public.submit_offer(uuid, numeric);

-- record_offer was the second door and the quieter one. It is SECURITY
-- DEFINER, was granted to `authenticated`, and had NO check of its own -- the
-- entitlement test lived in submit_offer, one layer up. Any signed-in account
-- could therefore call it directly against any lead id and record an offer,
-- which is the thing we have just decided must not happen, reachable without
-- touching the UI at all.
--
-- An offer is now something the AGENCY records: a figure a buyer named on the
-- phone, on WhatsApp, or at a viewing, written down by the people who heard
-- it. That is the only way one enters the system.
create or replace function public.record_offer(
  p_lead_id uuid, p_amount numeric, p_offered_by text default 'buyer'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lead   record;
  v_cur    text;
  v_id     uuid;
begin
  select l.id, l.agency_id, l.property_id into v_lead
  from leads l where l.id = p_lead_id and l.deleted_at is null;

  if v_lead.id is null then
    raise exception 'Lead not found' using errcode = 'no_data_found';
  end if;

  -- Staff of the agency that owns the lead. Not the buyer, and not a signed-in
  -- stranger with a uuid. coalesce because agency_role() is NULL for a
  -- non-member, and NULL compared with anything is NULL, which would skip the
  -- guard entirely.
  if coalesce(agency_role(v_lead.agency_id)::text, '') not in
     ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'Only the agency working this lead can record an offer on it'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'An offer has to be a positive amount'
      using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(currency, 'NGN') into v_cur
  from properties where id = v_lead.property_id;

  insert into negotiation_offers (lead_id, property_id, agency_id, amount,
                                  currency, offered_by)
  values (p_lead_id, v_lead.property_id, v_lead.agency_id, p_amount,
          coalesce(v_cur, 'NGN'), coalesce(p_offered_by, 'buyer'))
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.record_offer(uuid, numeric, text) from public;
revoke all on function public.record_offer(uuid, numeric, text) from anon;
grant execute on function public.record_offer(uuid, numeric, text) to authenticated, service_role;
