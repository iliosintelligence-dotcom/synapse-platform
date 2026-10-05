-- YouTube joins the platforms the studio can post to (Eden, 2026-10-06).
--
-- It takes a VIDEO, so it is only ever a studio channel for Synapse's own videos
-- (TryPost content type youtube_short: vertical, up to 3 minutes, MP4 or MOV).
-- It never takes an agency's listing post or autopilot, which are pictures. The
-- constraint below says so in the database, so no screen or function can switch
-- either on for a YouTube channel.

alter type social_platform add value if not exists 'youtube';

-- Compared as text: the new enum value cannot be used by name until this
-- migration has committed.
alter table city_channels drop constraint if exists city_channels_youtube_is_videos_only;
alter table city_channels add constraint city_channels_youtube_is_videos_only check (
  platform::text <> 'youtube' or (autopilot is not true and mirror_agency_posts is not true)
);
