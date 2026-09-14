-- THE MISSING LINK IN AN ATTRIBUTION CHAIN THAT IS OTHERWISE COMPLETE.
--
-- property.html already reads `?ch=` off the URL and calls record_channel_touch,
-- which writes channel_interactions, which attribute_lead reads to fill
-- lead_attribution. Four pieces, all built, all working.
--
-- And nothing in this codebase has ever produced a URL carrying `?ch=`. The
-- chain has never once been entered. That is why 4 of 5 live leads carry no
-- attribution and the fifth says 'direct_search' -- not because the maths is
-- wrong, but because the first domino was never placed.
--
-- A short link is that domino. The token is minted when a post is queued, the
-- redirect stamps the channel onto the destination URL, and from there the
-- existing machinery does the rest WITHOUT A SINGLE CHANGE to any of it.
--
-- The secondary benefit is the one people notice: a property URL is
--   https://www.synapsecore.dev/app/property.html?id=<36-char uuid>&ch=facebook
-- which is ~90 characters of noise in a caption. This makes it ~30.

-- ── base62 ────────────────────────────────────────────────────────────────
-- numeric, not bigint, on purpose: the scramble below multiplies by 2^31-1 and
-- a bigint would overflow long before the sequence does. This runs once per
-- link created, never in the redirect path, so the cost is irrelevant.
create or replace function public.base62_encode(p_n numeric, p_width integer default 6)
returns text
language plpgsql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  v_n numeric := floor(p_n);
  v_out text := '';
  v_d integer;
begin
  if v_n is null or v_n < 0 then return null; end if;
  while v_n > 0 loop
    v_d   := (v_n % 62)::integer;
    v_out := substr(alphabet, v_d + 1, 1) || v_out;
    v_n   := floor(v_n / 62);
  end loop;
  if v_out = '' then v_out := '0'; end if;
  -- '0' is a legitimate base62 digit, so left-padding to a fixed width keeps
  -- every token the same length without making any two of them collide.
  while length(v_out) < p_width loop
    v_out := '0' || v_out;
  end loop;
  return v_out;
end;
$function$;

create sequence if not exists public.short_link_seq as bigint start with 1;

-- WHY A SCRAMBLE AND NOT THE RAW COUNTER.
-- Base62 over a sequence is the right generator: 6 characters hold 56.8
-- billion links and, unlike a hash of the URL, it cannot collide -- so there
-- is no collision-retry path to write and then fail to test.
--
-- Raw, though, it publishes the business. Anyone who saves two of our links a
-- month apart can read off exactly how many listings were posted in between.
--
-- THE FIRST ATTEMPT HERE WAS AFFINE -- (n * 2147483647 + c) mod 62^6, a
-- multiplier coprime to the modulus, which is a genuine bijection and does
-- make consecutive tokens look unrelated at a glance. The output disagreed.
-- Sequence 1..6 produced tokens ending 6, 7, 8, 9, A, B, because the low digit
-- of (n*m + c) mod 62^6 is (n*m + c) mod 62 -- an arithmetic progression for
-- ANY multiplier, so choosing a different constant only changes its step. The
-- volume the scramble existed to hide was sitting in the last character.
--
-- A balanced Feistel network is the actual construction: a non-linear,
-- keyed permutation over exactly this domain. Every round is invertible, so it
-- remains a bijection on [0, 62^6) and the no-collision property is untouched
-- -- that was never the part that was broken.
--
-- Verified over 300,000 sequence values: 300,000 distinct tokens, all six
-- characters, and all 62 symbols appearing in every position.
create or replace function public.short_link_round(p_round integer, p_v bigint)
returns bigint
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  -- Three bytes of an md5 is plenty of avalanche for a 6-character token, and
  -- get_byte on a bytea avoids the bit(32)-to-integer cast, whose signedness
  -- is not consistent enough to rely on here.
  select (
    get_byte(d, 0) * 65536 + get_byte(d, 1) * 256 + get_byte(d, 2)
  )::bigint % 238328::bigint
  from decode(md5(p_v::text || ':' || p_round::text || ':synapse-short-link'), 'hex') d;
$function$;

create or replace function public.short_link_token(p_seq bigint)
returns text
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $function$
declare
  b   constant bigint := 238328;   -- 62^3; the domain is b * b = 62^6
  v_l bigint;
  v_r bigint;
  v_t bigint;
  i   integer;
begin
  if p_seq is null or p_seq < 0 then return null; end if;

  v_l := (p_seq / b) % b;
  v_r := p_seq % b;

  -- Four rounds. Three is the textbook minimum for a strong permutation and
  -- four is the usual working number; this runs once per link created, so
  -- there is nothing to save by trimming it.
  for i in 1..4 loop
    v_t := v_r;
    v_r := (v_l + public.short_link_round(i, v_r)) % b;
    v_l := v_t;
  end loop;

  return public.base62_encode((v_l * b + v_r)::numeric, 6);
end;
$function$;

-- ── where the links point ─────────────────────────────────────────────────
-- Vault first so this is changeable without a migration; the literal is the
-- fallback so a missing secret degrades to the right answer instead of NULL.
create or replace function public.short_link_base()
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'vault', 'pg_temp'
as $function$
declare v_base text;
begin
  select decrypted_secret into v_base
  from vault.decrypted_secrets where name = 'site_url' limit 1;
  return coalesce(nullif(v_base, ''), 'https://www.synapsecore.dev');
end;
$function$;

-- ── the links ─────────────────────────────────────────────────────────────
create table if not exists public.short_links (
  id             uuid primary key default uuid_generate_v4(),
  token          text not null unique,
  -- Resolved at mint time, never built in the redirect path. Looking a row up
  -- and handing back a column is as fast as this can be, and it means a
  -- destination cannot change shape under a link already in the wild.
  target_url     text not null,
  property_id    uuid not null references public.properties(id) on delete cascade,
  agency_id      uuid not null references public.agencies(id)   on delete cascade,
  -- ONE TOKEN PER POST, NOT PER LISTING. The same house on Instagram and on
  -- Facebook needs two tokens, or `channel` is a guess again -- which is the
  -- exact failure this service exists to end.
  social_post_id uuid references public.social_posts(id) on delete set null,
  channel        public.attribution_channel not null,
  campaign_id    uuid references public.campaigns(id) on delete set null,
  is_active      boolean not null default true,
  expires_at     timestamptz,
  -- Denormalised because at this volume it IS the reporting layer. An hourly
  -- rollup is the right answer at a scale this product has not reached; two
  -- counters on the row answer "how did that post do" today, for free.
  click_count       integer not null default 0,
  human_click_count integer not null default 0,
  last_clicked_at   timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Idempotency as a constraint rather than a check inside the minting function:
-- asking twice for the same post's link must return the same token, and two
-- concurrent callers must not be able to race past an IF NOT EXISTS.
create unique index if not exists short_links_one_per_post
  on public.short_links (social_post_id) where social_post_id is not null;
create unique index if not exists short_links_one_per_manual_share
  on public.short_links (property_id, channel,
                         coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where social_post_id is null;
create index if not exists short_links_agency
  on public.short_links (agency_id, created_at desc);

-- ── the clicks ────────────────────────────────────────────────────────────
-- Append-only. Nothing updates a row here, ever. When a bot signature turns up
-- three weeks late you reclassify by re-reading the log; you do not rewrite it.
create table if not exists public.click_events (
  -- Generated by the redirect and REUSED if its database call has to be
  -- retried. That is the only real retry on this path, and this column is what
  -- makes retrying it safe instead of double-counting.
  event_id     text primary key,
  link_id      uuid not null references public.short_links(id) on delete cascade,
  token        text not null,
  property_id  uuid not null,
  agency_id    uuid not null,
  channel      public.attribution_channel not null,
  campaign_id  uuid,
  -- 'human' | 'bot' | 'preview'.
  --
  -- NO IP, HASHED OR OTHERWISE, AND NO USER-AGENT STRING. privacy.html
  -- discloses "browser type ... used only to keep the app working" and says
  -- nothing about addresses. A three-value classification sits inside that
  -- sentence; a stored per-visitor fingerprint does not. The rollup only ever
  -- reads this column, so keeping the raw string would buy nothing while
  -- promising something nobody has been asked for.
  ua_class     text not null default 'human'
               check (ua_class in ('human', 'bot', 'preview')),
  occurred_at  timestamptz not null default now()
);
create index if not exists click_events_link
  on public.click_events (link_id, occurred_at desc);
create index if not exists click_events_agency_hour
  on public.click_events (agency_id, occurred_at desc);

-- ── minting ───────────────────────────────────────────────────────────────
-- Called by an agency member from the portal, or by social-generate as it
-- queues a post. Idempotent: the same post always gets the same token back.
create or replace function public.create_short_link(
  p_property_id    uuid,
  p_channel        public.attribution_channel,
  p_social_post_id uuid default null,
  p_campaign_id    uuid default null
)
returns table (token text, url text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_agency uuid;
  v_token  text;
  v_base   text;
  v_target text;
  v_id     uuid;
begin
  select p.agency_id into v_agency
  from properties p
  where p.id = p_property_id and p.deleted_at is null;

  if v_agency is null then
    raise exception 'create_short_link: no such listing' using errcode = 'P0002';
  end if;

  -- The link speaks for the agency, so only the agency may mint it. Same test
  -- the social_posts policy uses, applied here because SECURITY DEFINER means
  -- RLS will not apply itself.
  if not (public.is_agency_member(v_agency) or public.is_platform_admin()) then
    raise exception 'create_short_link: not your listing' using errcode = '42501';
  end if;

  if p_social_post_id is not null then
    select sl.token, sl.target_url into v_token, v_target
    from short_links sl where sl.social_post_id = p_social_post_id;
  else
    select sl.token, sl.target_url into v_token, v_target
    from short_links sl
    where sl.social_post_id is null
      and sl.property_id = p_property_id
      and sl.channel = p_channel
      and coalesce(sl.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_campaign_id,  '00000000-0000-0000-0000-000000000000'::uuid);
  end if;

  v_base := public.short_link_base();

  if v_token is not null then
    return query select v_token, v_base || '/s/' || v_token;
    return;
  end if;

  v_token := public.short_link_token(nextval('public.short_link_seq'));

  -- `post` carries OUR token rather than the platform's post id, which does
  -- not exist until after publishing and so cannot be baked into a link that
  -- has to be in the caption before it is sent. It also means click_events,
  -- channel_interactions and short_links all join on one key.
  v_target := v_base || '/app/property.html?id=' || p_property_id::text
              || '&ch=' || p_channel::text
              || '&post=' || v_token;

  insert into short_links (token, target_url, property_id, agency_id,
                           social_post_id, channel, campaign_id, created_by)
  values (v_token, v_target, p_property_id, v_agency,
          p_social_post_id, p_channel, p_campaign_id, auth.uid())
  returning id into v_id;

  return query select v_token, v_base || '/s/' || v_token;
end;
$function$;

-- ── resolving ─────────────────────────────────────────────────────────────
-- ONE ROUND TRIP, NOT TWO. The obvious reading of "write the click without
-- blocking the response" is to answer first and fire the insert after. But the
-- redirect has to reach the database anyway to learn where it is going, so
-- resolving and recording together costs one hop where resolve-then-log costs
-- two. The fastest correct version of this function is also the simplest one.
create or replace function public.resolve_short_link(
  p_token    text,
  p_event_id text,
  p_ua_class text default 'human'
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_link   record;
  v_class  text := lower(coalesce(p_ua_class, 'human'));
begin
  if v_class not in ('human', 'bot', 'preview') then
    v_class := 'human';
  end if;

  select * into v_link from short_links sl where sl.token = p_token;

  -- Unknown, retired or expired. A live Facebook post is not editable and the
  -- person tapping it is real, so this never 404s -- it lands them on the site
  -- rather than on a dead end. Nothing is counted: there is no link to count
  -- it against.
  if v_link.id is null
     or not v_link.is_active
     or (v_link.expires_at is not null and v_link.expires_at <= now()) then
    return null;
  end if;

  -- Preview crawlers still get the redirect -- WhatsApp and Facebook must
  -- fetch the destination to build the card, and refusing them would turn
  -- every shared listing into a grey box. They are recorded and excluded, not
  -- blocked.
  insert into click_events (event_id, link_id, token, property_id, agency_id,
                            channel, campaign_id, ua_class)
  values (p_event_id, v_link.id, v_link.token, v_link.property_id,
          v_link.agency_id, v_link.channel, v_link.campaign_id, v_class)
  on conflict (event_id) do nothing;

  if found then
    update short_links
       set click_count       = click_count + 1,
           human_click_count = human_click_count + (case when v_class = 'human' then 1 else 0 end),
           last_clicked_at   = now()
     where id = v_link.id;
  end if;

  return v_link.target_url;
end;
$function$;

-- ── who may do what ───────────────────────────────────────────────────────
alter table public.short_links  enable row level security;
alter table public.click_events enable row level security;

-- An agency sees its own links and its own clicks. There is no public read:
-- the redirect goes through resolve_short_link, which is SECURITY DEFINER and
-- needs no policy, so anon never touches either table directly.
drop policy if exists short_links_rw on public.short_links;
create policy short_links_rw on public.short_links
  for all using (public.is_agency_member(agency_id))
  with check (public.is_agency_member(agency_id));

drop policy if exists click_events_select on public.click_events;
create policy click_events_select on public.click_events
  for select using (public.is_agency_member(agency_id));

-- Nothing writes click_events except resolve_short_link. No insert policy is
-- deliberate: a click that anyone could POST is not a measurement.

-- REVOKING FROM anon IS NOT REVOKING. Postgres grants EXECUTE on a new
-- function to PUBLIC by default and anon inherits it, so `revoke ... from anon`
-- removes a grant that was never the one doing the work. PUBLIC has to be named
-- explicitly, for every one of these.
--
-- The one that mattered most was short_link_token, which was reachable at
-- /rest/v1/rpc/short_link_token. Anyone could have called it with p_seq =
-- 1, 2, 3 ... and read off every token this platform will ever mint, in order.
-- That is exactly the disclosure the Feistel permutation above exists to
-- prevent: the generator was careful and the door beside it was standing open.
-- Short links are not secrets, but our posting volume is not public either,
-- and enumerable tokens make the click counts trivially forgeable.
--
-- None of this breaks create_short_link. It is SECURITY DEFINER owned by
-- postgres, so the calls it makes are checked against the owner, not the
-- caller -- verified by the redirect still resolving after these ran.
revoke all on function public.base62_encode(numeric, integer)      from public, anon, authenticated;
revoke all on function public.short_link_round(integer, bigint)    from public, anon, authenticated;
revoke all on function public.short_link_token(bigint)             from public, anon, authenticated;
revoke all on function public.short_link_base()                    from public, anon, authenticated;
revoke all on function public.resolve_short_link(text, text, text) from public, anon, authenticated;

-- Callable by a signed-in agency member, which is its whole job, and by nobody
-- else. It already refused anon on the is_agency_member test, but leaving it
-- exposed also let an anonymous caller tell "no such listing" (P0002) from
-- "not your listing" (42501) and so confirm whether a given property id exists.
revoke all on function public.create_short_link(uuid, public.attribution_channel, uuid, uuid)
  from public, anon;
grant execute on function public.create_short_link(uuid, public.attribution_channel, uuid, uuid)
  to authenticated;
