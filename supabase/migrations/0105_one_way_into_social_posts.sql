-- TWO PATHS WROTE social_posts AND ONLY ONE OF THEM WAS THE CHOKE POINT.
--
-- agency-listings.js schedulePost() inserted into social_posts directly through
-- PostgREST, and it is the path "Schedule to pipeline" uses -- the button an
-- operator actually presses. queue_social_post, which mints the short link and
-- queues the Synapse twin, was only ever called by publishLive(), which nobody
-- uses to schedule.
--
-- So every caption scheduled from the composer arrived with no tracked link in
-- it and no amplification behind it. The first real rehearsal produced exactly
-- that: two Instagram posts, zero rows in short_links, zero twins. Both of the
-- previous migrations were working correctly and neither was ever reached.
--
-- 0096's comment called queue_social_post "the single choke point: the campaign
-- composer, social-generate and the scheduled drain all queue through it".
-- That was the argument for putting the link minting there and it was true of
-- publishLive only. The client is being moved onto the RPC so the claim becomes
-- true of the composer as well.
--
-- For that to lose nothing, the RPC has to accept the one thing the direct
-- insert carried and it did not: payload, which holds the angle a caption took
-- so social-generate does not rewrite the same three subjects every time.
--
-- DROPPED AND RECREATED rather than overloaded. Adding a defaulted parameter to
-- an existing function creates a SECOND function, and a six-argument call would
-- then match both and fail as ambiguous.
drop function if exists public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean);

create or replace function public.queue_social_post(
  p_property_id uuid,
  p_platform    social_platform,
  p_caption     text,
  p_media_urls  text[] default '{}',
  p_scheduled_at timestamptz default now(),
  p_dry_run     boolean default true,
  p_payload     jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
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
       set caption = v_caption || E'\n\n' || v_url
     where id = v_id;
  end if;

  -- The twin, from the ORIGINAL caption: the agency's link belongs to the
  -- agency's post, and the twin mints its own. A failure here is a warning and
  -- not an error -- amplification is the bonus, the row the operator asked for
  -- is already written.
  begin
    perform public.queue_synapse_twins(
      p_property_id, v_agency, v_caption, coalesce(p_media_urls, '{}'),
      coalesce(p_scheduled_at, now()), coalesce(p_dry_run, true), v_id);
  exception when others then
    raise warning 'queue_social_post: could not queue Synapse twins for % (%)', v_id, sqlerrm;
  end;

  return v_id;
end;
$fn$;

revoke all on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean, jsonb)
  from public, anon;
grant execute on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean, jsonb)
  to authenticated;

-- ── the portal has to be able to SEE the amplification ────────────────────
-- synapse_channels is service-role only, which is right for the trypost
-- account ids and leaves the portal unable to answer "will anything actually go
-- out?". Without that, the composer refuses to publish whenever the agency has
-- connected nothing -- even though Synapse's own channels are ready, which is
-- the entire point of the free amplification. Reported as the send button not
-- working.
--
-- Returns the platform and the handle, never the trypost account id. An agency
-- seeing "@synapse_core.ng" is the product working; an agency seeing our
-- workspace's internal ids is nothing anybody needs.
create or replace function public.synapse_channel_list()
returns table (platform text, handle text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select c.platform::text, c.handle
  from synapse_channels c
  where c.is_active
  order by c.platform::text;
$function$;

revoke all on function public.synapse_channel_list() from public, anon;
grant execute on function public.synapse_channel_list() to authenticated;
