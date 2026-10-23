-- THE TRYPOST ACCOUNTS ARE RETIRED (Eden, 2026-10-24: "posts are failing because TryPost has been disconnected, but it shouldn't
-- even be showing"; "the developer accounts should not go through TryPost").
--
-- TryPost was disconnected on 2026-10-23. Three things still pointed at it:
-- 1. synapse_channels, the studio's "developer accounts" (Synapse's Facebook, Instagram and X inside TryPost). They are switched
--    off. Synapse's Facebook now posts through a Page connected in the studio (Add channel, Facebook); social-publish sends a
--    synapse-leg Facebook post there.
-- 2. city_channels rows that only had a TryPost account (none today, kept for safety): switched off.
-- 3. Synapse-leg posts that failed, or are still retrying, because of TryPost: removed from the record (deleted_at), so the
--    studio stops reporting failures nobody can fix. Their history is kept in the table; only deleted_at is set.

update public.synapse_channels
   set is_active = false
 where trypost_account_id is not null and is_active;

update public.city_channels
   set is_active = false, autopilot = false, mirror_agency_posts = false, updated_at = now()
 where trypost_account_id is not null and meta_page_id is null and chat_id is null and is_active;

update public.social_posts
   set deleted_at = now()
 where leg = 'synapse'
   and deleted_at is null
   and status in ('failed', 'scheduled', 'draft')
   and failure_reason ilike '%trypost%';
