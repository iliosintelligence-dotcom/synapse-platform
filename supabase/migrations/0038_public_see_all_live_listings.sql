-- Verification is a trust SIGNAL, not a publishing gate. Public can see any
-- live, active, non-deleted listing; the app shows its verification status so
-- buyers know exactly what has and hasn't been checked. Draft/sold/archived
-- and soft-deleted rows stay hidden.
drop policy if exists properties_select_public on properties;
create policy properties_select_public on properties for select to public
using (deleted_at is null and is_active = true and status = 'live'::property_status);
