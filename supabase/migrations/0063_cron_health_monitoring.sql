-- 0063_cron_health_monitoring.sql
--
-- Watch the jobs that watch everything else.
--
-- The weekly marketplace-health job failed on every run for eight weeks and
-- nobody knew, because the only record of it was cron.job_run_details and
-- nothing ever read that. The table it should have been filling looked exactly
-- like a feature that had never been built.
--
-- TWO FAILURE MODES, NOT ONE. Watching for errors catches a job that runs and
-- breaks. It does not catch a job that stops running -- disabled, deleted, or
-- dropped by an upgrade -- because a job that never runs produces no failures
-- at all. That second case is the more dangerous one, and it is why this tracks
-- expected silence as well as errors.

-- ── how long each job may reasonably be quiet ───────────────────────────────
-- Explicit rather than parsed from the cron expression: parsing crontab syntax
-- in SQL to compute a next fire time is a lot of machinery to get subtly wrong,
-- and a human-set ceiling is easier to reason about at 3am. Generous by design,
-- roughly two missed runs, so a single blip raises nothing.
create table if not exists public.cron_expectations (
  jobname     text primary key,
  max_silence interval not null,
  note        text
);

insert into public.cron_expectations (jobname, max_silence, note) values
  ('synapse-daily-snapshots',      interval '50 hours',   'daily 01:30'),
  ('synapse-trust-nightly',        interval '50 hours',   'daily 02:00'),
  ('synapse-marketplace-weekly',   interval '15 days',    'Mondays 03:00'),
  ('enrich-property-surroundings', interval '30 minutes', 'every 2 minutes'),
  ('settle-enrichment-queue',      interval '30 minutes', 'every 2 minutes'),
  ('cron-health-check',            interval '45 minutes', 'every 15 minutes; watches the others')
on conflict (jobname) do update
  set max_silence = excluded.max_silence, note = excluded.note;

-- ── what is currently wrong ─────────────────────────────────────────────────
-- One open row per (job, kind). Re-detecting the same problem updates the row
-- rather than adding another, so a job failing every two minutes produces one
-- alert with a rising count and not 700 rows nobody will read.
create table if not exists public.cron_alerts (
  id              uuid primary key default gen_random_uuid(),
  jobname         text not null,
  kind            text not null check (kind in ('failing', 'stalled')),
  detail          text,
  occurrences     integer not null default 1,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  resolved_at     timestamptz,
  acknowledged_at timestamptz
);

create unique index if not exists cron_alerts_one_open_per_problem
  on public.cron_alerts (jobname, kind)
  where resolved_at is null;

comment on table public.cron_alerts is
  'Open problems with scheduled jobs. A row here means a job is failing or has gone quiet for longer than cron_expectations allows. Closed automatically when the job recovers.';

alter table public.cron_alerts       enable row level security;
alter table public.cron_expectations enable row level security;
-- Deny-all under RLS: platform operations, not tenant data. Read with the
-- service role or from the SQL editor.
grant select on public.cron_alerts, public.cron_expectations to service_role;

-- ── the check ───────────────────────────────────────────────────────────────
-- OUT parameters are prefixed out_ because jobname/kind/detail are also column
-- names on cron_alerts, and inside the INSERT plpgsql cannot tell which one a
-- bare jobname means. The first version of this failed on exactly that.
create or replace function public.check_cron_health()
returns table (out_jobname text, out_kind text, out_detail text)
language plpgsql
security definer
set search_path to 'public', 'cron'
as $$
declare
  r record;
begin
  -- 1. FAILING: the most recent run of an active job errored.
  for r in
    select j.jobname as jn, d.return_message as msg, d.start_time as st
    from cron.job j
    join lateral (
      select dd.status, dd.return_message, dd.start_time
      from cron.job_run_details dd
      where dd.jobid = j.jobid
      order by dd.start_time desc
      limit 1
    ) d on true
    where j.active and d.status <> 'succeeded'
  loop
    insert into cron_alerts (jobname, kind, detail)
    values (r.jn, 'failing',
            'last run ' || to_char(r.st, 'YYYY-MM-DD HH24:MI') || ' - '
            || left(coalesce(r.msg, 'no message'), 300))
    on conflict (jobname, kind) where resolved_at is null
    do update set occurrences  = cron_alerts.occurrences + 1,
                  last_seen_at = now(),
                  detail       = excluded.detail;
    out_jobname := r.jn; out_kind := 'failing'; out_detail := left(coalesce(r.msg, ''), 120);
    return next;
  end loop;

  -- 2. STALLED: an active job that has not run inside its allowed silence.
  --    This is what failure-watching cannot do: catch a job that stopped firing.
  for r in
    select j.jobname as jn, e.max_silence as sil,
           (select max(dd.start_time) from cron.job_run_details dd where dd.jobid = j.jobid) as lastrun
    from cron.job j
    join cron_expectations e on e.jobname = j.jobname
    where j.active
  loop
    if r.lastrun is null or r.lastrun < now() - r.sil then
      insert into cron_alerts (jobname, kind, detail)
      values (r.jn, 'stalled',
              coalesce('last ran ' || to_char(r.lastrun, 'YYYY-MM-DD HH24:MI'), 'has never run')
              || ', allowed silence ' || r.sil::text)
      on conflict (jobname, kind) where resolved_at is null
      do update set occurrences  = cron_alerts.occurrences + 1,
                    last_seen_at = now(),
                    detail       = excluded.detail;
      out_jobname := r.jn; out_kind := 'stalled';
      out_detail := coalesce(r.lastrun::text, 'never');
      return next;
    end if;
  end loop;

  -- 3. RECOVERY: close anything no longer true, so the table shows what is
  --    wrong NOW rather than everything that has ever been wrong. An alert
  --    table that only grows is the same silent-failure problem in a new coat.
  update cron_alerts a
     set resolved_at = now()
   where a.resolved_at is null
     and not exists (
       select 1 from cron.job j
       left join cron_expectations e on e.jobname = j.jobname
       left join lateral (
         select dd.status from cron.job_run_details dd
         where dd.jobid = j.jobid order by dd.start_time desc limit 1
       ) d on true
       left join lateral (
         select max(dd2.start_time) as lr from cron.job_run_details dd2
         where dd2.jobid = j.jobid
       ) lrx on true
       where j.jobname = a.jobname
         and j.active
         and (
           (a.kind = 'failing' and d.status is distinct from 'succeeded')
           or (a.kind = 'stalled' and e.jobname is not null
               and (lrx.lr is null or lrx.lr < now() - e.max_silence))
         )
     );
end;
$$;

revoke all on function public.check_cron_health() from public, anon, authenticated;
grant execute on function public.check_cron_health() to service_role;

-- ── the at-a-glance view ────────────────────────────────────────────────────
-- The point of the whole migration: one place that answers whether the jobs are
-- healthy, without anyone having to remember cron.job_run_details exists.
create or replace view public.cron_health as
select
  j.jobname,
  j.schedule,
  j.active,
  d.status                                   as last_status,
  d.start_time                               as last_run,
  case
    when not j.active                                     then 'inactive'
    when d.status is null                                 then 'never run'
    when d.status <> 'succeeded'                          then 'FAILING'
    when e.max_silence is not null
     and d.start_time < now() - e.max_silence             then 'STALLED'
    else 'ok'
  end                                        as health,
  left(d.return_message, 200)                as last_message
from cron.job j
left join cron_expectations e on e.jobname = j.jobname
left join lateral (
  select dd.status, dd.return_message, dd.start_time
  from cron.job_run_details dd
  where dd.jobid = j.jobid
  order by dd.start_time desc
  limit 1
) d on true;

comment on view public.cron_health is
  'One row per scheduled job with its current health. Check this rather than cron.job_run_details -- the marketplace job failed for eight weeks because nobody read the raw table.';

grant select on public.cron_health to service_role;

-- ── watch the watchers, every 15 minutes ────────────────────────────────────
select cron.schedule('cron-health-check', '*/15 * * * *',
                     'select public.check_cron_health()');

-- Verified against the live database (2026-08-19), all three paths:
--   failing detected -> synapse-marketplace-weekly, with the enum error text
--   stalled detected -> forced by squeezing an allowance to 1 second
--   recovery         -> restoring the allowance closed that alert automatically
--   dedupe           -> repeat detections increment occurrences, one row each
--
-- LIMIT WORTH KNOWING: this is detection, not delivery. Nothing pushes. The
-- view has to be looked at, or polled -- the same shape as the problem it was
-- built for, with a much shorter fuse. Closing that needs a channel this
-- project does not have yet: no SMTP, no VAPID keypair, Twilio unset.
