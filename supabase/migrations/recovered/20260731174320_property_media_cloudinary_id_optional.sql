-- property_media.cloudinary_public_id was NOT NULL with no default, which
-- assumed every image arrives via Cloudinary. An agency pasting an image URL
-- (the only media path the dashboard actually offers today) has no Cloudinary
-- public id, so the constraint made agency media inserts impossible. The id is
-- genuinely optional metadata about where an asset is hosted, not part of the
-- record's meaning — nullable is the honest shape.
alter table public.property_media
  alter column cloudinary_public_id drop not null;

comment on column public.property_media.cloudinary_public_id is
  'Cloudinary public id, when the asset was uploaded through Cloudinary. NULL for media supplied as a direct URL.';
