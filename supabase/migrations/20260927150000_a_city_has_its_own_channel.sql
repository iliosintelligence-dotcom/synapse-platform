-- A city has its own channel: Synapse Ibadan.
--
-- WHY. Ten agencies with forty followers each reach almost nobody; one channel
-- that carries every agency's homes in a city is worth following, because it
-- is the whole market rather than a slice of it. Agencies then have a reason
-- to point people at it -- their listings are there -- and the audience it
-- builds is Synapse's, city by city, instead of being split ten ways.
--
-- HOW IT DIFFERS FROM THE TWINS. A twin (queue_synapse_twins) follows an
-- agency's own post. The city feed follows the INVENTORY: every live listing
-- in the city with a photograph goes out, whether or not its agency ever
-- posted it, and without anyone pressing anything.
--
-- PACED, not dumped. A channel that posts forty homes in an hour is a channel
-- people mute. Each channel posts inside Lagos daytime hours, at most
-- daily_cap times a day, at least min_gap apart, newest listings first. A home
-- still live after repost_after can go out again, so a quiet week does not
-- leave the channel silent.
--
-- ONE PHOTO PER POST, deliberately. On Telegram only a single photo can carry
-- the "View this home" button -- an album cannot -- and the button is the
-- whole reason Telegram is worth doing.
--
-- ACTIVATION IS TELEGRAM'S TO CONFIRM. The row below is seeded inactive with
-- the handle the channel must have. When @SynapseListingsBot is added to a
-- channel with that @name as an administrator allowed to post, telegram-webhook
-- calls claim_city_channel(), which records the chat id and switches it on.
-- Remove the bot, or take its posting right away, and it switches off. A
-- Telegram @name is unique, so the handle is the proof it is ours.

-- ── the channels ─────────────────────────────────────────────────────────
create table if not exists public.city_channels (
  id                  uuid primary key default uuid_generate_v4(),
  city                text not null,
  platform            public.social_platform not null,
  handle              text,                    -- '@SynapseIbadan'
  title               text,
  chat_id             text,                    -- Telegram: filled by claim_city_channel
  trypost_account_id  text,                    -- a platform we post to through trypost
  is_active           boolean not null default false,
  daily_cap           integer not null default 6 check (daily_cap between 1 and 24),
  min_gap             interval not null default interval '2 hours',
  window_start        smallint not null default 8  check (window_start between 0 and 23),
  window_end          smallint not null default 20 check (window_end between 1 and 24),
  repost_after        interval not null default interval '30 days',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists city_channels_one_per_city
  on public.city_channels (platform, lower(city));

comment on table public.city_channels is
  'Synapse''s own per-city channels, fed from the live inventory of that city by '
  'feed_city_channels(). Service role only. Telegram rows are switched on by '
  'claim_city_channel() when the bot is made a posting admin of the channel.';

alter table public.city_channels enable row level security;
revoke all on public.city_channels from public, anon, authenticated;

-- A city post says which channel it went to; the publisher reads the chat id
-- from here rather than from synapse_channels, which is one row per platform.
alter table public.social_posts
  add column if not exists city_channel_id uuid references public.city_channels (id) on delete set null;
create index if not exists social_posts_city_channel
  on public.social_posts (city_channel_id, scheduled_at desc) where city_channel_id is not null;

insert into public.city_channels (city, platform, handle, title)
values ('Ibadan', 'telegram', '@SynapseIbadan', 'Synapse Ibadan')
on conflict do nothing;

-- ── switched on by Telegram ──────────────────────────────────────────────
create or replace function public.claim_city_channel(
  p_chat_id  bigint,
  p_username text,
  p_title    text,
  p_status   text,
  p_can_post boolean
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  update city_channels
     set chat_id    = p_chat_id::text,
         title      = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         is_active  = (p_status in ('administrator', 'creator') and coalesce(p_can_post, false)),
         updated_at = now()
   where platform = 'telegram'
     and (   (p_username is not null and lower(handle) = lower('@' || p_username))
          or chat_id = p_chat_id::text)
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.claim_city_channel(bigint, text, text, text, boolean) is
  'Called by telegram-webhook on every change to the bot''s membership of a '
  'channel. Matches a seeded city channel by @name (or by chat id once known) and '
  'switches it on only while the bot is an administrator that may post.';
revoke all on function public.claim_city_channel(bigint, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_city_channel(bigint, text, text, text, boolean) to service_role;

-- ── the caption ──────────────────────────────────────────────────────────
-- From the listing's own fields, like the share kit's: every figure is the
-- row's figure. The area and the city, never the address -- this goes to
-- strangers and somebody lives there. It names the agency, because that is
-- what makes the channel worth an agency pointing people to.
create or replace function public.city_channel_caption(p_property_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  p        record;
  v_beds   integer;
  v_head   text;
  v_per    text;
  v_lines  text[] := '{}';
  v_charge text[] := '{}';
  v_naira  text := chr(8358);   -- ₦
begin
  select pr.*, n.name as area_name, a.name as agency_name
    into p
    from properties pr
    left join neighbourhoods n on n.id = pr.neighbourhood_id
    left join agencies a on a.id = pr.agency_id
   where pr.id = p_property_id;
  if not found then return null; end if;

  v_beds := p.bedrooms;
  v_head := case when coalesce(v_beds, 0) > 0 and p.property_type::text not in ('land', 'commercial')
                 then v_beds || '-BEDROOM ' else '' end
         || upper(replace(coalesce(p.property_type::text, 'property'), '_', ' '))
         || case p.listing_type::text
              when 'rent' then ' FOR RENT'
              when 'shortlet' then ' SHORT-LET'
              else ' FOR SALE' end;
  v_lines := v_lines || ('🏡 ' || v_head);

  if coalesce(p.area_name, p.city) is not null then
    v_lines := v_lines || ('📍 ' || concat_ws(', ', nullif(btrim(p.area_name), ''), nullif(btrim(p.city), '')));
  end if;

  v_per := case p.price_period::text
             when 'per_year' then '/year' when 'per_month' then '/month'
             when 'per_night' then '/night' else '' end;
  if coalesce(p.price, 0) > 0 then
    v_lines := v_lines || ('💰 ' || v_naira || to_char(p.price, 'FM999,999,999,990') || v_per);
  end if;

  if coalesce(p.service_charge, 0) > 0 then
    v_charge := v_charge || ('Service charge ' || v_naira || to_char(p.service_charge, 'FM999,999,999,990'));
  end if;
  if coalesce(p.agency_fee, 0) > 0 then
    v_charge := v_charge || ('Agency fee ' || v_naira || to_char(p.agency_fee, 'FM999,999,999,990'));
  end if;
  if coalesce(p.legal_fee, 0) > 0 then
    v_charge := v_charge || ('Legal fee ' || v_naira || to_char(p.legal_fee, 'FM999,999,999,990'));
  end if;
  if array_length(v_charge, 1) > 0 then
    v_lines := v_lines || array_to_string(v_charge, ' · ');
  end if;

  if coalesce(array_length(p.amenities, 1), 0) > 0 then
    v_lines := v_lines || array_to_string(p.amenities[1:4], ' · ');
  end if;

  v_lines := v_lines || ''::text;
  if p.verification_status::text = 'verified' then
    v_lines := v_lines || '✓ Verified by Synapse'::text;
  end if;
  if p.agency_name is not null then
    v_lines := v_lines || ('Listed by ' || p.agency_name);
  end if;

  return array_to_string(v_lines, E'\n');
end;
$$;
revoke all on function public.city_channel_caption(uuid) from public, anon, authenticated;

-- ── the link ─────────────────────────────────────────────────────────────
-- create_short_link refuses anyone who is not a member of the listing's
-- agency, and the feed runs as nobody -- it is a cron job. This mints the
-- same kind of post-bound link without that check, and is reachable only
-- from the feed: no role may execute it.
create or replace function public.city_short_link(p_property_id uuid, p_post_id uuid, p_platform public.social_platform)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_agency uuid;
  v_token  text;
  v_base   text := public.short_link_base();
  v_ch     public.attribution_channel;
begin
  select token into v_token from short_links where social_post_id = p_post_id;
  if v_token is not null then return v_base || '/s/' || v_token; end if;

  select agency_id into v_agency from properties where id = p_property_id;
  if v_agency is null then return null; end if;

  v_ch := (case lower(p_platform::text)
             when 'instagram' then 'instagram'
             when 'facebook'  then 'facebook'
             when 'tiktok'    then 'tiktok'
             when 'whatsapp'  then 'whatsapp_campaign'
             when 'telegram'  then 'telegram'
             else 'organic'
           end)::public.attribution_channel;

  v_token := public.short_link_token(nextval('public.short_link_seq'));
  insert into short_links (token, target_url, property_id, agency_id,
                           social_post_id, channel, created_by)
  values (v_token,
          v_base || '/app/property.html?id=' || p_property_id::text
                 || '&ch=' || v_ch::text || '&post=' || v_token,
          p_property_id, v_agency, p_post_id, v_ch, null);
  return v_base || '/s/' || v_token;
end;
$$;
revoke all on function public.city_short_link(uuid, uuid, public.social_platform) from public, anon, authenticated;

-- ── the feed ─────────────────────────────────────────────────────────────
-- At most ONE post per channel per run, every half hour; the drain that runs
-- every minute publishes it. Paced by the channel's own rules, all read in
-- Lagos time because that is when its readers are awake.
create or replace function public.feed_city_channels()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r        record;
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
     where is_active
       and (chat_id is not null or trypost_account_id is not null)
  loop
    if v_hour < r.window_start or v_hour >= r.window_end then continue; end if;

    if (select count(*) from social_posts
         where city_channel_id = r.id and deleted_at is null
           and (scheduled_at at time zone 'Africa/Lagos')::date = v_today) >= r.daily_cap then
      continue;
    end if;

    if exists (select 1 from social_posts
                where city_channel_id = r.id and deleted_at is null
                  and scheduled_at > v_now - r.min_gap) then
      continue;
    end if;

    /* Never posted to this channel first, then the one posted longest ago;
       within each, the newest listing. Live, in the city, not expired, with
       a photograph. */
    v_pid := null; v_agency := null;
    select p.id, p.agency_id into v_pid, v_agency
      from properties p
     where p.deleted_at is null
       and p.status = 'live'
       and p.is_active
       and (p.expires_at is null or p.expires_at > v_now)
       and lower(btrim(p.city)) = lower(btrim(r.city))
       and exists (select 1 from property_media m where m.property_id = p.id)
       and not exists (
         select 1 from social_posts sp
          where sp.city_channel_id = r.id and sp.property_id = p.id
            and sp.deleted_at is null
            and sp.scheduled_at > v_now - r.repost_after)
     order by (select max(sp.scheduled_at) from social_posts sp
                where sp.city_channel_id = r.id and sp.property_id = p.id) asc nulls first,
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
comment on function public.feed_city_channels() is
  'Queues at most one post per active city channel per run, paced by the '
  'channel''s window, daily cap and minimum gap (Lagos time). Run every half '
  'hour by cron; drain_social_queue publishes what it queues.';
revoke all on function public.feed_city_channels() from public, anon, authenticated;

select cron.unschedule('feed-city-channels')
 where exists (select 1 from cron.job where jobname = 'feed-city-channels');
select cron.schedule(
  'feed-city-channels',
  '*/30 * * * *',
  $cron$select public.feed_city_channels()$cron$
);
