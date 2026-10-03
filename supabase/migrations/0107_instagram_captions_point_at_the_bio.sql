-- 0107 — INSTAGRAM AND TIKTOK DO NOT LINKIFY CAPTIONS
--
-- Both queue_social_post and queue_synapse_twins ended every caption with the
-- bare short link, on every platform. On Facebook, X, LinkedIn and WhatsApp
-- that is a link somebody taps. On Instagram and TikTok it is plain text: not
-- underlined, not tappable, not long-pressable into anything useful. So the one
-- route from a post to the home it is about was, on our two most important
-- channels, a string you had to retype from memory into another app.
--
-- The link stays -- it is readable, and some people do type it -- and it is now
-- joined by the thing that actually works there: a pointer to the bio, where
-- 0106's /go/<handle> lists exactly these listings and each entry carries this
-- same short link, so the click is still attributed to this post.
--
-- The URL is shortened to its typable form on those two platforms only. If
-- somebody IS going to retype it, 'synapsecore.dev/s/ab12cd' is 24 characters
-- and 'https://www.synapsecore.dev/s/ab12cd' is 36, and the scheme buys them
-- nothing. Elsewhere the full URL is left alone, because there it has to be
-- autolinked by the platform and a bare host is detected less reliably.
--
-- Both captions are ~46 characters instead of ~36 now. Instagram and TikTok
-- both allow 2200, so the reserve syndication.js keeps for the link cannot
-- bind on either.

begin;

-- ONE HELPER, CALLED FROM BOTH QUEUEING PATHS. They have appended captions
-- separately since the twin leg was added, and a rule that lives in two
-- functions is a rule that will shortly be true in only one of them.
create or replace function public.caption_link_tail(p_platform text, p_url text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_url is null or btrim(p_url) = '' then ''
    when lower(coalesce(p_platform, '')) in ('instagram', 'tiktok')
      then 'Link in bio — or open ' || regexp_replace(p_url, '^https?://(www\.)?', '')
    else p_url
  end;
$$;

comment on function public.caption_link_tail(text, text) is
  'How a short link is written into a caption. Instagram and TikTok do not make '
  'caption URLs tappable, so there the caption points at the bio as well.';

-- Reachable by the two SECURITY DEFINER functions below (which call it as their
-- owner) and by nothing anonymous. revoke from PUBLIC, not from anon: anon
-- holds EXECUTE by inheritance from the default grant to PUBLIC, so revoking
-- from anon alone would have done nothing at all.
revoke all on function public.caption_link_tail(text, text) from public;
grant execute on function public.caption_link_tail(text, text) to authenticated, service_role;


create or replace function public.queue_social_post(
  p_property_id uuid,
  p_platform social_platform,
  p_caption text,
  p_media_urls text[] default '{}'::text[],
  p_scheduled_at timestamptz default now(),
  p_dry_run boolean default true,
  p_payload jsonb default null::jsonb)
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

  insert into social_posts (
    property_id, agency_id, platform, caption, media_urls,
    status, scheduled_at, dry_run, created_by, payload
  ) values (
    p_property_id, v_agency, p_platform, v_caption, coalesce(p_media_urls, '{}'),
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

  -- The twin, from the ORIGINAL caption: the agency's link belongs to the
  -- agency's post, and the twin mints its own.
  begin
    perform public.queue_synapse_twins(
      p_property_id, v_agency, v_caption, coalesce(p_media_urls, '{}'),
      coalesce(p_scheduled_at, now()), coalesce(p_dry_run, true), v_id);
  exception when others then
    raise warning 'queue_social_post: could not queue Synapse twins for % (%)', v_id, sqlerrm;
  end;

  return v_id;
end;
$function$;


create or replace function public.queue_synapse_twins(
  p_property_id uuid, p_agency_id uuid, p_caption text, p_media_urls text[],
  p_scheduled_at timestamptz, p_dry_run boolean, p_source_post uuid)
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
  v_n       integer := 0;
begin
  for v_channel in
    select platform from synapse_channels where is_active order by platform
  loop
    -- A DIFFERENT CAPTION, DELIBERATELY. The same photographs and the same
    -- words, posted within the hour by two accounts on one platform, is what
    -- Instagram and TikTok dampen as duplicate content, so an identical twin
    -- would cost the agency reach rather than add any.
    v_caption := 'Spotted on Synapse' || E'\n\n' || btrim(coalesce(p_caption, ''));

    insert into social_posts (
      property_id, agency_id, platform, caption, media_urls,
      status, scheduled_at, dry_run, created_by, leg, twin_of
    ) values (
      p_property_id, p_agency_id, v_channel.platform,
      v_caption, coalesce(p_media_urls, '{}'),
      'scheduled', coalesce(p_scheduled_at, now()), coalesce(p_dry_run, true),
      auth.uid(), 'synapse', p_source_post
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      continue;   -- already twinned for this platform
    end if;

    -- ITS OWN SHORT LINK, which is the entire reason the twin is a separate
    -- row: a lead from Synapse's Instagram and one from the agency's Instagram
    -- are different facts, and a shared token could not tell them apart.
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

    -- The twin goes out on a SYNAPSE account, so "link in bio" here means
    -- Synapse's bio -- which is right: /go/<that handle> lists the twins, and
    -- each carries this token, so the click stays on the Synapse leg.
    update social_posts
       set caption = v_caption || E'\n\n'
                     || public.caption_link_tail(v_channel.platform::text, v_url)
     where id = v_id;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;

commit;
