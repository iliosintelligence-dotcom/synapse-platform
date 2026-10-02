-- migrate: no-transaction
--
-- Telegram is a content type too.
--
-- The same gap 0110 closed for X. social_platform has had 'telegram' since
-- 20260925230000, so a channel could be connected and posted to -- but
-- content_type, the enum generated_content files a draft under, had no value
-- for it. saveGeneration drops any channel without a content type, silently,
-- so the composer could not offer Telegram at all, and a Telegram post could
-- only ever carry a caption written for a different platform.
--
-- Telegram's caption is not any other platform's: it is cut at 1024
-- characters and carries its own "View this home" button, so it is written
-- short and never points at a link. social-generate now writes one.
--
-- Alone and outside the transaction wrapper for the usual reason: Postgres
-- refuses to use an enum value in the transaction that added it. One
-- idempotent statement, so a failure here cannot leave anything half-done.

alter type content_type add value if not exists 'telegram_post';
