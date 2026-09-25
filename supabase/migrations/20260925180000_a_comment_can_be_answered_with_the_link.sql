-- A comment can be answered with the link.
--
-- Phase 3 of docs/SOCIAL_TO_PLATFORM_ROUTING.md. Instagram captions never
-- linkify, so every listing posted there ends at a dead end: the reader sees
-- the home, wants the price, and has nowhere to tap. The bio link is the only
-- standing route and it always points at the newest posts rather than the one
-- being read.
--
-- The pattern that works is the one every Nigerian agency already sees on
-- Instagram daily:
--
--     Comment PRICE and I'll send you the link.
--
-- Meta supports it properly. A PRIVATE REPLY sends one direct message to
-- somebody who commented on your post:
--
--     POST /{page-id}/messages
--     {"recipient":{"comment_id":"..."},"message":{"text":"..."}}
--
-- and that message CAN carry a tappable link. It is the only route that turns
-- an Instagram caption into a click.
--
-- ── the three hard limits, which shape everything below ─────────────────
--
--   ONE REPLY PER COMMENT, EVER. Meta permits exactly one private reply to
--   any comment. A retry that sends twice does not send twice -- it is
--   refused, and the one chance is already gone. So a comment carries its own
--   state and is claimed before it is sent to, never after.
--
--   SEVEN DAYS from the comment. Our sweep runs hourly, which is comfortably
--   inside it, but a backlog after an outage must not spend calls on comments
--   that can no longer be answered.
--
--   PAGES_MESSAGING, which we do not currently request. The permission is not
--   instagram_manage_messages as the plan first said -- that is the Instagram
--   Login flow, and our accounts arrive through Facebook Login holding a Page
--   token. Production also needs Advanced Access and the Human Agent feature,
--   which is App Review. Nothing here sends until that exists; it stays off.
--
-- ── this is messaging people who did not sign up ─────────────────────────
--
-- The compliance framing is not an afterthought and it is why several
-- decisions below look conservative.
--
--   THE CONSENT IS THE COMMENT. A reply is only ever sent to somebody who
--   typed the keyword the caption asked for. Not to everyone who comments,
--   not to likers, not to followers.
--   ONE MESSAGE. No sequence, no follow-up, no second touch. Meta's limit
--   happens to agree, but it would be the rule regardless.
--   IT SAYS IT IS AUTOMATED. The template carries it and the column comment
--   says so, because a person who believes they are talking to an agent and
--   is not has been misled -- which is FCCPA territory, not tone.
--   OFF BY DEFAULT, PER AGENCY. It sends in the agency's name, so the agency
--   turns it on. No default-on, no platform-wide switch that enrols anybody.

-- ── which Page owns this Instagram account ───────────────────────────────
--
-- A private reply is POST /{page-id}/messages -- the PAGE id, not the
-- Instagram account's. We store an Instagram account reached through Facebook
-- Login with the Page's token and have never recorded which Page that was.
--
-- That was harmless while an agency had one Page. It stopped being harmless
-- this morning, when an agency became able to hold several: picking "the
-- agency's Facebook account" to message from would be a guess, and the guess
-- would sometimes address a comment on one brand's post from another brand's
-- Page.
--
-- NULL for the standalone Instagram Login flow, which has no Page at all, and
-- for every row connected before this column existed. A worker that cannot
-- determine the Page does not guess one.
alter table public.social_accounts
  add column if not exists parent_account_id text;

comment on column public.social_accounts.parent_account_id is
  'For an Instagram account reached through Facebook Login: the platform id of '
  'the Page that owns it, which is what /{page-id}/messages needs. NULL for '
  'the standalone Instagram Login flow and for rows predating this column.';

-- ── what an agency has decided ───────────────────────────────────────────
create table if not exists public.social_reply_settings (
  agency_id   uuid primary key references public.agencies (id) on delete cascade,
  -- OFF. A feature that messages strangers in an agency's name does not get a
  -- default that turns it on for agencies who have not read this sentence.
  enabled     boolean not null default false,
  -- Matched case-insensitively on a word boundary, so "PRICE" answers
  -- "price?" and "Price please" and does not answer "priceless".
  keyword     text not null default 'PRICE',
  -- {{link}} is replaced with the listing's own short link. Deliberately the
  -- only token: a template language here would be a template language to
  -- maintain, and the one thing this message exists to carry is the link.
  message     text not null default
    'Thanks for asking! Here are the full details, photos and the area guide for this home: {{link}}',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

comment on table public.social_reply_settings is
  'Per-agency settings for answering Instagram comments with a private reply. '
  'Absent row means off. Off is also the default when present.';
comment on column public.social_reply_settings.message is
  'The single message sent. {{link}} becomes the listing''s short link. It '
  'must read as automated -- somebody who believes they reached a person and '
  'did not has been misled, which is a consumer-protection problem and not a '
  'matter of tone.';

alter table public.social_reply_settings enable row level security;

drop policy if exists social_reply_settings_read on public.social_reply_settings;
create policy social_reply_settings_read on public.social_reply_settings
  for select using (public.is_agency_member(agency_id));

-- Turning this on commits the agency to messaging strangers in its own name.
-- That is an owner/admin decision, unlike connecting an account, which is now
-- any member's: connecting adds a channel, this changes what the channel does
-- to people who never contacted us.
drop policy if exists social_reply_settings_manage on public.social_reply_settings;
create policy social_reply_settings_manage on public.social_reply_settings
  for all using (public.agency_role(agency_id) in ('agency_admin', 'agency_owner'))
  with check (public.agency_role(agency_id) in ('agency_admin', 'agency_owner'));

revoke all on public.social_reply_settings from public, anon;
grant select, insert, update on public.social_reply_settings to authenticated;
grant all on public.social_reply_settings to service_role;


-- ── what happened to each comment ────────────────────────────────────────
--
-- On the comment rather than in a side table, because Meta's one-reply-per-
-- comment rule makes the comment the natural unique key. A separate send log
-- would need its own uniqueness constraint to say the same thing, and the two
-- would eventually disagree.
alter table public.social_comments
  add column if not exists reply_state text not null default 'none'
    check (reply_state in ('none', 'claimed', 'sent', 'failed', 'skipped')),
  add column if not exists replied_at  timestamptz,
  add column if not exists reply_error text;

comment on column public.social_comments.reply_state is
  'none = not considered. claimed = a worker has taken it and is sending. '
  'sent = the one private reply Meta allows has been used. failed = it was '
  'attempted and refused. skipped = deliberately not answered (no keyword, '
  'too old, no link). Claimed BEFORE sending, never after: Meta permits one '
  'reply per comment ever, so a crash mid-send must not look retryable.';

create index if not exists social_comments_reply_due
  on public.social_comments (commented_at)
  where deleted_at is null and reply_state = 'none';


-- ── which comments are due, claimed atomically ───────────────────────────
--
-- The claim and the decision are one statement. Two workers, a retry after a
-- timeout, or a hand-run overlapping the cron would otherwise each read the
-- same comment as unanswered -- and the second send is not a duplicate
-- message, it is a refusal that burns the only reply that comment will ever
-- get.
create or replace function public.claim_comment_replies(p_limit integer default 10)
returns setof public.social_comments
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update social_comments c
     set reply_state = 'claimed'
   where c.id in (
     select sc.id
     from social_comments sc
     join social_reply_settings rs on rs.agency_id = sc.agency_id
     where sc.deleted_at is null
       and sc.reply_state = 'none'
       and rs.enabled
       and sc.platform = 'instagram'
       -- Seven days is Meta's window. Older comments are not failures and
       -- must not be retried forever; the sweep below marks them skipped.
       and sc.commented_at > now() - interval '7 days'
       -- The consent. Word boundaries, so PRICE answers "price?" and
       -- "Price please" and never "priceless".
       and sc.body ~* ('\y' || regexp_replace(rs.keyword, '([^a-zA-Z0-9])', '\\\1', 'g') || '\y')
     order by sc.commented_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked
   )
  returning c.*;
$function$;

comment on function public.claim_comment_replies(integer) is
  'Claims Instagram comments matching an enabled agency''s keyword, inside '
  'Meta''s seven-day window. Claim and selection are one statement: a second '
  'worker reading the same comment does not send a duplicate, it burns the '
  'single private reply Meta allows.';

revoke all on function public.claim_comment_replies(integer) from public, anon, authenticated;
grant execute on function public.claim_comment_replies(integer) to service_role;


-- Comments too old to answer, retired so the index does not carry them for
-- ever. Separate from the claim because it is not a failure and should not
-- read as one in any report.
create or replace function public.retire_unanswerable_comments()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer;
begin
  update social_comments
     set reply_state = 'skipped',
         reply_error = 'older than Meta''s seven-day private reply window'
   where deleted_at is null
     and reply_state = 'none'
     and commented_at is not null
     and commented_at <= now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.retire_unanswerable_comments() from public, anon, authenticated;


-- ── the drain ────────────────────────────────────────────────────────────
create or replace function public.drain_comment_replies()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $function$
declare
  v_key text; v_url text; v_due integer;
begin
  perform public.retire_unanswerable_comments();

  /* Counted before a request is spent, the same shape as drain_social_queue
     and refresh_social_metrics: an idle platform should cost nothing. */
  select count(*) into v_due
  from social_comments sc
  join social_reply_settings rs on rs.agency_id = sc.agency_id
  where sc.deleted_at is null
    and sc.reply_state = 'none'
    and rs.enabled
    and sc.platform = 'instagram'
    and sc.commented_at > now() - interval '7 days';

  if v_due = 0 then return 0; end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if v_key is null or v_url is null then
    raise warning 'drain_comment_replies: service_role_key or project_url missing from vault';
    return 0;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/social-reply',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('limit', 10),
    timeout_milliseconds := 120000
  );
  return v_due;
end;
$function$;

comment on function public.drain_comment_replies() is
  'Asks social-reply to answer matching Instagram comments. Counts due work '
  'before spending a request. Scheduled; safe to call by hand.';

revoke all on function public.drain_comment_replies() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('drain-comment-replies');
exception when others then null;
end $$;

-- Every five minutes. Faster than the metrics sweep because somebody who just
-- commented is still holding the phone, and slower than the post queue
-- because the comments themselves only arrive hourly -- there is nothing to
-- find in between. It turns itself off: with no agency enabled, the count is
-- zero and no request is made.
select cron.schedule(
  'drain-comment-replies',
  '*/5 * * * *',
  $$select public.drain_comment_replies()$$
);
