-- PENETRATION TEST FOLLOW-UP, 2026-10-11. Three exposures found by probing as an anonymous
-- and as a signed-in visitor.
--
-- 1. handoff_phone_for(agent, agency) had no permission check and was callable by anyone, so
--    anyone who knew an agency id (they are public) could read its owner's phone number
--    (11 owners have one stored). Now server-side only.
--
-- 2. agencies: a signed-in BUYER could read every agency's cac_number, whatsapp_number, plan
--    and paid-through date, relationship manager and referral code. Signed-in users now get
--    only the public columns (plus owner_id, which a storage policy needs); an agency's own
--    private fields come back through agency_private(), members only.
--
-- 3. properties: the exact street address and coordinates of every listing were public. The
--    public columns now hold a GENERALISED address (house/plot/flat number removed) and
--    coordinates rounded to 3 decimals (about 100 m). The exact values live in
--    property_private, readable by the owning agency's members only (agency_property_exact).
--    Pages keep working unchanged because they still read the same columns; the agency portal
--    overlays the exact values for its own listings.

-- 1 -------------------------------------------------------------------------------------
revoke execute on function public.handoff_phone_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.handoff_phone_for(uuid, uuid) to service_role;

-- 2 -------------------------------------------------------------------------------------
revoke select on public.agencies from authenticated;
grant select (id, owner_id, name, logo_url, logo_dark_url, verification_tier, city, address, description,
              brand_color, brand_color_secondary, brand_font, brand_voice, tagline, founded_year,
              specialties, avg_response_minutes, rating, closed_deals, business_hours, social,
              created_at, updated_at, deleted_at)
  on public.agencies to authenticated;

create or replace function public.agency_private(p_agency uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_agency_member(p_agency) then
    raise exception 'Not a member of this agency' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
            'whatsapp_number', a.whatsapp_number,
            'subscription_tier', a.subscription_tier,
            'subscription_current_period_end', a.subscription_current_period_end,
            'referral_code', a.referral_code,
            'cac_number', a.cac_number)
          from agencies a where a.id = p_agency);
end;
$$;
revoke all on function public.agency_private(uuid) from public, anon;
grant execute on function public.agency_private(uuid) to authenticated, service_role;

-- 3 -------------------------------------------------------------------------------------
-- Remove a leading house/plot/flat number: "12 Adeoyo Road" -> "Adeoyo Road",
-- "Plot 5B, Bodija" -> "Bodija". Ordinals like "3rd Avenue" are left alone.
create or replace function public.public_address(a text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(nullif(btrim(regexp_replace(coalesce(a, ''),
    '^\s*(?:(?:(?:plot|block|flat|house|no|number|unit|suite|shop|room)\.?\s*[a-z]?\d+[a-z]?(?![a-z])|\d+[a-z]?(?![a-z])(?:\s*[-/]\s*\d+[a-z]?(?![a-z]))?)\s*[,.\-]?\s*)+',
    '', 'i')), ''), case when btrim(coalesce(a, '')) = '' then null else 'Full address shared on enquiry' end);
$$;

create table if not exists public.property_private (
  property_id uuid primary key references public.properties(id) on delete cascade deferrable initially deferred,
  address     text,
  latitude    double precision,
  longitude   double precision,
  updated_at  timestamptz not null default now()
);
alter table public.property_private enable row level security;
drop policy if exists property_private_member_read on public.property_private;
create policy property_private_member_read on public.property_private
  for select to authenticated
  using (exists (select 1 from public.properties p where p.id = property_id and public.is_agency_member(p.agency_id)));
revoke all on public.property_private from anon;

create or replace function public.properties_split_exact()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  addr_changed boolean; pin_changed boolean;
begin
  if coalesce(current_setting('synapse.skip_split', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    addr_changed := new.address is not null;
    pin_changed := new.latitude is not null or new.longitude is not null;
  else
    addr_changed := new.address is distinct from old.address;
    pin_changed := new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude;
  end if;
  if addr_changed or pin_changed then
    insert into property_private (property_id, address, latitude, longitude)
      values (new.id, case when addr_changed then new.address end,
                      case when pin_changed then new.latitude end,
                      case when pin_changed then new.longitude end)
      on conflict (property_id) do update set
        address   = case when addr_changed then excluded.address   else property_private.address   end,
        latitude  = case when pin_changed  then excluded.latitude  else property_private.latitude  end,
        longitude = case when pin_changed  then excluded.longitude else property_private.longitude end,
        updated_at = now();
    if addr_changed then new.address := public_address(new.address); end if;
    if pin_changed then
      new.latitude  := round(new.latitude::numeric, 3);
      new.longitude := round(new.longitude::numeric, 3);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists properties_00_split_exact on public.properties;
create trigger properties_00_split_exact before insert or update on public.properties
  for each row execute function public.properties_split_exact();

-- The agency portal's view of its own exact values.
create or replace function public.agency_property_exact(p_agency uuid)
returns table (property_id uuid, address text, latitude double precision, longitude double precision)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_agency_member(p_agency) then
    raise exception 'Not a member of this agency' using errcode = '42501';
  end if;
  return query
    select pp.property_id, pp.address, pp.latitude, pp.longitude
      from property_private pp join properties p on p.id = pp.property_id
     where p.agency_id = p_agency;
end;
$$;
revoke all on function public.agency_property_exact(uuid) from public, anon;
grant execute on function public.agency_property_exact(uuid) to authenticated, service_role;

-- Backfill: keep today's exact values private, publish the generalised ones. The trigger that
-- re-surveys a listing when its pin moves is switched off for this one pass (rounding is not
-- the pin moving, and re-surveying every listing would throw away the stored places and queue
-- every one for paid enrichment again).
set local synapse.skip_split = 'on';
alter table public.properties disable trigger properties_queue_enrichment;
alter table public.properties disable trigger properties_require_location;
insert into public.property_private (property_id, address, latitude, longitude)
  select id, address, latitude, longitude from public.properties
  on conflict (property_id) do nothing;
update public.properties
   set address   = public_address(address),
       latitude  = round(latitude::numeric, 3),
       longitude = round(longitude::numeric, 3)
 where address is not null or latitude is not null;
alter table public.properties enable trigger properties_queue_enrichment;
alter table public.properties enable trigger properties_require_location;
set local synapse.skip_split = 'off';

-- DRYRUN-BEGIN: report, then roll everything back. Remove this block to apply for real.
do $$
declare n1 bigint; n2 bigint; n3 bigint; n4 bigint; samp text; ctrl bigint;
begin
  select count(*) into n1 from properties;
  select count(*) into n2 from property_private;
  select count(*) into n3 from properties p join property_private pp on pp.property_id = p.id where p.address is distinct from pp.address;
  select count(*) into n4 from properties p join property_private pp on pp.property_id = p.id where p.latitude is distinct from pp.latitude;
  select string_agg(coalesce(p.address, 'NULL'), ' | ') into samp from (select address from properties where address is not null limit 6) p;
  select count(*) into ctrl from property_places;
  raise exception 'DRYRUN properties=% private=% address_generalised=% pin_rounded=% property_places_kept=% sample public addresses: %',
    n1, n2, n3, n4, ctrl, samp;
end $$;
-- DRYRUN-END
