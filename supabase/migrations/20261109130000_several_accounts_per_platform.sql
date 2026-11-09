-- Several accounts on one platform per agency (contract: "multi-account connect").
--
-- Everything else this needs already exists, since 2026-09-25 (an_agent_brings_their_own_account): a post names its
-- account (social_posts.social_account_id, validated by queue_social_post against the agency and platform);
-- social-publish keys connections by account id and falls back to the agency's OLDEST account for a post that names
-- none; post-metrics and social-reply read the post's own account; the scheduler shows an account picker once a
-- platform has two. connect_social_account has always replaced only the SAME account (agency, platform,
-- platform_account_id) on reconnect.
--
-- What still refused a second account was this index from 0055, written when an agency had one account per platform:
-- connecting a second Instagram failed with a unique violation. It becomes one live row per ACCOUNT -- the rule
-- connect_social_account already follows -- so the same account still cannot be connected twice.
--
-- Safe on existing data: the old index allowed at most one live row per (agency, platform), so no (agency, platform,
-- account) can be duplicated today.

begin;

drop index if exists public.social_accounts_one_live_per_platform;

create unique index if not exists social_accounts_one_live_per_account
  on public.social_accounts (agency_id, platform, platform_account_id)
  where deleted_at is null;

comment on index public.social_accounts_one_live_per_account is
  'One live row per connected account. An agency may hold several accounts on a platform; posts name which (social_posts.social_account_id).';

commit;
