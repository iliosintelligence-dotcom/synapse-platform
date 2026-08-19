-- Repositioning from a Nigeria-only product to a global one starts here, not in
-- the copy. `price` was a bare number and every surface formatted it as ₦, so a
-- listing in London or Nairobi would have rendered as naira. A price without a
-- currency is not a price.
--
-- ISO 4217 code, three uppercase letters. Existing rows are Nigerian, so they
-- backfill to NGN — that is a statement of fact about the current inventory, not
-- a default the world should inherit.

alter table public.properties
  add column if not exists currency text;

update public.properties set currency = 'NGN' where currency is null;

alter table public.properties
  alter column currency set default 'NGN',
  alter column currency set not null;

-- Guard the shape rather than the list: an allowlist of codes would need editing
-- every time a new market opens, which is precisely the friction this change is
-- meant to remove.
alter table public.properties
  drop constraint if exists properties_currency_iso4217;
alter table public.properties
  add constraint properties_currency_iso4217 check (currency ~ '^[A-Z]{3}$');

comment on column public.properties.currency is
  'ISO 4217 code the price is denominated in. Existing Nigerian stock backfilled to NGN; the default is a migration convenience, and the listing form should always ask. Clients must format from this, never from a hardcoded symbol.';

comment on column public.properties.country is
  'Country the property is in. The NGN-era default of Nigeria remains for backward compatibility; new markets set it explicitly.';
