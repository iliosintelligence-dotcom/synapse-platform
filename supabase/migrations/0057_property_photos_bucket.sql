-- 0057_property_photos_bucket.sql
--
-- Somewhere for a listing's photographs to actually live.
--
-- The new-listing form asked for a "Primary image URL", and that was the only
-- way in. An agency holding a photo on their phone has no URL for it, so the
-- only honest options were to host it somewhere else first, or paste a link to
-- wherever the picture happened to sit. On 2026-08-16 a listing was published
-- with https://share.google/EiSyLU6CGrkHy9pYw as its image -- a Google share
-- redirect that answers 302 text/html. It was never an image and could never
-- have rendered.
--
-- Validating the URL harder does not fix that, and the validation added in the
-- same week would have rejected this particular link while still leaving the
-- person with a photograph and nowhere to put it. This is the missing bucket.
--
-- Mirrors the `brand` bucket exactly, including the path convention: the first
-- folder is the agency id, and every write policy checks membership of that
-- folder, so an agency can only ever write into its own prefix.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-photos', 'property-photos', true,
  10485760,                                   -- 10MB: phone photos are big, and
                                              -- client-side resizing is a later
                                              -- optimisation, not a gate on
                                              -- being able to list at all
  array['image/png', 'image/jpeg', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may look at a listing photo: listings are public, and a photo behind
-- auth simply would not display on the property page.
drop policy if exists property_photos_read on storage.objects;
create policy property_photos_read on storage.objects
  for select to public
  using (bucket_id = 'property-photos');

-- Writes are scoped to the agency's own folder, by membership.
drop policy if exists property_photos_insert on storage.objects;
create policy property_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'property-photos'
    and is_agency_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists property_photos_update on storage.objects;
create policy property_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'property-photos'
    and is_agency_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists property_photos_delete on storage.objects;
create policy property_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'property-photos'
    and is_agency_member(((storage.foldername(name))[1])::uuid)
  );

-- Verified against the live database (2026-08-17):
--   bucket created                              -> 1 row
--   policies installed                          -> 4
--   "<agency_id>/photo-….jpg" folder parsing    -> resolves to the agency id,
--                                                  so is_agency_member() gates
--                                                  writes to the agency's own
--                                                  prefix and nowhere else
