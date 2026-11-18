-- Synapse Studio connects every platform the agency studio allows, through PostPeer.
--
-- DECISION (the client, 2026-11-18): "I want to be able to connect to all social media like what happens on the social
-- studio for users", and "only the channels that are allowed on social studio" -- so the studio offers exactly the
-- platforms social-connect's status lists as ready for agencies, reached through PostPeer (TryPost, the old route, was
-- disconnected on 2026-10-23).
--
-- A studio channel connected through PostPeer stores PostPeer's integration id, never a token: PostPeer holds the grant,
-- on Synapse's own PostPeer profile (platform_settings 'studio_postpeer_profile', made by social-connect on first use).
-- One integration is one channel, like one Facebook Page or one Telegram chat.
--
-- Undo:
--   drop index if exists city_channels_one_postpeer_integration;
--   alter table city_channels drop column if exists postpeer_integration_id;

alter table city_channels add column if not exists postpeer_integration_id text;

create unique index if not exists city_channels_one_postpeer_integration
  on city_channels (postpeer_integration_id) where postpeer_integration_id is not null;

comment on column city_channels.postpeer_integration_id is
  'PostPeer integration id when the studio connected this channel through PostPeer (2026-11-18). PostPeer holds the token.';
