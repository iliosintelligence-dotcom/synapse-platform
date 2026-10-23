-- KEYWORD REPLIES ON FACEBOOK TOO (Eden, 2026-10-23: Facebook is the channel that works today).
--
-- Comments on an agency's Facebook posts are already collected (post-metrics files them in social_comments with
-- platform 'facebook'). A Facebook private reply is the same Meta call as Instagram's, POST /{page-id}/messages with the
-- comment id, sent from the Page itself. The only change here is that the claim now takes Facebook comments as well;
-- drain_comment_replies counts them too, and social-reply works out the Page. Everything else is unchanged: off per agency until its owner turns it on, one reply per
-- comment, seven days, only to someone who typed the keyword, and it says it is automated. It also still needs Meta's
-- pages_messaging permission on the app, without which Meta refuses the send and the comment is marked failed, not retried.

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
       and sc.platform in ('instagram', 'facebook')
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

revoke all on function public.claim_comment_replies(integer) from public, anon, authenticated;
grant execute on function public.claim_comment_replies(integer) to service_role;

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
    and sc.platform in ('instagram', 'facebook')
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

revoke all on function public.drain_comment_replies() from public, anon, authenticated;
