-- A Telegram post goes to a chat once, and the city feed can be switched off.
--
-- Reported 2026-10-02: "Telegram keeps auto posting", and no way to tell
-- whether the bot or Synapse was doing it.
--
-- WHAT THE RECORD SHOWS (read-only queries, 2026-10-02). The bot cannot post
-- by itself, and telegram-webhook never writes to a channel -- it acts on
-- "/connect CODE" and ignores every other channel post, its own included.
-- Every message it has put in a channel came from social-publish and is a
-- social_posts row. There are five. Each was claimed once (attempts = 1) and
-- carries its own message id; in @synapse_ibadan those ids run 3, 4, 5, 6
-- with no gap, so nothing else was posted there in between. Nothing has been
-- sent twice.
--
-- Four of the five were asked for by nobody. feed_city_channels
-- (20260927150000, cron every 30 minutes) queued them for @synapse_ibadan --
-- 27 Sep 17:12, 28 Sep 07:01, 09:31 and 11:31 UTC -- and drain-social-queue
-- published each within the minute. That is the automatic posting, and it is
-- ours, by design. One of them was a home its agency had posted to its own
-- channel seven hours earlier, and because a city post carries the listing's
-- agency_id it showed on that agency's board as a second Telegram post
-- labelled "Your Telegram" (fixed in the portal, Synapse-Demo, same branch).
--
-- WHAT COULD STILL SEND ONE TWICE. social-publish sends, then writes
-- 'published', and never checked that write. A message that went out but
-- whose write did not land left the row at 'publishing', and
-- claim_social_due_any reclaims any 'publishing' row five minutes old: the
-- same message would go out again, up to max_attempts times. The same if the
-- function died between Telegram's answer and the write. And a reply it could
-- not read counted as a refusal and was retried at 1, 5 and 25 minutes,
-- though Telegram may have posted it.
--
-- THE GUARD is a claim per (post, chat), taken before the send and won once
-- -- the primary key, not a check that could race. Telegram's answer decides
-- what happens to it: a message id is written onto it; a refusal (nothing was
-- posted) lets it go, so the retry ladder works as before; no answer at all
-- keeps it, and the post fails rather than retrying. A duplicate in somebody's
-- public channel cannot be taken back. A missing post is one press of Retry,
-- which is somebody saying they looked -- so retry_social_post lets an
-- unanswered claim go.
--
-- No begin/commit here: scripts/migrate.mjs wraps the file and its record in
-- one transaction, and a commit inside would end that early.

-- ── the claims ───────────────────────────────────────────────────────────
create table if not exists public.telegram_deliveries (
  social_post_id uuid        not null references public.social_posts (id) on delete cascade,
  chat_id        text        not null,
  message_id     bigint,
  claimed_at     timestamptz not null default now(),
  sent_at        timestamptz,
  primary key (social_post_id, chat_id)
);

comment on table public.telegram_deliveries is
  'One row per Telegram post per chat, claimed by social-publish before it sends. '
  'sent_at set = it went out (message_id is the first message). No sent_at = Telegram '
  'never answered, so it may be in the channel; nothing resends it until somebody '
  'presses Retry (retry_social_post). Service role only.';

alter table public.telegram_deliveries enable row level security;
revoke all on public.telegram_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.telegram_deliveries to service_role;

-- What already went out is claimed now, so no reclaim can ever send it again.
insert into public.telegram_deliveries (social_post_id, chat_id, message_id, claimed_at, sent_at)
select sp.id,
       sp.payload->>'chat_id',
       sp.platform_post_id::bigint,
       coalesce(sp.published_at, sp.updated_at),
       coalesce(sp.published_at, sp.updated_at)
  from public.social_posts sp
 where sp.platform::text = 'telegram'
   and sp.status = 'published'
   and sp.provider = 'telegram'
   and coalesce(sp.payload->>'chat_id', '') <> ''
   and sp.platform_post_id ~ '^[0-9]+$'
on conflict do nothing;

-- ── claiming one ─────────────────────────────────────────────────────────
-- Returns {"claimed": true} to the one caller that may send. Anyone else gets
-- the existing claim, so they can tell "already out" (sent_at) from "an
-- attempt that never heard back" (no sent_at).
create or replace function public.claim_telegram_delivery(p_post_id uuid, p_chat_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v jsonb;
begin
  insert into telegram_deliveries (social_post_id, chat_id)
  values (p_post_id, p_chat_id)
  on conflict do nothing;
  if found then
    return jsonb_build_object('claimed', true);
  end if;

  select jsonb_build_object('claimed', false,
                            'message_id', d.message_id,
                            'sent_at', d.sent_at,
                            'claimed_at', d.claimed_at)
    into v
    from telegram_deliveries d
   where d.social_post_id = p_post_id and d.chat_id = p_chat_id;
  return v;
end;
$$;

comment on function public.claim_telegram_delivery(uuid, text) is
  'social-publish, before every Telegram send: wins the (post, chat) claim once. '
  'A loser is told whether the message already went out (sent_at) or an earlier '
  'attempt never got an answer.';
revoke all on function public.claim_telegram_delivery(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_telegram_delivery(uuid, text) to service_role;

-- ── Retry lets an unanswered claim go ────────────────────────────────────
-- The live body (read from pg_proc 2026-10-02), with one statement added
-- before the update. A post that failed because Telegram never answered is
-- the only kind holding a claim with no sent_at; pressing Retry is somebody
-- saying they looked and it is not there. A claim that DID go out is kept --
-- retry is refused for a published post anyway, and the claim would stop it
-- regardless.
create or replace function public.retry_social_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_agency uuid;
  v_status text;
begin
  select agency_id, status::text into v_agency, v_status
  from social_posts
  where id = p_post_id and deleted_at is null;

  if v_agency is null then
    raise exception 'That post is no longer here' using errcode = 'no_data_found';
  end if;

  if coalesce(agency_role(v_agency)::text, '') not in ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot post for this agency' using errcode = 'insufficient_privilege';
  end if;

  -- Only a failure may be retried. A published post is a fact about the
  -- outside world and re-queueing it would post the same thing twice.
  if v_status <> 'failed' then
    raise exception 'Only a post that failed can be sent again'
      using errcode = 'invalid_parameter_value';
  end if;

  -- THE ADDED STATEMENT (20261002080000).
  delete from telegram_deliveries
   where social_post_id = p_post_id
     and sent_at is null;

  update social_posts
     set status         = 'scheduled',
         scheduled_at   = now(),
         attempts       = 0,
         failure_reason = null,
         updated_at     = now()
   where id = p_post_id;

  return true;
end;
$function$;

-- ── the city feed gets an off switch ─────────────────────────────────────
-- The feed posts without anyone pressing anything, which is the point of it
-- and also why it read as the bot misbehaving. Until now the only way to stop
-- it was to unschedule the cron job or switch the channel off -- and
-- claim_city_channel switches a channel back on at the bot's next membership
-- change. ON by default, so nothing changes until somebody decides: setting
-- {"enabled": false} stops new city posts; anything already queued still
-- goes out.
insert into public.platform_settings (key, value, note) values (
  'city_feed',
  '{"enabled": true}'::jsonb,
  'Whether feed_city_channels queues listings for Synapse''s city channels '
  '(@synapse_ibadan). It posts automatically, at most daily_cap a day, min_gap '
  'apart, inside the Lagos window, and reposts a listing after repost_after. '
  'Set {"enabled": false} to stop it.'
) on conflict (key) do nothing;

-- The live body (read from pg_proc 2026-10-02, identical to 20260927150000),
-- with the switch added at the top -- nothing else changes.
create or replace function public.feed_city_channels()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  /* ON UNLESS SWITCHED OFF (20261002080000). A missing row reads as on,
     which is what the feed was before the switch existed. */
  if coalesce((select (value->>'enabled')::boolean
                 from platform_settings where key = 'city_feed'), true) is not true then
    return 0;
  end if;

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
$function$;
