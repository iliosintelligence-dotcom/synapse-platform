-- The caption leads with the link.
--
-- Phase 1 of docs/SOCIAL_TO_PLATFORM_ROUTING.md, and the last of the three.
--
-- A Greenlight listing went out on Facebook and the buyer ended up in Eden's
-- personal WhatsApp. The caption's link was real, tappable and attributed --
-- and it was the last thing in the caption, after the body and after the
-- hashtags, below the "See more" fold that Facebook draws at about three
-- lines. For most readers it was not on the post at all.
--
-- ── the caption's own first line is the hook ─────────────────────────────
--
-- The plan sketched an invented opener ("3-bed in Lekki, N4.5m/yr — photos
-- and what's nearby:"). That would be a second voice arguing with the caption
-- underneath it, written from columns rather than by the model that wrote the
-- post, and duplicating whatever the caption already says in its own words.
--
-- The caption ALREADY opens with a hook: that is what social-generate's six
-- angles produce. So the link goes after the first line, not before it, and
-- no copy is invented:
--
--     <the caption's own first line>
--     synapsecore.dev/s/2VYusY
--
--     <the rest of the caption>
--     <hashtags>
--     synapsecore.dev/s/2VYusY
--
-- The repeat at the bottom costs nothing and is kept: whoever reads to the
-- end of a property post is the most motivated reader on it.
--
-- A LONG FIRST LINE DEFEATS THE WHOLE POINT, so there is a second branch. A
-- caption opening with a 300-character paragraph would push the link back
-- below the fold, and "after the first line" would have quietly achieved
-- nothing. Past 180 characters the link goes first instead, on its own line.
-- A bare URL as the opening line reads as spam, which is why it is the
-- fallback rather than the rule.
--
-- ── only where a link is a link ──────────────────────────────────────────
--
-- Instagram and TikTok never linkify a caption, and 0112 established that a
-- hand-typed case-sensitive token is not a route anybody takes. They keep
-- "Link in bio" and are untouched here -- their answer is Phase 3, which
-- shipped this afternoon.
--
-- ── this is the phase with a downside ────────────────────────────────────
--
-- Meta has historically dampened reach on posts carrying outbound links. I do
-- not know the current size of that effect and nobody outside Meta does. It
-- is why the plan recommended Phases 2 and 3 first, and why the number to
-- watch after this is LEADS PER POST rather than clicks: a link above the
-- fold that triples taps while halving reach has moved the problem, not
-- solved it. social_post_stats() already reports both.

create or replace function public.caption_with_link(
  p_platform text,
  p_caption  text,
  p_url      text
)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_caption text := btrim(coalesce(p_caption, ''));
  v_tail    text := public.caption_link_tail(p_platform, p_url);
  v_break   integer;
  v_first   text;
  v_rest    text;
begin
  if v_tail = '' then
    return v_caption;
  end if;

  /* Instagram and TikTok get "Link in bio", which is an instruction and not a
     link -- there is no fold to beat and nothing to lead with. Detected by
     the tail not being the URL rather than by naming the platforms again:
     caption_link_tail already owns that decision and two copies of it would
     drift. */
  if v_tail is distinct from p_url then
    return v_caption || E'\n\n' || v_tail;
  end if;

  v_break := position(E'\n' in v_caption);
  if v_break = 0 then
    v_first := v_caption;
    v_rest  := '';
  else
    v_first := btrim(substr(v_caption, 1, v_break - 1));
    v_rest  := btrim(substr(v_caption, v_break + 1));
  end if;

  /* The fallback. An opening paragraph long enough to bury the link makes
     "after the first line" meaningless, so the link goes above everything
     instead -- less elegant, and it still beats being unreachable. */
  if length(v_first) > 180 then
    return p_url || E'\n\n' || v_caption || E'\n\n' || p_url;
  end if;

  if v_rest = '' then
    return v_first || E'\n' || p_url;
  end if;

  return v_first || E'\n' || p_url || E'\n\n' || v_rest || E'\n\n' || p_url;
end;
$function$;

comment on function public.caption_with_link(text, text, text) is
  'Assembles the caption around its short link. On platforms that linkify, '
  'the link goes after the caption''s OWN first line -- above Facebook''s '
  '"See more" fold -- and is repeated at the end. Past a 180-character '
  'opening line it goes first instead. Instagram and TikTok are unchanged: '
  'caption_link_tail gives them "Link in bio", and this defers to it rather '
  'than naming the platforms a second time.';

revoke all on function public.caption_with_link(text, text, text) from public, anon;
grant execute on function public.caption_with_link(text, text, text) to authenticated, service_role;


-- ── queue_social_post ────────────────────────────────────────────────────
--
-- 20260925120000's body, with ONE expression changed: the UPDATE that appends
-- the link now calls caption_with_link. Reproduced in full because CREATE OR
-- REPLACE takes a whole function. Everything else is deliberately identical,
-- including the account check added this morning, which is load-bearing --
-- it is what stops an id from a browser naming another agency's account.
create or replace function public.queue_social_post(
  p_property_id uuid,
  p_platform social_platform,
  p_caption text,
  p_media_urls text[] default '{}'::text[],
  p_scheduled_at timestamptz default now(),
  p_dry_run boolean default true,
  p_payload jsonb default null,
  p_social_account_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_agency  uuid;
  v_role    text;
  v_id      uuid;
  v_caption text;
  v_channel public.attribution_channel;
  v_url     text;
  v_media   text[];
  v_acct_platform social_platform;
  v_acct_agency   uuid;
begin
  if p_caption is null or length(btrim(p_caption)) = 0 then
    raise exception 'Caption is empty' using errcode = 'invalid_parameter_value';
  end if;

  select agency_id into v_agency
  from properties
  where id = p_property_id and deleted_at is null;

  if v_agency is null then
    raise exception 'Listing not found' using errcode = 'no_data_found';
  end if;

  v_role := coalesce(agency_role(v_agency)::text, '');
  if v_role not in ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot post for this agency'
      using errcode = 'insufficient_privilege';
  end if;

  if p_social_account_id is not null then
    select platform, agency_id into v_acct_platform, v_acct_agency
      from social_accounts
     where id = p_social_account_id and is_active and deleted_at is null;

    if v_acct_agency is null then
      raise exception 'That account is not connected any more'
        using errcode = 'no_data_found';
    end if;
    if v_acct_agency <> v_agency then
      raise exception 'That account belongs to a different agency'
        using errcode = 'insufficient_privilege';
    end if;
    if v_acct_platform <> p_platform then
      raise exception 'That account is % , not %', v_acct_platform, p_platform
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  v_caption := btrim(p_caption);

  v_media := coalesce(p_media_urls, '{}');
  if cardinality(v_media) = 0 then
    select coalesce(array_agg(m.url order by m.display_order), '{}')
      into v_media
    from (
      select url, display_order
      from property_media
      where property_id = p_property_id
        and url is not null
        and btrim(url) <> ''
        and url like 'https://%'
      order by display_order
      limit 10
    ) m;
  end if;

  insert into social_posts (
    property_id, agency_id, platform, caption, media_urls,
    status, scheduled_at, dry_run, created_by, payload, social_account_id
  ) values (
    p_property_id, v_agency, p_platform, v_caption,
    v_media[1:media_cap_for(p_platform::text)],
    'scheduled', coalesce(p_scheduled_at, now()), coalesce(p_dry_run, true),
    auth.uid(), p_payload, p_social_account_id
  )
  returning id into v_id;

  if position('/s/' in v_caption) = 0
     and position('synapsecore.dev' in lower(v_caption)) = 0 then

    v_channel := (case lower(p_platform::text)
                    when 'instagram' then 'instagram'
                    when 'facebook'  then 'facebook'
                    when 'tiktok'    then 'tiktok'
                    when 'whatsapp'  then 'whatsapp_campaign'
                    else 'organic'
                  end)::public.attribution_channel;

    select l.url into v_url
    from public.create_short_link(p_property_id, v_channel, v_id) l;

    -- THE ONE CHANGED LINE. Was: v_caption || E'\n\n' || caption_link_tail(...)
    update social_posts
       set caption = public.caption_with_link(p_platform::text, v_caption, v_url)
     where id = v_id;
  end if;

  begin
    perform public.queue_synapse_twins(
      p_property_id, v_agency, v_caption, v_media,
      coalesce(p_scheduled_at, now()), coalesce(p_dry_run, true), v_id);
  exception when others then
    raise warning 'queue_social_post: could not queue Synapse twins for % (%)', v_id, sqlerrm;
  end;

  return v_id;
end;
$function$;

revoke all on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean, jsonb, uuid) from public, anon;
grant execute on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean, jsonb, uuid) to authenticated, service_role;


-- ── queue_synapse_twins ──────────────────────────────────────────────────
--
-- The same one-line change. Synapse's own Facebook and X posts have the link
-- in the same place for the same reason, and leaving them appending at the
-- bottom would mean the before/after this phase asks for is comparing two
-- different treatments rather than one change.
create or replace function public.queue_synapse_twins(
  p_property_id  uuid,
  p_agency_id    uuid,
  p_caption      text,
  p_media_urls   text[],
  p_scheduled_at timestamptz,
  p_dry_run      boolean,
  p_source_post  uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_channel record;
  v_id      uuid;
  v_caption text;
  v_url     text;
  v_media   text[];
  v_at      timestamptz := coalesce(p_scheduled_at, now());
  v_n       integer := 0;
begin
  for v_channel in
    select platform from synapse_channels where is_active order by platform
  loop
    /* ONE PER PLATFORM PER LISTING PER RUN. The (twin_of, platform) index
       cannot express this: each agency post carries its own twin_of, so three
       agency posts legitimately produced three twins to the same account. The
       question that matters is not "has THIS post been twinned" but "has this
       LISTING just been put out on this channel". */
    if exists (
      select 1 from social_posts
      where property_id = p_property_id
        and platform    = v_channel.platform
        and leg         = 'synapse'
        and deleted_at is null
        and scheduled_at between v_at - interval '1 hour' and v_at + interval '1 hour'
    ) then
      continue;
    end if;

    /* A DIFFERENT CAPTION, DELIBERATELY. The same photographs and the same
       words, posted within the hour by two accounts on one platform, is what
       Instagram and TikTok both dampen as duplicate content -- so an identical
       twin would cost the agency reach rather than adding any. */
    v_caption := 'Spotted on Synapse' || E'\n\n' || btrim(coalesce(p_caption, ''));

    -- Trimmed to what this platform renders: four on X, ten elsewhere.
    v_media := (coalesce(p_media_urls, '{}'))[1:media_cap_for(v_channel.platform::text)];

    insert into social_posts (
      property_id, agency_id, platform, caption, media_urls,
      status, scheduled_at, dry_run, created_by, leg, twin_of
    ) values (
      p_property_id, p_agency_id, v_channel.platform,
      v_caption, v_media,
      'scheduled', v_at, coalesce(p_dry_run, true),
      auth.uid(), 'synapse', p_source_post
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      continue;   -- already twinned for this platform
    end if;

    /* ITS OWN SHORT LINK, which is the entire reason the twin is a separate
       row rather than a second destination on one row. A lead arriving from
       Synapse's Instagram and one from the agency's Instagram are different
       facts about which channel works. */
    begin
      select l.url into v_url
      from public.create_short_link(
        p_property_id,
        (case lower(v_channel.platform::text)
           when 'instagram' then 'instagram'
           when 'facebook'  then 'facebook'
           when 'tiktok'    then 'tiktok'
           when 'whatsapp'  then 'whatsapp_campaign'
           else 'organic'
         end)::public.attribution_channel,
        v_id) l;

      -- THE ONE CHANGED LINE, as above.
      update social_posts
         set caption = public.caption_with_link(v_channel.platform::text, v_caption, v_url)
       where id = v_id;
    exception when others then
      raise warning 'queue_synapse_twins: no short link for % (%)', v_id, sqlerrm;
    end;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;
