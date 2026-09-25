-- A comment comes back to the agency.
--
-- Reported by Eden, looking at the architecture diagram: "there should be a
-- connection back from social networks to the pipeline boards or the agency
-- side." Correct. Publishing was a one-way street with one narrow return lane.
--
-- WHAT ALREADY CAME BACK, so this is an extension and not a first attempt:
--
--   clicks     our own /s/<token> redirect counts every tap, with nothing
--              connected and no Graph token at all
--   leads      a click carries its channel into attribution, so a post can be
--              measured to the enquiry it produced
--   counts     likes / comments / shares, swept hourly onto the post row and
--              rendered on the pipeline card
--
-- WHAT DID NOT. The text. "You have 3 comments" is the end of the line: an
-- agency could see that somebody had asked something in public and had no way
-- to find out what, short of opening Instagram. The count is a notification;
-- the comment is the lead. 20260918190000 said so plainly and named the
-- reason it could not be built -- "those need the Meta Graph API against a
-- connected account, and no agency account is connected yet."
--
-- That reason expired this week. The permissions are granted and the first
-- account is about to be connected, so the table it was waiting for goes in
-- ahead of it.
--
-- ── this is other people's personal data, and it is the first table of it ──
--
-- Everything else we hold belongs to somebody who came to Synapse. A
-- commenter did not. They wrote on an agency's Instagram post and have never
-- heard of us, which makes minimisation and retention the whole design rather
-- than a footnote:
--
--   · the HANDLE and the TEXT, and nothing else. No profile id, no avatar, no
--     follower count, no link to any other comment by the same person. The
--     handle is kept because a reply is addressed to it -- without it the
--     comment is unanswerable and the feature has no point.
--   · NINETY DAYS, purged by a job that ships in this same migration. The
--     platform holds the original; our copy exists to get an agent to answer
--     it, and a question nobody answered in three months is not going to be.
--   · no aggregation. Nothing here builds a picture of a person across posts
--     or agencies, and the absence of a stable author key is what keeps that
--     true by construction rather than by policy.
--
-- The compliance review (R-06, scored 15) found that no table in either
-- repository has a purge job and every one of them grows forever. That is
-- still true of the others and is still open. It is not going to become true
-- of a table of third-party personal data on the day it is created.

create table if not exists public.social_comments (
  id                  uuid primary key default gen_random_uuid(),
  social_post_id      uuid not null references public.social_posts (id) on delete cascade,
  -- Denormalised from the post, and safe to denormalise: a post's agency and
  -- listing are fixed at publication and cannot move afterwards. It is what
  -- every read filters on, and RLS should not have to join to decide.
  agency_id           uuid not null references public.agencies (id) on delete cascade,
  property_id         uuid references public.properties (id) on delete set null,
  platform            social_platform not null,
  platform_comment_id text not null,
  -- Nullable, deliberately. Facebook withholds the author on a comment from
  -- somebody who has not granted the Page anything, and a blank name is a
  -- truthful answer where 'Unknown' would be our invention.
  author_handle       text,
  body                text,
  commented_at        timestamptz,
  fetched_at          timestamptz not null default now(),
  -- An agent marking a comment dealt with. The point of the table: a comment
  -- nobody has answered should look different from one somebody has.
  handled_at          timestamptz,
  handled_by          uuid references public.profiles (id) on delete set null,
  deleted_at          timestamptz,
  -- The sweep re-reads the same comments every time the count moves, so the
  -- platform's own id is what makes re-reading free instead of duplicating.
  unique (platform, platform_comment_id)
);

comment on table public.social_comments is
  'Comments on our published posts, read back from the platform. Third-party '
  'personal data: handle and text only, ninety days, purged by '
  'purge_social_comments(). Not to be joined across posts or agencies into a '
  'picture of a person.';
comment on column public.social_comments.author_handle is
  'The public handle, kept only so a reply can be addressed. NULL where the '
  'platform withholds it, which is a real answer and not a missing value.';
comment on column public.social_comments.handled_at is
  'When an agent marked this dealt with. NULL means it is still waiting, '
  'which is what the pipeline card counts.';

create index if not exists social_comments_post
  on public.social_comments (social_post_id) where deleted_at is null;
-- The card's question is "what is still waiting for this agency", so that is
-- the index: unhandled, newest first.
create index if not exists social_comments_waiting
  on public.social_comments (agency_id, commented_at desc)
  where deleted_at is null and handled_at is null;
create index if not exists social_comments_age
  on public.social_comments (commented_at);

alter table public.social_comments enable row level security;

-- READ ONLY for an agency member. Nothing in the portal may write a comment's
-- text or author: those are the platform's words about a person who is not
-- our user, and an agency editing them would make our copy a forgery. The one
-- thing an agent can change goes through the function below.
--
-- Dropped first because CREATE POLICY has no IF NOT EXISTS, and this migration
-- sits behind CREATE TABLE IF NOT EXISTS -- so a re-run reaches a table that
-- already exists and would fail on the policy instead.
drop policy if exists social_comments_read on public.social_comments;
create policy social_comments_read on public.social_comments
  for select using (public.is_agency_member(agency_id));

-- FROM PUBLIC, not only from anon. Supabase's default privileges grant the
-- API roles on every new table in this schema, and revoking from `anon` alone
-- leaves a grant to PUBLIC that anon still inherits -- which is the exact
-- mistake that left the erasure function callable by anonymous visitors and
-- needed its own migration to undo.
revoke all on public.social_comments from public, anon, authenticated;
grant select on public.social_comments to authenticated;
grant all on public.social_comments to service_role;

-- ── the one field an agent may move ──────────────────────────────────────
create or replace function public.mark_comment_handled(
  p_comment_id uuid,
  p_handled    boolean default true
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid;
begin
  select agency_id into v_agency from social_comments
   where id = p_comment_id and deleted_at is null;
  if v_agency is null then
    raise exception 'No such comment' using errcode = 'no_data_found';
  end if;

  -- Membership, not owner/admin. Answering a comment is the job of whoever is
  -- working the board, and a permission narrower than the work is a permission
  -- somebody routes around.
  if not is_agency_member(v_agency) then
    raise exception 'That comment is not yours'
      using errcode = 'insufficient_privilege';
  end if;

  update social_comments
     set handled_at = case when p_handled then now() else null end,
         handled_by = case when p_handled then auth.uid() else null end
   where id = p_comment_id;
end;
$$;

revoke all on function public.mark_comment_handled(uuid, boolean) from public, anon;
grant execute on function public.mark_comment_handled(uuid, boolean) to authenticated, service_role;

-- ── ninety days, and then gone ───────────────────────────────────────────
--
-- A HARD delete, not a soft one. Soft deletion is for our own records, where
-- the row is evidence of something that happened between us and a user.
-- This is somebody else's sentence, copied from a platform that still has it,
-- and "deleted" that means "hidden behind a flag" is the thing the retention
-- finding was about.
--
-- commented_at is what ages, not fetched_at: re-reading an old comment must
-- not extend its life, and fetched_at moves every time the count changes.
create or replace function public.purge_social_comments()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_gone integer;
begin
  delete from social_comments
   where coalesce(commented_at, fetched_at) < now() - interval '90 days';
  get diagnostics v_gone = row_count;
  if v_gone > 0 then
    raise notice 'purge_social_comments: removed % comments past ninety days', v_gone;
  end if;
  return v_gone;
end;
$$;

comment on function public.purge_social_comments() is
  'Retention for social_comments: ninety days from the comment, hard deleted. '
  'Ships with the table rather than after it, because this is third-party '
  'personal data.';

revoke all on function public.purge_social_comments() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('purge-social-comments');
exception when others then
  null;   -- not scheduled yet
end $$;

-- Daily, at a quiet hour. A retention window of ninety days does not need to
-- be enforced to the minute, and a delete that scans for age is the kind of
-- job to keep away from the times an agency is working the board.
select cron.schedule(
  'purge-social-comments',
  '20 3 * * *',
  $$select public.purge_social_comments()$$
);
