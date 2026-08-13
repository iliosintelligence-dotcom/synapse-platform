-- 0051_agency_relationship_manager.sql
--
-- A named human at Synapse an agency can phone.
--
-- The need is escalation: a deal that has to close today, or something going
-- wrong that a support form cannot carry. That is a phone call to a person
-- whose name you know, not a ticket.
--
-- Deliberately a `tel:` path, not a platform-mediated call. Twilio is not
-- configured, so nothing here could place or route a call -- and a dialler
-- link works from every phone with no provider at all. If calls are later
-- routed through Synapse, the number below is still the thing being dialled.
--
-- Nothing is invented. When no manager is assigned the UI says so plainly
-- rather than showing a support number that nobody answers.

alter table public.agencies
  add column if not exists relationship_manager_id uuid references public.profiles(id),
  add column if not exists relationship_manager_hours text;

comment on column public.agencies.relationship_manager_id is
  'The Synapse staff profile this agency escalates to by phone. NULL means none assigned -- the UI must say so rather than fall back to a generic number.';
comment on column public.agencies.relationship_manager_hours is
  'Free text, e.g. "Mon-Fri, 8am-6pm WAT". NULL means we make no promise about when the call will be answered.';

create index if not exists agencies_relationship_manager_idx
  on public.agencies (relationship_manager_id)
  where deleted_at is null;

-- Read path. SECURITY DEFINER because the manager is a Synapse staff member,
-- not a colleague: profiles_select_own and the agency-colleagues policy both
-- correctly refuse to show them, and widening either one to expose staff
-- profiles would leak far more than a name and a number. This returns exactly
-- the four fields the call surface needs, for the caller's own agency only.
create or replace function public.my_relationship_manager()
returns table (
  agency_id uuid,
  manager_name text,
  manager_phone text,
  hours text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id,
         p.full_name,
         coalesce(p.whatsapp, p.phone),
         a.relationship_manager_hours
  from agencies a
  left join profiles p
         on p.id = a.relationship_manager_id
        and p.deleted_at is null
  where a.deleted_at is null
    and is_agency_member(a.id)
  limit 1;
$$;

revoke all on function public.my_relationship_manager() from public, anon;
grant execute on function public.my_relationship_manager() to authenticated;

-- Verified behaviour (2026-08-13):
--   agency owner, nobody assigned   -> name NULL, phone NULL (UI shows the honest state)
--   consumer with no agency         -> 0 rows
--   agency owner, manager assigned  -> name + hours; phone NULL when that profile has none
--   consumer after assignment       -> still 0 rows
--
-- To assign one:
--   update agencies
--      set relationship_manager_id = '<staff profile id>',
--          relationship_manager_hours = 'Mon-Fri, 8am-6pm WAT'
--    where id = '<agency id>';
-- The number comes from that profile's whatsapp, falling back to phone.
