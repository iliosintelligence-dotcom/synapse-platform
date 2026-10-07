-- A post goes where it was sent (Eden, 2026-10-07).
--
-- An agency made ONE TikTok post and it appeared on Instagram, Facebook, X and
-- Telegram too. The "Synapse twin" step (Synapse sharing what an agency posts)
-- copied the post onto EVERY Synapse channel, whatever platform the agency had
-- chosen. A twin now goes only to Synapse's channels on the SAME platform as the
-- post it shares: a TikTok post is shared on Synapse's TikTok, an Instagram post
-- on Synapse's Instagram, and nowhere else.
--
-- Everything else about twins is unchanged: still off unless switched on in the
-- studio, still honouring each channel's routing rules and city.

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
  v_city    text;
  v_prop    public.properties;
  v_src     text;
  v_at      timestamptz := coalesce(p_scheduled_at, now());
  v_n       integer := 0;
begin
  /* OFF UNLESS SWITCHED ON. Since 2026-09-27 this is a switch in the Synapse
     studio (platform_settings.synapse_twins). */
  if coalesce((select (value->>'enabled')::boolean
                 from platform_settings where key = 'synapse_twins'), false) is not true then
    return 0;
  end if;

  select platform::text into v_src from social_posts where id = p_source_post;
  select * into v_prop from properties where id = p_property_id;
  if not found then return 0; end if;
  v_city := v_prop.city;

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
       and (c.chat_id is not null or c.trypost_account_id is not null)
       and public.city_channel_accepts(c, v_prop)
    order by 1
  loop
    if exists (
      select 1 from social_posts
      where property_id = p_property_id
        and platform    = v_channel.platform
        and leg         = 'synapse'
        and deleted_at is null
        and city_channel_id is not distinct from v_channel.city_channel_id
        and scheduled_at between v_at - interval '1 hour' and v_at + interval '1 hour'
    ) then
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

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;

-- Posts already queued by the old behaviour and not yet sent: take back the twins
-- that sit on a platform different from the post they copy.
update social_posts t
   set deleted_at = now()
  from social_posts s
 where t.twin_of = s.id
   and t.platform <> s.platform
   and t.status = 'scheduled'
   and t.deleted_at is null;
