-- ── A tier is a claim, and these agencies have not earned one ─────────────
-- The seeded agencies shipped as 'gold', 'verified' and 'basic'. Same problem
-- as the listings: agency_verifications is empty, so nothing supports any of
-- it, and verification_tier is what a buyer sees on an agency's public page.
-- They seed as 'unverified' now. The tier is the verification desk's to give.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000','d0000000-0000-4000-8000-000000000001','authenticated','authenticated','seed-owner@synapse.test',crypt('Synapse!Seed1', gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{"role":"agency_owner","full_name":"Synapse Seed Holdings"}',now(),now())
on conflict (id) do nothing;
insert into agencies (id, owner_id, name, city, verification_tier, whatsapp_number, address) values ('a6e10000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','Lagos Prime Realty','Lagos','unverified','+2348030000101','Lagos, Nigeria') on conflict (id) do nothing;
insert into agencies (id, owner_id, name, city, verification_tier, whatsapp_number, address) values ('a6e10000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000001','Abuja Property Hub','Abuja','unverified','+2348030000102','Abuja, Nigeria') on conflict (id) do nothing;
insert into agencies (id, owner_id, name, city, verification_tier, whatsapp_number, address) values ('a6e10000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001','Coastal Homes PH','Port Harcourt','unverified','+2348030000103','Port Harcourt, Nigeria') on conflict (id) do nothing;
insert into agencies (id, owner_id, name, city, verification_tier, whatsapp_number, address) values ('a6e10000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000001','Heartland Estates','Enugu','unverified','+2348030000104','Enugu, Nigeria') on conflict (id) do nothing;
insert into agencies (id, owner_id, name, city, verification_tier, whatsapp_number, address) values ('a6e10000-0000-4000-8000-000000000005','d0000000-0000-4000-8000-000000000001','Sahel Realty','Kaduna','unverified','+2348030000105','Kaduna, Nigeria') on conflict (id) do nothing;
insert into agencies (id, owner_id, name, city, verification_tier, whatsapp_number, address) values ('a6e10000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','Southwest Homes','Ibadan','unverified','+2348030000106','Ibadan, Nigeria') on conflict (id) do nothing;
insert into neighbourhoods (id, name, area_zone, lat, lon) values
('a4b160bb-2ad3-5426-ab57-1f4d2b0294f4','Peter Odili Road (Port Harcourt)','Rivers',4.83132,7.03508),
('c4c919b1-fa4e-5893-a2b6-fe3f3dbce054','Barnawa (Kaduna)','Kaduna',10.52732,7.44758),
('77b2e17d-db19-5881-ae00-7eca1794ae1f','Trans Amadi (Port Harcourt)','Rivers',4.8106,7.03684),
('3cb6288b-dbfb-5b80-94a0-a20f4e96dda6','Laderin (Abeokuta)','Ogun',7.15122,3.32862),
('0fa8901c-22eb-5e41-be05-f04eacf97217','Magodo (Lagos)','Lagos',6.50564,3.39884),
('cf983d52-aa04-5ded-913c-42f7582ea618','Wuse 2 (Abuja)','FCT',9.06054,7.38712),
('fc2ca448-3ac1-5917-922c-8d67ca19435b','Ugbowo (Benin City)','Edo',6.32468,5.61346),
('4c4baeed-49db-507f-923d-ac7b96ebee9e','Rayfield (Jos)','Plateau',9.90522,8.84298),
('2b18a7da-ff65-579e-93de-860d87efb479','State Housing (Calabar)','Cross River',4.98826,8.3403),
('1837df4b-5391-5e22-abdf-0a32ca58b68d','Victoria Island (Lagos)','Lagos',6.5146,3.3642),
('f0ee7bfa-113d-5736-8ae1-1b033b85ed70','Lugbe (Abuja)','FCT',9.06266,7.4082),
('ab41bd10-4411-5bce-a82c-7713614d841d','Tarauni (Kano)','Kano',12.01796,8.57252),
('b2b9ad83-602e-5139-81d6-81838dfde099','GRA Ilorin (Ilorin)','Kwara',8.49316,4.52926),
('df0b7588-bee2-575e-8c5b-568db783eeea','Rumuodara (Port Harcourt)','Rivers',4.82476,7.06848),
('58699d95-8da4-5782-a832-bf7344569730','Sangotedo (Lagos)','Lagos',6.54392,3.3692),
('7bc049d5-9be0-517e-8761-85fbbc99ece7','Yaba (Lagos)','Lagos',6.50624,3.36244),
('0daad7cd-1f57-58e7-b042-1498aa6e0ce2','Ikoyi (Lagos)','Lagos',6.52928,3.36664),
('cac5e5c8-6e31-5c1b-b1b7-15db9e802209','Jericho (Ibadan)','Oyo',7.38184,3.93184),
('a307f080-4687-5e09-96f7-517857eb3617','Apo (Abuja)','FCT',9.07038,7.3858),
('83405e0b-6bbd-58d2-b246-ec37540a98c7','Epe (Lagos)','Lagos',6.50496,3.38132),
('11635143-aded-5579-ab37-7bb0b1bf9309','Gwarinpa (Abuja)','FCT',9.07498,7.40884),
('328bbca0-cad8-5ee2-a8c4-3175e399dbf2','Asokoro (Abuja)','FCT',9.06858,7.40436),
('77ec9a10-e927-523d-a0c4-1b018eb6b8ee','Surulere (Lagos)','Lagos',6.51868,3.36296),
('cae56119-7ddb-5432-bbb9-efea593b370e','Okpanam Road (Asaba)','Delta',6.19964,6.7392),
('ca366676-b06b-5a9a-a228-ca2244379880','Life Camp (Abuja)','FCT',9.06022,7.38076),
('899a54c1-b3e3-5ccf-a62f-87212ff5dd8b','Aroma (Awka)','Anambra',6.19226,7.05746),
('f8fd303b-439d-5aeb-80a5-4e5d3e6c7542','Oluyole (Ibadan)','Oyo',7.3588,3.9432),
('0c04d985-bc5e-5161-a1dd-d55a4b69304b','New Haven (Enugu)','Enugu',6.45148,7.53572),
('2550d444-af18-5c0a-abb2-32919fb39f5d','Ajilosun (Ado-Ekiti)','Ekiti',7.6393,5.20316),
('41c1edf1-03ce-5518-8be3-3ea2845c574f','Jabi (Abuja)','FCT',9.07766,7.38784),
('ba9893f5-2905-5d22-80e9-a117dd2f561f','Sango Ota (Ota)','Ogun',6.69636,3.23176),
('1679008e-812d-5f62-a618-6e2f3a8b5a57','Independence Layout (Enugu)','Enugu',6.4398,7.52964),
('41bb6aee-d7ff-5316-8511-4e1ec90dae03','GRA Osogbo (Osogbo)','Osun',7.77998,4.56204),
('e102d27b-e4c6-5384-8807-9251d0ae1c61','Ajah (Lagos)','Lagos',6.52912,3.3926),
('4f5dd875-c32e-585b-b5be-dd81e18dbf5c','Mowe (Mowe-Ofada)','Ogun',6.83118,3.44778),
('f8951c2a-a39d-5d04-b554-cdbde0bb1903','Ikeja GRA (Lagos)','Lagos',6.53732,3.39488),
('e870d75b-c739-5f4e-879e-f22b9d4582d6','Effurun GRA (Warri)','Delta',5.50406,5.75396),
('636b51ec-fe6e-5b50-86d8-851a68ec07d3','GRA Onitsha (Onitsha)','Anambra',6.17982,6.78662),
('dc015032-1d98-515d-8876-6bb61c647dfc','Nasarawa GRA (Kano)','Kano',11.98964,8.59064),
('95a64364-f5f4-560e-9ac3-1e75c4e636da','GRA Benin (Benin City)','Edo',6.33524,5.59602)
on conflict (id) do nothing;
