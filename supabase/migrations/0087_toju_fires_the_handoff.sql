-- Toju hands a lead over the moment it exists.
--
-- WHY A TRIGGER AND NOT A CALL IN create-lead
-- A lead can be born several ways -- the app, an edge function, an import, a
-- future channel nobody has written yet -- and the agent needs telling in all
-- of them. A trigger is the only place that is true of. It also runs inside
-- the transaction that made the lead, so there is no window where a lead
-- exists and nothing has been queued.
--
-- WHY NOT queue_agent_handoff
-- That function asks agency_role(auth.uid()), which is right for a browser:
-- an agency member messaging their own team. But a lead is usually created BY
-- THE BUYER, who is a member of nothing, so the check would refuse exactly
-- the case this exists for. The trigger is the authority here, so it resolves
-- the recipient itself.

-- The template, reworded so every fallback reads. "budget around {{3}}" was
-- fine with a real figure and clumsy without one. Nothing has been submitted
-- to Meta yet, so this is free to fix now; after approval the text is frozen
-- and a reword means resubmitting. Three variables rather than four: the
-- listing already implies the area.
update public.whatsapp_templates
   set body = 'New lead from Tayo. {{1}} asked about {{2}} and their budget is {{3}}. Open Synapse to read the conversation and reply.',
       variables = '[{"name":"buyer_name","example":"Chinaza Obi"},
                     {"name":"listing","example":"Bodija Park 3-Bedroom Flat"},
                     {"name":"budget","example":"N3.2M/yr"}]'::jsonb
 where key = 'handoff_new_lead' and status = 'draft';

create or replace function public.notify_agent_of_new_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_phone   text;
  v_name    text;
  v_listing text;
  v_budget  text;
  v_body    text;
begin
  -- The agent it is assigned to, else whoever owns the agency. Same order as
  -- queue_agent_handoff, deliberately: two places resolving a recipient two
  -- different ways is a bug waiting for a quiet afternoon.
  if new.assigned_agent_id is not null then
    select nullif(btrim(p.phone), '') into v_phone
    from profiles p where p.id = new.assigned_agent_id;
  end if;

  if v_phone is null then
    select nullif(btrim(p.phone), '') into v_phone
    from profiles p
    join agency_members m on m.profile_id = p.id
    where m.agency_id = new.agency_id
      and m.role = 'agency_owner'
      and m.deleted_at is null
      and nullif(btrim(p.phone), '') is not null
    limit 1;
  end if;

  -- Nobody reachable. The lead is still a lead: it is visible in the CRM and
  -- can be worked. Refusing the insert because an agent has not filled in a
  -- phone number would throw away the enquiry to protect the notification,
  -- which is exactly backwards.
  if v_phone is null then
    return new;
  end if;

  v_name := coalesce(nullif(btrim(new.consumer_name), ''), 'A buyer');

  select coalesce(nullif(btrim(pr.title), ''), 'one of your listings')
    into v_listing
  from properties pr where pr.id = new.property_id;
  v_listing := coalesce(v_listing, 'one of your listings');

  -- budget_range is what a person typed; the numbers are the fallback.
  v_budget := nullif(btrim(coalesce(new.budget_range, '')), '');
  if v_budget is null and new.budget_max is not null then
    v_budget := trim(to_char(new.budget_max, 'FM999,999,999,999'));
    if new.budget_min is not null then
      v_budget := trim(to_char(new.budget_min, 'FM999,999,999,999')) || ' to ' || v_budget;
    end if;
  end if;
  v_budget := coalesce(v_budget, 'not stated');

  begin
    v_body := public.render_whatsapp_template('handoff_new_lead', jsonb_build_object(
      'buyer_name', v_name, 'listing', v_listing, 'budget', v_budget));

    insert into message_outbox (agency_id, lead_id, to_phone, body,
                                template_key, template_vars)
    values (new.agency_id, new.id, v_phone, v_body, 'handoff_new_lead',
            jsonb_build_object('buyer_name', v_name, 'listing', v_listing,
                               'budget', v_budget));
  exception when others then
    -- Never lose a lead over a message. The enquiry is the valuable thing;
    -- the notification is how somebody hears about it, and a notification
    -- that cannot be built is worth a log line, not a rolled-back lead.
    raise warning 'notify_agent_of_new_lead: % (lead %)', sqlerrm, new.id;
  end;

  return new;
end;
$function$;

drop trigger if exists leads_notify_agent on public.leads;
create trigger leads_notify_agent
  after insert on public.leads
  for each row execute function public.notify_agent_of_new_lead();
