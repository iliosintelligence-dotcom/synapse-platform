-- properties_select_agency hid an agency's own soft-deleted rows. Combined with
-- there being no DELETE policy, that made deletion impossible by any route: the
-- soft-delete UPDATE produced a row the caller could no longer see under any
-- SELECT policy, and Postgres rejects that as an RLS violation. Confirmed by
-- probe — setting is_active/status/expires_at all succeeded, only deleted_at
-- failed, which is exactly the visibility boundary.
--
-- An agency should be able to see its own archived listings anyway: to confirm
-- a delete happened, to restore one, and to keep an audit trail. The public
-- policy is untouched, so buyers still never see deleted rows.
drop policy if exists properties_select_agency on public.properties;
create policy properties_select_agency
  on public.properties
  for select
  using (is_agency_member(agency_id));
