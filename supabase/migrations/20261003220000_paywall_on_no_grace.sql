-- The paywall is on, for everyone, with no free period.
--
-- DECISION (Eden, 2026-10-03): scrap "free until". Nobody gets a grace
-- period, whether they joined before or after the switch-on. An agency over
-- its plan's limit keeps what it has; the limit only stops it adding more
-- (see enforce_listing_limit).
create or replace function agency_free_until(p_agency_id uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select null::timestamptz;
$$;

update platform_settings
   set value = value || jsonb_build_object('existing_free_days', 0), updated_at = now()
 where key = 'paywall_enabled' and jsonb_typeof(value) = 'object';

select set_paywall(true);
