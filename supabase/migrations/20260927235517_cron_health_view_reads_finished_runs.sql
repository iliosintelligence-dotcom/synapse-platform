-- The cron_health view had the same blind spot check_cron_health() had until
-- 20260927230000: it judged each job by its newest job_run_details row, so any
-- job caught mid-run -- status 'running', no message yet -- read as FAILING.
-- A job that runs every minute looked broken to whoever happened to check at
-- the wrong second. It now reads the newest FINISHED run ('succeeded' or
-- 'failed'), the same rule as the check; last_status, last_run and
-- last_message describe that run. A run stuck in flight past its allowed
-- silence now shows as STALLED, which is what it is.
--
-- The body is the live definition (pg_get_viewdef, verified by md5 before
-- editing) with only that condition added. Same columns, same order, so
-- CREATE OR REPLACE keeps the view's comment and grants.
--
-- AND THE GRANTS. 0063 granted this view to service_role alone ("read with the
-- service role"), but Supabase's default privileges on the public schema had
-- already given anon and authenticated everything on it. The view is owned by
-- postgres and is not security_invoker, so it reads cron.job and
-- job_run_details with the owner's rights: anyone holding the public anon key
-- could read every job's schedule and last error message through the REST
-- API. Nothing in this repo reads the view as either role, so both lose it.

create or replace view public.cron_health as
 SELECT j.jobname,
    j.schedule,
    j.active,
    d.status AS last_status,
    d.start_time AS last_run,
        CASE
            WHEN (NOT j.active) THEN 'inactive'::text
            WHEN (d.status IS NULL) THEN 'never run'::text
            WHEN (d.status <> 'succeeded'::text) THEN 'FAILING'::text
            WHEN ((e.max_silence IS NOT NULL) AND (d.start_time < (now() - e.max_silence))) THEN 'STALLED'::text
            ELSE 'ok'::text
        END AS health,
    "left"(d.return_message, 200) AS last_message
   FROM ((cron.job j
     LEFT JOIN cron_expectations e ON ((e.jobname = j.jobname)))
     LEFT JOIN LATERAL ( SELECT dd.status,
            dd.return_message,
            dd.start_time
           FROM cron.job_run_details dd
          WHERE ((dd.jobid = j.jobid) AND (dd.status = ANY (ARRAY['succeeded'::text, 'failed'::text])))
          ORDER BY dd.start_time DESC
         LIMIT 1) d ON (true));

revoke all on public.cron_health from anon, authenticated;
