-- A photograph can carry the agency's mark.
--
-- A6. Agencies do this by hand in Canva before every post: the logo in a
-- corner, the price across the bottom, "Verified" if it is. We hold all three
-- -- agencies.logo_url, properties.price, properties.verification_status --
-- so it can be done once at upload instead of every time.
--
-- ── the problem with burning a price into a picture ─────────────────────
--
-- It is true at the moment it is drawn and never checked again. Drop the
-- price and the photograph still says the old one, in an image now sitting on
-- Instagram where nothing can recall it. That is the same failure this
-- codebase spent today removing -- a number presented as current that nothing
-- keeps current -- and it would be worse here, because it is on a picture
-- rather than a screen.
--
-- Three things stop that:
--
--   THE ORIGINAL IS NEVER TOUCHED. `url` keeps the photograph as uploaded and
--   the listing page keeps showing it. The mark goes on a DERIVATIVE in
--   `branded_url`, which only social posts use. An agency that hates the
--   result loses nothing.
--
--   WHAT IT WAS BRANDED WITH IS RECORDED. branded_price and branded_verified
--   are the values drawn onto the image, not the values now. Comparing them
--   to the listing is how drift becomes DETECTABLE rather than invisible.
--
--   DRIFT IS REPORTED, NOT GUESSED AT. media_brand_stale() names the images
--   whose mark no longer matches the listing, so the portal can offer to
--   redraw them. The alternative -- silently falling back to the unbranded
--   original -- would be correct and would also mean an agency's branding
--   quietly disappearing for reasons nobody could see.
--
-- Nothing here regenerates anything on its own. The compositing is done in
-- the browser with a canvas, at upload, and a redraw needs a browser too.
-- Deno has no canvas, so a server-side version would be a new image service;
-- that is a real decision and this is not it.

alter table public.property_media
  add column if not exists branded_url      text,
  -- Kept as text rather than numeric: it is a record of what was DRAWN, and
  -- what was drawn was a formatted string. Re-deriving "N4.5m" from 4500000
  -- to compare it would be re-implementing the formatter in SQL.
  add column if not exists branded_price    text,
  add column if not exists branded_verified boolean,
  add column if not exists branded_at       timestamptz;

comment on column public.property_media.branded_url is
  'A copy of this photograph with the agency mark, the price and the verified '
  'badge drawn on. Used by social posts only -- the listing page keeps `url`, '
  'which is never touched. NULL means no branded copy exists.';
comment on column public.property_media.branded_price is
  'The price TEXT drawn onto the image, not the price now. The two differing '
  'is how a stale mark is detected, and why it is stored at all.';

create index if not exists property_media_branded
  on public.property_media (property_id) where branded_url is not null;


-- ── which marks no longer match the listing ──────────────────────────────
create or replace function public.media_brand_stale()
returns table (
  media_id      uuid,
  property_id   uuid,
  branded_price text,
  price_now     text,
  branded_verified boolean,
  verified_now  boolean
)
language sql
stable
security definer
set search_path = public
as $function$
  select m.id, m.property_id, m.branded_price,
         /* The same shape the browser draws: naira, millions to one decimal.
            Formatted here only for COMPARISON and for showing the agency what
            it would become -- the drawing still happens in the canvas. */
         case when p.price is null then null
              when p.price >= 1000000
                then 'N' || trim(to_char(p.price / 1000000.0, 'FM999999990.0')) || 'm'
              else 'N' || trim(to_char(p.price, 'FM999,999,999')) end,
         m.branded_verified,
         (p.verification_status = 'verified')
  from property_media m
  join properties p on p.id = m.property_id
  where m.deleted_at is null
    and p.deleted_at is null
    and m.branded_url is not null
    and is_agency_member(p.agency_id)
    and (
      m.branded_verified is distinct from (p.verification_status = 'verified')
      or m.branded_price is distinct from (
        case when p.price is null then null
             when p.price >= 1000000
               then 'N' || trim(to_char(p.price / 1000000.0, 'FM999999990.0')) || 'm'
             else 'N' || trim(to_char(p.price, 'FM999,999,999')) end)
    );
$function$;

comment on function public.media_brand_stale() is
  'Photographs whose printed mark no longer matches the listing. Reported so '
  'the portal can offer to redraw them: silently falling back to the '
  'unbranded original would be correct and would also mean an agency''s '
  'branding vanishing for a reason nobody could see.';

revoke all on function public.media_brand_stale() from public, anon;
grant execute on function public.media_brand_stale() to authenticated, service_role;


-- ── the gallery, in one place at last ────────────────────────────────────
--
-- queue_social_post has had this subquery inlined and has been reproduced in
-- full four times this week for unrelated reasons -- an account column, a
-- campaign channel, the link position. Every reproduction is a chance to drop
-- the vault handling or the membership guard.
--
-- It moves out here, so the NEXT change to what a post carries does not
-- require reproducing a security-definer function again. This reproduction is
-- the last one it needs.
--
-- coalesce(branded_url, url): a photograph with a mark goes out with it, and
-- one without goes out plain. No branding is not an error state.
create or replace function public.listing_gallery(p_property_id uuid, p_cap integer)
returns text[]
language sql
stable
set search_path = public
as $function$
  select coalesce(array_agg(u order by ord), '{}')
  from (
    select coalesce(nullif(btrim(m.branded_url), ''), m.url) as u,
           m.display_order as ord
    from property_media m
    where m.property_id = p_property_id
      and m.deleted_at is null
      and m.url is not null
      and btrim(m.url) <> ''
      and m.url like 'https://%'
    order by m.display_order
    limit greatest(1, coalesce(p_cap, 10))
  ) g;
$function$;

comment on function public.listing_gallery(uuid, integer) is
  'A listing''s photographs in display order, preferring the branded copy '
  'where one exists. Extracted from queue_social_post so the next change to '
  'what a post carries does not mean reproducing a security-definer function '
  'in full for the fifth time.';

revoke all on function public.listing_gallery(uuid, integer) from public, anon;
grant execute on function public.listing_gallery(uuid, integer) to authenticated, service_role;


-- 20260926000000's body, with the inlined gallery replaced by the call above
-- and NOTHING else changed.
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
    v_media := public.listing_gallery(p_property_id, 10);
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
                    when 'telegram'  then 'telegram'
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
