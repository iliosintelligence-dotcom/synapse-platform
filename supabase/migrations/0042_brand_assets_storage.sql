-- Brand assets: the agency's own logo files. (Applied to the live project.)
--
-- Public read: a logo is meant to be seen — it renders on listings, on
-- generated campaign creatives and on the public agency page, all anonymous
-- surfaces. Nothing private goes in this bucket.
--
-- Writes are scoped to the agency's own folder. Every object lives at
--   brand/<agency_id>/<file>
-- and the policies check that first path segment against agency membership,
-- so one agency can never overwrite or delete another agency's mark.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand', 'brand', true, 2097152,
        array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists brand_assets_read on storage.objects;
create policy brand_assets_read on storage.objects
  for select using (bucket_id = 'brand');

drop policy if exists brand_assets_insert on storage.objects;
create policy brand_assets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'brand' and is_agency_member(((storage.foldername(name))[1])::uuid));

drop policy if exists brand_assets_update on storage.objects;
create policy brand_assets_update on storage.objects
  for update to authenticated
  using (bucket_id = 'brand' and is_agency_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'brand' and is_agency_member(((storage.foldername(name))[1])::uuid));

drop policy if exists brand_assets_delete on storage.objects;
create policy brand_assets_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'brand' and is_agency_member(((storage.foldername(name))[1])::uuid));
