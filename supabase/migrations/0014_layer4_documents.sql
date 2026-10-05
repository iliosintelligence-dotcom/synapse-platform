-- Layer 4 · System 5 — document intelligence
-- Every credential, evidence upload, and deal-room document. Versioned and
-- never hard-deleted — the version chain is the audit trail. Documents are
-- served via signed URLs from Edge Functions, never public storage URLs.

create type document_entity_type as enum ('agency','agent','property','deal_room');
create type document_type as enum (
  'certificate_of_occupancy','survey_plan','deed_of_assignment','allocation_letter',
  'building_approval','governors_consent','excision_document','agency_license',
  'cac_certificate','directors_id','bank_statement','frcn_membership',
  'scout_video','scout_photograph','other'
);

-- ──────────────── documents ────────────────
create table documents (
  id                   uuid primary key default uuid_generate_v4(),
  entity_type          document_entity_type not null,
  entity_id            uuid not null,
  document_type        document_type not null,
  display_name         text not null,
  storage_url          text not null,
  cloudinary_public_id text not null,
  file_size_bytes      bigint,
  mime_type            text,
  uploaded_by          uuid references profiles (id) on delete set null,
  is_verified          boolean not null default false,
  verified_by          uuid references profiles (id) on delete set null,
  verified_at          timestamptz,
  verification_notes   text,
  is_current           boolean not null default true,
  expires_at           timestamptz,
  ai_analysis_result   jsonb,   -- reserved for Document Analysis AI
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create trigger documents_updated_at before update on documents
  for each row execute function set_updated_at();
create index idx_documents_entity on documents (entity_type, entity_id, document_type);
create index idx_documents_current on documents (entity_type, entity_id) where is_current = true;

-- ──────────────── document_versions (audit chain) ────────────────
create table document_versions (
  id                   uuid primary key default uuid_generate_v4(),
  document_id          uuid not null references documents (id) on delete cascade,
  entity_type          document_entity_type not null,
  entity_id            uuid not null,
  document_type        document_type not null,
  version              integer not null,
  storage_url          text not null,
  cloudinary_public_id text not null,
  uploaded_by          uuid references profiles (id) on delete set null,
  created_at           timestamptz not null default now()
);
create index idx_document_versions on document_versions (document_id, version desc);
create trigger document_versions_no_mutate before update or delete on document_versions
  for each row execute function reject_mutation();

-- A new upload of the same (entity, document_type) supersedes the prior
-- current row and records a version. Called by the api/documents service.
create or replace function supersede_document(p_new_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_entity_type document_entity_type;
  v_entity_id   uuid;
  v_doc_type    document_type;
  v_next        integer;
begin
  select entity_type, entity_id, document_type
    into v_entity_type, v_entity_id, v_doc_type
    from documents where id = p_new_id;

  select coalesce(max(version), 0) into v_next from document_versions
  where entity_type = v_entity_type and entity_id = v_entity_id and document_type = v_doc_type;

  -- archive each prior current doc as the next version, then retire it
  insert into document_versions (document_id, entity_type, entity_id, document_type, version, storage_url, cloudinary_public_id, uploaded_by)
  select d.id, d.entity_type, d.entity_id, d.document_type,
         v_next + row_number() over (order by d.created_at),
         d.storage_url, d.cloudinary_public_id, d.uploaded_by
  from documents d
  where d.entity_type = v_entity_type and d.entity_id = v_entity_id
    and d.document_type = v_doc_type and d.id <> p_new_id and d.is_current;

  update documents set is_current = false
  where entity_type = v_entity_type and entity_id = v_entity_id
    and document_type = v_doc_type and id <> p_new_id;
end;
$$;
