-- A campaign keeps only what it uses.
--
-- Three things on that page were inert rather than false -- nothing lied, but
-- nothing acted on them either. Asked for directly after the audit:
--
--   campaign_assets              0 rows, 0 inbound foreign keys, never once
--                                written. It modelled a campaign's planned
--                                creative, which is now simply the posts
--                                filed under it.
--   budget_naira / spend_naira   selected on every load and written as 0.
--                                Nothing in this product spends money -- there
--                                is no ads integration and the only payment
--                                path is the subscription.
--   persona / audience           a dropdown implying the campaign is targeted
--                                at somebody. It is not. Nothing filters,
--                                routes or writes differently because of it.
--
-- ── the one that holds something ────────────────────────────────────────
--
-- The first two are empty or zero. The audience is not: both campaigns carry
-- a label somebody chose.
--
--   family     -> Family buyers · Lekki corridor
--   firsthome  -> First-home buyers · Bodija, Ibadan
--
-- Written here so the drop does not destroy them silently. They are notes, not
-- records -- nothing was ever targeted at either group -- but a value an
-- agency typed should leave a trace when it goes, and a migration comment is
-- where that trace belongs.
--
-- Anything still wanted from them fits in the campaign's NAME, which is free
-- text and already displays. "Lekki family homes" says the same thing and
-- does not imply the platform is doing something with it.
--
-- Every value is logged before its column goes, so the migration output is
-- the record of what was removed rather than this comment being the only one.

do $$
declare r record;
begin
  for r in
    select id, name,
           coalesce(budget_naira, 0) as budget,
           coalesce(persona, '-') as persona,
           coalesce(target_audience_description, '-') as audience
    from campaigns where deleted_at is null
  loop
    raise notice 'campaign % (%): budget=% persona=% audience=%',
      r.name, r.id, r.budget, r.persona, r.audience;
  end loop;
end $$;


-- ── campaign_assets ──────────────────────────────────────────────────────
--
-- RESTRICT, not CASCADE, for the same reason campaign_creatives had it: the
-- audit says nothing depends on this, and if that is wrong the right outcome
-- is a migration that fails loudly rather than one that quietly takes
-- something else with it.
drop table if exists public.campaign_assets restrict;


-- ── the money that is never spent ────────────────────────────────────────
--
-- Not "kept for later". There is no ads integration to build toward, and a
-- column that has only ever held 0 is not a head start on one -- it is a
-- field on a form that somebody eventually fills in believing it does
-- something. The comment already in the form says it best: a budget for
-- something that does not happen is worse than no field.
alter table public.campaigns
  drop column if exists budget_naira,
  drop column if exists spend_naira;


-- ── the audience nobody targets ──────────────────────────────────────────
alter table public.campaigns
  drop column if exists persona,
  drop column if exists target_audience_description;


-- campaign_type survives on purpose: it is NOT NULL, every row carries
-- 'property_showcase', and unlike the four above it describes what the
-- campaign IS rather than claiming something the platform does. It costs
-- nothing and removing a not-null column needs a default the table does not
-- have.
comment on table public.campaigns is
  'A named group of posts over a date range. What it did is reported by '
  'campaign_performance(), summed from the posts filed under it. It holds no '
  'budget, no spend and no audience: none of the three were ever acted on, '
  'and a field nobody acts on is one somebody eventually fills in believing '
  'otherwise.';
