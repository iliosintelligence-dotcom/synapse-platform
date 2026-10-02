-- A city channel caption leads with the listing's own title.
--
-- Previewed against the four live Ibadan listings before anything posted, the
-- generated headline was wrong in two ways:
--
--   1. No area. Every one read "📍 Ibadan" -- neighbourhood_id is empty on all
--      of them, because the portal's Area field is not saved anywhere yet
--      (reported separately). The area was sitting in the title the whole time:
--      "1 bedroom student apartment, Agbowo", "... New Bodija".
--   2. It contradicted the listing. "4 Bedroom duplex in Aafin-iyanu" is filed
--      as an apartment, so the headline announced a 4-BEDROOM APARTMENT under
--      a photo of a duplex. The type field is the agent's too; the title is
--      the one they actually read back.
--
-- So the title leads, as it does on every card in the product, and the second
-- line carries only what cannot contradict it: the deal and the room counts.
-- Everything else is unchanged from 20260927150000.
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
  select pr.*, n.name as area_name, a.name as agency_name
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

  if coalesce(nullif(btrim(p.area_name), ''), nullif(btrim(p.city), '')) is not null then
    v_lines := v_lines || ('📍 ' || concat_ws(', ', nullif(btrim(p.area_name), ''), nullif(btrim(p.city), '')));
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
