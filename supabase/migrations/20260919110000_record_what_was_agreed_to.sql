-- Record what was agreed to, and which version of it.
--
-- signin.html asked for nothing: no terms, no privacy link, no consent of any
-- kind. So there was no notice at the moment the law most expects it, and no
-- evidence that anybody had ever agreed to anything.
--
-- WHAT THIS IS NOT. A ticked box is not a lawful basis, and this table is not
-- pretending to be one. Most of what Synapse does runs on contract or
-- legitimate interest and needs no consent at all. Two narrower things are
-- worth recording:
--
--   · that the person was shown the terms and the policy BEFORE handing over
--     anything, which is the notice obligation; and
--   · WHICH VERSION they accepted. "They agreed to the terms" ages into
--     meaninglessness the first time the terms change. "They agreed to
--     2026-09-19" does not, and an NDPA enquiry asks the second question.
--
-- SEPARATE ROWS, NOT A BOOLEAN ON profiles. Consent is a series of events with
-- dates, not a state -- somebody can accept v1, withdraw, and accept v2, and a
-- single flag would forget all of that. It also means withdrawal is recordable
-- without destroying the record that consent was once given, which is what
-- demonstrating compliance actually requires.

create table if not exists consent_records (
  id           uuid primary key default uuid_generate_v4(),
  profile_id   uuid not null references profiles (id) on delete cascade,
  /* 'terms_of_service' | 'privacy_policy' | 'ai_processing' | 'marketing'.
     Text rather than an enum because these change with the documents, and a
     migration to add a consent kind is friction that discourages asking
     properly. */
  kind         text not null,
  /* The document version, as published. A date is the version. */
  version      text not null,
  granted      boolean not null default true,
  granted_at   timestamptz not null default now(),
  /* Where the person was standing when they agreed -- 'signup', 'settings',
     'reconsent'. Not an IP address: recording an IP to prove consent means
     collecting more personal data in order to be better at data protection,
     which is the wrong trade. */
  context      text not null default 'signup',
  created_at   timestamptz not null default now()
);

create index if not exists idx_consent_profile on consent_records (profile_id, kind, granted_at desc);

alter table consent_records enable row level security;

/* You can see your own consents and you can add to them. Nobody can edit or
   delete one: a consent record that can be rewritten proves nothing, and the
   withdrawal path is a new row with granted = false rather than a deletion.
   Erasure still reaches these, through the profiles cascade and the
   erase_personal_data() path -- deleting somebody means deleting the record
   that they consented, which is correct. */
drop policy if exists consent_select_own on consent_records;
create policy consent_select_own on consent_records
  for select using (profile_id = auth.uid());

drop policy if exists consent_insert_own on consent_records;
create policy consent_insert_own on consent_records
  for insert with check (profile_id = auth.uid());

comment on table consent_records is
  'Append-only history of what each person agreed to and which version. '
  'Withdrawal is a new row with granted = false, never an update: a consent '
  'record that can be rewritten is not evidence of anything.';
