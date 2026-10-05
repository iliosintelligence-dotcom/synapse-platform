-- The Synapse studio: Synapse's own social media, run by its own team.
--
-- WHAT THIS ADDS (Eden, 2026-10-05): a section separate from the agency
-- portal, reached through a back door, where Synapse's social media manager
-- can connect several accounts, write and schedule posts, switch on an
-- autopilot that posts the live inventory, and have agencies' posts mirrored
-- onto Synapse's channels so the audience builds on its own.
--
-- IT REUSES THE PIPELINE THAT ALREADY EXISTS rather than building a second:
--   * a Synapse account is a row in city_channels (already: a trypost account
--     or a Telegram chat, with a daily cap, a posting window and a minimum
--     gap). It simply no longer has to belong to one city, and there can be
--     several per platform;
--   * the autopilot is feed_city_channels(), which already paces itself and
--     publishes through social-publish with delivery checks and short links
--     that credit the agency;
--   * mirroring an agency's post is queue_synapse_twins(), which gains a
--     second loop over the channels that asked for it.
-- The one new thing is a free-form post (synapse_posts): a brand or
-- campaign post with no listing behind it, which social_posts cannot hold
-- because every row there belongs to a property and an agency.

-- ── who may use the studio ────────────────────────────────────────────────
create table if not exists synapse_staff (
  profile_id uuid primary key references profiles (id) on delete cascade,
  role       text not null default 'social_manager' check (role in ('social_manager', 'admin')),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table synapse_staff enable row level security;
revoke all on synapse_staff from public, anon, authenticated;

create or replace function is_synapse_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'platform_admin')
    or exists (select 1 from synapse_staff s where s.profile_id = auth.uid()));
$$;

-- 'platform_admin' for the founders, the staff role for everyone else, null
-- for nobody. The page asks this once and shows nothing to a null.
create or replace function synapse_staff_role()
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'platform_admin') then 'platform_admin'
    else (select s.role from synapse_staff s where s.profile_id = auth.uid())
  end;
$$;
revoke all on function is_synapse_staff() from public, anon;
revoke all on function synapse_staff_role() from public, anon;
grant execute on function is_synapse_staff() to authenticated;
grant execute on function synapse_staff_role() to authenticated;

-- Finding a person by email, for granting access. profiles holds no email.
create or replace function synapse_find_user(p_email text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
$$;
revoke all on function synapse_find_user(text) from public, anon, authenticated;
grant execute on function synapse_find_user(text) to service_role;

-- ── a Synapse account is no longer one per city ───────────────────────────
alter table city_channels alter column city drop not null;
drop index if exists city_channels_one_per_city;
create unique index if not exists city_channels_one_trypost_account
  on city_channels (trypost_account_id) where trypost_account_id is not null;
create unique index if not exists city_channels_one_chat
  on city_channels (chat_id) where chat_id is not null;
alter table city_channels
  add column if not exists label text,
  add column if not exists autopilot boolean not null default true,
  add column if not exists mirror_agency_posts boolean not null default false,
  add column if not exists added_by uuid references profiles (id) on delete set null;

comment on column city_channels.city is
  'The city whose live listings this channel carries. NULL = every city (a national channel).';
comment on column city_channels.autopilot is
  'Whether feed_city_channels() posts the live inventory to this channel on its own.';
comment on column city_channels.mirror_agency_posts is
  'Whether an agency''s post is also copied here by queue_synapse_twins (when synapse_twins is on).';

-- ── the autopilot: national channels, and a switch per channel ────────────
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
       within each, the newest listing. Live, in the channel's city (or any
       city, for a national channel), not expired, with a photograph. */
    v_pid := null; v_agency := null;
    select p.id, p.agency_id into v_pid, v_agency
      from properties p
     where p.deleted_at is null
       and p.status = 'live'
       and p.is_active
       and (p.expires_at is null or p.expires_at > v_now)
       and (r.city is null or lower(btrim(p.city)) = lower(btrim(r.city)))
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

-- ── mirroring an agency's post onto Synapse's channels ────────────────────
-- One twin per channel, not per platform: two Instagram accounts are two
-- audiences. The old index keyed on (twin_of, platform) would refuse the
-- second one.
drop index if exists social_posts_one_twin_per_platform;
create unique index if not exists social_posts_one_twin_per_channel
  on social_posts (twin_of, platform, coalesce(city_channel_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where twin_of is not null and deleted_at is null;

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
  v_at      timestamptz := coalesce(p_scheduled_at, now());
  v_n       integer := 0;
begin
  /* OFF UNLESS SWITCHED ON. Since 2026-09-27 this is a switch in the Synapse
     studio (platform_settings.synapse_twins). */
  if coalesce((select (value->>'enabled')::boolean
                 from platform_settings where key = 'synapse_twins'), false) is not true then
    return 0;
  end if;

  select p.city into v_city from properties p where p.id = p_property_id;

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
       and (c.city is null or lower(btrim(c.city)) = lower(btrim(coalesce(v_city, ''))))
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

-- ── a post with no listing behind it ──────────────────────────────────────
create table if not exists synapse_posts (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null default gen_random_uuid(),   -- one compose = several rows
  channel_id      uuid not null references city_channels (id) on delete cascade,
  platform        social_platform not null,
  caption         text not null check (char_length(caption) between 1 and 5000),
  media_urls      text[] not null default '{}',
  status          text not null default 'scheduled'
                    check (status in ('scheduled', 'publishing', 'sent', 'live', 'failed', 'cancelled')),
  scheduled_at    timestamptz not null default now(),
  attempts        integer not null default 0,
  trypost_post_id text,
  failure_reason  text,
  payload         jsonb not null default '{}'::jsonb,
  sent_at         timestamptz,
  published_at    timestamptz,
  created_by      uuid references profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_synapse_posts_due on synapse_posts (status, scheduled_at);
create index if not exists idx_synapse_posts_group on synapse_posts (group_id);
alter table synapse_posts enable row level security;
revoke all on synapse_posts from public, anon, authenticated;

create or replace function claim_synapse_posts(p_limit integer default 10)
returns setof synapse_posts language sql security definer set search_path = public as $$
  update synapse_posts o
     set status = 'publishing', attempts = o.attempts + 1, updated_at = now()
   where o.id in (
     select id from synapse_posts
      where attempts < 3
        and ((status = 'scheduled' and scheduled_at <= now())
             or (status = 'publishing' and updated_at < now() - interval '10 minutes'))
      order by scheduled_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 10), 25)))
  returning o.*;
$$;
revoke all on function claim_synapse_posts(integer) from public, anon, authenticated;
grant execute on function claim_synapse_posts(integer) to service_role;

-- ── the media bucket: public to read (trypost fetches the pictures), staff to write ──
insert into storage.buckets (id, name, public) values ('synapse-media', 'synapse-media', true)
on conflict (id) do nothing;

drop policy if exists synapse_media_staff_insert on storage.objects;
create policy synapse_media_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'synapse-media' and public.is_synapse_staff());
drop policy if exists synapse_media_staff_delete on storage.objects;
create policy synapse_media_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'synapse-media' and public.is_synapse_staff());

-- ── the two jobs: publish what is due, then ask whether it went live ──────
create or replace function drain_synapse_posts()
returns integer language plpgsql security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp' as $$
declare v_key text; v_url text; v_due integer;
begin
  select count(*) into v_due from synapse_posts
   where attempts < 3
     and ((status = 'scheduled' and scheduled_at <= now())
          or (status = 'publishing' and updated_at < now() - interval '10 minutes'));
  if v_due = 0 then return 0; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if v_key is null or v_url is null then
    raise warning 'drain_synapse_posts: service_role_key or project_url missing from vault';
    return 0;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/synapse-studio',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('action', 'publish_due'),
    timeout_milliseconds := 120000);
  return v_due;
end;
$$;
revoke all on function drain_synapse_posts() from public, anon, authenticated;

create or replace function confirm_synapse_posts()
returns integer language plpgsql security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp' as $$
declare v_key text; v_url text; v_n integer;
begin
  select count(*) into v_n from synapse_posts
   where status = 'sent' and sent_at > now() - interval '3 days';
  if v_n = 0 then return 0; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if v_key is null or v_url is null then return 0; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/synapse-studio',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('action', 'confirm_delivery'),
    timeout_milliseconds := 60000);
  return v_n;
end;
$$;
revoke all on function confirm_synapse_posts() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'drain-synapse-posts') then
    perform cron.schedule('drain-synapse-posts', '* * * * *', 'select public.drain_synapse_posts()');
  end if;
  if not exists (select 1 from cron.job where jobname = 'confirm-synapse-posts') then
    perform cron.schedule('confirm-synapse-posts', '*/2 * * * *', 'select public.confirm_synapse_posts()');
  end if;
end $$;
