-- 0096_social_posts_carry_their_own_short_link.sql
--
-- 0095 built the short-link service and proved it live: mint a token, 302
-- through /s/, and from there property.html -> record_channel_touch ->
-- channel_interactions -> attribute_lead -> lead_attribution runs on its own
-- with nothing further to change.
--
-- And nothing in this product has ever called create_short_link. The service
-- shipped; no publishing path invokes it; leads still arrive with no channel.
-- That is the same failure 0095 was written to end, moved one step later -- a
-- link service no caption carries measures exactly as much as no link service.
--
-- So the mint moves INTO the publishing path, and specifically into
-- queue_social_post, because that function is the single choke point: the
-- campaign composer, social-generate and the scheduled drain all queue through
-- it. Wiring it here rather than in the browser means
--
--   * every caller gets attribution, including callers written after today,
--   * the caption cannot be edited between minting and queueing,
--   * and the link is minted in the SAME transaction as the insert, so "post
--     with no link" and "link for a post that was never queued" are both
--     unreachable states rather than states we promise not to reach.
--
-- Nothing downstream of the redirect is touched here. Not property.html, not
-- record_channel_touch, not attribute_lead, not create_short_link itself.

-- == the only way in, now with the link in it ==============================
-- Everything above the INSERT is what 0052 shipped, unchanged. The function is
-- restated whole because CREATE OR REPLACE has no other form, and a reader
-- deserves to see the guards that still run.
create or replace function public.queue_social_post(
  p_property_id uuid,
  p_platform    social_platform,
  p_caption     text,
  p_media_urls  text[] default '{}',
  p_scheduled_at timestamptz default now(),
  p_dry_run     boolean default true
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

  -- coalesce: agency_role() is NULL for a non-member, and NULL compared with
  -- anything is NULL, which would skip a negative guard entirely.
  v_role := coalesce(agency_role(v_agency)::text, '');
  if v_role not in ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot post for this agency'
      using errcode = 'insufficient_privilege';
  end if;

  v_caption := btrim(p_caption);

  insert into social_posts (
    property_id, agency_id, platform, caption, media_urls,
    status, scheduled_at, dry_run, created_by
  ) values (
    p_property_id, v_agency, p_platform, v_caption, coalesce(p_media_urls, '{}'),
    'scheduled', coalesce(p_scheduled_at, now()), coalesce(p_dry_run, true), auth.uid()
  )
  returning id into v_id;

  -- == the link ============================================================
  -- AFTER the insert, and that order is the entire reason one token per POST is
  -- possible rather than one per listing. The same house on Instagram and on
  -- Facebook has to resolve to two different channels, which means two tokens,
  -- which means the token cannot exist until the post it belongs to has an id.
  -- Waiting for that id costs one extra statement and buys the distinction the
  -- attribution chain exists to make.
  --
  -- DO NOT DOUBLE-APPEND. An operator may have pasted a link themselves --
  -- ours, copied out of the composer, or a campaign link from elsewhere -- and
  -- a caption ending in two competing URLs is worse than one that measures
  -- nothing. '/s/' is the load-bearing half of the test: every link this
  -- service mints contains it, whatever host short_link_base() resolves to. The
  -- host is checked too, lowercased, as belt and braces.
  --
  -- The cost of the test is that a caption containing '/s/' for some unrelated
  -- reason silently gets no link. That is a missed measurement rather than a
  -- mangled post, and it is the right way round.
  if position('/s/' in v_caption) = 0
     and position('synapsecore.dev' in lower(v_caption)) = 0 then

    -- PLATFORM -> CHANNEL. Four of the seven platforms have a channel of their
    -- own. The other three do not:
    --
    --     linkedin, x, youtube  ->  organic
    --
    -- which is a real loss of resolution, said plainly rather than papered
    -- over. The alternative is adding three values to attribution_channel, but
    -- that enum is read by attribute_lead, by the reporting layer and by the
    -- frontend's generated types, so widening it is a decision with its own
    -- blast radius and is not smuggled in on the back of this change. Posts to
    -- those three are still tracked -- the link resolves, the click is recorded
    -- against the post -- they simply land in 'organic', and
    -- short_links.social_post_id recovers the exact platform for anyone who
    -- needs it. Less convenient, not unknowable.
    --
    -- Matched on ::text rather than on enum literals. social_platform has
    -- already gained values this repo holds no migration for (whatsapp,
    -- youtube; see DRIFT.md), so naming a literal that is absent in some
    -- environment would make this function fail at runtime instead of at
    -- deploy. On text, an unrecognised platform falls through to organic, which
    -- is the answer it would have been given anyway.
    v_channel := (case lower(p_platform::text)
                    when 'instagram' then 'instagram'
                    when 'facebook'  then 'facebook'
                    when 'tiktok'    then 'tiktok'
                    when 'whatsapp'  then 'whatsapp_campaign'
                    else 'organic'
                  end)::public.attribution_channel;

    -- EVERY PLATFORM, INCLUDING THE ONES THAT DO NOT LINKIFY. Instagram and
    -- TikTok do not make a URL in a caption tappable, and the tempting
    -- conclusion is to skip them. It is backwards. synapsecore.dev/s/HxdJ1r is
    -- 24 characters, which a person can read off a screen and type; the
    -- 90-character UUID URL it replaces is not typeable by anybody. Short links
    -- matter MOST on exactly the platforms that refuse to linkify them.
    -- Skipping those two would also leave Instagram traffic invisible forever,
    -- and Instagram is where most of this product's traffic is expected.
    --
    -- Dry runs get a link too. A rehearsal whose caption differs from the real
    -- send is not a rehearsal of anything, and create_short_link is idempotent
    -- per post, so the row it writes records an intent that genuinely existed.
    --
    -- If create_short_link raises, the whole call fails and no post is queued.
    -- Deliberate: the failure is not swallowed, because a post that quietly
    -- went out unattributed is precisely the outcome this migration exists to
    -- end, and it would look exactly like success. The two conditions it can
    -- refuse on -- listing missing, caller not a member -- were both settled
    -- above: agency_role() returning non-null and is_agency_member() returning
    -- true are the same predicate over agency_members, so a caller that reached
    -- this line cannot fail the check inside.
    select l.url into v_url
    from public.create_short_link(p_property_id, v_channel, v_id) l;

    -- Two newlines, so the link reads as its own line in every composer instead
    -- of running into the last sentence of the caption.
    --
    -- This UPDATE passes social_posts_guard because inside a SECURITY DEFINER
    -- function current_user is the function's owner, not 'authenticated', so
    -- the guard's client branch never fires. That is the same property 0052
    -- relied on when it made the trigger SECURITY INVOKER.
    update social_posts
       set caption = v_caption || E'\n\n' || v_url
     where id = v_id;
  end if;

  return v_id;
end;
$fn$;

comment on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean) is
  'Queues one social post AND mints its attribution short link, in one transaction. The caption stored on the row is the caption that goes out -- social-publish sends the row, not the browser''s copy -- so the appended link is what a reader taps. A caption that already carries a link is left exactly as written.';

-- REVOKING FROM anon IS NOT REVOKING. Postgres grants EXECUTE on a function to
-- PUBLIC by default and anon inherits that, so naming anon alone removes a
-- grant that was never the one doing the work. PUBLIC has to be named.
--
-- CREATE OR REPLACE preserves the existing ACL, so strictly this restates what
-- 0052 already did. It is restated anyway: this file should read as the whole
-- current truth about who may queue a post, and the cost is two statements.
--
-- service_role is deliberately NOT revoked here. Supabase's default privileges
-- grant it execute on functions in public, and removing that would be an
-- unrelated change made blind to whichever server-side caller depends on it.
revoke all on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean)
  to authenticated;
