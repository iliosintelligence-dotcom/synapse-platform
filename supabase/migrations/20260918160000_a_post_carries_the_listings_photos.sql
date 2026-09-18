-- A POST CARRIES THE LISTING'S PHOTOS, AND THE DATABASE DECIDES WHICH.
--
-- The portal was taught to send the whole gallery so a listing with twelve
-- photographs posts as a carousel. It then sent one photo anyway. Chasing that
-- meant reading four different client-side sources for the same fact —
-- localStorage, the fetch that replaces it, fromDbRow, deriveLegacy — any of
-- which can drop `media` without anything failing. The portal is simply the
-- wrong place to answer "which photographs does this listing have".
--
-- property_media already knows. So when a caller does not name its media, the
-- listing's own photographs are used, in display order.
--
--   p_media_urls = NULL or {}  ->  every photo on the listing, capped at ten
--   p_media_urls = a list      ->  exactly that list, untouched
--
-- Ten because that is Meta's carousel limit and social-publish's checkMedia
-- refuses an eleventh: better to send the first ten than to queue a post that
-- is certain to fail.
--
-- This also fixes every caller at once, including ones not written yet, which
-- the client-side version could not. The syndication composer picks a
-- different hero image per variant (aiCampaign cycles a pool), and that
-- deliberate choice is now expressed by passing nothing and letting the
-- listing's gallery stand — a carousel of the home is worth more to a buyer
-- than one angle of it.
--
-- The Synapse twin gets the resolved array too, so both legs carousel or
-- neither does.

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

  -- THE GALLERY, when the caller did not name one. Ordered by display_order,
  -- which is the primary signal here: property_media has no is_primary column.
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
        and url like 'https://%'      -- Meta will not fetch anything else
      order by display_order
      limit 10
    ) m;
  end if;

  insert into social_posts (
    property_id, agency_id, platform, caption, media_urls,
    status, scheduled_at, dry_run, created_by, payload
  ) values (
    p_property_id, v_agency, p_platform, v_caption, v_media,
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
  -- agency's post, and the twin mints its own. It gets the RESOLVED media, so
  -- both legs carousel or neither does.
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

comment on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean, jsonb) is
  'Queue one post per channel. When p_media_urls is null or empty the listing''s '
  'own photographs are used, in display_order, capped at ten (Meta''s carousel '
  'limit) and restricted to https URLs Meta can fetch. An explicit list is used '
  'exactly as given. The Synapse twin receives the same resolved array.';
