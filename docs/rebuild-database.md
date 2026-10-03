# Rebuilding the database from nothing

Use this if the production project is lost, or to make a copy (a staging
project, a restore drill).

## Why the repo alone is not enough

The live database has recorded **220 migrations**. This repo has files for
fewer than 160 of them: **64 were applied straight to the database** (small
patches and fixes), and the `0001_…` to `0109_…` files are a rough
reconstruction, not what actually ran. Running the files in the repo against an
empty project would not give you production's schema.

The database keeps the SQL of everything it ran, in
`supabase_migrations.schema_migrations.statements`. That is the source. The
migration script has two modes for it:

| Mode | What it does |
| --- | --- |
| `export` | Reads the recorded history (read-only) and writes one `.sql` file per migration into a folder on **your machine**. |
| `bootstrap` | Replays that folder, in version order, into a **new, empty** project. Each file runs in a transaction together with its record. |

The exported folder is the **whole schema**. Do not commit it, do not attach it
to an issue, and do not run `export` in CI (the repo and its logs are public).

## Steps

You need Node 22 and a Supabase access token (the same one the workflows use).
Never paste the token into chat or a commit.

1. **Export** from production, on your own machine:
   ```bash
   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=bhrhejpekmhbhwryjhgk \
     HISTORY_DIR=./migration-history node scripts/migrate.mjs export
   ```
2. **Create a new, empty Supabase project.** Note its reference.
3. **Enable what migrations assume** in the new project (Database > Extensions):
   `postgis`, `pg_cron`, `pg_net`, `vector`, `uuid-ossp`, and Vault.
4. **Bootstrap** it:
   ```bash
   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=<new project> \
     HISTORY_DIR=./migration-history node scripts/migrate.mjs bootstrap
   ```
   It refuses unless the project is named explicitly, is not production, has
   no tables in `public`, and has no recorded migrations. It stops at the first
   file that fails, naming it; everything before that file is applied.
5. **Catch up** with anything the repo has added since the export:
   ```bash
   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=<new project> node scripts/migrate.mjs apply
   ```
6. **Recreate what migrations do not carry** (see below).

## What migrations do not carry

- **Vault secrets** the scheduler reads: `service_role_key` and `project_url`
  (`drain_social_queue` does nothing without them).
- **Edge function secrets** (names only): `ANTHROPIC_API_KEY`,
  `PAYSTACK_SECRET_KEY`, `META_APP_ID`, `META_APP_SECRET`, `META_FB_CONFIG_ID`,
  `META_IG_APP_ID`, `META_IG_APP_SECRET`, `META_REDIRECT_URI`,
  `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`,
  `TRYPOST_API_KEY`, `TRYPOST_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`, `GOOGLE_MAPS_API_KEY`, `PORTAL_URL`, `SITE_URL`,
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, and the
  provider switches `TOJU_LLM_PROVIDER` / `ANALYZE_LLM_PROVIDER` /
  `OPENAI_API_KEY` if used.
- **Auth settings:** site URL and redirect URLs (the `auth-urls` workflow sets
  these), email/SMTP, providers.
- **Edge functions:** deploy them with the `Deploy edge functions` workflow
  (dispatch with `all`) after pointing `SUPABASE_PROJECT_REF`'s secrets at the
  new project.
- **Webhooks:** Paystack (`paystack-webhook`), Telegram, Meta, TikTok all hold
  the old project's URL and must be pointed at the new one.
- **Data:** this restores the schema and any data migrations inserted, not
  customer data. Customer data comes from a Supabase backup (Dashboard >
  Database > Backups), which is separate and should be tested on its own.

## Status

The script's behaviour is tested against a stand-in for the Supabase API
(`node scripts/migrate.history.test.mjs`): the files export in order, and
bootstrap refuses every unsafe target and applies in version order.

**It has not yet been rehearsed against a real empty project.** Until it has,
treat a first real run as a drill and expect to fix a file or two (migrations
that assumed a setting or an extension that has to be enabled first). A
Supabase branch or a throwaway project is the right place to do it.
