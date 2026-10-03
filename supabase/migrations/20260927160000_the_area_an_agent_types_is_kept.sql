-- The Area an agent types is kept.
--
-- The portal's listing form has always asked for an "Area" and never stored
-- it. properties has no area column, only neighbourhood_id, and nothing at
-- runtime ever sets that -- only the seed scripts did. So every area an agent
-- typed was dropped at the save, and the captions, the share kit and the
-- cards knew the city and not the place: "Ibadan" where the market writes
-- "Agbowo, Ibadan".
--
-- WHY A TEXT COLUMN AND NOT neighbourhood_id. Resolving the typed name to a
-- neighbourhoods row, creating one when absent, was the first choice. The
-- table rules it out:
--
--   * All 48 rows are coord_source = 'synthetic_seed', and 0048 refuses to
--     link a listing to any zone that is not 'curated'. That is deliberate:
--     the link is what would turn seed_rand flood and safety scores into
--     claims shown to buyers.
--   * lat/lon are NOT NULL, so a new row for "Agbowo" would need a coordinate
--     somebody made up -- the exact thing 0048 was written against.
--   * There is no city column and `name` is unique nationally ("Jericho
--     (Ibadan)"), so a GRA in Ilorin and a GRA in Benin cannot both exist.
--
-- So neighbourhood_id stays what 0048 made it, a link to a surveyed zone set
-- by a person, and area_name is what the agent said, theirs to edit like the
-- address. Readers prefer area_name and fall back to the linked zone's name.
--
-- The column is covered by the table-level grants every other column uses,
-- and the agency insert/update policies are row policies, so nothing else is
-- needed for the portal to write it.

alter table public.properties
  add column if not exists area_name text;

alter table public.properties drop constraint if exists properties_area_name_len;
alter table public.properties
  add constraint properties_area_name_len
  check (area_name is null or char_length(btrim(area_name)) between 1 and 120);

comment on column public.properties.area_name is
  'The area as the listing agent typed it ("Agbowo", "New Bodija"). Free text, per listing. Not a link to neighbourhoods: that is neighbourhood_id, which only a curated zone may fill (see 0048).';

-- city_channel_caption read the area as `n.name as area_name` alongside
-- `pr.*`. With a real properties.area_name that record would carry two fields
-- of the same name, and which one `p.area_name` resolved to would be an
-- accident of column order. The alias is renamed, and the agent's own word
-- comes first. Everything else is unchanged from 20260927153000.
create or replace function public.city_channel_caption(p_property_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  p        record;
  v_facts  text[] := '{}';
  v_per    text;
  v_lines  text[] := '{}';
  v_charge text[] := '{}';
  v_naira  text := chr(8358);   -- ₦
begin
  select pr.*,
         coalesce(nullif(btrim(pr.area_name), ''), n.name) as area_label,
         a.name as agency_name
    into p
    from properties pr
    left join neighbourhoods n on n.id = pr.neighbourhood_id
    left join agencies a on a.id = pr.agency_id
   where pr.id = p_property_id;
  if not found then return null; end if;

  v_lines := v_lines || ('🏡 ' || coalesce(nullif(btrim(p.title), ''), 'New listing'));

  v_facts := v_facts || (case p.listing_type::text
                           when 'rent' then 'For rent'
                           when 'shortlet' then 'Short-let'
                           else 'For sale' end);
  if coalesce(p.bedrooms, 0) > 0 then
    v_facts := v_facts || (p.bedrooms || ' bedroom' || case when p.bedrooms = 1 then '' else 's' end);
  end if;
  if coalesce(p.bathrooms, 0) > 0 then
    v_facts := v_facts || (p.bathrooms || ' bathroom' || case when p.bathrooms = 1 then '' else 's' end);
  end if;
  v_lines := v_lines || array_to_string(v_facts, ' · ');

  if coalesce(nullif(btrim(p.area_label), ''), nullif(btrim(p.city), '')) is not null then
    v_lines := v_lines || ('📍 ' || concat_ws(', ', nullif(btrim(p.area_label), ''), nullif(btrim(p.city), '')));
  end if;

  v_per := case p.price_period::text
             when 'per_year' then '/year' when 'per_month' then '/month'
             when 'per_night' then '/night' else '' end;
  if coalesce(p.price, 0) > 0 then
    v_lines := v_lines || ('💰 ' || v_naira || to_char(p.price, 'FM999,999,999,990') || v_per);
  end if;

  if coalesce(p.service_charge, 0) > 0 then
    v_charge := v_charge || ('Service charge ' || v_naira || to_char(p.service_charge, 'FM999,999,999,990'));
  end if;
  if coalesce(p.agency_fee, 0) > 0 then
    v_charge := v_charge || ('Agency fee ' || v_naira || to_char(p.agency_fee, 'FM999,999,999,990'));
  end if;
  if coalesce(p.legal_fee, 0) > 0 then
    v_charge := v_charge || ('Legal fee ' || v_naira || to_char(p.legal_fee, 'FM999,999,999,990'));
  end if;
  if array_length(v_charge, 1) > 0 then
    v_lines := v_lines || array_to_string(v_charge, ' · ');
  end if;

  if coalesce(array_length(p.amenities, 1), 0) > 0 then
    v_lines := v_lines || array_to_string(p.amenities[1:4], ' · ');
  end if;

  v_lines := v_lines || ''::text;
  if p.verification_status::text = 'verified' then
    v_lines := v_lines || '✓ Verified by Synapse'::text;
  end if;
  if p.agency_name is not null then
    v_lines := v_lines || ('Listed by ' || p.agency_name);
  end if;

  return array_to_string(v_lines, E'\n');
end;
$$;
revoke all on function public.city_channel_caption(uuid) from public, anon, authenticated;
