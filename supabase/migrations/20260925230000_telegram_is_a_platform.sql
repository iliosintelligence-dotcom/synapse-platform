-- migrate: no-transaction
--
-- Telegram is a platform.
--
-- ALONE IN ITS OWN FILE, and opting out of the transaction wrapper, for one
-- reason: Postgres refuses to USE an enum value in the same transaction that
-- added it. Everything that references 'telegram' therefore has to commit
-- after this does, which is what the next migration is for.
--
-- The no-transaction marker means a failure here leaves the database
-- part-migrated. That is safe precisely because this file is one idempotent
-- statement: ADD VALUE IF NOT EXISTS either adds the label or finds it
-- already there.
--
-- ── why Telegram, when Meta is the channel agencies live on ──────────────
--
-- Because it is the only one where the link works. Everything in
-- docs/SOCIAL_TO_PLATFORM_ROUTING.md exists to route around a platform's
-- refusal to carry a tappable link: Facebook buries it below the fold and
-- outranks it with the Page button, Instagram does not linkify captions at
-- all, and Stories published through the API take no sticker.
--
-- A Telegram message carries real links and inline buttons. A listing posted
-- there can have a "View this home" button under the photographs, and the
-- buyer is one tap from the listing. No fold, no competing call button, no
-- bio-link indirection.

alter type social_platform add value if not exists 'telegram';

-- AND A CHANNEL TO ATTRIBUTE IT TO. Without this every Telegram click
-- lands in 'organic', which is the bucket for traffic we cannot explain --
-- so a channel we deliberately built would be indistinguishable from one
-- we never made. The click reports already separate the others by name.
--
-- Worth noting while here: short-link already counts 'telegrambot' among
-- the preview crawlers it excludes from human clicks, so Telegram's own
-- link-preview fetch will not inflate the numbers on the first post.
alter type attribution_channel add value if not exists 'telegram';
