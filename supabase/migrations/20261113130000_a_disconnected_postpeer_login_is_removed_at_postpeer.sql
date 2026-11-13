-- A disconnected PostPeer account is removed at PostPeer too (2026-11-13).
--
-- Disconnecting deletes the login keys WE hold (disconnect_social_account). An account connected through PostPeer has
-- none here -- PostPeer holds the login -- so until now Disconnect left that login sitting at PostPeer, unused. This
-- removes it there as well, whichever way the account goes:
--
-- 1. postpeer_cleanup: the PostPeer integrations waiting to be removed. Service role only.
-- 2. A trigger on social_accounts adds one when a PostPeer account is disconnected (deleted_at set), switched off
--    (is_active false, e.g. PostPeer reported it disconnected), or its row is deleted (its agency was deleted). It can
--    never stop the disconnect itself: any failure is a warning, not an error.
-- 3. drain_postpeer_cleanup + a job every 5 minutes: when something is waiting, wakes post-metrics (action
--    'postpeer-cleanup'), which removes each one at PostPeer -- unless the same account has been connected again
--    meanwhile, which is then left alone. Removing costs no PostPeer credits.
--
-- Undo: undo-postpeer-cleanup.sql beside this repo.

begin;

-- ── 1 ──
create table if not exists public.postpeer_cleanup (
  id             bigserial primary key,
  integration_id text not null,
  agency_id      uuid,
  platform       text,
  reason         text not null,
  created_at     timestamptz not null default now(),
  attempts       integer not null default 0,
  last_error     text,
  done_at        timestamptz,
  outcome        text
);
comment on table public.postpeer_cleanup is
  'PostPeer integrations to remove at PostPeer after the account was disconnected here. Filled by a trigger on '
  'social_accounts; worked through by post-metrics (action postpeer-cleanup). Service role only.';
-- One open entry per integration: disconnecting twice does not queue it twice.
create unique index if not exists postpeer_cleanup_one_open
  on public.postpeer_cleanup (integration_id) where done_at is null;
alter table public.postpeer_cleanup enable row level security;
revoke all on table public.postpeer_cleanup from public;
revoke all on table public.postpeer_cleanup from anon;
revoke all on table public.postpeer_cleanup from authenticated;
revoke all on sequence public.postpeer_cleanup_id_seq from public;
revoke all on sequence public.postpeer_cleanup_id_seq from anon;
revoke all on sequence public.postpeer_cleanup_id_seq from authenticated;

-- ── 2 ──
create or replace function public.postpeer_queue_cleanup()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_reason text;
begin
  if old.auth_source is distinct from 'postpeer' or coalesce(old.platform_account_id, '') = '' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    if old.deleted_at is not null then return null; end if;   -- already queued when it was disconnected
    v_reason := 'account row deleted';
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_reason := 'disconnected';
  elsif old.is_active and not new.is_active then
    v_reason := 'switched off';
  else
    return null;
  end if;
  begin
    insert into public.postpeer_cleanup (integration_id, agency_id, platform, reason)
    values (old.platform_account_id, old.agency_id, old.platform::text, v_reason)
    on conflict (integration_id) where done_at is null do nothing;
  exception when others then
    raise warning 'postpeer_queue_cleanup: could not queue %: %', old.platform_account_id, sqlerrm;
  end;
  return null;
end;
$function$;
comment on function public.postpeer_queue_cleanup() is
  'Queues a PostPeer integration for removal at PostPeer when its social_accounts row is disconnected, switched off '
  'or deleted. Never blocks the change that fired it.';
revoke all on function public.postpeer_queue_cleanup() from public;
revoke all on function public.postpeer_queue_cleanup() from anon;
revoke all on function public.postpeer_queue_cleanup() from authenticated;

drop trigger if exists social_accounts_postpeer_cleanup on public.social_accounts;
create trigger social_accounts_postpeer_cleanup
  after update or delete on public.social_accounts
  for each row execute function public.postpeer_queue_cleanup();

-- PostPeer accounts already disconnected before this existed (and not connected again since) are queued once.
insert into public.postpeer_cleanup (integration_id, agency_id, platform, reason)
select distinct on (s.platform_account_id) s.platform_account_id, s.agency_id, s.platform::text,
       'disconnected before this cleanup existed'
from public.social_accounts s
where s.auth_source = 'postpeer' and coalesce(s.platform_account_id, '') <> ''
  and (s.deleted_at is not null or not s.is_active)
  and not exists (select 1 from public.social_accounts l
                  where l.auth_source = 'postpeer' and l.platform_account_id = s.platform_account_id
                    and l.deleted_at is null and l.is_active)
on conflict (integration_id) where done_at is null do nothing;

-- ── 3 ──
create or replace function public.drain_postpeer_cleanup()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $function$
declare
  v_key text;
  v_url text;
  v_waiting integer;
begin
  select count(*) into v_waiting
  from postpeer_cleanup
  where done_at is null and attempts < 5;

  if v_waiting = 0 then
    return 0;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url' limit 1;

  if v_key is null or v_url is null then
    raise warning 'drain_postpeer_cleanup: service_role_key or project_url missing from vault';
    return 0;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/post-metrics',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('action', 'postpeer-cleanup', 'limit', 20),
    timeout_milliseconds := 120000
  );

  return v_waiting;
end;
$function$;
comment on function public.drain_postpeer_cleanup() is
  'Every 5 minutes: when PostPeer integrations are waiting in postpeer_cleanup, asks post-metrics to remove them.';
revoke all on function public.drain_postpeer_cleanup() from public;
revoke all on function public.drain_postpeer_cleanup() from anon;
revoke all on function public.drain_postpeer_cleanup() from authenticated;

do $$
begin
  perform cron.unschedule('postpeer-cleanup');
exception when others then
  null;   -- not scheduled yet: nothing to remove
end $$;

select cron.schedule(
  'postpeer-cleanup',
  '*/5 * * * *',
  $$select public.drain_postpeer_cleanup()$$
);

-- Watched like every other job (see 20260927235841).
insert into public.cron_expectations (jobname, max_silence, note) values
  ('postpeer-cleanup', interval '30 minutes', 'every 5 minutes')
on conflict (jobname) do update
  set max_silence = excluded.max_silence, note = excluded.note;

commit;
