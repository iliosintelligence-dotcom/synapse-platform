-- A campaign is the posts it contains.
--
-- Eden, having looked at the page: "what does campaign really do?"
--
-- Almost nothing, and the audit was not flattering:
--
--   campaigns            2 rows
--   campaign_assets      0 rows -- the link to posts, never once written
--   total_impressions    nothing in either repository ever updates it
--   total_reach          nor this
--   total_inquiries      nor this
--   total_viewings       nor this
--   total_closes         nor this
--   social_posts         50 rows, entirely unconnected to any of it
--
-- So the page showed five counters that no code increments, over a set of
-- posts it had no link to. Zeros dressed as measurements, which is worse than
-- an empty page: an empty page tells you there is nothing there.
--
-- Meanwhile the real measurement has existed for weeks. social_post_stats()
-- already computes human clicks, listing visits and leads per post, from the
-- short link each post carries. A campaign does not need a measurement system.
-- It needs to know which posts are in it.
--
-- ── so that is all this adds ─────────────────────────────────────────────
--
-- One column, and a rollup that sums what is already counted. No new
-- counters, no new pipeline, nothing to keep in step -- because a second
-- number that has to be maintained alongside a first is how the five columns
-- above came to be wrong.
--
-- campaign_assets is left alone and unused. It models a campaign's planned
-- creative, which is a different idea from "posts that went out under this
-- campaign", and emptying or repurposing it would be a guess about intent.
-- The new column says what is true; the old table stays empty and honest.

alter table public.social_posts
  add column if not exists campaign_id uuid
    references public.campaigns (id) on delete set null;

comment on column public.social_posts.campaign_id is
  'Which campaign this post went out under. NULL means none, which is what '
  'every post before today means. on delete set null: deleting a campaign '
  'must not delete the posts that ran under it -- they happened.';

create index if not exists social_posts_campaign
  on public.social_posts (campaign_id) where campaign_id is not null;


-- ── the stored counters are now demonstrably wrong ───────────────────────
--
-- Not dropped: the portal reads them today and a dropped column is a broken
-- page before the next deploy lands. Marked instead, so the next person to
-- read this schema does not wire something new to them.
comment on column public.campaigns.total_impressions is
  'DEAD. Nothing has ever written this. Use campaign_performance(), which '
  'sums the per-post measurement that actually exists. Kept only because the '
  'portal still selects it; do not add a writer.';
comment on column public.campaigns.total_inquiries is
  'DEAD -- see total_impressions. campaign_performance() reports real leads.';
comment on column public.campaigns.total_reach is
  'DEAD -- see total_impressions.';
comment on column public.campaigns.total_viewings is
  'DEAD -- see total_impressions.';
comment on column public.campaigns.total_closes is
  'DEAD -- see total_impressions.';


-- ── what a campaign actually did ─────────────────────────────────────────
--
-- Every number here is summed from social_post_stats(), which is the same
-- function the pipeline card uses. One source, so a campaign and the posts
-- inside it can never disagree -- which they would within a week if this
-- recomputed clicks its own way.
--
-- HUMAN CLICKS ONLY, inherited from that function rather than restated: 82 of
-- this project's first 103 clicks were preview crawlers, and reporting those
-- as audience would be the most flattering lie in the product.
create or replace function public.campaign_performance()
returns table (
  campaign_id uuid,
  posts       integer,
  published   integer,
  clicks      integer,
  visits      integer,
  leads       integer,
  last_click  timestamptz
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    c.id,
    count(sp.id)::int,
    count(sp.id) filter (where sp.status = 'published')::int,
    /* coalesce because a post with no clicks yet contributes NULL, and one
       unclicked post must not erase the campaign's total. */
    coalesce(sum(st.clicks), 0)::int,
    coalesce(sum(st.visits), 0)::int,
    coalesce(sum(st.leads), 0)::int,
    max(st.last_click)
  from campaigns c
  left join social_posts sp
    on sp.campaign_id = c.id and sp.deleted_at is null
  left join social_post_stats() st
    on st.social_post_id = sp.id
  where c.deleted_at is null
    and is_agency_member(c.agency_id)
  group by c.id;
$function$;

comment on function public.campaign_performance() is
  'What each campaign actually did, summed from social_post_stats() -- the '
  'same per-post measurement the pipeline card reads, so a campaign and its '
  'posts can never disagree. Replaces the five stored counters, which nothing '
  'ever wrote.';

revoke all on function public.campaign_performance() from public, anon;
grant execute on function public.campaign_performance() to authenticated, service_role;


-- ── putting a post in a campaign ─────────────────────────────────────────
--
-- A separate call rather than an argument on queue_social_post. That function
-- has been reproduced in full three times today -- every reproduction is a
-- chance to drop the vault handling, the membership guard or the account
-- check -- and this is one foreign key set on rows that were just created.
--
-- THE TWINS COME TOO. A Synapse twin is the same listing amplified on our own
-- channel under the same campaign, and its clicks are clicks the campaign
-- produced. Leaving them out would under-report every campaign by exactly the
-- amplification this platform gives away for free.
create or replace function public.assign_posts_to_campaign(
  p_campaign_id uuid,
  p_post_ids    uuid[]
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_agency uuid;
  v_n      integer;
begin
  select agency_id into v_agency from campaigns
   where id = p_campaign_id and deleted_at is null;
  if v_agency is null then
    raise exception 'No such campaign' using errcode = 'no_data_found';
  end if;
  if not is_agency_member(v_agency) then
    raise exception 'That campaign is not yours' using errcode = 'insufficient_privilege';
  end if;

  /* Scoped to the campaign's OWN agency, not to the ids passed in. The array
     arrives from a browser, and without this line one agency could file
     another agency's posts under its campaign and read their click figures
     through campaign_performance(). */
  update social_posts
     set campaign_id = p_campaign_id
   where deleted_at is null
     and agency_id = v_agency
     and (id = any(p_post_ids) or twin_of = any(p_post_ids));

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

comment on function public.assign_posts_to_campaign(uuid, uuid[]) is
  'Files posts, and their Synapse twins, under a campaign. Scoped to the '
  'campaign''s own agency: the id array comes from a browser, and without '
  'that scope one agency could file another''s posts and read their figures.';

revoke all on function public.assign_posts_to_campaign(uuid, uuid[]) from public, anon;
grant execute on function public.assign_posts_to_campaign(uuid, uuid[]) to authenticated, service_role;
