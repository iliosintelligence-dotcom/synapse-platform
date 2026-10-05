-- The studio decides which Synapse page a listing goes to (Eden, 2026-10-06).
--
-- Before: every studio channel that asked to "share agencies' posts" got every
-- agency post, narrowed only by the channel's city. Now each channel can carry
-- routing rules, and a listing goes to every channel whose rules accept it:
--
--   route_kinds      what it is: sale, rent, shared, land, commercial, shortlet, offplan
--                    (a listing has one kind of the first six, and also offplan when it is)
--   route_min_beds / route_max_beds   bedrooms; a 2-bedroom page is min 2, max 2.
--                    A bedroom rule excludes land and commercial.
--   route_min_price / route_max_price  the asking price (annual rent for rentals)
--   route_areas      names the listing's area, address or title must mention
--   city             (already there) the city
--
-- No rule = anything. A listing no channel accepts is simply not shared on
-- Synapse's pages; the agency's own accounts are untouched. Agents choose only
-- their OWN accounts; which Synapse page takes which listing is the studio's call.
-- The same rules decide what a channel's autopilot may post.

alter table city_channels
  add column if not exists route_kinds text[],
  add column if not exists route_min_beds integer,
  add column if not exists route_max_beds integer,
  add column if not exists route_min_price numeric,
  add column if not exists route_max_price numeric,
  add column if not exists route_areas text[];

alter table city_channels drop constraint if exists city_channels_route_known;
alter table city_channels add constraint city_channels_route_known check (
  (route_kinds is null or route_kinds <@ array['sale','rent','shared','land','commercial','shortlet','offplan']::text[])
  and (route_min_beds is null or route_min_beds between 0 and 20)
  and (route_max_beds is null or route_max_beds between 0 and 20)
  and (route_min_beds is null or route_max_beds is null or route_min_beds <= route_max_beds)
  and (route_min_price is null or route_min_price >= 0)
  and (route_max_price is null or route_max_price >= 0)
  and (route_min_price is null or route_max_price is null or route_min_price <= route_max_price)
);

create or replace function public.listing_tags(p public.properties)
returns text[]
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select array_remove(array[
    case when p.property_type::text = 'land' then 'land'
         when p.property_type::text = 'commercial' then 'commercial'
         when p.property_type::text = 'shared' then 'shared'
         when p.listing_type::text = 'rent' then 'rent'
         when p.listing_type::text = 'shortlet' then 'shortlet'
         else 'sale' end,
    case when p.deal_structure::text = 'off_plan' or p.build_stage::text in ('under_construction', 'not_started') then 'offplan' end
  ], null);
$$;

create or replace function public.city_channel_accepts(c public.city_channels, p public.properties)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select
    (c.city is null or lower(btrim(c.city)) = lower(btrim(coalesce(p.city, ''))))
    and (c.route_kinds is null or cardinality(c.route_kinds) = 0 or c.route_kinds && public.listing_tags(p))
    and ((c.route_min_beds is null and c.route_max_beds is null)
         or (p.bedrooms is not null
             and p.property_type::text not in ('land', 'commercial')
             and (c.route_min_beds is null or p.bedrooms >= c.route_min_beds)
             and (c.route_max_beds is null or p.bedrooms <= c.route_max_beds)))
    and (c.route_min_price is null or p.price >= c.route_min_price)
    and (c.route_max_price is null or p.price <= c.route_max_price)
    and (c.route_areas is null or cardinality(c.route_areas) = 0
         or exists (
           select 1 from unnest(c.route_areas) a
            where btrim(a) <> ''
              and (lower(coalesce(p.area_name, '')) like '%' || lower(btrim(a)) || '%'
                or lower(coalesce(p.address, ''))   like '%' || lower(btrim(a)) || '%'
                or lower(coalesce(p.title, ''))     like '%' || lower(btrim(a)) || '%')));
$$;
revoke all on function public.listing_tags(public.properties) from public, anon, authenticated;
revoke all on function public.city_channel_accepts(public.city_channels, public.properties) from public, anon, authenticated;
grant execute on function public.listing_tags(public.properties) to service_role;
grant execute on function public.city_channel_accepts(public.city_channels, public.properties) to service_role;

-- ── autopilot honours the rules ───────────────────────────────────────────
create or replace function public.feed_city_channels()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
       and (chat_id is not null or trypost_account_id is not null)
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
$$;

revoke all on function public.feed_city_channels() from public, anon, authenticated;

-- ── sharing an agency's post honours them too ─────────────────────────────
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
  v_at      timestamptz := coalesce(p_scheduled_at, now());
  v_n       integer := 0;
begin
  /* OFF UNLESS SWITCHED ON. Since 2026-09-27 this is a switch in the Synapse
     studio (platform_settings.synapse_twins). */
  if coalesce((select (value->>'enabled')::boolean
                 from platform_settings where key = 'synapse_twins'), false) is not true then
    return 0;
  end if;

  select * into v_prop from properties where id = p_property_id;
  if not found then return 0; end if;
  v_city := v_prop.city;

  /* Both kinds of channel in one pass: the original per-platform channels
     (synapse_channels, city_channel_id null) and the studio's channels that
     asked to receive agencies' posts. */
  for v_channel in
    select platform, null::uuid as city_channel_id
      from synapse_channels where is_active
    union all
    select c.platform, c.id
      from city_channels c
     where c.is_active and c.mirror_agency_posts
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


-- ── what a channel's rules would reach, for the studio to show ─────────────
create or replace function public.synapse_channel_reach(p_channel uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'matching', count(*) filter (where public.city_channel_accepts(c, p)),
    'total', count(*))
  from city_channels c
  join properties p on p.deleted_at is null and p.status = 'live' and p.is_active
  where c.id = p_channel;
$$;
revoke all on function public.synapse_channel_reach(uuid) from public, anon, authenticated;
grant execute on function public.synapse_channel_reach(uuid) to service_role;

-- ── the overview carries the rules and the reach ──────────────────────────
create or replace function synapse_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'label', coalesce(nullif(btrim(c.label), ''), nullif(btrim(c.title), ''), c.handle),
        'platform', c.platform,
        'handle', c.handle,
        'city', c.city,
        'trypost_account_id', c.trypost_account_id,
        'telegram', c.chat_id is not null,
        'is_active', c.is_active,
        'autopilot', c.autopilot,
        'mirror', c.mirror_agency_posts,
        'route_kinds', coalesce(c.route_kinds, '{}'::text[]),
        'route_min_beds', c.route_min_beds,
        'route_max_beds', c.route_max_beds,
        'route_min_price', c.route_min_price,
        'route_max_price', c.route_max_price,
        'route_areas', coalesce(c.route_areas, '{}'::text[]),
        'reach', (select count(*) from properties p where p.deleted_at is null and p.status = 'live' and p.is_active and public.city_channel_accepts(c, p)),
        'daily_cap', c.daily_cap,
        'min_gap_minutes', (extract(epoch from c.min_gap) / 60)::int,
        'window_start', c.window_start,
        'window_end', c.window_end,
        'repost_days', (extract(epoch from c.repost_after) / 86400)::int,
        'posts_today',
          (select count(*) from social_posts sp
            where sp.city_channel_id = c.id and sp.deleted_at is null
              and (sp.scheduled_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)
          + (select count(*) from synapse_posts x
              where x.channel_id = c.id and x.status <> 'cancelled'
                and (x.scheduled_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)
      ) order by c.created_at)
      from city_channels c), '[]'::jsonb),
    'legacy', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'platform', s.platform, 'handle', s.handle, 'is_active', s.is_active)
                       order by s.platform)
        from synapse_channels s), '[]'::jsonb),
    'twins_enabled', coalesce((select (value->>'enabled')::boolean from platform_settings where key = 'synapse_twins'), false),
    'live_listings', (select count(*) from properties where deleted_at is null and status = 'live' and is_active)
  );
$$;
revoke all on function synapse_overview() from public, anon, authenticated;
grant execute on function synapse_overview() to service_role;
