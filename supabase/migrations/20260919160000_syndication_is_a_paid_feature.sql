-- Syndication is a paid feature, and Greenlight keeps it.
--
-- DECISION (Eden, 2026-09-19): "grandfather greenlight and enforce
-- syndication as paid going forward."
--
-- ── the distinction that does the work ───────────────────────────────────
--
-- social_posts.leg already separates the two things, and 0103 named them:
--
--   agency    published to the agency's OWN connected account. This is the
--             "Publish once, reach everywhere" the pricing page sells at
--             N75k/month.
--   synapse   published to a Synapse-owned channel. 0103 calls it "free
--             amplification" and that is exactly what it is -- our marketing,
--             carrying their listing.
--
-- Only the agency leg is gated. Gating the synapse leg would be charging an
-- agency for the privilege of appearing on our own feed, which is not a
-- product, and it would switch off the thing that has actually been working:
-- all 43 published posts on this database are synapse-leg. Every agency-leg
-- attempt failed for want of a connected account.
--
-- Which means the grandfathering below protects something Greenlight has
-- never yet used. It is not therefore pointless -- it is the difference
-- between their first real syndication working and being refused on the day
-- they finally connect Meta, which is the thing we have been asking them to
-- do.
--
-- ── a grant table, not a column on agencies ──────────────────────────────
--
-- `legacy_syndication boolean` would have been shorter and would have been
-- wrong within a month. Grandfathering is not one flag: it is a promise made
-- to a particular customer, on a date, for a reason, sometimes with an end.
-- A row can say all of that and a boolean can say none of it -- and the next
-- time we make an exception, this holds it without another migration.

-- ── 1. what each plan includes ───────────────────────────────────────────
create or replace function plan_features(p_tier subscription_tier)
returns text[] language sql immutable as $$
  /* Mirrors the COMPARE_ROWS table in agency.html. If these disagree, the
     product is selling something it does not deliver -- change both. */
  select case p_tier
    when 'free'          then array[]::text[]
    when 'accelerator'   then array['syndication', 'ai_captions']
    when 'market_leader' then array['syndication', 'ai_captions', 'proximity', 'campaigns']
    else array[]::text[]
  end;
$$;

-- ── 2. promises we have made to particular agencies ──────────────────────
create table if not exists agency_feature_grants (
  id          uuid primary key default uuid_generate_v4(),
  agency_id   uuid not null references agencies (id) on delete cascade,
  feature     text not null,
  /* Why, in words, because in a year nobody will remember. A grant with no
     reason is indistinguishable from a bug in the permission check. */
  reason      text not null,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references profiles (id),
  /* Null means open-ended. Grandfathering usually is; a trial usually is not. */
  expires_at  timestamptz,
  revoked_at  timestamptz,
  unique (agency_id, feature)
);
create index if not exists idx_grants_agency on agency_feature_grants (agency_id, feature);

alter table agency_feature_grants enable row level security;

/* An agency may see what it has been given -- being told "you have this
   because we promised it" is better than it silently working. Nobody grants
   themselves anything: there is no insert or update policy, so it is service
   role or the SQL console. */
drop policy if exists grants_select_own on agency_feature_grants;
create policy grants_select_own on agency_feature_grants
  for select using (
    exists (select 1 from agency_members m
             where m.agency_id = agency_feature_grants.agency_id
               and m.profile_id = auth.uid() and m.deleted_at is null)
  );

comment on table agency_feature_grants is
  'Features an agency has outside its plan: grandfathering, trials, goodwill. '
  'Carries the reason and the date because a permission with no explanation '
  'is indistinguishable from a bug in the permission check.';

-- ── 3. the one question everything asks ──────────────────────────────────
create or replace function agency_can(p_agency_id uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    coalesce((
      select p_feature = any(plan_features(a.subscription_tier))
      from agencies a where a.id = p_agency_id
    ), false)
    or exists (
      select 1 from agency_feature_grants g
       where g.agency_id = p_agency_id
         and g.feature = p_feature
         and g.revoked_at is null
         and (g.expires_at is null or g.expires_at > now())
    );
$$;

revoke all on function agency_can(uuid, text) from public, anon;
grant execute on function agency_can(uuid, text) to authenticated, service_role;

comment on function agency_can(uuid, text) is
  'Does this agency have this feature -- by plan, or by a grant made to them '
  'specifically. The only question the enforcement asks, so plan changes and '
  'grandfathering cannot disagree.';

-- ── 4. Greenlight keeps syndication ──────────────────────────────────────
insert into agency_feature_grants (agency_id, feature, reason)
select id, 'syndication',
       'Grandfathered 2026-09-19. On the platform before syndication was '
       'enforced as a paid feature; kept on the free plan by decision rather '
       'than by oversight.'
  from agencies
 where deleted_at is null
   and lower(name) like 'greenlight%'
on conflict (agency_id, feature) do nothing;

-- ── 5. the gate ──────────────────────────────────────────────────────────
create or replace function enforce_syndication_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /* The synapse leg is free amplification on our own channels -- see 0103.
     Charging for it would be charging an agency to appear on our feed. */
  if new.leg is distinct from 'agency' then return new; end if;

  /* The drain, the twin builder and support tooling all run as service role.
     A post queued legitimately before a downgrade must still be retryable,
     and a gate that blocks our own retries gets switched off in an incident. */
  if auth.role() = 'service_role' then return new; end if;

  if new.agency_id is null then return new; end if;

  if not agency_can(new.agency_id, 'syndication') then
    raise exception
      'Publishing to your own social accounts is on the Accelerate plan and above.'
      using errcode = 'check_violation',
            hint = 'Your listings still go out on Synapse''s own channels at no cost. '
                || 'Subscription in the portal shows what each plan includes.';
  end if;

  return new;
end;
$$;

drop trigger if exists social_posts_syndication_plan on social_posts;
create trigger social_posts_syndication_plan
  before insert on social_posts
  for each row execute function enforce_syndication_plan();
