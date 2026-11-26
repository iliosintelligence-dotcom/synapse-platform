-- A POST CUT OFF MID-SEND THROUGH POSTPEER IS SENT AGAIN, NOT FAILED (2026-11-26).
--
-- The 26 Nov 3pm batch showed sends being cut off by the function's time limit (fixed in social-publish and
-- synapse-studio: posts now go side by side within a time budget). Should a run still be cut off, drain_social_queue's
-- sweep marked every post left at 'publishing' for 20 minutes as failed, even one going through PostPeer, which is
-- safe to send again: its idempotency key makes PostPeer replay the first answer, never a second post. Those are now
-- put back in the queue (the attempt uncounted); any other post is settled exactly as before. The rest of the function
-- is the live definition, unchanged.

CREATE OR REPLACE FUNCTION public.drain_social_queue()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
declare
  v_key text;
  v_url text;
  v_due integer;
begin
  /* A post cut off mid-send that goes through PostPeer is sent again instead (2026-11-26): its key makes PostPeer
     replay the first answer, so it can never go out twice. Through PostPeer means: a studio channel with a PostPeer
     integration, or the agency account it resolves to (the one it names, else the oldest) connected through PostPeer. */
  update social_posts sp
     set status = 'scheduled', attempts = greatest(0, sp.attempts - 1), scheduled_at = now(),
         failure_reason = 'Sending was cut off; sent again (it cannot go out twice).'
   where sp.status = 'publishing' and sp.deleted_at is null
     and sp.updated_at < now() - interval '20 minutes'
     and (
       (sp.city_channel_id is not null and exists (
          select 1 from city_channels c where c.id = sp.city_channel_id and c.postpeer_integration_id is not null))
       or (sp.city_channel_id is null and (
          select a.auth_source from social_accounts a
           where a.agency_id = sp.agency_id and a.platform = sp.platform and a.is_active and a.deleted_at is null
             and (sp.social_account_id is null or a.id = sp.social_account_id)
           order by a.connected_at asc limit 1) = 'postpeer')
     );

  /* Settle the uncertain ones first (see the header of this file). */
  update social_posts
     set status = 'failed',
         failure_reason = 'We could not confirm this post went out. Check the channel, then retry it from Needs attention if it is not there.'
   where status = 'publishing' and deleted_at is null
     and updated_at < now() - interval '20 minutes';

  select count(*) into v_due
  from social_posts sp
  where sp.deleted_at is null
    and sp.attempts < sp.max_attempts
    and (
      (sp.status = 'scheduled' and sp.scheduled_at <= now())
    )
    -- THE ONLY CHANGE. 0081's body is otherwise reproduced exactly, including
    -- the request it sends: limit 25 and no `live` flag. A first draft of this
    -- invented both, which would have quietly changed what the scheduler asks
    -- the publisher to do -- the same mistake connect_social_account taught
    -- earlier this week, caught the same way: read the original first.
    and not exists (
      select 1 from campaigns c
       where c.id = sp.campaign_id and c.status = 'paused'
    );

  if v_due = 0 then
    return 0;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url' limit 1;

  if v_key is null or v_url is null then
    raise warning 'drain_social_queue: service_role_key or project_url missing from vault';
    return 0;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/social-publish',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('limit', 25),
    timeout_milliseconds := 120000
  );

  return v_due;
end;
$function$;
