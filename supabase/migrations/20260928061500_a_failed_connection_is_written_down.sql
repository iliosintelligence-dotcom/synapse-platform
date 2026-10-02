-- A FAILED SOCIAL CONNECTION IS WRITTEN DOWN.
--
-- social-connect tells the person connecting what went wrong in a toast, and
-- the function log, which cannot be read from outside the dashboard (the
-- Management API logs endpoint returns "Backend error" for it). So on
-- 27-28 September "Facebook still gives the same error" arrived twice with no
-- error attached, and nobody could see what Facebook had said.
--
-- backToPortal now writes every 'error' or 'cancelled' outcome here: the
-- outcome and the platform's own words. Nothing about the person -- no
-- account, no agency, no address. Service role only. Kept 30 days.

create table if not exists public.social_connect_failures (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  status  text not null,
  detail  text
);

comment on table public.social_connect_failures is
  'Failed or cancelled social connections, as social-connect reported them to '
  'the person (backToPortal). Outcome and the platform''s words only. Service '
  'role only; purged after 30 days by purge-social-connect-failures.';

alter table public.social_connect_failures enable row level security;
revoke all on public.social_connect_failures from public;
revoke all on public.social_connect_failures from anon;
revoke all on public.social_connect_failures from authenticated;

do $$
begin
  perform cron.unschedule('purge-social-connect-failures');
exception when others then
  null;
end $$;

select cron.schedule(
  'purge-social-connect-failures',
  '50 3 * * *',
  $$delete from public.social_connect_failures where at < now() - interval '30 days'$$
);

insert into public.cron_expectations (jobname, max_silence, note) values
  ('purge-social-connect-failures', interval '50 hours', 'daily 03:50')
on conflict (jobname) do update
  set max_silence = excluded.max_silence, note = excluded.note;
