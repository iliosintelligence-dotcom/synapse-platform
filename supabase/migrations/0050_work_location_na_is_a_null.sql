-- 0050_work_location_na_is_a_null.sql
--
-- `work_location = 'n/a'` on 7 of 24 profiles.
--
-- It is a null wearing a costume. The column was doing two jobs -- "where is
-- this person's work anchor" and "have we asked yet" -- so someone needed a
-- not-null way to say "asked, and there is no anchor", and wrote the string
-- 'n/a'. The result is a column that is populated and useless: it cannot be
-- used to derive a commute, and it cannot be distinguished from a real answer
-- without string-matching.
--
-- Split properly. NULL means no anchor. `work_arrangement` already carries
-- whether someone is remote, so nothing is lost by nulling the string -- a
-- remote worker with no anchor is a complete, valid profile, not a gap.

update public.consumer_profiles
   set work_location = null
 where btrim(lower(coalesce(work_location, ''))) in ('n/a', 'na', 'none', '-');

-- Stop the costume coming back.
alter table public.consumer_profiles
  drop constraint if exists consumer_profiles_work_location_not_placeholder;

alter table public.consumer_profiles
  add constraint consumer_profiles_work_location_not_placeholder
  check (
    work_location is null
    or btrim(lower(work_location)) not in ('n/a', 'na', 'none', 'nil', '-', '')
  );

comment on column public.consumer_profiles.work_location is
  'The person''s work ANCHOR, used to reason about commute. NULL means there is no anchor (remote, unemployed, student) or we have not asked -- never a placeholder string; a CHECK constraint rejects "n/a" and friends. Whether they are remote lives in work_arrangement.';

-- Verified after running (2026-08-13):
--   rows with 'n/a'      7 -> 0
--   rows with NULL            7
--   constraint present        yes
