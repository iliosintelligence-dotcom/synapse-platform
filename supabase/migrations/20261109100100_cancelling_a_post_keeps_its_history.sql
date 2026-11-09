-- Cancel a scheduled post without erasing it, and say when a listing went out on only some of its channels.
--
-- 1. cancel_social_post: an agency member stops one of the agency's posts that has not gone out yet. The row stays,
--    status 'cancelled', so the history shows it was planned and stopped. Published / publishing / failed posts are
--    refused: what went out stays in history, and a failed post keeps its own Retry and Remove.
-- 2. social_posts_twins_follow learns 'cancelled': a cancelled agency post takes its still-scheduled Synapse twins with
--    it, exactly as a removed one already does. (This function existed only in the database; it is written out here
--    in full, unchanged apart from the new block.)
-- 3. social_listing_publish_status: one line per listing, counting its posts (agency and Synapse twins) by state and
--    naming the overall state, including 'partially_published' -- some went out, some did not.
--
-- Nothing here changes how a post is claimed or published: the publisher only ever claims status = 'scheduled',
-- so a cancelled post can never go out.

begin;

create or replace function public.cancel_social_post(p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency uuid;
  v_status text;
  v_twins integer;
begin
  select agency_id, status::text into v_agency, v_status
    from social_posts
   where id = p_post_id and deleted_at is null;

  if v_agency is null then
    raise exception 'That post no longer exists' using errcode = 'no_data_found';
  end if;

  if coalesce(agency_role(v_agency)::text, '') not in ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot change posts for this agency' using errcode = 'insufficient_privilege';
  end if;

  if v_status not in ('draft', 'scheduled') then
    raise exception 'Only a post that has not gone out yet can be cancelled (this one is %)', v_status
      using errcode = 'check_violation';
  end if;

  update social_posts
     set status = 'cancelled', updated_at = now()
   where id = p_post_id
     and status in ('draft', 'scheduled');   -- the publisher may have claimed it since the read above

  if not found then
    raise exception 'That post has just started going out and can no longer be cancelled'
      using errcode = 'check_violation';
  end if;

  -- the twins were cancelled by social_posts_twins_follow; report how many, for the toast
  select count(*) into v_twins from social_posts where twin_of = p_post_id and status = 'cancelled';
  return 1 + v_twins;
end;
$$;

comment on function public.cancel_social_post(uuid) is
  'Agency member: stop one of its own posts that has not gone out. Kept as status cancelled, with its Synapse twins.';

revoke all on function public.cancel_social_post(uuid) from public, anon;
grant execute on function public.cancel_social_post(uuid) to authenticated;


create or replace function public.social_posts_twins_follow()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Only an agency post has twins, and only these columns are worth
  -- propagating: the time it goes out, whether it still exists, and whether it was cancelled.
  if new.leg <> 'agency' then return new; end if;

  if new.scheduled_at is distinct from old.scheduled_at then
    /* Only rows that have not gone anywhere yet. A twin already published
       cannot be un-published by moving its source, and one that failed has a
       failure_reason worth keeping rather than silently re-arming. */
    update social_posts t
       set scheduled_at = new.scheduled_at
     where t.twin_of = new.id
       and t.status = 'scheduled'
       and t.deleted_at is null;
  end if;

  if new.deleted_at is distinct from old.deleted_at and new.deleted_at is not null then
    -- Taking a post off the schedule takes its amplification with it. The FK
    -- already cascades a real DELETE; this covers the soft one, which is what
    -- the portal actually does.
    update social_posts t
       set deleted_at = new.deleted_at
     where t.twin_of = new.id
       and t.deleted_at is null;
  end if;

  -- Cancelling it cancels the twins that have not gone out either (2026-11-09).
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update social_posts t
       set status = 'cancelled'
     where t.twin_of = new.id
       and t.status in ('draft', 'scheduled')
       and t.deleted_at is null;
  end if;

  return new;
end;
$function$;

revoke all on function public.social_posts_twins_follow() from public, anon, authenticated;


create or replace function public.social_listing_publish_status(p_agency_id uuid)
returns table (
  property_id uuid,
  total integer,
  published integer,
  waiting integer,
  failed integer,
  cancelled integer,
  drafts integer,
  overall text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_agency_member(p_agency_id) then
    raise exception 'You are not a member of this agency' using errcode = 'insufficient_privilege';
  end if;

  return query
  with c as (
    select sp.property_id,
           count(*)::int                                                        as total,
           count(*) filter (where sp.status = 'published')::int                 as published,
           count(*) filter (where sp.status in ('scheduled', 'publishing'))::int as waiting,
           count(*) filter (where sp.status = 'failed')::int                    as failed,
           count(*) filter (where sp.status = 'cancelled')::int                 as cancelled,
           count(*) filter (where sp.status = 'draft')::int                     as drafts
      from social_posts sp
     where sp.agency_id = p_agency_id
       and sp.deleted_at is null
       and sp.dry_run = false
       and sp.property_id is not null
     group by sp.property_id
  )
  select c.property_id, c.total, c.published, c.waiting, c.failed, c.cancelled, c.drafts,
         case
           when c.total = c.cancelled                         then 'cancelled'
           when c.published > 0
            and c.published = c.total - c.cancelled            then 'published'
           when c.published > 0                               then 'partially_published'
           when c.waiting > 0                                 then 'scheduled'
           when c.failed > 0                                  then 'failed'
           else 'draft'
         end
    from c;
end;
$$;

comment on function public.social_listing_publish_status(uuid) is
  'Per listing: how many of its posts (agency + Synapse twins) are published, waiting, failed, cancelled, draft, and the overall state including partially_published.';

revoke all on function public.social_listing_publish_status(uuid) from public, anon;
grant execute on function public.social_listing_publish_status(uuid) to authenticated;


commit;
