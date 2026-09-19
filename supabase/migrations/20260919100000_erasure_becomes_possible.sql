-- Erasure becomes possible.
--
-- NDPA 2023 s.34 gives a data subject the right to have their personal data
-- erased. Today that request cannot be honoured at all -- not through the app,
-- not through Supabase Auth, not by hand without disabling triggers.
--
-- reject_mutation() is attached `before update OR DELETE` on nineteen tables.
-- The intent is right: an audit trail nobody can quietly rewrite is worth
-- having, and several of these exist precisely so a dispute can be settled
-- later. But DELETE was swept up with UPDATE, and deleting a consumer reaches
-- these tables by cascade.
--
-- Verified against the live schema rather than assumed. For a consumer the
-- blocking paths are:
--
--   proximity_events      profiles  (CASCADE)   -- direct
--   activity_feed         leads     (CASCADE)   -- leads cascade from profiles
--   lead_attribution      leads     (CASCADE)
--   lead_stage_history    leads     (CASCADE)
--
-- and attribute_lead() writes a lead_attribution row for EVERY lead, including
-- a 'direct_search' row when no touch was recorded. So any consumer who has
-- ever been introduced to an agency is undeletable, which is most of them.
--
-- ── the fix ───────────────────────────────────────────────────────────────
--
-- UPDATE stays rejected, always and for everyone. Tampering with history is
-- the thing these triggers exist to stop and nothing here weakens it.
--
-- DELETE is permitted only inside a transaction that has declared itself an
-- erasure, via a transaction-local setting that erase_personal_data() sets and
-- that nothing else sets. A stray DELETE from the API, from a bug, or from an
-- agency's own session still hits the exception exactly as before: the caller
-- has to go through the function, and the function records what it did.
--
-- This is deliberately not a `security definer` bypass of RLS on each table.
-- The flag approach keeps one auditable entry point rather than nineteen
-- exceptions, and the erasure_log row is written in the same transaction as
-- the deletes -- so a completed erasure cannot exist without its record, and a
-- record cannot exist without the erasure.
--
-- ── what this migration does NOT decide ───────────────────────────────────
--
-- Whether an agency may keep a lead it lawfully acquired after the buyer asks
-- Synapse to erase them is a legal question with a real answer on both sides:
-- s.34 is not absolute and other lawful bases can survive it. This migration
-- makes erasure POSSIBLE and does not set that policy. erase_personal_data()
-- deletes; if counsel says leads should instead be anonymised in place, that
-- is a change to this one function and not to the nineteen triggers.

-- ── 1. the trigger learns the difference between tampering and erasure ────
create or replace function reject_mutation()
returns trigger language plpgsql as $$
begin
  /* DELETE is allowed only inside an authorised erasure. erase_personal_data()
     is the only thing that sets this, and it sets it transaction-locally, so
     it cannot leak into another statement or another session. */
  if tg_op = 'DELETE'
     and coalesce(current_setting('synapse.erasure', true), '') = 'on' then
    return old;
  end if;

  /* The original read 'Table %s is append-only', which prints the table name
     and then a stray letter s -- %s is not a PL/pgSQL placeholder. */
  raise exception '% is append-only', tg_table_name
    using hint = 'Rows here are never updated. They can only be deleted by '
               || 'erase_personal_data(), which exists so an NDPA s.34 erasure '
               || 'request can be honoured and which records what it removed.';
end;
$$;

-- ── 2. proof that an erasure happened, holding no personal data ───────────
create table if not exists erasure_log (
  id            uuid primary key default uuid_generate_v4(),
  /* The subject is recorded as a SHA-256 of their id, not the id. That is
     enough to confirm "yes, this person was erased" if they come back with
     their own identifier, and not enough to enumerate who has ever asked.
     A log of erasures that is itself a list of people is not a good trade. */
  subject_hash  text not null,
  erased_at     timestamptz not null default now(),
  actor         text not null,        -- 'self' | 'service_role'
  reason        text not null,
  /* Which tables gave up how many rows. Demonstrating compliance under the
     NDPA means being able to say what was done, not merely that it was. */
  row_counts    jsonb not null default '{}'::jsonb
);
create index if not exists idx_erasure_log_subject on erasure_log (subject_hash);

alter table erasure_log enable row level security;
-- Nobody reads this through the API. It is evidence for the regulator and for
-- us, and it is reachable with the service role or at the SQL console.
revoke all on erasure_log from anon, authenticated;

comment on table erasure_log is
  'One row per honoured erasure. Holds no personal data: the subject is a '
  'SHA-256 of their profile id, which can confirm a specific erasure but '
  'cannot be used to list who has asked.';

-- ── 3. the one way to erase somebody ──────────────────────────────────────
create or replace function erase_personal_data(
  p_profile_id uuid,
  p_reason     text default 'data subject request (NDPA s.34)'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   text;
  v_counts  jsonb := '{}'::jsonb;
  v_leads   integer;
  v_prox    integer;
  v_exists  boolean;
begin
  /* The subject themselves, or the service role acting on a request that
     reached us by another channel. An agency cannot erase a buyer, and one
     buyer cannot erase another. */
  if auth.uid() is not null and auth.uid() = p_profile_id then
    v_actor := 'self';
  elsif auth.role() = 'service_role' then
    v_actor := 'service_role';
  else
    raise exception 'Not permitted to erase that subject'
      using hint = 'Only the data subject or the service role may call this.';
  end if;

  select exists(select 1 from profiles where id = p_profile_id) into v_exists;
  if not v_exists then
    /* Not an error. A second request for somebody already erased should
       report the same outcome as the first, or the caller learns whether an
       id ever existed by the shape of the failure. */
    return jsonb_build_object('erased', false, 'reason', 'no such subject');
  end if;

  /* Counted BEFORE the deletes, because afterwards there is nothing to
     count and the log would say nothing useful. */
  select count(*) into v_leads from leads where consumer_id = p_profile_id;
  /* user_id, not profile_id. Verified against the live schema: 0019 declares
     proximity_events.user_id and nothing renames it. The first draft of this
     said profile_id, which would have raised "column does not exist" before
     reaching set_config -- erasure would have failed on every call, safely
     and uselessly. */
  select count(*) into v_prox  from proximity_events where user_id = p_profile_id;

  /* Transaction-local: `true` is the is_local argument. It ends with this
     transaction whether it commits or rolls back, so a failure halfway
     through cannot leave deletion enabled for the next caller. */
  perform set_config('synapse.erasure', 'on', true);

  /* One delete. Every cascade defined on profiles does the rest, which is
     why the FK graph was worth verifying rather than enumerating tables here
     -- a hand-written list would go stale the first time a table was added. */
  delete from profiles where id = p_profile_id;

  v_counts := jsonb_build_object('leads', v_leads, 'proximity_events', v_prox);

  insert into erasure_log (subject_hash, actor, reason, row_counts)
  values (encode(sha256(p_profile_id::text::bytea), 'hex'), v_actor, p_reason, v_counts);

  return jsonb_build_object('erased', true, 'counts', v_counts);
end;
$$;

revoke all on function erase_personal_data(uuid, text) from public;
grant execute on function erase_personal_data(uuid, text) to authenticated;

comment on function erase_personal_data(uuid, text) is
  'Honours an NDPA s.34 erasure. The only path that may delete from an '
  'append-only table, and it records what it removed. Does NOT delete the '
  'auth.users row -- that needs the Auth admin API from an edge function, '
  'because SQL cannot reach it.';

-- ── 4. the visitors who never made an account ─────────────────────────────
--
-- erase_personal_data() takes a profile id, and most of our data subjects do
-- not have one. No account is needed to browse, to talk to Tayo, or to be
-- followed around by a geofence -- so the largest group of people with
-- personal data here had no erasure path at all, and the thing they would
-- most want gone is the conversation.
--
-- Verified against the live schema before writing this, not assumed:
--
--   demo_chat_sessions    visitor_id
--   geofence_watches      visitor_id
--   push_subscriptions    visitor_id
--   notifications         visitor_id
--   channel_interactions  session_id     (append-only; needs the flag)
--
-- AUTHORISATION IS POSSESSION OF THE ID. A visitor id is a random uuid held
-- in that person's browser and nowhere a stranger can enumerate it. There is
-- no session to check it against, because the whole point is that there is no
-- account. The trade is deliberate and worth naming: somebody who obtains a
-- visitor id can erase that visitor's data. They cannot READ any of it, and
-- erasing data on somebody's behalf is a far smaller harm than being unable
-- to erase your own -- which is where we are today.
--
-- Needs the id surfaced in the interface. A right nobody can invoke because
-- they cannot quote their own identifier is not a right. That is a UI change,
-- not a migration, and it is tracked as one.

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

  delete from demo_chat_sessions   where visitor_id = p_visitor_id;
  get diagnostics v_chats = row_count;
  delete from geofence_watches     where visitor_id = p_visitor_id;
  get diagnostics v_watch = row_count;
  delete from push_subscriptions   where visitor_id = p_visitor_id;
  get diagnostics v_push = row_count;
  delete from notifications        where visitor_id = p_visitor_id;
  get diagnostics v_notif = row_count;
  delete from channel_interactions where session_id = p_visitor_id;
  get diagnostics v_inter = row_count;

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

  return jsonb_build_object('erased', true, 'counts', jsonb_build_object(
    'demo_chat_sessions', v_chats, 'geofence_watches', v_watch,
    'push_subscriptions', v_push, 'notifications', v_notif,
    'channel_interactions', v_inter));
end;
$$;

revoke all on function forget_visitor(uuid) from public;
-- anon as well as authenticated: a visitor with no account is precisely who
-- this exists for, and they call it without ever signing in.
grant execute on function forget_visitor(uuid) to anon, authenticated;

comment on function forget_visitor(uuid) is
  'Erases everything held against an anonymous visitor id. Authorisation is '
  'possession of the id, which is a random uuid in that person''s browser: '
  'there is no session to check it against, because having no account is the '
  'condition this exists to serve.';
