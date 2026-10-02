-- Four Ibadan listings get their areas, from their own titles.
--
-- area_name is documented as "what the agent typed" (20260927160000). These
-- four were created before the Area field saved anything, so they have none,
-- and every caption built from them -- the Synapse Ibadan channel, the share
-- kit -- could say only "Ibadan". Each title already names the area in the
-- agent's own words; the owner asked (2026-09-27) for those to be filled in
-- rather than wait for each listing to be re-saved.
--
-- Keyed by id, taken word for word from the title, and only where no area is
-- set, so anything an agent has typed since is never overwritten.

update public.properties set area_name = v.area, updated_at = now()
  from (values
    ('8975b819-eecc-4154-bb3d-207c0999d286'::uuid, 'New Bodija'),
    ('07b1723b-7610-4613-9f9d-b4a041333443'::uuid, 'Behind Ace Mall'),
    ('01beeb38-e878-413a-8172-3659adb564d0'::uuid, 'Aafin-iyanu'),
    ('97aae4b9-8a66-42db-8db4-ec4c4356a9b9'::uuid, 'Agbowo')
  ) as v(id, area)
 where properties.id = v.id
   and properties.area_name is null
   and properties.deleted_at is null;
