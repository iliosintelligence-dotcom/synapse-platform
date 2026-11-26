-- STUDIO CHANNELS CONNECTED THROUGH POSTPEER OR A FACEBOOK PAGE ARE FED (2026-11-26).
--
-- Found in the 26 Nov sweep: six studio channels connected since 18 Nov (two Instagram and two TikTok through PostPeer,
-- two Facebook Pages) had never been given a single post. Three of them have autopilot and "share agency posts" on.
-- feed_city_channels and queue_synapse_twins only considered a channel with a Telegram chat or a TryPost account:
--     (chat_id is not null or trypost_account_id is not null)
-- 20261023 (Facebook Pages, meta_page_id) and 20261118 (PostPeer, postpeer_integration_id) added the two new ways to
-- connect a channel, and social-publish already posts to both (loadCityChannels), but neither migration widened that
-- filter. This is the only change to either function: the same filter, with the two new kinds of connection added.
-- Each channel's own switches (is_active, autopilot, mirror_agency_posts, daily cap, window, gap, routing) are unchanged.
--
-- And Synapse's own X (synapse_channels, TryPost) is switched off. 20261024 switched off every TryPost developer account
-- because TryPost was disconnected on 23 Oct; the X row is still on, so every agency X post queues a Synapse X copy that
-- can only fail ("Synapse x (TryPost has been disconnected) ..."). Its queued copies are removed from the record the same
-- way 20261024 removed the others (deleted_at; history kept).
--
-- Rollback: re-run the two functions from 20261110120000 / the live definitions saved before this, and
--   update synapse_channels set is_active = true where platform = 'x' and trypost_account_id is not null;

begin;

CREATE OR REPLACE FUNCTION public.feed_city_channels()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r        public.city_channels;
  v_now    timestamptz := now();
  v_hour   integer := extract(hour from (now() at time zone 'Africa/Lagos'))::integer;
  v_today  date := (now() at time zone 'Africa/Lagos')::date;
  v_pid    uuid;
  v_agency uuid;
  v_id     uuid;
  v_caption text;
  v_url    text;
  v_n      integer := 0;
begin
  for r in
    select * from city_channels
     where is_active and autopilot
       and (chat_id is not null or trypost_account_id is not null or meta_page_id is not null or postpeer_integration_id is not null)
  loop
    if v_hour < r.window_start or v_hour >= r.window_end then continue; end if;

    if (select count(*) from social_posts
         where city_channel_id = r.id and deleted_at is null and twin_of is null
           and (scheduled_at at time zone 'Africa/Lagos')::date = v_today) >= r.daily_cap then
      continue;
    end if;

    if exists (select 1 from social_posts
                where city_channel_id = r.id and deleted_at is null and twin_of is null
                  and scheduled_at > v_now - r.min_gap) then
      continue;
    end if;

    /* Never posted to this channel first, then the one posted longest ago;
       within each, the newest listing. Live, one this channel's routing rules
       accept (city, kind, bedrooms, price, area), not expired, with a photograph. */
    v_pid := null; v_agency := null;
    select p.id, p.agency_id into v_pid, v_agency
      from properties p
     where p.deleted_at is null
       and p.status = 'live'
       and p.is_active
       and (p.expires_at is null or p.expires_at > v_now)
       and public.city_channel_accepts(r, p)
       and exists (select 1 from property_media m where m.property_id = p.id)
       and not exists (
         select 1 from social_posts sp
          where sp.city_channel_id = r.id and sp.property_id = p.id
            and sp.deleted_at is null and sp.twin_of is null
            and sp.scheduled_at > v_now - r.repost_after)
     order by (select max(sp.scheduled_at) from social_posts sp
                where sp.city_channel_id = r.id and sp.property_id = p.id and sp.twin_of is null) asc nulls first,
              p.listed_at desc nulls last
     limit 1;
    if v_pid is null then continue; end if;

    v_caption := public.city_channel_caption(v_pid);
    if v_caption is null then continue; end if;

    insert into social_posts (
      property_id, agency_id, platform, caption, media_urls,
      status, scheduled_at, dry_run, leg, city_channel_id
    ) values (
      v_pid, v_agency, r.platform, v_caption, public.listing_gallery(v_pid, 1),
      'scheduled', v_now, false, 'synapse', r.id
    )
    returning id into v_id;

    begin
      v_url := public.city_short_link(v_pid, v_id, r.platform);
      if v_url is not null then
        update social_posts
           set caption = public.caption_with_link(r.platform::text, v_caption, v_url)
         where id = v_id;
      end if;
    exception when others then
      raise warning 'feed_city_channels: no short link for % (%)', v_id, sqlerrm;
    end;

    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.queue_synapse_twins(p_property_id uuid, p_agency_id uuid, p_caption text, p_media_urls text[], p_scheduled_at timestamp with time zone, p_dry_run boolean, p_source_post uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_channel record;
  v_id      uuid;
  v_caption text;
  v_url     text;
  v_media   text[];
  v_city    text;
  v_prop    public.properties;
  v_src     text;
  v_at      timestamptz := coalesce(p_scheduled_at, now());
  v_n       integer := 0;
  v_kind    text;
begin
  /* OFF UNLESS SWITCHED ON. Since 2026-09-27 this is a switch in the Synapse
     studio (platform_settings.synapse_twins). */
  if coalesce((select (value->>'enabled')::boolean
                 from platform_settings where key = 'synapse_twins'), false) is not true then
    perform log_social_routing(p_agency_id, p_property_id, p_source_post, null, null, null, null,
                               'skipped', 'Synapse channel copies are switched off in the studio');
    return 0;
  end if;

  select platform::text into v_src from social_posts where id = p_source_post;
  select * into v_prop from properties where id = p_property_id;
  if not found then return 0; end if;
  v_city := v_prop.city;

  /* ROUTING LOG ONLY: the studio channels that would take this platform but whose rules (city, area, price,
     bedrooms, kind) this listing does not meet. Read-only; nothing is queued from here. */
  begin
    for v_channel in
      select c.platform, c.id
        from city_channels c
       where c.is_active and c.mirror_agency_posts
         and (v_src is null or c.platform::text = v_src)
         and (c.chat_id is not null or c.trypost_account_id is not null or c.meta_page_id is not null or c.postpeer_integration_id is not null)
         and not public.city_channel_accepts(c, v_prop)
    loop
      perform log_social_routing(p_agency_id, p_property_id, p_source_post, v_channel.platform::text, 'city_channel',
                                 v_channel.id, null, 'skipped', 'Listing does not match this channel''s rules');
    end loop;
  exception when others then
    raise warning 'queue_synapse_twins: routing log of rejected channels failed (%)', sqlerrm;
  end;

  /* Both kinds of channel in one pass: the original per-platform channels
     (synapse_channels, city_channel_id null) and the studio's channels that
     asked to receive agencies' posts. */
  for v_channel in
    select platform, null::uuid as city_channel_id
      from synapse_channels where is_active
       and (v_src is null or platform::text = v_src)
    union all
    select c.platform, c.id
      from city_channels c
     where c.is_active and c.mirror_agency_posts
       and (v_src is null or c.platform::text = v_src)
       and (c.chat_id is not null or c.trypost_account_id is not null or c.meta_page_id is not null or c.postpeer_integration_id is not null)
       and public.city_channel_accepts(c, v_prop)
    order by 1
  loop
    v_kind := case when v_channel.city_channel_id is null then 'synapse_channel' else 'city_channel' end;

    if exists (
      select 1 from social_posts
      where property_id = p_property_id
        and platform    = v_channel.platform
        and leg         = 'synapse'
        and deleted_at is null
        and city_channel_id is not distinct from v_channel.city_channel_id
        and scheduled_at between v_at - interval '1 hour' and v_at + interval '1 hour'
    ) then
      perform log_social_routing(p_agency_id, p_property_id, p_source_post, v_channel.platform::text, v_kind,
                                 v_channel.city_channel_id, null, 'skipped',
                                 'Already queued on this channel within an hour of this time');
      continue;
    end if;

    v_caption := 'Spotted on Synapse' || E'\n\n' || btrim(coalesce(p_caption, ''));
    v_media := (coalesce(p_media_urls, '{}'))[1:media_cap_for(v_channel.platform::text)];

    v_id := null;
    insert into social_posts (
      property_id, agency_id, platform, caption, media_urls,
      status, scheduled_at, dry_run, created_by, leg, twin_of, city_channel_id
    ) values (
      p_property_id, p_agency_id, v_channel.platform,
      v_caption, v_media,
      'scheduled', v_at, coalesce(p_dry_run, true),
      auth.uid(), 'synapse', p_source_post, v_channel.city_channel_id
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      perform log_social_routing(p_agency_id, p_property_id, p_source_post, v_channel.platform::text, v_kind,
                                 v_channel.city_channel_id, null, 'skipped',
                                 'This post already has a copy on this channel');
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
           when 'telegram'  then 'telegram'
           else 'organic'
         end)::public.attribution_channel,
        v_id) l;

      update social_posts
         set caption = public.caption_with_link(v_channel.platform::text, v_caption, v_url)
       where id = v_id;
    exception when others then
      raise warning 'queue_synapse_twins: no short link for % (%)', v_id, sqlerrm;
    end;

    perform log_social_routing(p_agency_id, p_property_id, p_source_post, v_channel.platform::text, v_kind,
                               v_channel.city_channel_id, v_id, 'queued',
                               case when v_kind = 'city_channel' then 'Listing matches this channel''s rules'
                                    else 'Synapse''s own ' || v_channel.platform::text || ' channel' end);

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;

update public.synapse_channels
   set is_active = false
 where platform = 'x' and trypost_account_id is not null and is_active;

update public.social_posts
   set deleted_at = now()
 where leg = 'synapse' and platform = 'x' and city_channel_id is null
   and deleted_at is null and status in ('scheduled', 'draft', 'failed');

commit;
