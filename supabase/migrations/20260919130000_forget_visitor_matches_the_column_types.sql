-- forget_visitor() matches the column types it is actually comparing against.
--
-- The first version took p_visitor_id as uuid and compared it to all five
-- columns directly. Three of them are text:
--
--   channel_interactions.session_id   uuid
--   demo_chat_sessions.visitor_id     uuid
--   geofence_watches.visitor_id       text
--   notifications.visitor_id          text
--   push_subscriptions.visitor_id     text
--
-- so the function raised `operator does not exist: text = uuid` and erased
-- nothing at all. Found by calling it for real against the live project with
-- an id that matches nothing — the grants and the definition had both looked
-- correct, and only the call showed it. Checking that the columns EXISTED,
-- which I did, was not the same as checking what they were.
--
-- CAST PER COLUMN, not one blanket ::text on both sides. Casting the column
-- would discard the index on the two uuid tables for no benefit; casting the
-- parameter costs nothing and each comparison stays sargable. The asymmetry
-- is ugly and it is honest — the schema is genuinely mixed, and hiding that
-- behind a uniform cast would trade a visible oddity for a silent seq scan.
--
-- The parameter stays uuid. A visitor id IS a uuid, and typing it as one
-- means a malformed value is rejected at the boundary rather than quietly
-- matching nothing three tables later.

create or replace function forget_visitor(p_visitor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chats  integer := 0;
  v_watch  integer := 0;
  v_push   integer := 0;
  v_notif  integer := 0;
  v_inter  integer := 0;
begin
  if p_visitor_id is null then
    raise exception 'A visitor id is required';
  end if;

  /* Same transaction-local flag: channel_interactions is append-only and
     would otherwise refuse the delete exactly as it refuses every other. */
  perform set_config('synapse.erasure', 'on', true);

  -- uuid columns
  delete from demo_chat_sessions   where visitor_id = p_visitor_id;
  get diagnostics v_chats = row_count;
  delete from channel_interactions where session_id = p_visitor_id;
  get diagnostics v_inter = row_count;

  -- text columns: the parameter is cast, never the column, so the index holds
  delete from geofence_watches     where visitor_id = p_visitor_id::text;
  get diagnostics v_watch = row_count;
  delete from push_subscriptions   where visitor_id = p_visitor_id::text;
  get diagnostics v_push = row_count;
  delete from notifications        where visitor_id = p_visitor_id::text;
  get diagnostics v_notif = row_count;

  /* Only recorded when something was actually removed. A log that gains a row
     every time somebody opens the page and presses the button on an empty
     browser is a log you stop being able to read — and an audit trail is only
     worth keeping if every row in it means something happened. */
  if (v_chats + v_watch + v_push + v_notif + v_inter) > 0 then
    insert into erasure_log (subject_hash, actor, reason, row_counts)
    values (
      encode(sha256(p_visitor_id::text::bytea), 'hex'),
      'visitor',
      'visitor erasure request (NDPA s.34)',
      jsonb_build_object(
        'demo_chat_sessions', v_chats, 'geofence_watches', v_watch,
        'push_subscriptions', v_push, 'notifications', v_notif,
        'channel_interactions', v_inter)
    );
  end if;

  return jsonb_build_object('erased', true, 'counts', jsonb_build_object(
    'demo_chat_sessions', v_chats, 'geofence_watches', v_watch,
    'push_subscriptions', v_push, 'notifications', v_notif,
    'channel_interactions', v_inter));
end;
$$;

revoke all on function forget_visitor(uuid) from public;
grant execute on function forget_visitor(uuid) to anon, authenticated;

comment on function forget_visitor(uuid) is
  'Erases everything held against an anonymous visitor id. Authorisation is '
  'possession of the id, which is a random uuid in that person''s browser: '
  'there is no session to check it against, because having no account is the '
  'condition this exists to serve. anon MUST keep execute on this one -- '
  'unlike erase_personal_data, which anon is deliberately barred from.';
