-- ═══════════════════════════════════════════════════════════════════════════
-- Synapse digital-twin seed, part 5: the relationship manager.
--
-- my_relationship_manager() reads agencies.relationship_manager_id and joins
-- profiles for the name and number. Every agency had a null there, so the
-- portal's escalation panel could only ever render its unassigned state and
-- the tel: path was unreachable from real data. This gives the demo agency a
-- named Synapse contact so that path is exercised.
--
-- The manager is Synapse staff, not an agency colleague: no agency_members
-- row, and role platform_admin. That is the whole reason the RPC is SECURITY
-- DEFINER -- profiles_select_own and the agency-colleagues policy both
-- correctly refuse to show this person, and widening either to expose staff
-- would leak far more than a name and a number.
--
-- Deterministic + idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create temp table _staff on commit drop as
select md5('synapse-staff:'||v.nm)::uuid uid, v.* from (values
-- nm, number, hours
('Ngozi Balogun', '+2348155136506', 'Mon-Fri, 9am-6pm WAT')
) v(nm, num, hours);

-- encrypted_password is deliberately left null: this account exists to be
-- displayed to an agency, never to be signed into. A null hash means no
-- password can ever verify against it.
insert into auth.users (instance_id, id, aud, role, email,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
       lower(replace(nm,' ','.'))||'@synapse-staff.test',
       '{"provider":"email","providers":["email"]}',
       jsonb_build_object('role','consumer','full_name',nm), now(), now()
from _staff on conflict (id) do nothing;

-- handle_new_user() maps any unknown claimed role to 'consumer' -- platform_admin
-- is deliberately not reachable from signup metadata, which is correct. So the
-- trigger has made a consumer profile and this promotes it.
insert into profiles (id, role, full_name, phone, whatsapp)
select uid, 'platform_admin', nm, num, num
from _staff
on conflict (id) do update
  set role = excluded.role,
      full_name = excluded.full_name,
      phone = excluded.phone,
      whatsapp = excluded.whatsapp;

-- The demo agency only. Every other agency keeps a null manager and keeps
-- rendering the unassigned state, which is the honest answer for them.
update agencies a
set relationship_manager_id = s.uid,
    relationship_manager_hours = s.hours
from _staff s
where a.id = 'a6e00000-0000-4000-8000-000000000010';
