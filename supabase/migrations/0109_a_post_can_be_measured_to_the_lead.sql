-- 0109 — THE FUNNEL STOPPED ONE STEP SHORT OF THE ANSWER
--
-- click_events knows which post was tapped (token). channel_interactions knows
-- which post brought somebody to the listing (post_id, the same token). But
-- lead_attribution — the row written when that person actually becomes a lead —
-- recorded only the CHANNEL. So the product could say "3 leads came from
-- Instagram" and could never say "this post produced 3 leads", which is the
-- only version an agency can act on: you cannot post more of a channel.
--
-- attribute_lead already reads the exact channel_interactions rows that carry
-- post_id. It was throwing the column away on the way out.

begin;

alter table public.lead_attribution
  add column if not exists post_id text;

comment on column public.lead_attribution.post_id is
  'Short-link token of the social post that earned this touch, when there was one.';


-- Carried through from the touch. Same first/last-touch logic as before; the
-- only change is that each row now remembers which post it came from.
create or replace function public.attribute_lead(p_lead_id uuid, p_session_id uuid default null::uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead      record;
  v_first     record;
  v_last      record;
  v_has_touch boolean := false;
  v_count     int := 0;
begin
  select id, property_id, agency_id, source into v_lead
  from leads where id = p_lead_id and deleted_at is null;
  if not found then
    return 0;
  end if;

  -- Already attributed: never write twice for the same lead.
  if exists (select 1 from lead_attribution where lead_id = p_lead_id) then
    return 0;
  end if;

  if p_session_id is not null then
    select * into v_first from channel_interactions
     where session_id = p_session_id and agency_id = v_lead.agency_id
     order by occurred_at asc limit 1;
    v_has_touch := found;

    if v_has_touch then
      select * into v_last from channel_interactions
       where session_id = p_session_id and agency_id = v_lead.agency_id
       order by occurred_at desc limit 1;
    end if;
  end if;

  if not v_has_touch then
    -- No recorded touch. Use what the lead itself tells us (0093) rather than
    -- flattening every session-less lead to 'direct'. No post_id, because there
    -- was no post: an empty string here would be a post that does not exist.
    insert into lead_attribution (lead_id, property_id, agency_id, channel, is_first_touch, is_last_touch, occurred_at)
    values (p_lead_id, v_lead.property_id, v_lead.agency_id,
            lead_source_to_channel(v_lead.source), true, true, now());
    return 1;
  end if;

  insert into lead_attribution (lead_id, property_id, agency_id, channel, post_id, is_first_touch, is_last_touch, occurred_at)
  values (p_lead_id, v_first.property_id, v_lead.agency_id, v_first.channel, v_first.post_id,
          true, v_first.id = v_last.id, v_first.occurred_at);
  v_count := 1;

  -- Only a second row when the last touch is genuinely a different event.
  if v_last.id is distinct from v_first.id then
    insert into lead_attribution (lead_id, property_id, agency_id, channel, post_id, is_first_touch, is_last_touch, occurred_at)
    values (p_lead_id, v_last.property_id, v_lead.agency_id, v_last.channel, v_last.post_id,
            false, true, v_last.occurred_at);
    v_count := 2;
  end if;

  return v_count;
end;
$function$;


-- Existing rows, where the touch they were derived from can still be found.
-- Matched on session-less facts — same agency, same property, same channel,
-- same moment — because lead_attribution never stored the interaction id. Only
-- fills a NULL, so re-running is harmless. Matched nothing on this project:
-- every lead on file predates the first social post, which is itself the point.
update lead_attribution la
   set post_id = ci.post_id
  from channel_interactions ci
 where la.post_id is null
   and ci.post_id is not null
   and ci.agency_id = la.agency_id
   and ci.property_id is not distinct from la.property_id
   and ci.channel = la.channel
   and ci.occurred_at = la.occurred_at;


-- ── the two columns' numbers, in one round trip ────────────────────────────
-- Everything here is measured by us: our redirect counts the tap, our property
-- page records the visit, our lead form closes the loop. None of it needs a
-- platform connection, a Graph token or an app review — which is why the
-- Published card could stop saying "metrics arrive once a channel is connected"
-- while sitting on a post five people had clicked.
--
-- HUMAN CLICKS ONLY. 82 of the first 103 clicks on this project were preview
-- crawlers fetching the link the instant it was posted. Reporting those as
-- audience would be the most flattering lie in the product.
create or replace function public.social_post_stats()
returns table (
  social_post_id uuid,
  token          text,
  clicks         integer,
  clicks_raw     integer,
  visits         integer,
  leads          integer,
  last_click     timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sl.social_post_id,
    sl.token,
    (select count(*)::int from click_events ce
      where ce.token = sl.token and ce.ua_class = 'human'),
    (select count(*)::int from click_events ce where ce.token = sl.token),
    -- distinct sessions, not rows: one person reading the listing three times
    -- is one person who read the listing.
    (select count(distinct ci.session_id)::int from channel_interactions ci
      where ci.post_id = sl.token),
    (select count(distinct la.lead_id)::int from lead_attribution la
      where la.post_id = sl.token),
    (select max(ce.occurred_at) from click_events ce
      where ce.token = sl.token and ce.ua_class = 'human')
  from short_links sl
  where sl.social_post_id is not null
    and is_agency_member(sl.agency_id);
$$;

comment on function public.social_post_stats() is
  'Per-post funnel for the caller''s agencies: human clicks, listing visits, leads.';

revoke all on function public.social_post_stats() from public;
grant execute on function public.social_post_stats() to authenticated;

commit;
