-- A Telegram channel is connected by a form, not a redirect.
--
-- Every other platform here arrives through OAuth: we send the operator to
-- the platform, they authorise, and a callback hands us a token. Telegram has
-- no such flow for posting. Its model is a BOT added as an ADMINISTRATOR of a
-- channel, after which the bot may post there.
--
-- So "Connect" for Telegram is two steps the agency does in Telegram, then one
-- field in our portal:
--
--   1. add @<our bot> to the channel as an administrator, with Post Messages
--   2. paste the channel's @username here
--
-- WE VERIFY RATHER THAN BELIEVE. social-connect calls getChat to confirm the
-- channel exists and getChatMember to confirm the bot is actually an admin
-- there. Storing an unverified channel would produce an account that looks
-- connected and fails silently at the first post -- which is the failure mode
-- this whole subsystem has spent a week climbing out of.
--
-- ── the credential is ours, which changes what is stored ────────────────
--
-- One Synapse bot serves every agency. No agency ever holds or pastes a
-- token, which is the point: a per-agency bot would mean each of them doing
-- five minutes with BotFather and us storing their credential.
--
-- The consequence is that social_accounts.access_token_ref for a Telegram row
-- points at OUR bot token, not at something the agency granted. That is
-- honest -- it is the credential that authorises the post -- and it keeps one
-- code path in the publisher rather than a special case that reads a token
-- from the environment for one platform.
--
-- Rotating the bot token therefore means reconnecting the channels. There are
-- none today, and a rotation is rare enough that a documented reconnect beats
-- a second token-resolution path nobody exercises.
--
-- ── attribution ─────────────────────────────────────────────────────────
--
-- queue_social_post maps a platform to an attribution_channel and had no case
-- for Telegram, so its clicks would have landed in 'organic'. Both functions
-- that mint a short link are updated. They are reproduced in full because
-- CREATE OR REPLACE takes a whole function; nothing else in either body
-- changes, and the two changed lines are marked.

-- ── connecting: validation and storage ───────────────────────────────────
--
-- A thin wrapper over connect_social_account rather than a second way in. All
-- of the hard parts -- vault storage, the membership guard, soft-deleting a
-- previous row for the same channel -- are already right there and would have
-- to be got right again here.
create or replace function public.connect_telegram_channel(
  p_agency_id   uuid,
  p_chat_id     text,
  p_title       text,
  p_username    text,
  p_bot_token   text,
  p_connected_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if p_chat_id is null or btrim(p_chat_id) = '' then
    raise exception 'No channel id' using errcode = 'invalid_parameter_value';
  end if;

  /* THE CHAT ID IS THE ACCOUNT ID, not the @username. A channel can be
     renamed and its username reassigned; the numeric id cannot. Storing the
     username as the account key would mean a rename silently points our posts
     at whoever took the old handle. */
  v_id := public.connect_social_account(
    p_agency_id     := p_agency_id,
    p_platform      := 'telegram'::social_platform,
    p_account_id    := btrim(p_chat_id),
    /* What the portal shows. The @username where there is one, because that
       is what the agency recognises, falling back to the channel title. */
    p_username      := coalesce(nullif(btrim(coalesce(p_username, '')), ''),
                                btrim(coalesce(p_title, '')), 'channel'),
    p_access_token  := p_bot_token,
    p_refresh_token := null,
    /* A bot token does not expire. NULL rather than an invented date, which
       would show in the portal as a session about to lapse. */
    p_expires_at    := null,
    p_scopes        := array['post_messages'],
    p_connected_by  := p_connected_by,
    /* Neither Meta flow. The column's check constraint only knows the two
       Instagram routes, so Telegram takes the default -- it is never read for
       this platform, because the Telegram adapter has one host. */
    p_auth_source   := 'instagram_login'
  );

  return v_id;
end;
$function$;

comment on function public.connect_telegram_channel(uuid, text, text, text, text, uuid) is
  'Stores a verified Telegram channel as a social account. Wraps '
  'connect_social_account so the vault handling, the membership guard and the '
  'reconnect behaviour are not written twice. The chat id is the account key, '
  'never the @username: a username can be reassigned after a rename.';

revoke all on function public.connect_telegram_channel(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.connect_telegram_channel(uuid, text, text, text, text, uuid) to service_role;


-- ── attribution: telegram is its own channel ─────────────────────────────
--
-- 20260925200000's body, with ONE case added to the channel mapping.
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
                    when 'telegram'  then 'telegram'   -- THE ADDED CASE
                    else 'organic'
                  end)::public.attribution_channel;

    select l.url into v_url
    from public.create_short_link(p_property_id, v_channel, v_id) l;

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


-- The same one added case, in the twins.
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


-- media_cap_for needs no change: it caps X at four and everything else at ten,
-- and ten is exactly Telegram's album maximum. Stated here so the next reader
-- does not go looking for the Telegram case and conclude it was forgotten.
