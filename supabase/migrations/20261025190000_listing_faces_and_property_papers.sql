-- A listing shows who answers for it, and can carry the papers that verify it.
--
-- Measured 2026-10-25: 12 live listings, all with photos, 0 verified and 0 with
-- listed_by_agent_id set. Two things stood in the way, and neither was the
-- verification functions (0099-0102), which are sound.
--
-- 1. OWNERSHIP COULD NEVER PASS. ownership_validation is one of the three
--    mandatory checks, and since 0100 it needs at least one evidence URL. An
--    agency had nowhere to put a C of O or a survey plan for a listing: the
--    only document bucket is agency-documents, which is the director's ID and
--    the bank statement, owner/admin only, keyed by agency. And the desk could
--    not have read a property paper anyway: can_access_document's 'property'
--    branch admits agency members and deal-room buyers, never the platform.
--    So: a private property-documents bucket keyed by listing, writable by any
--    member of the listing's agency (agents list homes too), readable by them
--    and by the platform desk; and the desk is added to the 'property' branch.
--
-- 2. OWNERS HAD NO FACE. listing_agent_cards and agent_social_counts count
--    role 'agent' only, so an owner who lists a home (the common case in a
--    small agency) would show no portrait even once the site tags the listing
--    with its lister. Both views now include agency_owner and agency_admin.
--    The views stay column-for-column identical, so CREATE OR REPLACE keeps
--    their SELECT-only grants (20260928001207).

-- ── 1a. the bucket ──────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-documents', 'property-documents', false, 15728640,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path is <property_id>/<document_type>-<timestamp>.<ext>, so the first folder
-- names the listing, and through it the agency.
create or replace function public.can_access_property_files(p_property_id uuid, p_write boolean default false)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp' as $$
  select exists (
    select 1 from properties p
    where p.id = p_property_id
      and p.deleted_at is null
      and (is_agency_member(p.agency_id) or (not p_write and is_platform_admin()))
  );
$$;
revoke all on function public.can_access_property_files(uuid, boolean) from public, anon;
grant execute on function public.can_access_property_files(uuid, boolean) to authenticated;

-- A malformed first folder must read as "no", not as a cast error.
create or replace function public.property_folder(p_name text)
returns uuid language plpgsql immutable as $$
begin
  return ((storage.foldername(p_name))[1])::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function public.property_folder(text) to authenticated;

drop policy if exists property_documents_read on storage.objects;
create policy property_documents_read on storage.objects for select
  using (bucket_id = 'property-documents'
         and can_access_property_files(property_folder(name)));

drop policy if exists property_documents_insert on storage.objects;
create policy property_documents_insert on storage.objects for insert
  with check (bucket_id = 'property-documents'
              and can_access_property_files(property_folder(name), true));

drop policy if exists property_documents_delete on storage.objects;
create policy property_documents_delete on storage.objects for delete
  using (bucket_id = 'property-documents'
         and can_access_property_files(property_folder(name), true));

-- ── 1b. the desk can read a listing's papers ───────────────────────────────
-- The 0075 body, with only the 'property' branch extended. The platform may
-- read and supersede a property paper; it still cannot see an agency's own
-- papers or an agent's through this function.
create or replace function public.can_access_document(
  p_entity_type document_entity_type, p_entity_id uuid)
returns boolean language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $$
begin
  if p_entity_type = 'deal_room' then
    return exists (select 1 from deal_rooms d where d.id = p_entity_id
      and (d.consumer_id = auth.uid() or d.agent_id = auth.uid() or is_agency_member(d.agency_id)));
  elsif p_entity_type = 'property' then
    return exists (select 1 from properties p where p.id = p_entity_id and is_agency_member(p.agency_id))
        or exists (select 1 from deal_rooms d where d.property_id = p_entity_id and d.consumer_id = auth.uid())
        or is_platform_admin();
  elsif p_entity_type = 'agency' then
    -- Owner OR admin. Never an agent: these are the director's ID and the
    -- bank statement, not company letterhead.
    return exists (select 1 from agencies a where a.id = p_entity_id
      and (a.owner_id = auth.uid()
           or agency_role(a.id) in ('agency_admin','agency_owner')));
  elsif p_entity_type = 'agent' then
    return p_entity_id = auth.uid()
        or exists (select 1 from agency_members m where m.profile_id = p_entity_id
             and agency_role(m.agency_id) in ('agency_admin','agency_owner'));
  end if;
  return false;
end;
$$;

-- ── 2. owners and admins have a face too ───────────────────────────────────
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
  ap.certifications,
  (select count(*) from public.agent_follows f where f.agent_id = p.id) as followers,
  (select count(*) from public.agent_likes   l where l.agent_id = p.id) as likes
from public.profiles p
join public.agency_members m
  on m.profile_id = p.id and m.deleted_at is null
left join public.agent_profiles ap
  on ap.profile_id = p.id
where p.deleted_at is null
  and m.role in ('agent', 'agency_owner', 'agency_admin');

create or replace view public.agent_social_counts
with (security_invoker = false) as
 SELECT id AS agent_id,
    ( SELECT count(*) AS count
           FROM agent_follows f
          WHERE (f.agent_id = p.id)) AS followers,
    ( SELECT count(*) AS count
           FROM agent_likes l
          WHERE (l.agent_id = p.id)) AS likes
   FROM profiles p
  WHERE ((deleted_at IS NULL) AND (EXISTS ( SELECT 1
           FROM agency_members m
          WHERE ((m.profile_id = p.id) AND (m.deleted_at IS NULL)
                 AND (m.role in ('agent'::user_role, 'agency_owner'::user_role, 'agency_admin'::user_role))))));

-- ── 3. the face on a listing belongs to its agency ─────────────────────────
-- The site now tags a listing with the agent who posts it, and an owner can
-- hand it to a teammate. Without this, any member could point
-- listed_by_agent_id at any profile id and put a stranger's face (and, via
-- assign_lead_to_listing_agent, a stranger's lead routing) on a home.
create or replace function public.properties_guard_listing_agent()
returns trigger language plpgsql security definer
set search_path to 'public', 'pg_temp' as $$
begin
  if new.listed_by_agent_id is not null
     and (tg_op = 'INSERT' or new.listed_by_agent_id is distinct from old.listed_by_agent_id
          or new.agency_id is distinct from old.agency_id)
     and not exists (select 1 from agency_members m
                      where m.profile_id = new.listed_by_agent_id
                        and m.agency_id = new.agency_id
                        and m.deleted_at is null) then
    raise exception 'The listing agent must be a member of this agency'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function public.properties_guard_listing_agent() from anon, authenticated, public;

drop trigger if exists properties_guard_listing_agent on public.properties;
create trigger properties_guard_listing_agent
  before insert or update of listed_by_agent_id, agency_id on public.properties
  for each row execute function public.properties_guard_listing_agent();
