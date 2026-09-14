-- Every listing goes out twice: once as the agency, once as Synapse.
--
-- The agency posts to its own accounts and builds its own audience. Synapse
-- pushes the same listing to Synapse's channels as free amplification. Two
-- audiences from one action, and the agency gets reach it did not pay for.
--
-- THE ROUTING KEY IS WHOSE ACCOUNT, NOT WHICH PLATFORM. social-publish
-- currently decides by platform -- Instagram and Facebook go to the native
-- adapters, everything else to trypost. That is right for an agency and wrong
-- for us: SYNAPSE'S OWN INSTAGRAM LIVES IN THE TRYPOST WORKSPACE, not in
-- social_accounts, so a Synapse-leg Instagram post has to go through trypost
-- too. A post now says which leg it is, and the adapter follows that.

-- ── which leg ─────────────────────────────────────────────────────────────
-- Text with a check rather than a new enum: two values unlikely to grow, and
-- an enum would need its own migration to ever add a third.
alter table public.social_posts
  add column if not exists leg text not null default 'agency'
    check (leg in ('agency', 'synapse'));

comment on column public.social_posts.leg is
  'agency = published to the agency''s own connected account. synapse = published to a Synapse-owned channel as free amplification. Decides which adapter social-publish uses: whose account, not which platform.';

-- The twin's own column. content_id was the tempting place to put this and is
-- the wrong one -- it carries a foreign key to generated_content, so a
-- social_posts id would simply be rejected by it.
alter table public.social_posts
  add column if not exists twin_of uuid references public.social_posts(id) on delete cascade;

comment on column public.social_posts.twin_of is
  'For a synapse-leg post: the agency post it was amplified from. Null on an agency post.';

-- ONE TWIN PER SOURCE POST PER PLATFORM, enforced rather than checked. A drain
-- that retries the agency's post, or an operator who presses publish twice,
-- must not put the same listing out on Synapse's TikTok a second time -- and a
-- guard inside the function could be raced by two concurrent callers.
create unique index if not exists social_posts_one_twin_per_platform
  on public.social_posts (twin_of, platform)
  where twin_of is not null and deleted_at is null;

-- ── Synapse's own channels ────────────────────────────────────────────────
-- social_accounts cannot hold these: it is agency-scoped, agency_id is NOT
-- NULL, and a Synapse channel belongs to no agency. It is also a different
-- kind of thing -- there is no OAuth token here at all, because trypost holds
-- every one of these grants. This table only says "we have a TikTok, and this
-- is its id inside the trypost workspace".
create table if not exists public.synapse_channels (
  id                  uuid primary key default uuid_generate_v4(),
  platform            public.social_platform not null unique,
  trypost_account_id  text not null,
  handle              text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.synapse_channels is
  'Synapse''s own social accounts as they exist inside the trypost workspace. No OAuth token is stored: trypost holds the grant. One row per platform.';

-- Nobody reads this from a browser. There is no secret in it -- a trypost
-- account id is not a credential -- but an agency portal has no reason to read
-- Synapse's channel list, and RLS on with no policy is the clearest way to say
-- service role only. social-publish reads it with the service role.
alter table public.synapse_channels enable row level security;

-- ── the twin ──────────────────────────────────────────────────────────────
-- Queued automatically beside the agency's post, with no operator action.
-- Nobody asks for amplification: it is what the platform does.
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
  v_n       integer := 0;
begin
  for v_channel in
    select platform from synapse_channels where is_active order by platform
  loop
    /* A DIFFERENT CAPTION, DELIBERATELY. The same photographs and the same
       words, posted within the hour by two accounts on one platform, is what
       Instagram and TikTok both dampen as duplicate content -- so an identical
       twin would cost the agency reach rather than adding any. It also reads
       oddly to anyone following both accounts.

       This is the cheap version, and it is honest about what it is: Synapse
       speaking as a third party about somebody else's listing, which is a
       genuinely different voice. The better version is a separate generation
       from social-generate, which already produces several variants per
       campaign; when the composer starts passing one in, it goes here instead
       of this. */
    v_caption := 'Spotted on Synapse' || E'\n\n' || btrim(coalesce(p_caption, ''));

    /* The unique index is the real guard against a double twin; this catches
       it without turning a retry of the agency's post into an error. */
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

    /* ITS OWN SHORT LINK, which is the entire reason the twin is a separate
       row rather than a second destination on one row. A lead arriving from
       Synapse's Instagram and one from the agency's Instagram are different
       facts about which channel works, and a shared token could not tell them
       apart. create_short_link keys on social_post_id, so this costs nothing. */
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

    update social_posts
       set caption = v_caption || E'\n\n' || v_url
     where id = v_id;

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;

revoke all on function public.queue_synapse_twins(uuid, uuid, text, text[], timestamptz, boolean, uuid)
  from public, anon, authenticated;

comment on function public.queue_synapse_twins(uuid, uuid, text, text[], timestamptz, boolean, uuid) is
  'Queues one Synapse-leg post per active synapse_channels row, each with its own short link so the two legs stay separately attributable. Idempotent per (source post, platform) via social_posts_one_twin_per_platform.';
