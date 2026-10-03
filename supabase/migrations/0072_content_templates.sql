-- 0072_content_templates.sql
--
-- The angle catalogue was already a template engine, written in JavaScript.
-- Five entries in syndication.js, each a pair of functions taking a shaped
-- listing and returning text. It worked, and no agency could see it, edit it,
-- or add a sixth -- their "brand voice" was a field we appended a sign-off
-- from, while the writing itself was ours.
--
-- This is that catalogue as rows.
--
-- agency_id IS NULLABLE ON PURPOSE. A NULL row is one of ours: visible to
-- every agency, editable by none. A non-null row belongs to that agency and to
-- nobody else. The alternative -- copying five seed rows into every agency at
-- signup -- means a fix to our wording never reaches an account created
-- yesterday, and five thousand duplicate rows to migrate when it changes.
--
-- PATTERNS, NOT FUNCTIONS. `{bedrooms}`, `{area}`, `{priceLine}` substitute.
-- `{verified?yes|no}` picks a branch, because the angles genuinely need it --
-- "Verified this month." must not appear on an unverified listing, and that
-- conditional is the difference between a template system and a regression.
-- The renderer in syndication.js owns the vocabulary and rejects a token it
-- does not know rather than printing braces at a buyer.

create table if not exists public.content_templates (
  id                uuid primary key default uuid_generate_v4(),
  -- NULL = shipped with Synapse, shown to everyone, owned by nobody.
  agency_id         uuid references public.agencies (id) on delete cascade,
  name              text not null,
  why               text not null default '',
  hook_pattern      text not null,
  body_pattern      text not null default '',
  cta               text not null default '',
  -- Empty means every platform. Listing them is the exception, not the rule.
  platforms         text[] not null default '{}',
  -- An angle whose premise is the seven checks must not run on a listing that
  -- has not passed them. This is the flag that stops us publishing a lie.
  requires_verified boolean not null default false,
  sort_order        integer not null default 100,
  is_active         boolean not null default true,
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists content_templates_agency_idx
  on public.content_templates (agency_id) where deleted_at is null;

drop trigger if exists content_templates_updated_at on public.content_templates;
create trigger content_templates_updated_at before update on public.content_templates
  for each row execute function set_updated_at();

alter table public.content_templates enable row level security;

-- Read: ours plus your own.
drop policy if exists content_templates_read on public.content_templates;
create policy content_templates_read on public.content_templates
  for select
  using (agency_id is null or is_agency_member(agency_id));

-- Write: your own only. `agency_id is not null` is what protects the seeds --
-- without it, is_agency_member(NULL) returning NULL would be relied on to be
-- falsy, which is the kind of thing that quietly stops being true.
drop policy if exists content_templates_write on public.content_templates;
create policy content_templates_write on public.content_templates
  for all
  using (agency_id is not null and is_agency_member(agency_id))
  with check (agency_id is not null and is_agency_member(agency_id));

-- ── the five angles, as they read today ─────────────────────────────────────
-- Reproduced exactly, conditionals included, so nothing an agency generates
-- tomorrow differs from what it generated yesterday. Keyed by name so this
-- migration can be re-run without duplicating them.
insert into public.content_templates
  (agency_id, name, why, hook_pattern, body_pattern, cta, requires_verified, sort_order)
select * from (values
  (null::uuid, 'Verified-first',
   'Leads on the seven checks. Strongest for cold audiences who have been burned by ghost listings.',
   'Somebody stood in this {kind} and checked it.',
   E'Title, structure, flood risk, legal status, ownership — seven checks, all passed, re-confirmed within the last 14 days.\n\n{bedrooms}-bed {kind} in {area}. {priceLine}.',
   'See exactly what we checked →', true, 10),

  (null::uuid, 'Price context',
   'Anchors the number against the corridor. Best for comparison shoppers already browsing.',
   '{priceLine} in {area}. Here is what that actually gets you.',
   E'{bedrooms} bedrooms, {kind}, {area}.\n\n{verified?Verified this month. |}Power reliability in this corridor sits around {power}%.',
   'Ask Toju if it fits your budget →', false, 20),

  (null::uuid, 'Lifestyle',
   'Sells the mornings, not the square metres. Works on warm audiences and retargeting.',
   'Mornings in {area} hit differently.',
   E'A {bedrooms}-bed {kind} with room for the life you actually live.\n\n{priceLine}{verified?. Verified, and still available.|. Still available.}',
   'Take a look →', false, 30),

  (null::uuid, 'Freshness',
   'Uses the 14-day rule as honest urgency — the listing really does expire.',
   'This one disappears in {days} if it is not re-confirmed.',
   E'That is the rule on Synapse: no listing outlives its proof.\n\n{bedrooms}-bed {kind}, {area}. {priceLine}.',
   'See it while it is live →', false, 40),

  (null::uuid, 'Direct question',
   'Opens a conversation instead of making a claim. Highest comment rate, good for reach.',
   'Would you take {area} at {priceShort}?',
   E'{bedrooms}-bed {kind}.{verified? Verified, checked on the ground, live right now.| Live right now.}\n\nHonest answers only.',
   'Tell Toju what you think →', false, 50)
) as seed(agency_id, name, why, hook_pattern, body_pattern, cta, requires_verified, sort_order)
where not exists (
  select 1 from public.content_templates t
  where t.agency_id is null and t.name = seed.name
);

comment on table public.content_templates is
  'Caption angles as data. A NULL agency_id is a Synapse-provided seed, readable '
  'by every agency and writable by none; anything else belongs to that agency. '
  'Patterns use {token} and {token?then|else}; syndication.js owns the vocabulary.';
