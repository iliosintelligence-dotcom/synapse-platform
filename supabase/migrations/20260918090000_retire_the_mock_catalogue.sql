-- RETIRE THE MOCK CATALOGUE. Greenlight is the only real agency.
--
-- 29 agencies exist and 28 of them were generated for testing — 25 on 2 July
-- as the digital twin, plus Desire Agency, Fredo & co and Mellany Homes. They
-- hold 500 of the 503 live listings, every one created on 2026-09-08, the same
-- day Desire Agency itself was created. Migration 0094 already called these
-- rows "homes that exist to be deleted after testing"; this is that deletion.
--
-- Greenlight Real estate has 3 listings, made 1–16 September by a person.
-- Those are the catalogue now.
--
-- WHY THIS IS A SOFT DELETE. deleted_at is how this schema retires a row, and
-- every read path already honours it: the properties_select_public RLS policy,
-- freshLiveConds() in toju-demo, and the portal's own queries all filter
-- `deleted_at is null`. So setting it removes these listings from search, from
-- Tayo, from the map, from the pipeline and from the bio page in one move.
--
-- It is also the version that can be undone. A hard delete has to get past
-- property_enrichment, property_media, shared_room_details, channel_interactions
-- and lead_attribution, and whichever of those cascades is the one nobody
-- predicted. Reversing this is:
--
--   update public.properties set deleted_at = null
--    where agency_id <> '9b91087b-96dd-4139-8cb5-91effc30dfc8';
--
-- is_active and status are deliberately NOT touched. is_active means "the
-- agency paused this listing" and status means where it sits in its lifecycle;
-- overloading either to mean "fake" would make both fields lie, and would make
-- the undo above guess at what they used to be.
--
-- THE GUARD MATTERS MORE THAN THE DELETE. Everything below is scoped by "not
-- Greenlight", so if that id were wrong the statement would quietly retire the
-- entire catalogue including the real listings. It therefore aborts unless the
-- agency is found first.

do $$
declare
  v_keep    uuid := '9b91087b-96dd-4139-8cb5-91effc30dfc8';  -- Greenlight Real estate
  v_name    text;
  v_props   int;
  v_ags     int;
  v_agents  int := 0;
begin
  select name into v_name from public.agencies where id = v_keep;
  if v_name is null then
    raise exception
      'Refusing to run: agency % not found. Everything here is scoped by "not this agency", '
      'so an id that does not exist would retire the whole catalogue.', v_keep;
  end if;
  raise notice 'Keeping agency % (%)', v_keep, v_name;

  update public.properties
     set deleted_at = now()
   where agency_id is distinct from v_keep
     and deleted_at is null;
  get diagnostics v_props = row_count;

  -- The agencies themselves, so none of them can appear in a picker, a
  -- leaderboard or a listing card after their homes are gone.
  update public.agencies
     set deleted_at = now()
   where id is distinct from v_keep
     and deleted_at is null;
  get diagnostics v_ags = row_count;

  -- The invented staff. Guarded on the column existing rather than assumed:
  -- this table has been reshaped before, and a migration that fails on a
  -- missing column would roll back the two updates above with it.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agent_profiles'
      and column_name = 'deleted_at'
  ) then
    execute format(
      'update public.agent_profiles set deleted_at = now()
        where agency_id is distinct from %L and deleted_at is null', v_keep);
    get diagnostics v_agents = row_count;
  end if;

  raise notice 'Retired % listing(s), % agency(ies), % agent profile(s).',
    v_props, v_ags, v_agents;
end $$;
