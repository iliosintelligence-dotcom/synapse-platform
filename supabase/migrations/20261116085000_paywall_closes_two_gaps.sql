-- The paywall closes two gaps before it switches back on.
--
-- Found by a rolled-back attack test on live, 2026-11-16, as a free-tier agency owner:
--
-- 1. enforce_syndication_plan only fired on INSERT. A free agency could queue a post on Synapse's own
--    channels (leg 'synapse', allowed) and then UPDATE it to leg 'agency' -- its own connected account --
--    and the plan check never ran. It now also runs when a post's leg or agency changes.
--
-- 2. enforce_seat_limit only fired on INSERT. An owner could bring a removed member back
--    (deleted_at -> null) past the plan's seat cap. It now also runs when a member is reactivated or
--    moved to another agency -- the same pattern as properties_plan_limit_reactivate for listings.
--
-- Both reuse the existing trigger functions unchanged (they read only NEW). Nothing already in place is
-- touched: editing a caption or a schedule does not re-check the plan; only becoming own-account, or
-- becoming an active seat, does.
--
-- Undo:
--   drop trigger if exists social_posts_syndication_plan_update on social_posts;
--   drop trigger if exists agency_members_seat_limit_reactivate on agency_members;

drop trigger if exists social_posts_syndication_plan_update on social_posts;
create trigger social_posts_syndication_plan_update
  before update of leg, agency_id on social_posts
  for each row
  when (new.leg is distinct from old.leg or new.agency_id is distinct from old.agency_id)
  execute function enforce_syndication_plan();

drop trigger if exists agency_members_seat_limit_reactivate on agency_members;
create trigger agency_members_seat_limit_reactivate
  before update of deleted_at, agency_id on agency_members
  for each row
  when ((old.deleted_at is not null and new.deleted_at is null)
        or (new.deleted_at is null and new.agency_id is distinct from old.agency_id))
  execute function enforce_seat_limit();
