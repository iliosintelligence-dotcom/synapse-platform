-- Demo seed — one verified Lekki agency + three fresh, verified listings.
-- Purpose: give Toju real inventory inside the 14-day recommendation window so
-- the consumer path can be demoed end to end before the real upload UI exists.
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING, so re-running is safe.
-- listed_at defaults to now() on insert, keeping the listings inside the window
-- as long as the seed has been run within the last 14 days.
--
-- Demo agency owner login: demo-agency@synapse.test / Synapse!Demo1
-- (auth.users insert fires handle_new_user → creates the profiles row.)

-- ── agency owner auth user (trigger creates the profile) ──
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'demo-agency@synapse.test',
  crypt('Synapse!Demo1', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"role":"agency_owner","full_name":"Lekki Prime Realty"}',
  now(), now()
) on conflict (id) do nothing;

-- ── agency + membership ──
insert into agencies (id, owner_id, name, city, address, verification_tier, whatsapp_number)
values (
  'a6e00000-0000-4000-8000-000000000010',
  'a0000000-0000-4000-8000-000000000001',
  'Lekki Prime Realty', 'Lekki', '12 Admiralty Way, Lekki Phase 1, Lagos',
  'verified', '+2348030000001'
) on conflict (id) do nothing;

insert into agency_members (agency_id, profile_id, role)
values (
  'a6e00000-0000-4000-8000-000000000010',
  'a0000000-0000-4000-8000-000000000001',
  'agency_owner'
) on conflict (agency_id, profile_id) do nothing;

-- ── verified, live listings (city = Lekki so a "Lekki" search matches) ──
-- 7-node trust report passes; trust_score set; lat/lng → location via trigger.
insert into properties (
  id, agency_id, title, description, property_type, listing_type, price, price_period,
  bedrooms, bathrooms, area_sqm, address, city, state, latitude, longitude,
  amenities, status, verification_status, trust_score, verification_nodes, is_active
) values
(
  'b0000000-0000-4000-8000-000000000101',
  'a6e00000-0000-4000-8000-000000000010',
  '2-Bedroom Apartment, Lekki Phase 1',
  'Bright, newly serviced 2-bedroom apartment in a gated estate off Admiralty Way. 24/7 power, treated water, secure parking. Walking distance to restaurants and the Lekki–Epe expressway.',
  'apartment', 'rent', 4500000, 'per_year',
  2, 2, 95, '7 Fola Osibo, Lekki Phase 1', 'Lekki', 'Lagos', 6.4474, 3.4720,
  array['gated_estate','24_7_power','treated_water','secure_parking'],
  'live', 'verified', 92,
  '[{"name":"Title","status":"pass"},{"name":"Survey","status":"pass"},{"name":"Structure","status":"pass"},{"name":"Flood","status":"pass"},{"name":"Legal","status":"pass"},{"name":"Area Intel","status":"pass"},{"name":"Media","status":"pass"}]'::jsonb,
  true
),
(
  'b0000000-0000-4000-8000-000000000102',
  'a6e00000-0000-4000-8000-000000000010',
  '3-Bedroom Terrace, Ikate (Lekki)',
  'Contemporary 3-bedroom terrace with a BQ in a small, well-managed estate in Ikate. Fitted kitchen, en-suite rooms, ample natural light. Strong rental demand in the corridor.',
  'terrace', 'sale', 165000000, 'total',
  3, 4, 210, '15 Ikate Crescent, Ikate Elegushi', 'Lekki', 'Lagos', 6.4361, 3.4810,
  array['bq','fitted_kitchen','en_suite','estate'],
  'live', 'verified', 88,
  '[{"name":"Title","status":"pass"},{"name":"Survey","status":"pass"},{"name":"Structure","status":"pass"},{"name":"Flood","status":"pass"},{"name":"Legal","status":"pass"},{"name":"Area Intel","status":"pass"},{"name":"Media","status":"pass"}]'::jsonb,
  true
),
(
  'b0000000-0000-4000-8000-000000000103',
  'a6e00000-0000-4000-8000-000000000010',
  '4-Bed Semi-Detached Duplex, Lekki Phase 1',
  'Spacious 4-bedroom semi-detached duplex with a private compound, all rooms en-suite, and a generous living area. C of O title. Ideal for a family or a long-let investor.',
  'duplex', 'sale', 250000000, 'total',
  4, 5, 320, '3 Chevron Drive, Lekki Phase 1', 'Lekki', 'Lagos', 6.4459, 3.4886,
  array['c_of_o','private_compound','all_en_suite','family'],
  'live', 'verified', 95,
  '[{"name":"Title","status":"pass"},{"name":"Survey","status":"pass"},{"name":"Structure","status":"pass"},{"name":"Flood","status":"pass"},{"name":"Legal","status":"pass"},{"name":"Area Intel","status":"pass"},{"name":"Media","status":"pass"}]'::jsonb,
  true
)
on conflict (id) do nothing;

-- ── one image per listing (Unsplash placeholders) ──
insert into property_media (property_id, url, cloudinary_public_id, media_type, display_order)
values
('b0000000-0000-4000-8000-000000000101', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80', 'seed/lekki-apartment', 'image', 0),
('b0000000-0000-4000-8000-000000000102', 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80', 'seed/ikate-terrace', 'image', 0),
('b0000000-0000-4000-8000-000000000103', 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1200&q=80', 'seed/lekki-duplex', 'image', 0)
on conflict do nothing;
