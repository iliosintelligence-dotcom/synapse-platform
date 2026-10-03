-- Two cron jobs that have been failing on the live database, and why.
--
-- 1. synapse-daily-snapshots has failed every night since 4 September with
--    "ON CONFLICT DO UPDATE command cannot affect row a second time". One
--    person is an active member of two agencies, and the agent snapshot
--    grouped by (profile, agency) while upserting on (agent_id, date) -- so
--    that agent arrived twice in one statement. Because the whole function is
--    one transaction, the agency snapshots written just before it rolled back
--    too: neither table has a row after 2 September.
--
--    The fix picks ONE active membership per agent before aggregating -- the
--    most recently joined, agency_id breaking a tie -- so there is exactly one
--    source row per conflict key. The figures stay those of that single
--    agency. Summing the agent across agencies instead would put one agency's
--    lead and deal counts on a row the other agency's admins can read
--    (agent_snapshots_select lets an agency admin see rows by agency_id).
--    A row per (agent, agency) would need the primary key changed; this keeps
--    the table as it is.
--
-- 2. cron-health-check has reported ITSELF as failing every 15 minutes since
--    19 August, "last run ... - no message". check_cron_health() judged each
--    job by its most recent job_run_details row, and while the check runs, its
--    own most recent row is the one in flight: status 'running', no message
--    yet. So it flagged itself on every run and its recovery step, reading the
--    same row, never closed it. Every job that happened to be mid-run on the
--    quarter hour got the same treatment -- about 250 alerts opened and closed
--    again in the last day alone. Both places now read the most recent
--    FINISHED run ('succeeded' or 'failed'). The stalled check is unchanged: a
--    run in flight is proof the job is still firing.
--
-- Both function bodies are the live definitions (pg_proc.prosrc, verified by
-- md5 before editing) with only these changes.

CREATE OR REPLACE FUNCTION public.aggregate_daily_snapshots(p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into agency_daily_snapshots as s (
    agency_id, date, new_leads, leads_contacted, viewings_scheduled,
    viewings_completed, deals_closed, revenue_generated, average_response_time_seconds
  )
  select
    a.id, p_date,
    count(distinct l.id) filter (where l.created_at::date = p_date),
    count(distinct c.lead_id) filter (where c.direction = 'outbound' and c.occurred_at::date = p_date),
    count(distinct v.id) filter (where v.created_at::date = p_date),
    count(distinct v.id) filter (where v.completed_at::date = p_date),
    count(distinct dr.id) filter (where dr.status = 'closed' and dr.closed_at::date = p_date),
    coalesce(sum(dr.closing_price) filter (where dr.status = 'closed' and dr.closed_at::date = p_date), 0),
    avg(c.response_time_seconds) filter (where c.occurred_at::date = p_date)::bigint
  from agencies a
    left join leads l on l.agency_id = a.id
    left join communications c on c.lead_id = l.id
    left join viewings v on v.agency_id = a.id
    left join deal_rooms dr on dr.agency_id = a.id
  group by a.id
  on conflict (agency_id, date) do update set
    new_leads = excluded.new_leads,
    leads_contacted = excluded.leads_contacted,
    viewings_scheduled = excluded.viewings_scheduled,
    viewings_completed = excluded.viewings_completed,
    deals_closed = excluded.deals_closed,
    revenue_generated = excluded.revenue_generated,
    average_response_time_seconds = excluded.average_response_time_seconds;

  insert into agent_daily_snapshots as s (
    agent_id, agency_id, date, assigned_leads, leads_contacted,
    viewings_scheduled, viewings_completed, deals_closed, revenue_generated,
    average_response_time_seconds
  )
  select
    am.profile_id, am.agency_id, p_date,
    count(distinct l.id) filter (where l.assigned_agent_id = am.profile_id),
    count(distinct c.lead_id) filter (where c.agent_id = am.profile_id and c.direction = 'outbound' and c.occurred_at::date = p_date),
    count(distinct v.id) filter (where v.agent_id = am.profile_id and v.created_at::date = p_date),
    count(distinct v.id) filter (where v.agent_id = am.profile_id and v.completed_at::date = p_date),
    count(distinct dr.id) filter (where dr.agent_id = am.profile_id and dr.status = 'closed' and dr.closed_at::date = p_date),
    coalesce(sum(dr.closing_price) filter (where dr.agent_id = am.profile_id and dr.status = 'closed' and dr.closed_at::date = p_date), 0),
    avg(c.response_time_seconds) filter (where c.agent_id = am.profile_id and c.occurred_at::date = p_date)::bigint
  from (
    select distinct on (profile_id) profile_id, agency_id
    from agency_members
    where deleted_at is null
    order by profile_id, joined_at desc, agency_id
  ) am
    left join leads l on l.agency_id = am.agency_id
    left join communications c on c.lead_id = l.id
    left join viewings v on v.agency_id = am.agency_id
    left join deal_rooms dr on dr.agency_id = am.agency_id
  group by am.profile_id, am.agency_id
  on conflict (agent_id, date) do update set
    assigned_leads = excluded.assigned_leads,
    leads_contacted = excluded.leads_contacted,
    viewings_scheduled = excluded.viewings_scheduled,
    viewings_completed = excluded.viewings_completed,
    deals_closed = excluded.deals_closed,
    revenue_generated = excluded.revenue_generated,
    average_response_time_seconds = excluded.average_response_time_seconds;

  insert into property_performance as pp (
    property_id, total_leads, total_viewings, total_revenue_generated, top_source_channel, updated_at
  )
  select
    p.id,
    count(distinct l.id),
    count(distinct v.id),
    coalesce(sum(dr.closing_price) filter (where dr.status = 'closed'), 0),
    (select channel from lead_attribution la
       join leads l2 on l2.id = la.lead_id
       where l2.property_id = p.id
       group by channel order by count(*) desc limit 1),
    now()
  from properties p
    left join leads l on l.property_id = p.id
    left join viewings v on v.property_id = p.id
    left join deal_rooms dr on dr.property_id = p.id
  group by p.id
  on conflict (property_id) do update set
    total_leads = excluded.total_leads,
    total_viewings = excluded.total_viewings,
    total_revenue_generated = excluded.total_revenue_generated,
    top_source_channel = excluded.top_source_channel,
    conversion_rate = case when excluded.total_leads > 0
      then round(100.0 * (select count(*) from deal_rooms d where d.property_id = pp.property_id and d.status = 'closed') / excluded.total_leads, 2)
      else 0 end,
    updated_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_cron_health()
 RETURNS TABLE(out_jobname text, out_kind text, out_detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'pg_temp'
AS $function$
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
        and dd.status in ('succeeded', 'failed')
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
  --    Catches what failure-watching cannot: a job that stopped firing at all.
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
  --    wrong NOW rather than everything that has ever been wrong.
  update cron_alerts a
     set resolved_at = now()
   where a.resolved_at is null
     and not exists (
       select 1 from cron.job j
       left join cron_expectations e on e.jobname = j.jobname
       left join lateral (
         select dd.status from cron.job_run_details dd
         where dd.jobid = j.jobid and dd.status in ('succeeded', 'failed')
         order by dd.start_time desc limit 1
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
$function$;

-- Fill the gap the failures left: 3 to 26 September, the days whose nightly
-- run rolled back (27 September is tonight's). Idempotent upserts, the same
-- call the job makes, so it doubles as proof the fix holds on live data -- if
-- it still collided, this migration would fail and nothing above would stick.
select public.aggregate_daily_snapshots(d::date)
from generate_series(date '2026-09-03', date '2026-09-26', interval '1 day') as d;

-- Let the health check's own recovery step close what is no longer true. This
-- resolves the cron-health-check alert now. The synapse-daily-snapshots alert
-- stays open until the job's next scheduled run (01:30) succeeds, because its
-- latest run did fail; closing it by hand would only have the next check open
-- a fresh one.
select public.check_cron_health();
