-- A post goes where it was sent, and nowhere else.
--
-- Reported: "the post I made for Telegram was also shared to Instagram as well
-- as to Facebook. Even in the CRM it's showing X, Instagram, Facebook, but I
-- shared it to only one platform."
--
-- Not trypost and not a bug in the sense of code doing something unintended:
-- queue_synapse_twins (0103) queued a copy of EVERY agency post on each of
-- Synapse's own channels -- its Facebook page, its Instagram and its X -- as
-- "free amplification", with no one asked. Measured before this change: 16
-- agency posts had produced 42 copies, 14 on each channel, all published.
--
-- To the agency choosing a platform that is the product posting where it was
-- not told to, and it shows on their board as three extra channels. The
-- pooled reach it was meant to buy now has its own home that does not ride
-- on anybody's post: the city channels (20260927150000), fed from the whole
-- city's inventory and paced.
--
-- SWITCHED OFF, NOT REMOVED. platform_settings.synapse_twins = {"enabled":
-- false}; setting it true restores the old behaviour exactly. The function
-- body below is the LIVE body, read from pg_proc before this was written,
-- with one guard added at the top -- nothing else changes.

insert into platform_settings (key, value, note) values (
  'synapse_twins',
  '{"enabled": false}'::jsonb,
  'Whether every agency post is also copied to Synapse''s own Facebook, '
  'Instagram and X (queue_synapse_twins). Off since 2026-09-27: agencies read '
  'it as posting to platforms they did not choose. Pooled reach now comes '
  'from city_channels instead.'
) on conflict (key) do nothing;

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
  /* OFF UNLESS SWITCHED ON (20260927190000). An agency choosing one
     platform got that post on Synapse's Facebook, Instagram and X as well --
     read, reasonably, as the product posting where it was not asked to. */
  if coalesce((select (value->>'enabled')::boolean
                 from platform_settings where key = 'synapse_twins'), false) is not true then
    return 0;
  end if;
  for v_channel in
    select platform from synapse_channels where is_active order by platform
  loop
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

    v_caption := 'Spotted on Synapse' || E'\n\n' || btrim(coalesce(p_caption, ''));
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
      continue;
    end if;

    begin
      select l.url into v_url
      from public.create_short_link(
        p_property_id,
        (case lower(v_channel.platform::text)
           when 'instagram' then 'instagram'
           when 'facebook'  then 'facebook'
           when 'tiktok'    then 'tiktok'
           when 'whatsapp'  then 'whatsapp_campaign'
           when 'telegram'  then 'telegram'   -- THE ADDED CASE
           else 'organic'
         end)::public.attribution_channel,
        v_id) l;

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
