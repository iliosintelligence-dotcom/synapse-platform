-- PENETRATION TEST, 2026-10-11: what an anonymous visitor (the public key every page
-- ships) could read. Three things were wider than they should be.
--
-- 1. agencies: the whole row was public, including owner_id (the owner's account id),
--    cac_number, whatsapp_number, subscription_tier and its paid-through date,
--    relationship_manager_*, and referral_code. The public pages only ever ask for the
--    public columns (name, logo, brand, city, description, rating...), so anon is now
--    limited to exactly those. Signed-in members are unchanged (the portal needs the
--    rest); see the report for the remaining signed-in exposure.
--
-- 2. inspection_slots: no row level security at all, so anyone could read every
--    agency's viewing slots and agency_note. Now on: agency members read their own;
--    everything else goes through the security-definer booking functions as before.
--
-- 3. content_templates, task_templates: internal agency working data, readable by
--    anyone. The portal reads them signed in, so anon loses access.

alter table public.inspection_slots enable row level security;
drop policy if exists inspection_slots_member_read on public.inspection_slots;
create policy inspection_slots_member_read on public.inspection_slots
  for select to authenticated using (public.is_agency_member(agency_id));

revoke select on public.agencies from anon;
grant select (id, name, logo_url, logo_dark_url, verification_tier, city, address, description,
              brand_color, brand_color_secondary, brand_font, tagline, founded_year, specialties,
              avg_response_minutes, rating, closed_deals, business_hours, social,
              created_at, updated_at, deleted_at)
  on public.agencies to anon;

revoke select on public.content_templates from anon;
revoke select on public.task_templates from anon;
