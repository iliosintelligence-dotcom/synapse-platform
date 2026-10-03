-- 0106 — A LINK INSTAGRAM CAN ACTUALLY OPEN
--
-- queue_social_post appends the short link to every caption on every platform,
-- which is right on Facebook, X, LinkedIn and WhatsApp and useless on two of
-- them: Instagram and TikTok do not turn URLs in captions into links, and never
-- have. The only tappable link Instagram gives an account is the one in its
-- bio, and trypost exposes instagram_feed only -- no stories, so no link
-- sticker either. So every Instagram post we have ever made ended in 38
-- characters of text nobody could follow.
--
-- The bio is the mechanism, and a bio link has to be a URL that never changes,
-- because nobody is editing it per post. This is that URL: one stable page per
-- account, listing what that account has recently posted.
--
-- Each entry links through /s/<token> -- the SAME short link that is in the
-- caption of the post it came from -- rather than straight to the property.
-- That is the whole point: a click from Instagram lands in click_events with
-- channel = instagram, attributed to the exact post that sent it. Instagram
-- traffic has been unmeasurable until now because there was no way to click.

begin;

-- ── matching a handle that came out of a URL ────────────────────────────────
-- Handles are stored as people write them: '@synapse_core.ng', 'Demo Agency'.
-- Neither is a path segment. This is the one normalisation both sides go
-- through, so /go/synapse_core.ng and /go/demo-agency both resolve and nobody
-- has to know how the row was typed.
--
-- IMMUTABLE so it can be indexed later if these tables ever grow; there are
-- single digits of rows today and the scan is free.
create or replace function public.bio_slug(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    regexp_replace(
      lower(btrim(regexp_replace(coalesce(p, ''), '^\s*@', ''))),
      '[^a-z0-9._-]+', '-', 'g'),
    '');
$$;

comment on function public.bio_slug(text) is
  'Normalises a social handle into a URL path segment, for /go/<handle>.';


-- ── what a bio page shows ───────────────────────────────────────────────────
-- Anonymous, because it is linked from a public Instagram bio and read by
-- people who have never heard of us. SECURITY DEFINER for exactly that reason:
-- it must reach social_posts, which no anonymous role may read, and hand back
-- only the handful of public columns below. It returns nothing that is not
-- already on the public property page.
--
-- DISTINCT ON (property_id): a listing posted on three platforms, plus its
-- Synapse twins, is one home. The bio page is a list of homes, not a list of
-- posts, so it keeps the most recent post per property and uses that post's
-- link. Six is the visible page; anything older is scrolling for its own sake.
-- Dropped rather than replaced wherever this is re-run against an older
-- shape: adding a column changes the OUT-parameter row type, which
-- CREATE OR REPLACE is not permitted to do.
drop function if exists public.bio_page(text, int);

create function public.bio_page(p_handle text, p_limit int default 6)
returns table (
  property_id   uuid,
  title         text,
  price         numeric,
  currency      text,
  listing_type  text,
  city          text,
  bedrooms      smallint,
  verified      boolean,
  image_url     text,
  token         text,
  platform      text,
  posted_at     timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with slug as (
    select public.bio_slug(p_handle) as s
  ),
  -- Every channel with this handle, on either leg. An agency that connects an
  -- Instagram account gets a /go page on the same day, with no further work.
  mine as (
    select 'synapse'::text as leg, c.platform, null::uuid as agency_id
    from public.synapse_channels c, slug
    where c.is_active and public.bio_slug(c.handle) = slug.s
    union all
    select 'agency'::text, a.platform, a.agency_id
    from public.social_accounts a, slug
    where a.is_active and a.deleted_at is null
      and public.bio_slug(a.platform_username) = slug.s
  ),
  posted as (
    select distinct on (sp.property_id)
      sp.property_id, sp.published_at, sl.token, sp.platform::text as platform
    from public.social_posts sp
    join mine m
      on m.platform = sp.platform
     and m.leg = coalesce(sp.leg, 'agency')
     and (m.agency_id is null or m.agency_id = sp.agency_id)
    -- LEFT. A post made before queue_social_post minted links has no token,
    -- and an inner join dropped it -- which is exactly the post that prompted
    -- this work: the one live Instagram post, the one with no link in its
    -- caption, the one a reader most needs another way to reach. Without a
    -- token the page falls back to the property URL with the channel on it:
    -- coarser attribution, but not a dead end.
    left join public.short_links sl
      on sl.social_post_id = sp.id and sl.is_active
    where sp.status = 'published'
      and sp.deleted_at is null
      -- A rehearsal never reached Instagram, so nobody arriving from Instagram
      -- can be looking for it. Listing one would be inventing an audience.
      and sp.dry_run is not true
    -- A post WITH a token beats a more recent one without, so a property that
    -- has both keeps the precise attribution.
    order by sp.property_id, (sl.token is null), sp.published_at desc nulls last
  )
  select
    p.id,
    p.title,
    p.price,
    -- The page formats through the app's own money(), which is currency-aware.
    -- Its predecessor rounded to whole millions and rendered a 1,450,000
    -- listing as a flat 1M -- a third off, on the one number the reader tapped
    -- the link to see, and disagreeing with the property page one tap later.
    coalesce(nullif(btrim(p.currency), ''), 'NGN'),
    p.listing_type::text,
    p.city,
    p.bedrooms,
    (p.verification_status = 'verified'),
    (select m.url
       from public.property_media m
      where m.property_id = p.id
      order by m.display_order nulls last
      limit 1),
    posted.token,
    posted.platform,
    posted.published_at
  from posted
  join public.properties p on p.id = posted.property_id
  where p.is_active
    and p.deleted_at is null
    -- An expired listing is off the public site; a bio page that still shows it
    -- is sending people to a 404 from the one link we asked them to tap.
    and (p.expires_at is null or p.expires_at > now())
  order by posted.published_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 6), 24));
$$;

comment on function public.bio_page(text, int) is
  'Public: the listings an account recently posted, for its link-in-bio page. '
  'Links through the post''s own short link so the click is attributed.';


-- ── who the page belongs to ─────────────────────────────────────────────────
-- Enough to title the page honestly and no more. Never the trypost account id,
-- never the access token refs -- the same rule synapse_channel_list() follows.
create or replace function public.bio_owner(p_handle text)
returns table (handle text, platform text, is_synapse boolean, agency_name text)
language sql
stable
security definer
set search_path = public
as $$
  with slug as (select public.bio_slug(p_handle) as s)
  select c.handle, c.platform::text, true, null::text
  from public.synapse_channels c, slug
  where c.is_active and public.bio_slug(c.handle) = slug.s
  union all
  select a.platform_username, a.platform::text, false, ag.name
  from public.social_accounts a
  join public.agencies ag on ag.id = a.agency_id, slug
  where a.is_active and a.deleted_at is null
    and public.bio_slug(a.platform_username) = slug.s
  limit 1;
$$;

comment on function public.bio_owner(text) is
  'Public: display identity for a /go/<handle> page. Never exposes account ids.';


-- ── grants ──────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE on a new function to PUBLIC, and anon inherits it.
-- Revoking from anon alone does nothing at all -- so revoke from PUBLIC first
-- and then grant back deliberately, which is also the only way to be sure the
-- SECURITY DEFINER functions above are reachable by exactly the roles intended.
revoke all on function public.bio_slug(text)     from public;
revoke all on function public.bio_page(text, int) from public;
revoke all on function public.bio_owner(text)     from public;

grant execute on function public.bio_slug(text)      to anon, authenticated;
grant execute on function public.bio_page(text, int) to anon, authenticated;
grant execute on function public.bio_owner(text)     to anon, authenticated;

commit;
