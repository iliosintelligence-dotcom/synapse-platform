-- The listings posted before 2026-10-25 get the agent who posted them.
--
-- From that day the site tags a new listing with whoever posts it
-- (listed_by_agent_id). The 12 listings already live had none, so the listing
-- page showed only the agency, and new leads on them went unassigned.
--
-- Nothing recorded who posted them, but the photos did: storage.objects.owner
-- is the account that uploaded each file. Measured before writing this: every
-- one of the 12 has photos from exactly ONE uploader, and in every case that
-- person is a current member of the listing's agency.
--
-- Only fills an empty value, and only when there is exactly one uploader who
-- is a member of the listing's agency, so it cannot guess between two people
-- and cannot overwrite a choice an agency has since made. The membership guard
-- (properties_guard_listing_agent) checks each row again. Re-running it
-- changes nothing.
with poster as (
  select pm.property_id, (array_agg(distinct o.owner))[1] as profile_id, count(distinct o.owner) as uploaders
  from public.property_media pm
  join storage.objects o
    on o.bucket_id = 'property-photos' and pm.url like '%/' || o.name
  where o.owner is not null
  group by pm.property_id
)
update public.properties p
   set listed_by_agent_id = poster.profile_id
  from poster
 where poster.property_id = p.id
   and poster.uploaders = 1
   and p.listed_by_agent_id is null
   and p.deleted_at is null
   and exists (select 1 from public.agency_members m
                where m.profile_id = poster.profile_id
                  and m.agency_id = p.agency_id
                  and m.deleted_at is null);
