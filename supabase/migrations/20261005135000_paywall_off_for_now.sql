-- The paywall is off again, for everyone.
--
-- DECISION (Eden, 2026-10-05): everybody has every feature for now. Plan
-- limits (listings, seats, syndication, features) are not enforced while the
-- paywall is off. Prices, the Billing page and checkout stay as they are, and
-- nothing is deleted: this only turns the enforcement off. Eden will say when
-- to switch it back on, which is `select set_paywall(true);`.
--
-- The CAC certificate gate before listing is separate and unchanged.
select set_paywall(false);
