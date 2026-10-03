-- Facebook Login for Business gets the configuration it has always needed.
--
-- Supplied by Eden, 2026-09-25, from App Dashboard > Facebook Login for
-- Business > Configurations.
--
-- Until this row exists, social-connect opens the CLASSIC Facebook dialog --
-- driven by a scope list -- against an app built as Login for Business, which
-- is driven by a configuration. Live proof, minutes before this was written:
--
--   GET .../social-connect?action=status
--   {"platforms":{"facebook":{"ready":true,"mode":"classic"}, ...}}
--
-- That mismatch is why social_accounts has never had a single row. Every other
-- part of the path has been correct for weeks: the redirect URI is allowlisted,
-- the secrets are set, the callback exchanges a code, the vault stores the
-- token, the publisher reads it back. The dialog was the first step and it was
-- opening the wrong product.
--
-- ── why this is a migration and not a secret ─────────────────────────────
--
-- The config id travels in the dialog URL in plain sight; any agency
-- connecting an account can read it out of their own address bar. It is
-- configuration, not a credential, and it spent weeks in the Supabase secrets
-- store -- where setting it needs an access token that cannot travel through a
-- chat, so exactly one person could do it and it did not get done.
--
-- Here it is a reviewable line in the repository, applied by the same workflow
-- as every other change, and recoverable by reading the file rather than by
-- remembering a terminal session. META_FB_CONFIG_ID still wins if it is ever
-- set; this answers only because nothing else does.
--
-- The real secrets are unaffected and stay where they are. The test is whether
-- the value appears in a URL the user's own browser displays: this does,
-- META_APP_SECRET does not.
--
-- NO REDEPLOY NEEDED. social-connect reads platform_settings per request, so
-- the next Connect press uses this. Confirm with action=status: mode must read
-- 'login-for-business'.
--
-- Stored as {"id": ...} to match the shape of the switch already in this table
-- ({"on": false} for the paywall). settingText() accepts a bare JSON string
-- too, but one shape in one table is worth more than the flexibility.
--
-- Quoted, deliberately: it is an identifier that happens to be digits, and a
-- JSON number would hand back 2272646810190199 as a float somewhere down the
-- line and lose the last digits. Meta ids are long enough for that to be real.

insert into platform_settings (key, value, note) values (
  'meta_fb_config_id',
  '{"id": "2272646810190199"}'::jsonb,
  'Facebook Login for Business configuration id, from the Meta App Dashboard. '
  'Not a credential -- it travels in the dialog URL. Without it social-connect '
  'opens the classic Facebook dialog, which a Login for Business app refuses, '
  'and no account can ever be connected. Overridden by META_FB_CONFIG_ID if '
  'that is ever set.'
) on conflict (key) do update
  set value = excluded.value, note = excluded.note, updated_at = now();
