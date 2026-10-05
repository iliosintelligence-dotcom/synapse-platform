-- What kind of deal a listing is, said in fields instead of in prose.
--
-- Eden, 2026-10-02: agencies "keep typing long descriptions that can't be
-- used to do anything" -- how many units are left, whether the house is built
-- yet, whether it can be paid in instalments, whether it is an investment.
-- None of that could be filtered, shown on a card, or reasoned about by Tayo.
-- And "do not allow agents to add a listing without address or location ...
-- in Nigeria every property has an address".
--
-- listing_type (sale / rent / shortlet) stays: everything that already reads
-- it keeps working. deal_structure says HOW the deal is done, and the portal
-- keeps listing_type in step with it (lease -> rent; off-plan, joint venture,
-- development financing, rent-to-own -> sale).
--
-- The deals are the ones Nigerian agencies actually list:
--   outright               buy a finished property, full price, title transfers
--   rent                   yearly tenancy (advance rent is the norm)
--   shortlet               nights or weeks, furnished
--   lease                  a long lease, usually commercial or land
--   off_plan               buy before it is built: deposit, then payments tied
--                          to construction milestones, handover on completion
--   joint_venture          a landowner and a developer share the development
--   development_financing  investors fund a build and are repaid or share in it
--   rent_to_own            rent now, with rent counting towards buying
--
-- Every field is optional at the database: an agency may genuinely not know a
-- handover date. The portal asks for what applies to the deal chosen.

alter table properties
  add column if not exists deal_structure         text,
  add column if not exists build_stage            text,
  add column if not exists handover_date          date,
  add column if not exists build_progress_pct     smallint,
  add column if not exists payment_plan           text,
  add column if not exists deposit_pct            numeric(5,2),
  add column if not exists instalment_months      smallint,
  add column if not exists units_available        integer,
  add column if not exists plot_count             numeric(8,2),
  add column if not exists plot_size_sqm          numeric(10,2),
  add column if not exists min_investment         numeric(14,2),
  add column if not exists investment_term_months smallint,
  add column if not exists stated_return_pct      numeric(5,2);

alter table properties drop constraint if exists properties_deal_structure_check;
alter table properties add constraint properties_deal_structure_check check (deal_structure is null or deal_structure in
  ('outright', 'rent', 'shortlet', 'lease', 'off_plan', 'joint_venture', 'development_financing', 'rent_to_own'));
alter table properties drop constraint if exists properties_build_stage_check;
alter table properties add constraint properties_build_stage_check check (build_stage is null or build_stage in
  ('completed', 'under_construction', 'not_started'));
alter table properties drop constraint if exists properties_payment_plan_check;
alter table properties add constraint properties_payment_plan_check check (payment_plan is null or payment_plan in
  ('outright', 'instalments'));
alter table properties drop constraint if exists properties_deal_numbers_check;
alter table properties add constraint properties_deal_numbers_check check (
  (build_progress_pct is null or build_progress_pct between 0 and 100)
  and (deposit_pct is null or deposit_pct between 0 and 100)
  and (instalment_months is null or instalment_months between 1 and 240)
  and (units_available is null or units_available between 1 and 10000)
  and (plot_count is null or plot_count > 0)
  and (plot_size_sqm is null or plot_size_sqm > 0)
  and (min_investment is null or min_investment > 0)
  and (investment_term_months is null or investment_term_months between 1 and 600)
  and (stated_return_pct is null or stated_return_pct between 0 and 1000)
);

/* What the listings already say, carried over so nothing reads as blank. */
update properties set deal_structure = case listing_type::text
    when 'rent' then 'rent' when 'shortlet' then 'shortlet' else 'outright' end
 where deal_structure is null;
update properties set build_stage = 'completed'
 where build_stage is null and property_type::text <> 'land';

create index if not exists idx_properties_deal on properties (deal_structure) where deleted_at is null;

-- ── a live listing has an address and a pin ─────────────────────────────
/* Checked when a listing is live (is_active) and a person is writing it --
   our own jobs (expiry, geocoding, support) are not stopped. A draft can be
   saved half-done; it cannot be shown to buyers half-located. */
create or replace function require_listing_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.deleted_at is not null or new.is_active is not true then return new; end if;
  if length(trim(coalesce(new.address, ''))) < 5 then
    raise exception 'A live listing needs its street address.'
      using errcode = 'check_violation',
            hint = 'Type the street and number or the estate, then place the pin.';
  end if;
  if new.latitude is null or new.longitude is null then
    raise exception 'A live listing needs its pin on the map.'
      using errcode = 'check_violation',
            hint = 'Place the pin on the map in the listing form, or use your current location at the property.';
  end if;
  return new;
end;
$$;

drop trigger if exists properties_require_location on properties;
create trigger properties_require_location
  before insert or update of address, latitude, longitude, is_active, deleted_at on properties
  for each row execute function require_listing_location();
