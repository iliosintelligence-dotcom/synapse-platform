-- 0052_social_publish_queue.sql
--
-- A durable publish queue for social syndication.
--
-- syndication.js already generates, validates and queues variants, and already
-- has a dry/live split. What it lacked was anywhere for that queue to live: it
-- existed only in the browser, so closing the tab lost it, and there was no
-- record of what was sent or what came back.
--
-- Modelled on message_outbox, which is proven in this codebase: the row is
-- written first and delivery happens separately, so a provider outage costs the
-- attempt and never the intent.
--
-- THE IMPORTANT COLUMN IS `dry_run`, AND IT DEFAULTS TO TRUE.
-- Meta approval is pending, so every post for the foreseeable future is a
-- rehearsal recorded by a mock adapter. A rehearsal sitting in the same table
-- as a real post with no way to tell them apart is precisely the fabrication
-- pattern this codebase has spent the week removing -- someone would later
-- count these as published posts. A post is a rehearsal unless something
-- explicitly says otherwise, so the safe value is also the default.

alter table public.social_posts
  add column if not exists caption      text,
  add column if not exists media_urls   text[] not null default '{}',
  add column if not exists attempts     integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists dry_run      boolean not null default true,
  add column if not exists provider     text,
  add column if not exists payload      jsonb,
  add column if not exists created_by   uuid references public.profiles(id);

-- content_id was NOT NULL, which forced every post to originate from a
-- generated_content row. That coupling made sense when the caption lived only
-- in that table; it does not now that the post carries its own caption, and it
-- made a hand-written or hand-edited post impossible to queue.
alter table public.social_posts
  alter column content_id drop not null;

comment on column public.social_posts.dry_run is
  'TRUE means no external network call was made -- the mock adapter recorded what WOULD have been sent. Never count a dry_run row as a published post.';
comment on column public.social_posts.payload is
  'Exactly what was, or would have been, sent to the provider. The rehearsal record, and the audit trail for a real send.';
comment on column public.social_posts.provider is
  'Which adapter handled it: "mock" until a real integration is connected.';
comment on column public.social_posts.content_id is
  'The generation run this caption came from, when it came from one. NULL for a hand-written post.';

create index if not exists social_posts_due_idx
  on public.social_posts (status, scheduled_at)
  where deleted_at is null and status in ('scheduled', 'publishing');

-- ── the only way in ─────────────────────────────────────────────────────────
-- The agency is derived from membership rather than taken from the caller, so
-- nobody can queue a post onto someone else's account.
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
as $$
declare
  v_agency uuid;
  v_role   text;
  v_id     uuid;
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

  insert into social_posts (
    property_id, agency_id, platform, caption, media_urls,
    status, scheduled_at, dry_run, created_by
  ) values (
    p_property_id, v_agency, p_platform, btrim(p_caption), coalesce(p_media_urls, '{}'),
    'scheduled', coalesce(p_scheduled_at, now()), coalesce(p_dry_run, true), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean) from public, anon;
grant execute on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean) to authenticated;

-- ── claiming work ───────────────────────────────────────────────────────────
-- Atomic, and scoped to one agency. Two concurrent drains must never pick up
-- the same row: a double post is public and cannot be taken back.
create or replace function public.claim_social_batch(p_agency_id uuid, p_limit integer default 10)
returns setof public.social_posts
language sql
security definer
set search_path to 'public'
as $$
  update social_posts o
     set status   = 'publishing',
         attempts = o.attempts + 1
   where o.id in (
     select id from social_posts
      where agency_id = p_agency_id
        and deleted_at is null
        and attempts < max_attempts
        and (
          (status = 'scheduled' and scheduled_at <= now())
          -- a drain that died mid-flight: reclaim rather than strand the row
          or (status = 'publishing' and updated_at < now() - interval '5 minutes')
        )
      order by scheduled_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 10), 50))
     )
  returning o.*;
$$;

revoke all on function public.claim_social_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_social_batch(uuid, integer) to service_role;

-- ── clients may cancel, and nothing else ────────────────────────────────────
-- SECURITY INVOKER on purpose: inside a definer function current_user is the
-- owner, never the caller, so a definer guard testing current_user never fires
-- for anybody. That exact bug was shipped and fixed earlier in this codebase.
create or replace function public.social_posts_guard()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if not (old.status in ('draft', 'scheduled') and new.status = 'draft') then
      raise exception 'Only the publisher may change a post''s status'
        using errcode = 'insufficient_privilege';
    end if;
    if new.dry_run is distinct from old.dry_run then
      raise exception 'dry_run cannot be changed after queueing'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists social_posts_guard_trg on public.social_posts;
create trigger social_posts_guard_trg
  before update on public.social_posts
  for each row execute function public.social_posts_guard();

drop trigger if exists social_posts_updated_at on public.social_posts;
create trigger social_posts_updated_at
  before update on public.social_posts
  for each row execute function public.set_updated_at();

-- Verified end to end through the live function (2026-08-13):
--   outsider queues a post              -> blocked
--   empty caption                       -> rejected
--   agency queues                       -> ok, dry_run defaults to true
--   client sets status = published      -> blocked
--   client flips dry_run                -> blocked
--   two concurrent claims               -> 1 then 1, no overlap
--   third claim                         -> 0
--   drain with live:true on dry rows    -> still rehearsed via the mock
--   drain with live:true on a live row  -> "Instagram is not connected yet",
--                                          returned to scheduled for retry
