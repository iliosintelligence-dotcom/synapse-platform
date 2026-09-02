-- 0071_generated_content_enums_match_the_app.sql
--
-- WHY generated_content HAD NEVER HELD A ROW
-- The table shipped with the schema and nothing ever wrote to it. Part of that
-- was a missing code path, but the other part was that it could not have been
-- written to correctly even if something had tried: both of its enums
-- described a different product from the one that shipped.
--
--   narrative_angle was luxury | investment | rental | family | commercial |
--   shortlet. Those are property CATEGORIES. The angles syndication.js
--   actually generates are approaches to writing a caption -- trust, value,
--   life, scarcity, question -- and not one of them was storable.
--
--   content_type covered every platform the app publishes to except YouTube
--   Shorts, which is in PLATFORMS and had nowhere to go.
--
-- Added rather than replaced. The old values cost nothing to keep, may appear
-- in other environments, and removing an enum value is the kind of migration
-- that fails at 3am against a row nobody remembered.
--
-- Applied to the live project before this file was written, and the resulting
-- enums verified in place.

alter type narrative_angle add value if not exists 'trust';
alter type narrative_angle add value if not exists 'value';
alter type narrative_angle add value if not exists 'life';
alter type narrative_angle add value if not exists 'scarcity';
alter type narrative_angle add value if not exists 'question';

alter type content_type add value if not exists 'youtube_short';
