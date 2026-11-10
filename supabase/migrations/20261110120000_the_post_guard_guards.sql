-- The social_posts guard guards (found 2026-11-09, fixed 2026-11-10).
--
-- social_posts_guard is meant to hold a signed-in browser to drafts and scheduled posts: no rewriting what went out, no
-- declaring a post published, no re-arming a stopped one. It checked current_user, which inside a SECURITY DEFINER
-- trigger is the function's owner, never 'authenticated' -- so it never fired, and the browser could do all of that.
--
-- Now: the caller is read from the request's JWT role (auth.role()). Five functions the dashboard legitimately uses to
-- change posts outside that rule -- Retry (failed -> scheduled), Remove (hide a failed post), Hold to cancel (-> cancelled,
-- with its Synapse copies), Add to campaign (labels published posts too), and queueing -- mark their own request as
-- trusted with a transaction-local setting the browser cannot set (it only reaches functions in the public schema, and
-- PostgREST sets only request.* settings). The publisher and the scheduled jobs carry no 'authenticated' role and were
-- never held by it. Each definition below is live's text (read 2026-11-10) with only that change.

begin;

-- assign_posts_to_campaign(p_campaign_id uuid, p_post_ids uuid[]) — live md5 6b3c4051
CREATE OR REPLACE FUNCTION public.assign_posts_to_campaign(p_campaign_id uuid, p_post_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agency uuid;
  v_n      integer;
begin
  perform set_config('synapse.post_guard', 'trusted', true);  -- approved path: social_posts_guard lets it through
  select agency_id into v_agency from campaigns
   where id = p_campaign_id and deleted_at is null;
  if v_agency is null then
    raise exception 'No such campaign' using errcode = 'no_data_found';
  end if;
  if not agency_can_edit(v_agency) then
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

-- cancel_social_post(p_post_id uuid) — live md5 9c39c3e6
CREATE OR REPLACE FUNCTION public.cancel_social_post(p_post_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_agency uuid;
  v_status text;
  v_twins integer;
begin
  perform set_config('synapse.post_guard', 'trusted', true);  -- approved path: social_posts_guard lets it through
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
$function$;

-- discard_social_post(p_post_id uuid) — live md5 a1173857
CREATE OR REPLACE FUNCTION public.discard_social_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agency uuid;
  v_status text;
begin
  perform set_config('synapse.post_guard', 'trusted', true);  -- approved path: social_posts_guard lets it through
  select agency_id, status::text into v_agency, v_status
  from social_posts
  where id = p_post_id and deleted_at is null;

  if v_agency is null then
    return false;          -- already gone; not an error worth showing
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
$function$;

-- queue_social_post(…) — live md5 398e407f
CREATE OR REPLACE FUNCTION public.queue_social_post(p_property_id uuid, p_platform social_platform, p_caption text, p_media_urls text[] DEFAULT '{}'::text[], p_scheduled_at timestamp with time zone DEFAULT now(), p_dry_run boolean DEFAULT true, p_payload jsonb DEFAULT NULL::jsonb, p_social_account_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform set_config('synapse.post_guard', 'trusted', true);  -- approved path: social_posts_guard lets it through
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

-- retry_social_post(p_post_id uuid) — live md5 3181230d
CREATE OR REPLACE FUNCTION public.retry_social_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agency uuid;
  v_status text;
begin
  perform set_config('synapse.post_guard', 'trusted', true);  -- approved path: social_posts_guard lets it through
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
  -- outside world and re-queueing it would post the same thing twice.
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
$function$;

-- social_posts_guard() — live md5 55b1ff95
CREATE OR REPLACE FUNCTION public.social_posts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(current_setting('synapse.post_guard', true), '') <> 'trusted' then
    -- already out (or on its way): the portal does not get to rewrite history
    if old.status not in ('draft', 'scheduled') then
      raise exception 'A post that has already gone out cannot be changed here'
        using errcode = 'insufficient_privilege';
    end if;
    -- and it does not get to declare one sent
    if new.status not in ('draft', 'scheduled') then
      raise exception 'Only the publisher may publish a post'
        using errcode = 'insufficient_privilege';
    end if;
    if new.dry_run is distinct from old.dry_run then
      raise exception 'dry_run cannot be changed after queueing'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$function$;

commit;
