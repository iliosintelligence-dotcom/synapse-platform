-- Layer 4 · System 4 — property verification engine
-- A structured pipeline with evidence at every stage. The consumer-facing
-- 7-node score is a weighted average of passed checks; failed checks pull a
-- property out of the verified pool and are never surfaced.

create type property_verification_state as enum (
  'unverified','documents_submitted','under_review','scout_scheduled',
  'scout_completed','legal_review','verified','disputed','expired'
);
create type property_check_type as enum (
  'listing_authenticity','ownership_validation','media_validation',
  'freshness_validation','structural_assessment','flood_risk','government_acquisition_risk'
);
create type property_check_status as enum ('pending','passed','failed','not_applicable');

-- ──────────────── property_verifications ────────────────
create table property_verifications (
  id          uuid primary key default uuid_generate_v4(),
  property_id uuid not null references properties (id) on delete cascade,
  state       property_verification_state not null default 'unverified',
  node_score  smallint check (node_score between 0 and 100),
  verified_at timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (property_id)
);
create trigger property_verifications_updated_at before update on property_verifications
  for each row execute function set_updated_at();
create index idx_property_verifications_state on property_verifications (state);

-- ──────────────── property_verification_history (append-only) ────────────────
create table property_verification_history (
  id              uuid primary key default uuid_generate_v4(),
  property_id     uuid not null references properties (id) on delete cascade,
  from_state      property_verification_state,
  to_state        property_verification_state not null,
  transitioned_by uuid references profiles (id) on delete set null,
  transitioned_at timestamptz not null default now(),
  notes           text
);
create index idx_property_verif_history on property_verification_history (property_id, transitioned_at);
create trigger property_verif_history_no_mutate before update or delete on property_verification_history
  for each row execute function reject_mutation();

-- ──────────────── property_verification_checks ────────────────
-- One row per check type per property; each carries evidence + an expiry.
create table property_verification_checks (
  id           uuid primary key default uuid_generate_v4(),
  property_id  uuid not null references properties (id) on delete cascade,
  check_type   property_check_type not null,
  status       property_check_status not null default 'pending',
  evidence_urls text[] not null default '{}',
  rating       text,    -- structural_rating / risk_rating where applicable
  verified_by  uuid references profiles (id) on delete set null,
  verified_at  timestamptz,
  expiry_date  timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  unique (property_id, check_type)
);
create index idx_property_checks on property_verification_checks (property_id, status);

-- ──────────────── image hash on property_media (fraud signal) ────────────────
-- Perceptual hash for image-duplication detection (System 6). Stored
-- alongside the existing Cloudinary metadata.
alter table property_media add column image_hash text;
create index idx_property_media_hash on property_media (image_hash) where image_hash is not null;

-- Recompute a property's weighted 7-node score from its passed checks.
-- Weights mirror NODE_WEIGHTS in packages/types/layer4.
create or replace function recompute_node_score(p_property_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_score numeric := 0;
begin
  select coalesce(sum(
    case check_type
      when 'listing_authenticity'        then 20
      when 'ownership_validation'        then 25
      when 'media_validation'            then 10
      when 'freshness_validation'        then 10
      when 'structural_assessment'       then 10
      when 'flood_risk'                  then 10
      when 'government_acquisition_risk' then 15
    end), 0)
  into v_score
  from property_verification_checks
  where property_id = p_property_id and status = 'passed';

  update property_verifications set node_score = round(v_score) where property_id = p_property_id;
end;
$$;
