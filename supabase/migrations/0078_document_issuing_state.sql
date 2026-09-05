-- ═══════════════════════════════════════════════════════════════════════════
-- Which state issued it.
--
-- Real-estate licensing in Nigeria is state business, not federal. LASRERA
-- registration covers Lagos only -- and trading in Lagos without it is now a
-- criminal offence -- while Ogun, Rivers and the rest run their own schemes.
-- A single global "agency_license" type could not record the thing that
-- matters most about a licence: where it is good.
--
-- An agency working across state lines holds one licence per state, which is
-- one documents row per state. That falls out of this for free.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.documents add column if not exists issuing_state text;

-- The 36 states and the FCT, copied verbatim from the STATES array in
-- app/ng-places.js so the form and the database cannot drift. That file
-- explains why the set is closed: it does not change, so any value outside
-- it is a mistake and the column should refuse it.
alter table public.documents drop constraint if exists documents_issuing_state_valid;
alter table public.documents add constraint documents_issuing_state_valid check (
  issuing_state is null or issuing_state in (
    'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue',
    'Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu',
    'Federal Capital Territory','Gombe','Imo','Jigawa','Kaduna','Kano',
    'Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun',
    'Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'
  )
);

-- A state licence with no state is not a record of anything. Federal
-- documents (CAC, SCUML, ESVARBON, NIESV) leave it null: they are valid
-- everywhere, and a state on them would be a false claim about scope.
alter table public.documents drop constraint if exists documents_state_licence_needs_state;
alter table public.documents add constraint documents_state_licence_needs_state check (
  document_type <> 'agency_license' or issuing_state is not null
);

comment on column public.documents.issuing_state is
  'State that issued a state-scoped document (agency_license). Null for federal '
  'documents: CAC, SCUML, ESVARBON, NIESV. Constrained to the 36 states + FCT, '
  'matching STATES in app/ng-places.js.';

create index if not exists documents_entity_state_idx
  on public.documents (entity_id, document_type, issuing_state)
  where deleted_at is null and is_current;

-- documents.cloudinary_public_id and document_versions.cloudinary_public_id
-- were both NOT NULL, so neither table could be written to at all without a
-- Cloudinary id -- and Synapse does not use Cloudinary. Every file this
-- product stores goes to Supabase Storage. That single constraint is a good
-- part of why the whole documents subsystem had nought rows in it.
-- storage_url stays NOT NULL: a document row with no file is not a document.
alter table public.documents         alter column cloudinary_public_id drop not null;
alter table public.document_versions alter column cloudinary_public_id drop not null;

comment on column public.documents.cloudinary_public_id is
  'Unused. Synapse stores files in Supabase Storage (bucket agency-documents for '
  'legal papers); storage_url is the real location. Retained only so no existing '
  'row is lost.';
