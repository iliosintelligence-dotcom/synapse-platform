-- A listing can go to Stories.
--
-- Phase 4 of docs/SOCIAL_TO_PLATFORM_ROUTING.md, and its stated premise is
-- false. The plan said:
--
--     Instagram Stories carry a genuinely tappable link sticker [...] This is
--     the only fully tappable Instagram surface there is.
--
-- The first half is true of Stories. It is NOT true of Stories published
-- through the API. Meta's Content Publishing documentation offers media_type
-- STORIES with image_url or video_url and nothing else -- no link sticker, no
-- poll, no mention, no hashtag. Checked before building, because the same
-- assumption killed Phase 2 this morning.
--
-- So this ships without the thing it was for, and it is worth being exact
-- about what is left:
--
--   WHAT A STORY GETS US       the top strip of the Instagram app, where
--                              Nigerian agencies get most of their attention,
--                              for a listing that would otherwise only sit in
--                              the feed
--   WHAT IT DOES NOT GET US    a tap. There is no route out of an
--                              API-published Story except the profile bio,
--                              and no way to attribute anything to it
--
-- NO SHORT LINK IS MINTED FOR A STORY ROW, deliberately. Every other post in
-- this system gets one, and doing it here out of symmetry would create a link
-- nobody can click, a channel that can never convert, and a row in the click
-- report that is permanently zero for a reason no one reading it would guess.
-- A story is reach, and it is recorded as reach.
--
-- THE AGENCY CAN STILL ADD THE STICKER. Stories last 24 hours and the sticker
-- takes two taps in the app. An agency that wants the link on a Story can put
-- it there themselves, on the Story we published, which is more than they
-- could do before.

alter table public.social_posts
  add column if not exists post_format text not null default 'feed'
    check (post_format in ('feed', 'story'));

comment on column public.social_posts.post_format is
  'feed = the ordinary post. story = an Instagram Story, which lasts 24 hours '
  'and carries NO link: the Content Publishing API accepts media and nothing '
  'else. Story rows deliberately have no short link, because nothing on a '
  'Story could open one.';

create index if not exists social_posts_story
  on public.social_posts (agency_id, scheduled_at)
  where post_format = 'story' and deleted_at is null;


-- ── a story beside a post ────────────────────────────────────────────────
--
-- A separate row rather than a flag on the existing one, for the same reason
-- a Synapse twin is a separate row: it publishes separately, succeeds or
-- fails separately, and carries its own platform_post_id. One row with two
-- destinations cannot record that the feed post went out and the Story did
-- not.
--
-- ONE MEDIA ITEM. A Story is a single frame -- there is no carousel Story in
-- the publishing API -- so the gallery is trimmed here rather than discovered
-- at the container, where the error names a field and not a cause.
create or replace function public.queue_story_twin(p_source_post uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_src  record;
  v_id   uuid;
  v_role text;
begin
  select * into v_src from social_posts
   where id = p_source_post and deleted_at is null;
  if v_src.id is null then
    raise exception 'No such post' using errcode = 'no_data_found';
  end if;

  v_role := coalesce(agency_role(v_src.agency_id)::text, '');
  if v_role not in ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot post for this agency'
      using errcode = 'insufficient_privilege';
  end if;

  -- Instagram only. Facebook Stories are a different product with different
  -- endpoints, and pretending otherwise here would queue a row the publisher
  -- would reject later, where the failure reads as a bug rather than a limit.
  if v_src.platform <> 'instagram' then
    raise exception 'Only Instagram Stories can be posted from here'
      using errcode = 'invalid_parameter_value';
  end if;

  if cardinality(coalesce(v_src.media_urls, '{}')) = 0 then
    raise exception 'That post has no photograph to use as a Story'
      using errcode = 'invalid_parameter_value';
  end if;

  /* Idempotent against a double-press and against a retried request: a
     listing already going to Stories from this post is not queued twice. */
  select id into v_id from social_posts
   where twin_of = p_source_post and post_format = 'story' and deleted_at is null
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into social_posts (
    property_id, agency_id, platform, caption, media_urls,
    status, scheduled_at, dry_run, created_by, leg, twin_of,
    social_account_id, post_format
  ) values (
    v_src.property_id, v_src.agency_id, 'instagram',
    /* Kept so the pipeline card has something to show, and sent nowhere: the
       STORIES container takes no caption field at all. */
    v_src.caption,
    v_src.media_urls[1:1],
    'scheduled', v_src.scheduled_at, v_src.dry_run,
    auth.uid(), v_src.leg, p_source_post,
    v_src.social_account_id, 'story'
  )
  returning id into v_id;

  /* NO create_short_link HERE. Every other post gets one; a Story cannot open
     one, so minting it would produce a permanently-zero row in the click
     report for a reason nobody reading it would guess. */

  return v_id;
end;
$function$;

comment on function public.queue_story_twin(uuid) is
  'Queues an Instagram Story beside an existing post, using its first image. '
  'Idempotent per source post. No short link: an API-published Story carries '
  'no sticker and no tappable link, so there is nothing for one to open.';

revoke all on function public.queue_story_twin(uuid) from public, anon;
grant execute on function public.queue_story_twin(uuid) to authenticated, service_role;
