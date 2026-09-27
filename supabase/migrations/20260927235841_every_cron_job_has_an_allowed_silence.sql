-- Nine scheduled jobs had no row in cron_expectations, so nothing noticed if
-- one of them stopped firing. check_cron_health() only tests for stalls on
-- jobs it has an expectation for, and since 20260927230000 it judges failure
-- by the newest FINISHED run -- so a run hung in flight on one of these jobs
-- would have shown up nowhere at all. With a row here, a job that stops
-- running, or hangs, raises a 'stalled' alert once it has been quiet too long.
--
-- Same rule as 0063: roughly two missed runs and generous by design, so one
-- blip raises nothing, with 30 minutes as the floor for the frequent ones.
--
-- purge-telegram-link-codes was scheduled on 27 September after that day's
-- 03:35 slot and has never run. The check reports a job with no runs at all
-- as stalled ("has never run"), so that alert is expected until its first run
-- at 03:35 UTC, and closes itself at the check after it.
insert into public.cron_expectations (jobname, max_silence, note) values
  ('drain-social-queue',        interval '30 minutes', 'every minute'),
  ('drain-growth-alerts',       interval '30 minutes', 'every 2 minutes'),
  ('drain-comment-replies',     interval '30 minutes', 'every 5 minutes'),
  ('refresh-social-metrics',    interval '45 minutes', 'every 15 minutes'),
  ('feed-city-channels',        interval '90 minutes', 'every 30 minutes'),
  ('rollup-click-events',       interval '3 hours',    'hourly'),
  ('purge-social-comments',     interval '50 hours',   'daily 03:20'),
  ('purge-telegram-link-codes', interval '50 hours',   'daily 03:35'),
  ('purge-growth-events',       interval '50 hours',   'daily 03:40')
on conflict (jobname) do update
  set max_silence = excluded.max_silence, note = excluded.note;
