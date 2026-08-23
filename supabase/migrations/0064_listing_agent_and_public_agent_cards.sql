-- Applied to the live project on 2026-08-23. Kept here so the schema change
-- lives in the repo rather than only in the database.
--
-- Direction: agency brand, named agent. The agency brands the listing; a named
-- person answers for it.

-- 1. A listing has a listing agent. Nullable: a listing without one falls back
--    to the agency-only card the page showed before.
alter table public.properties
  add column if not exists listed_by_agent_id uuid references public.profiles(id);

create index if not exists properties_listed_by_agent_idx
  on public.properties (listed_by_agent_id)
  where listed_by_agent_id is not null;

-- 2. The public face of an agent.
--    profiles RLS is own-or-colleague, so a buyer can read no profile row at
--    all. A row-level policy cannot solve this: RLS gates rows, not columns, so
--    any policy wide enough for a buyer to see full_name also hands them phone
--    and whatsapp. A view gives column-level control instead.
--    Deliberately absent: phone, whatsapp, role, timestamps.
create or replace view public.listing_agent_cards
with (security_invoker = false) as
select
  p.id                    as agent_id,
  m.agency_id             as agency_id,
  p.full_name,
  p.avatar_url,
  ap.bio,
  ap.years_experience,
  ap.languages,
  ap.specializations,
  ap.areas_covered,
  ap.response_rate_pct,
  ap.closed_deals,
  ap.avg_rating,
  ap.certifications
from public.profiles p
join public.agency_members m
  on m.profile_id = p.id and m.deleted_at is null
left join public.agent_profiles ap
  on ap.profile_id = p.id
where p.deleted_at is null
  and m.role = 'agent';

grant select on public.listing_agent_cards to anon, authenticated;

-- 3. Route a new lead to the listing's agent.
--    In the database rather than in create-lead so it holds for every insert
--    path and needs no deploy. Only ever fills a null.
create or replace function public.assign_lead_to_listing_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_agent_id is null and new.property_id is not null then
    select pr.listed_by_agent_id into new.assigned_agent_id
    from public.properties pr
    where pr.id = new.property_id;
  end if;
  return new;
end;
$$;

-- A trigger function has no business being callable over /rest/v1/rpc. The
-- trigger itself is unaffected: triggers do not go through EXECUTE grants.
revoke execute on function public.assign_lead_to_listing_agent() from anon, authenticated, public;

drop trigger if exists leads_assign_listing_agent on public.leads;
create trigger leads_assign_listing_agent
  before insert on public.leads
  for each row execute function public.assign_lead_to_listing_agent();
