-- An agency could previously INSERT a row declaring itself verified: the insert
-- policy only checked agency membership, while the UPDATE policy carefully
-- prevents changing verification_status/trust_score. Verification is the whole
-- trust proposition, so it must not be self-grantable at any point — including
-- at creation. Agencies may create listings; only the platform may certify them.
drop policy if exists properties_insert_agency on public.properties;

create policy properties_insert_agency
  on public.properties
  for insert
  with check (
    is_agency_member(agency_id)
    and verification_status = 'unverified'::verification_status
    and verification_nodes = '[]'::jsonb
    and trust_score is null
    and verified_at is null
    and deleted_at is null
  );
