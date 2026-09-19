-- Greenlight keeps AI captions too.
--
-- DECISION (Eden, 2026-09-19): "extend the grant to ai_captions."
--
-- Same shape as the syndication grant, and for the same reason: they were on
-- the platform and using this before it was enforced, so they keep it by
-- decision rather than by the gate not existing yet.
--
-- Unlike syndication, this one protects something they are ACTIVELY using.
-- Every caption in the social studio has come from social-generate, and until
-- the gate shipped alongside this, that endpoint answered anybody at all --
-- it ran with verify_jwt = false and performed no authentication of its own,
-- so it could not have told one agency from another even if it had looked.
-- Without this row, the first thing the new gate would have done is stop the
-- only agency on the platform from writing captions.
--
-- Open-ended, like the syndication grant. A grandfathering that quietly
-- expires is a price rise nobody was told about.

insert into agency_feature_grants (agency_id, feature, reason)
select id, 'ai_captions',
       'Grandfathered 2026-09-19 alongside syndication. Using AI captions '
       'before the feature was gated; kept on the free plan by decision '
       'rather than by oversight.'
  from agencies
 where deleted_at is null
   and lower(name) like 'greenlight%'
on conflict (agency_id, feature) do nothing;
