-- A listing can carry video.
--
-- property_media has had `media_type` since 0002 and the enum has always
-- included 'video'. Nothing else did: the bucket refused anything that was not
-- an image, the upload path allowed four image mime types, and every consumer
-- assumed an <img>. The column was a plan, not a feature.
--
-- Two changes here, both to the bucket.
--
-- MIME TYPES: mp4 and quicktime only, and webm is deliberately absent. Meta
-- will not ingest webm, so accepting it would mean an agency uploads a file,
-- sees it on the listing, schedules a post and gets a failure from Instagram
-- hours later with no way to understand why. Better to refuse it at the point
-- where somebody can still choose a different file. MOV is included because
-- that is what an iPhone produces and most of these will be filmed on one.
--
-- SIZE: 100MB, up from 10MB. A 10MB ceiling is roughly 20 seconds of 1080p
-- from a phone -- shorter than any walkthrough worth posting. 100MB carries
-- about 90 seconds, which is also where Instagram caps a Reel, so the two
-- limits agree rather than surprising each other.
--
-- The photo limit rises with it, because file_size_limit is per bucket and not
-- per type. That is a real consequence: the client keeps its own 10MB gate on
-- images (agency-listings.js) so a mis-selected 40MB photo is still refused
-- with a sentence a person can act on, rather than being quietly accepted and
-- served to buyers on a phone connection.

update storage.buckets
   set file_size_limit = 104857600,           -- 100MB
       allowed_mime_types = array[
         'image/png', 'image/jpeg', 'image/webp', 'image/avif',
         -- Meta ingests MP4 and MOV. Not webm: see above.
         'video/mp4', 'video/quicktime'
       ]
 where id = 'property-photos';

-- The queue carries URLs only, so the type has to be recoverable from the URL
-- at publish time. Uploaded objects always have an extension because the
-- upload path builds the path itself; a pasted link might not, and is treated
-- as an image, which is the safe reading -- an image posted as video fails
-- loudly at Meta, a video posted as an image fails the same way, but images
-- are overwhelmingly the common case for a pasted link.
comment on column property_media.media_type is
  'image | video | floor_plan | document. Set from the uploaded file''s mime type. '
  'Publishers re-derive it from the URL extension because social_posts.media_urls '
  'carries URLs without types.';
