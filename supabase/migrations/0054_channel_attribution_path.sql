-- 0054_channel_attribution_path.sql
--
-- The path from a syndicated post to a lead.
--
-- `channel_interactions` and `lead_attribution` both existed and both were
-- empty, because nothing wrote to either. Meanwhile the CRM renders an
-- attribution channel per lead, so every lead read as "direct" -- which is not
-- a measurement, it is the absence of one wearing a measurement's clothes.
--
-- Without this, syndication cannot answer the only question that justifies it:
-- did the posting produce buyers. Both functions are SECURITY DEFINER because
-- an anonymous visitor must be able to record a touch without being able to
-- read anybody's attribution back out.

-- ── the FK that made anonymous attribution impossible ───────────────────────
-- channel_interactions.session_id referenced chat_sessions, whose consumer_id
-- is NOT NULL. A stranger arriving from an Instagram post has no account and
-- therefore can never have a chat_sessions row, so the FK guaranteed that the
-- exact case this table exists to measure could never be inserted.
--
-- session_id is now what it always meant in practice: the anonymous visitor id
-- the browser already keeps in localStorage as `toju_visitor_v1`.
alter table public.channel_interactions
  drop constraint if exists channel_interactions_session_id_fkey;

comment on column public.channel_interactions.session_id is
  'Anonymous browser visitor id (localStorage toju_visitor_v1). Deliberately NOT a foreign key to chat_sessions: a social visitor has no account, and that is the case this table exists to measure.';

-- ── recording a touch ───────────────────────────────────────────────────────
-- Called from the property page when the URL carries a channel. Every failure
-- path returns NULL rather than raising: attribution is never worth
-- interrupting someone who is looking at a house.
create or replace function public.record_channel_touch(
  p_property_id uuid,
  p_channel     attribution_channel,
  p_session_id  uuid,
  p_post_id     text default null,
  p_kind        text default 'visit'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid;
  v_id     uuid;
  v_recent int;
begin
  if p_session_id is null then
    return null;    -- no visitor id, nothing to attribute; not an error
  end if;

  select agency_id into v_agency
  from properties
  where id = p_property_id and deleted_at is null;

  if v_agency is null then
    return null;    -- unknown listing: ignore quietly rather than 500 a page view
  end if;

  -- Cheap flood guard. A visitor refreshing a page ten times is one interest,
  -- not ten, and without this the first/last-touch maths is skewed by reloads.
  select count(*) into v_recent
  from channel_interactions
  where session_id = p_session_id
    and property_id = p_property_id
    and channel = p_channel
    and occurred_at > now() - interval '30 minutes';

  if v_recent > 0 then
    return null;
  end if;

  insert into channel_interactions (property_id, agency_id, channel, post_id, session_id, kind)
  values (p_property_id, v_agency, p_channel, p_post_id, p_session_id, coalesce(p_kind, 'visit'))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_channel_touch(uuid, attribution_channel, uuid, text, text) to anon, authenticated;

-- ── collapsing touches into attribution ─────────────────────────────────────
-- Both first and last touch are kept, because they are usually different and
-- the difference is the interesting part: the Instagram post that started it,
-- the AI recommendation that closed it. Picking one would throw away half the
-- answer, and which half matters depends on the question being asked.
create or replace function public.attribute_lead(p_lead_id uuid, p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lead   record;
  v_first  record;
  v_last   record;
  v_count  int := 0;
begin
  select id, property_id, agency_id into v_lead
  from leads where id = p_lead_id and deleted_at is null;
  if v_lead.id is null then
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

    select * into v_last from channel_interactions
     where session_id = p_session_id and agency_id = v_lead.agency_id
     order by occurred_at desc limit 1;
  end if;

  if v_first.id is null then
    -- No recorded touch. The honest attribution is that we do not know how
    -- they arrived, recorded as direct rather than guessed at.
    insert into lead_attribution (lead_id, property_id, agency_id, channel, is_first_touch, is_last_touch, occurred_at)
    values (p_lead_id, v_lead.property_id, v_lead.agency_id, 'direct_search', true, true, now());
    return 1;
  end if;

  insert into lead_attribution (lead_id, property_id, agency_id, channel, is_first_touch, is_last_touch, occurred_at)
  values (p_lead_id, v_first.property_id, v_lead.agency_id, v_first.channel,
          true, v_first.id = v_last.id, v_first.occurred_at);
  v_count := 1;

  -- Only a second row when the last touch is genuinely a different event.
  if v_last.id is distinct from v_first.id then
    insert into lead_attribution (lead_id, property_id, agency_id, channel, is_first_touch, is_last_touch, occurred_at)
    values (p_lead_id, v_last.property_id, v_lead.agency_id, v_last.channel,
            false, true, v_last.occurred_at);
    v_count := 2;
  end if;

  return v_count;
end;
$$;

grant execute on function public.attribute_lead(uuid, uuid) to anon, authenticated;

-- Verified against the live database (2026-08-13):
--   touch recorded                        -> 1 row
--   same visitor refreshes                -> deduped, 0 new rows
--   unknown listing                       -> NULL, no error
--   two-touch journey attributed          -> 2 rows
--   first touch / last touch              -> instagram / ai_recommendation
--   attribute the same lead again         -> 0 rows, idempotent
--   lead with no recorded touch           -> 1 row, direct_search
-- And end to end in a real browser: arriving on a tracked Instagram link wrote
-- the touch against the visitor id actually held in localStorage.
