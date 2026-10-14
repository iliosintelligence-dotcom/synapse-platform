-- A LISTING STAYS LIVE FOR 21 DAYS BEFORE THE AGENCY MUST RE-LIST IT (Eden, 2026-10-14; was 14).
--
-- Four places hold the number:
--   1. properties.expires_at default            (what a new listing gets)
--   2. the listings that are live right now     (extended, so nobody is cut off a week early)
--   3. property_check_attestable                (the freshness check must agree with the window)
--   4. proximity_candidates                     (the nearby-home alerts must agree with it too)
-- The two functions are rewritten from their live definitions with 14 changed to 21, rather than copied from an
-- old migration, so nothing else in them can drift. lifecycle_due is NOT touched: its 14 days is the follow-up
-- email schedule, not the listing window.
alter table public.properties alter column expires_at set default (now() + interval '21 days');

update public.properties
   set expires_at = listed_at + interval '21 days'
 where status = 'live' and deleted_at is null and listed_at is not null
   and expires_at < listed_at + interval '21 days';

do $$
declare d text;
begin
  for d in
    select pg_get_functiondef(p.oid) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('property_check_attestable', 'proximity_candidates')
  loop
    execute replace(replace(d, '14 days', '21 days'), '14-day', '21-day');
  end loop;
end $$;

-- the caption templates promise "re-confirmed within the last 14 days"
update public.content_templates set body_pattern = replace(body_pattern, 'within the last 14 days', 'within the last 21 days')
 where body_pattern like '%within the last 14 days%';
