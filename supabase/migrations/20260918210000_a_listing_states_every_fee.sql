-- A listing states every fee, not just the headline price.
--
-- The property card's cost breakdown ends with a sentence it should never have
-- had to write: "Utilities, power and any agency fee are separate and not shown
-- here." It says that because there was nowhere to put them. Rent, service
-- charge and move-in cost had columns; the agency fee and the legal fee -- the
-- two charges a Nigerian tenant is most reliably surprised by, commonly 5-10%
-- of the annual rent each -- had none.
--
-- So a buyer reading a Synapse listing could not see the number that decides
-- whether they can afford it, and the card told them to go and ask. That is the
-- opposite of the thing this product is for.
--
-- Both nullable on purpose. An unstated fee is not a fee of zero, and the card
-- draws that distinction: a null is named as not stated, a zero is shown as
-- included. Collapsing them would let a listing that simply never filled the
-- field read as one that charges nothing.
--
-- Deliberately NOT in the social caption payload. Captions take an explicit
-- allowlist in social-generate, and these two are not on it: a post is an
-- invitation, and a fee schedule belongs on the listing where there is room to
-- show what it is attached to.

alter table properties
  add column if not exists agency_fee numeric(16,2) check (agency_fee >= 0),
  add column if not exists legal_fee  numeric(16,2) check (legal_fee  >= 0);

comment on column properties.agency_fee is
  'One-off agency/agent commission in the listing currency. Null means the agency has not stated one; 0 means there is none. Not sent to social captions.';
comment on column properties.legal_fee is
  'One-off legal/agreement fee in the listing currency. Null means not stated; 0 means none. Not sent to social captions.';
