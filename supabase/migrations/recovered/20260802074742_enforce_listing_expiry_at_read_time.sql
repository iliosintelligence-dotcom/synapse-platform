-- The landing page states, three times, that a listing disappears after 14 days
-- unless re-confirmed. That was not true. `expires_at` was written on create and
-- re-list but read by nothing: no trigger, no cron, no policy. Toju's matcher
-- happened to filter on `listed_at`, so the promise held inside chat results and
-- nowhere else — Browse and every direct property URL served expired listings
-- indefinitely.
--
-- Enforcing it in the public SELECT policy makes it a view-time fact rather than
-- a job that can fail to run: it applies to Browse, property detail, and any
-- future read path automatically, with nothing to remember. Agency members keep
-- seeing their own expired rows through properties_select_agency, which is
-- exactly what re-listing requires.
--
-- Safe to apply now: 1 buyer-visible listing, 0 with a null expiry, 0 already
-- past it — verified immediately before this migration.

-- 1. A listing can no longer exist without a window. Previously the column was
--    nullable with no default, so anything created outside the agency client
--    (direct API, import, seed) would have been exempt from expiry forever.
alter table public.properties
  alter column expires_at set default (now() + interval '14 days');

update public.properties
   set expires_at = coalesce(listed_at, created_at, now()) + interval '14 days'
 where expires_at is null;

alter table public.properties
  alter column expires_at set not null;

-- 2. Expiry now actually hides the listing from buyers.
drop policy if exists properties_select_public on public.properties;
create policy properties_select_public
  on public.properties
  for select
  using (
    deleted_at is null
    and is_active = true
    and status = 'live'::property_status
    and expires_at > now()
  );

comment on column public.properties.expires_at is
  'When this listing stops being visible to buyers. Enforced by properties_select_public at read time, not by a job. Re-listing pushes it 14 days out (see freshWindow() in app/agency-listings.js). The 14-day promise on the landing page depends on this clause.';
