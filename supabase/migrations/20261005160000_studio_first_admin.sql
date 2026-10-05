-- Someone real can open the studio.
--
-- The only two platform_admin logins are test accounts, so nobody on the team
-- could open /app/synapse.html, and nobody could reach the Team tab to add
-- anybody. This makes the owner's own login, ilios.proxim@gmail.com (the
-- account that tried to open the studio on 2026-10-05), a studio admin.
-- A studio admin can add the social media manager from the Team tab.
--
-- Idempotent, and a no-op if that account does not exist.
insert into synapse_staff (profile_id, role)
select synapse_find_user('ilios.proxim@gmail.com'), 'admin'
where synapse_find_user('ilios.proxim@gmail.com') is not null
on conflict (profile_id) do update set role = 'admin';
