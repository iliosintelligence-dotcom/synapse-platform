-- property_media_select required the parent property to be VERIFIED before
-- anyone outside the agency could see its photos. That matched the old rule
-- where only verified homes were ever shown. The rule is now: show every live
-- listing and state its verification status, so the buyer decides. Under the
-- old policy an unverified listing rendered with no photos at all, which reads
-- as a broken listing rather than an unchecked one — and a buyer judging
-- whether to take that risk needs to see the home.
--
-- Verification still gates nothing here except the CLAIM of verification,
-- which lives on the listing itself.
drop policy if exists property_media_select on public.property_media;

create policy property_media_select
  on public.property_media
  for select
  using (
    deleted_at is null
    and exists (
      select 1 from public.properties p
      where p.id = property_media.property_id
        and p.deleted_at is null
        and (
          (p.is_active and p.status = 'live'::property_status)
          or is_agency_member(p.agency_id)
        )
    )
  );
