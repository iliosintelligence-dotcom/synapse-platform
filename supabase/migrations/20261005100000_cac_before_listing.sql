-- Partial verification before an agency can list.
--
-- DECISION (Eden, 2026-10-05): an agency must show SOMETHING before it starts
-- uploading listings. The easiest document to ask for is the CAC certificate,
-- so that is the one. Submitting it is enough: the verification desk reviews
-- it afterwards, so the gate is "has submitted", not "has been approved".
--
-- An agency may list when ANY of these holds:
--   * it has a current CAC certificate on file (the new, normal way in);
--   * the verification desk has already reviewed or verified it (documents
--     reviewed, CAC verified, or any tier above unverified in either place),
--     so a verified agency is never asked again.
--
-- The database is the lock; the portal asks the same question first
-- (agency_listing_gate) so the person is told before they fill the form in.
-- Service-role and direct database writes (seeds, imports, the CRM's own
-- jobs) are not the agency uploading and pass through.

create or replace function agency_may_list(p_agency_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from documents d
             where d.entity_type = 'agency' and d.entity_id = p_agency_id
               and d.document_type = 'cac_certificate'
               and d.deleted_at is null and d.is_current)
    or exists (select 1 from agency_verifications v
                where v.agency_id = p_agency_id and v.deleted_at is null
                  and (v.documents_reviewed or v.cac_verified
                       or v.current_tier <> 'unverified'))
    or exists (select 1 from agencies a
                where a.id = p_agency_id and a.verification_tier <> 'unverified');
$$;
revoke all on function agency_may_list(uuid) from public, anon, authenticated;
grant execute on function agency_may_list(uuid) to service_role;

-- What the portal asks. Members only.
create or replace function agency_listing_gate(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_agency_member(p_agency_id) then
    raise exception 'Not a member of this agency' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'ok', agency_may_list(p_agency_id),
    'can_fix', coalesce(agency_role(p_agency_id)::text, '') in ('agency_owner', 'agency_admin'));
end;
$$;
revoke all on function agency_listing_gate(uuid) from public, anon;
grant execute on function agency_listing_gate(uuid) to authenticated;

create or replace function enforce_listing_verification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if agency_may_list(new.agency_id) then return new; end if;
  raise exception 'Add your CAC certificate before you add listings. It takes a minute, and you can start listing as soon as it is uploaded.'
    using errcode = 'check_violation',
          hint = 'Get verified in the portal takes the upload.';
end;
$$;

drop trigger if exists properties_enforce_verification on properties;
create trigger properties_enforce_verification
  before insert on properties
  for each row execute function enforce_listing_verification();
