-- TWO THINGS, both seen on a real post.
--
-- 1. SYNAPSE POSTED THE SAME LISTING TO INSTAGRAM MORE THAN ONCE.
--
-- queue_synapse_twins loops over every active Synapse channel, and it is called
-- once per agency post. So an agency publishing to three channels produced:
--
--     agency -> instagram   twins to Synapse instagram, facebook, x
--     agency -> facebook    twins to Synapse instagram, facebook, x
--     agency -> x           twins to Synapse instagram, facebook, x
--
-- Nine Synapse posts, three of them to the same Instagram account, same
-- listing, same minute.
--
-- The index that was meant to stop this is on (twin_of, platform). It prevents
-- ONE agency post from twinning twice to a platform, which is a different
-- thing: each of those three agency posts has its own twin_of, so all nine
-- inserts were unique and all nine were allowed. The guard was real, it just
-- guarded the wrong key.
--
-- Synapse amplifies a LISTING, not each of the agency's channel-posts. So the
-- rule is one Synapse post per platform per listing per posting run, and a
-- "run" is defined by time because that is what it actually is: the composer
-- queues its channels within seconds of each other.
--
-- The window is an hour. Long enough that no batch, retry or double-press can
-- slip through; short enough that an agency genuinely re-posting a listing
-- tomorrow still gets amplified. It also means Synapse's own feed cannot show
-- the same home twice in an hour, which is the behaviour you would want even
-- if the duplicate had never happened.
--
-- 2. X SHOWS AT MOST FOUR IMAGES.
--
-- A ten-photo carousel was sent to X and accepted; X does not render ten. The
-- cap belongs here, where the row is written, rather than at send time -- a row
-- claiming ten media when four go out makes every later count wrong, including
-- the payload the operator reads back.

-- How many images a platform will actually show. Instagram and Facebook take
-- ten in a carousel; X takes four. Anything unlisted gets ten, which is
-- Meta's limit and the most conservative useful default.
create or replace function public.media_cap_for(p_platform text)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  select case lower(coalesce(p_platform, ''))
           when 'x' then 4
           when 'twitter' then 4
           else 10
         end;
$function$;

comment on function public.media_cap_for(text) is
  'Images a platform will actually render in one post: 4 on X, 10 elsewhere. '
  'Applied when the row is written so stored media_urls matches what goes out.';


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

      update social_posts
         set caption = v_caption || E'\n\n'
                       || public.caption_link_tail(v_channel.platform::text, v_url)
       where id = v_id;
    exception when others then
      raise warning 'queue_synapse_twins: no short link for % (%)', v_id, sqlerrm;
    end;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;


-- The agency's own row gets the same per-platform trim.
create or replace function public.queue_social_post(
  p_property_id uuid,
  p_platform social_platform,
  p_caption text,
  p_media_urls text[] default '{}'::text[],
  p_scheduled_at timestamptz default now(),
  p_dry_run boolean default true,
  p_payload jsonb default null
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

  v_caption := btrim(p_caption);

  -- The listing's gallery when the caller named none, in display order.
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

  /* THE TWIN GETS THE UNTRIMMED SET. Each platform trims to its own ceiling,
     so handing the twins an array already cut to four -- because this post
     happened to be for X -- would cost Instagram six photographs. */
  insert into social_posts (
    property_id, agency_id, platform, caption, media_urls,
    status, scheduled_at, dry_run, created_by, payload
  ) values (
    p_property_id, v_agency, p_platform, v_caption,
    v_media[1:media_cap_for(p_platform::text)],
    'scheduled', coalesce(p_scheduled_at, now()), coalesce(p_dry_run, true),
    auth.uid(), p_payload
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

    update social_posts
       set caption = v_caption || E'\n\n'
                     || public.caption_link_tail(p_platform::text, v_url)
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
