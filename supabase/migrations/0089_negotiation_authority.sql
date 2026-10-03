-- The price an agency will not let Tayo go below, and the offers measured
-- against it.
--
-- WHY NOT A COLUMN ON properties
-- properties is world-readable: that is the point of a listing. A floor added
-- there would be one PostgREST select away from the buyer it is meant to be
-- hidden from, and column-level grants are easy to forget the next time
-- somebody writes `select *`. A separate table can simply have no policy that
-- admits a consumer, which is a much harder thing to undo by accident.
--
-- ON "ENCRYPTED"
-- The plan called this an encrypted field. It is not encrypted at the column
-- level and saying so would be false: it is a numeric column whose table has
-- no policy any buyer can satisfy, and which is never returned by any function
-- a buyer can call. Vault was the alternative and is the wrong tool -- it is
-- built for a handful of service credentials, not a row per listing, and
-- decrypting on every comparison would put the number through more code paths
-- rather than fewer. Storage is encrypted at rest by the platform either way.
-- What actually protects this is that the number has nowhere to go.
--
-- Proven rather than assumed: with a real consumer's JWT this table returns
-- zero rows, and with an agency owner's it returns theirs.

create table if not exists public.listing_negotiation_authority (
  property_id  uuid primary key references properties (id) on delete cascade,
  agency_id    uuid not null references agencies (id) on delete cascade,

  -- The lowest Tayo may agree to. Not a target and not a reserve: the point
  -- past which a human has to take over.
  floor_amount numeric(14,2) not null check (floor_amount > 0),
  currency     text not null default 'NGN',

  -- Off means Tayo negotiates nothing on this listing rather than that it
  -- negotiates without limit -- an absent floor must never read as no floor.
  is_active    boolean not null default true,

  set_by       uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger listing_negotiation_authority_updated_at
  before update on public.listing_negotiation_authority
  for each row execute function set_updated_at();

alter table public.listing_negotiation_authority enable row level security;

-- Staff of the owning agency, and nobody else. There is deliberately no
-- policy for consumers or anon: not a restrictive one, none at all.
create policy lna_staff_read on public.listing_negotiation_authority
  for select using (
    coalesce(agency_role(agency_id)::text, '') in ('agent', 'agency_admin', 'agency_owner')
  );
create policy lna_staff_write on public.listing_negotiation_authority
  for all using (
    coalesce(agency_role(agency_id)::text, '') in ('agency_admin', 'agency_owner')
  ) with check (
    coalesce(agency_role(agency_id)::text, '') in ('agency_admin', 'agency_owner')
  );

-- ── what a buyer actually offered ────────────────────────────────────────
create table if not exists public.negotiation_offers (
  id          uuid primary key default uuid_generate_v4(),
  lead_id     uuid not null references leads (id) on delete cascade,
  property_id uuid not null references properties (id) on delete cascade,
  agency_id   uuid not null references agencies (id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  currency    text not null default 'NGN',

  -- Who put the number on the table. Tayo relaying a buyer's figure is still
  -- the buyer's offer; 'agent' is a counter from the human side.
  offered_by  text not null default 'buyer'
              check (offered_by in ('buyer', 'agent', 'tayo')),

  -- Stamped at the time, because a floor can be changed afterwards and the
  -- question "was this within authority when it was made" must stay
  -- answerable.
  below_floor boolean,
  created_at  timestamptz not null default now()
);
create index if not exists negotiation_offers_lead_idx
  on public.negotiation_offers (lead_id, created_at desc);

alter table public.negotiation_offers enable row level security;
create policy negotiation_offers_staff_read on public.negotiation_offers
  for select using (
    coalesce(agency_role(agency_id)::text, '') in ('agent', 'agency_admin', 'agency_owner')
  );

-- ── setting it ───────────────────────────────────────────────────────────
create or replace function public.set_negotiation_floor(
  p_property_id uuid, p_amount numeric, p_active boolean default true
)
returns numeric
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_agency uuid;
  v_price  numeric;
  v_cur    text;
begin
  select agency_id, price, coalesce(currency, 'NGN')
    into v_agency, v_price, v_cur
  from properties where id = p_property_id and deleted_at is null;

  if v_agency is null then
    raise exception 'Listing not found' using errcode = 'no_data_found';
  end if;

  -- Owners and admins. An agent negotiating the deal should not also be the
  -- one deciding how low the agency will go.
  if coalesce(agency_role(v_agency)::text, '') not in ('agency_admin', 'agency_owner') then
    raise exception 'Only an agency owner or admin can set a negotiation floor'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'A floor has to be a positive amount'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A floor above the asking price is not a floor, it is a different price,
  -- and it would make every offer "below floor" including the asking one.
  if v_price is not null and p_amount > v_price then
    raise exception 'The floor cannot be above the asking price'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into listing_negotiation_authority
    (property_id, agency_id, floor_amount, currency, is_active, set_by)
  values (p_property_id, v_agency, p_amount, v_cur, coalesce(p_active, true), auth.uid())
  on conflict (property_id) do update
    set floor_amount = excluded.floor_amount,
        currency     = excluded.currency,
        is_active    = excluded.is_active,
        set_by       = excluded.set_by;

  return p_amount;
end;
$function$;

-- ── asking whether an offer is acceptable, without handing over the number ─
-- This is what Tayo calls. It answers yes or no. The floor itself is never in
-- the return value, so a negotiator that is talked into repeating its own
-- context has nothing to repeat.
create or replace function public.offer_within_authority(
  p_property_id uuid, p_amount numeric
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_floor  numeric;
  v_active boolean;
begin
  select floor_amount, is_active into v_floor, v_active
  from listing_negotiation_authority where property_id = p_property_id;

  -- No floor set, or negotiation switched off: Tayo has no authority here.
  -- The safe reading of "nobody said" is "not allowed", never "anything goes".
  if v_floor is null or v_active is not true then
    return false;
  end if;

  return p_amount >= v_floor;
end;
$function$;

revoke all on function public.offer_within_authority(uuid, numeric) from public;
revoke all on function public.offer_within_authority(uuid, numeric) from anon;
grant execute on function public.offer_within_authority(uuid, numeric) to authenticated, service_role;
