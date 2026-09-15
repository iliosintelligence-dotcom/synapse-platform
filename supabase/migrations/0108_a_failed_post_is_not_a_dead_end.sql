-- 0108 — A FAILED POST IS NOT A DEAD END
--
-- social_posts_guard refuses any UPDATE from 'authenticated' when old.status is
-- not draft/scheduled. That is right for what it was written to stop: a browser
-- declaring a post published, or rewriting one that has already gone out. But
-- 'failed' fell on the wrong side of it, and deleting is a SOFT delete, which
-- is an UPDATE. So a failed post could not be retried, could not be
-- rescheduled, and could not even be cleared off the board.
--
-- It sat there forever — and because the pipeline mapped every non-published
-- status to 'Scheduled', it sat there wearing a clock, looking like it was
-- still on its way out. Three were in that state, every one of them saying
-- "No account is connected to this agency": a condition the agency can
-- actually fix, with no way to then say "try it again".
--
-- These two functions are the narrow opening. Neither can declare anything
-- published, which is the thing the guard exists to prevent.

begin;

-- Back into the queue. attempts is reset because drain_social_queue requires
-- attempts < max_attempts and a failed post has spent them all -- without that
-- the row would return to 'scheduled' and then be skipped by the drain
-- forever, which is a worse lie than the one being fixed.
create or replace function public.retry_social_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_status text;
begin
  select agency_id, status::text into v_agency, v_status
  from social_posts
  where id = p_post_id and deleted_at is null;

  if v_agency is null then
    raise exception 'That post is no longer here' using errcode = 'no_data_found';
  end if;

  if coalesce(agency_role(v_agency)::text, '') not in ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot post for this agency' using errcode = 'insufficient_privilege';
  end if;

  -- Only a failure may be retried. A published post is a fact about the
  -- outside world, and re-queueing it would post the same thing twice.
  if v_status <> 'failed' then
    raise exception 'Only a post that failed can be sent again'
      using errcode = 'invalid_parameter_value';
  end if;

  update social_posts
     set status         = 'scheduled',
         scheduled_at   = now(),
         attempts       = 0,
         failure_reason = null,
         updated_at     = now()
   where id = p_post_id;

  return true;
end;
$$;

comment on function public.retry_social_post(uuid) is
  'Agency member: put one of its own failed posts back in the publish queue.';


-- Off the board. Deliberately NOT allowed on a published post: that row is the
-- agency's own record of what went out, and the whole point of the Published
-- column is that the history is real. Hiding a post here would not unpublish it
-- on the platform, it would only make our account of it wrong.
create or replace function public.discard_social_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_status text;
begin
  select agency_id, status::text into v_agency, v_status
  from social_posts
  where id = p_post_id and deleted_at is null;

  if v_agency is null then
    return false;          -- already gone; not an error worth showing anybody
  end if;

  if coalesce(agency_role(v_agency)::text, '') not in ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot post for this agency' using errcode = 'insufficient_privilege';
  end if;

  if v_status in ('published', 'publishing') then
    raise exception 'A post that has gone out stays in your history'
      using errcode = 'insufficient_privilege';
  end if;

  update social_posts
     set deleted_at = now(), updated_at = now()
   where id = p_post_id;

  return true;
end;
$$;

comment on function public.discard_social_post(uuid) is
  'Agency member: take one of its own unsent posts off the board. Never a published one.';

-- anon inherits EXECUTE from the default grant to PUBLIC, so revoking from anon
-- alone would do nothing. See [[supabase-revoke-from-public]].
revoke all on function public.retry_social_post(uuid)   from public;
revoke all on function public.discard_social_post(uuid) from public;
grant execute on function public.retry_social_post(uuid)   to authenticated;
grant execute on function public.discard_social_post(uuid) to authenticated;

commit;
