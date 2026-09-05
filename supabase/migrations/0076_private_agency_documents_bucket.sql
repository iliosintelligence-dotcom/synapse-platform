-- ═══════════════════════════════════════════════════════════════════════════
-- A private bucket for legal documents.
--
-- avatars, brand and property-photos are all public-read: right for a logo,
-- catastrophic for a director's ID or a bank statement. Anyone with the URL
-- gets the file. Legal papers therefore get their own bucket, private, read
-- only through signed URLs.
-- ═══════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agency-documents','agency-documents', false, 15728640,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owner and admin only. is_agency_member() would let an agent read the
-- company's papers, which is the one thing this bucket exists to prevent.
create or replace function public.can_access_agency_files(p_agency_id uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp' as $$
  select exists (
    select 1 from agencies a
    where a.id = p_agency_id
      and a.deleted_at is null
      and (a.owner_id = auth.uid()
           or agency_role(a.id) in ('agency_admin','agency_owner'))
  );
$$;

-- Path is <agency_id>/<document_type>-<timestamp>.<ext>, so the first folder
-- segment is the tenant key -- the shape brand and property-photos use.
drop policy if exists agency_documents_read on storage.objects;
create policy agency_documents_read on storage.objects for select
  using (bucket_id = 'agency-documents'
         and can_access_agency_files(((storage.foldername(name))[1])::uuid));

drop policy if exists agency_documents_insert on storage.objects;
create policy agency_documents_insert on storage.objects for insert
  with check (bucket_id = 'agency-documents'
              and can_access_agency_files(((storage.foldername(name))[1])::uuid));

drop policy if exists agency_documents_update on storage.objects;
create policy agency_documents_update on storage.objects for update
  using (bucket_id = 'agency-documents'
         and can_access_agency_files(((storage.foldername(name))[1])::uuid));

drop policy if exists agency_documents_delete on storage.objects;
create policy agency_documents_delete on storage.objects for delete
  using (bucket_id = 'agency-documents'
         and can_access_agency_files(((storage.foldername(name))[1])::uuid));
