-- Pen test follow-up, 2026-10-11. inspection_slots already had row level security, but
-- one policy (slots_read: select to public using (true)) made every agency's viewing
-- slots, agent ids and internal agency_note readable by anyone. Only the portal reads
-- this table directly (as a signed-in member, covered by inspection_slots_member_read);
-- buyers book through the security-definer functions, which do not need it.
drop policy if exists slots_read on public.inspection_slots;
