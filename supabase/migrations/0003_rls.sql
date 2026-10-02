-- Layer 1 · row level security
-- Every table locked immediately. Platform admins use the service-role key
-- in Edge Functions only — there is intentionally NO admin client policy.

alter table profiles enable row level security;
alter table agencies enable row level security;
alter table agency_members enable row level security;
alter table properties enable row level security;
alter table property_media enable row level security;
alter table saved_properties enable row level security;
alter table viewings enable row level security;

-- ───────────────────────── profiles ─────────────────────────
-- Readable/updatable only by the owner.
create policy profiles_select_own on profiles
  for select using (id = auth.uid() and deleted_at is null);

create policy profiles_update_own on profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    -- role escalation is blocked: role changes only via service role
    and role = (select role from profiles p where p.id = auth.uid())
  );

-- ───────────────────────── agencies ─────────────────────────
-- Public can read verified agencies (consumer surfaces show agency identity).
create policy agencies_select_public on agencies
  for select using (deleted_at is null);

create policy agencies_insert_owner on agencies
  for insert with check (owner_id = auth.uid());

create policy agencies_update_admin on agencies
  for update using (
    deleted_at is null
    and (owner_id = auth.uid() or agency_role(id) in ('agency_admin','agency_owner'))
  );

-- ─────────────────────── agency_members ───────────────────────
create policy agency_members_select_own_agency on agency_members
  for select using (
    deleted_at is null
    and (profile_id = auth.uid() or is_agency_member(agency_id))
  );

create policy agency_members_manage_admin on agency_members
  for all using (
    agency_role(agency_id) in ('agency_admin','agency_owner')
  ) with check (
    agency_role(agency_id) in ('agency_admin','agency_owner')
    -- only the service role may grant agency_owner
    and role <> 'agency_owner'
  );

-- ───────────────────────── properties ─────────────────────────
-- Consumers: only verified + active + live listings.
create policy properties_select_public on properties
  for select using (
    deleted_at is null
    and is_active = true
    and verification_status = 'verified'
    and status = 'live'
  );

-- Agency members: full visibility of their own inventory.
create policy properties_select_agency on properties
  for select using (deleted_at is null and is_agency_member(agency_id));

create policy properties_insert_agency on properties
  for insert with check (is_agency_member(agency_id));

create policy properties_update_agency on properties
  for update using (deleted_at is null and is_agency_member(agency_id))
  with check (
    is_agency_member(agency_id)
    -- verification fields are set by the platform pipeline, not agencies
    and verification_status = (select verification_status from properties p where p.id = properties.id)
    and trust_score is not distinct from (select trust_score from properties p where p.id = properties.id)
  );

-- ─────────────────────── property_media ───────────────────────
create policy property_media_select on property_media
  for select using (
    deleted_at is null
    and exists (
      select 1 from properties p
      where p.id = property_id
        and p.deleted_at is null
        and (
          (p.is_active and p.verification_status = 'verified' and p.status = 'live')
          or is_agency_member(p.agency_id)
        )
    )
  );

create policy property_media_write_agency on property_media
  for all using (
    exists (
      select 1 from properties p
      where p.id = property_id and is_agency_member(p.agency_id)
    )
  ) with check (
    exists (
      select 1 from properties p
      where p.id = property_id and is_agency_member(p.agency_id)
    )
  );

-- ─────────────────────── saved_properties ───────────────────────
-- Fully owned by the consumer.
create policy saved_properties_all_own on saved_properties
  for all using (consumer_id = auth.uid())
  with check (consumer_id = auth.uid());

-- ───────────────────────── viewings ─────────────────────────
-- Readable by the booking consumer and the listing agency.
create policy viewings_select on viewings
  for select using (
    deleted_at is null
    and (consumer_id = auth.uid() or is_agency_member(agency_id))
  );

create policy viewings_insert_consumer on viewings
  for insert with check (consumer_id = auth.uid());

create policy viewings_update_parties on viewings
  for update using (
    deleted_at is null
    and (consumer_id = auth.uid() or is_agency_member(agency_id))
  );
