# Social automation: setup guide and secrets checklist

How Synapse connects agencies' social accounts, publishes their listings, and how to configure, test and ship it.
Every secret name, table and function below is taken from the code, not from memory.

---

## 1. How it fits together

```
Agency dashboard (synapsecore.dev /app/agency)
  ├─ Connect a channel ──► social-connect (edge function) ──► platform OAuth ──► token saved in Supabase Vault
  ├─ Write / schedule ───► queue_social_post (database) ──► social_posts row (+ Synapse channel copies)
  └─ Activity screen ────► social_audit_log, social_routing_log (read-only)

pg_cron, every minute
  └─ drain_social_queue ──► social-publish (edge function) ──► one publisher per platform ──► the platform's API
```

| Piece | What it does |
|---|---|
| `social-connect` | OAuth start/callback for every platform; saves tokens to Vault via `connect_social_account`; `?action=status` says which platforms are configured |
| `social-publish` | Claims due posts, reads tokens, renews expiring ones (TikTok, Instagram, YouTube), retries, saves results. Publishes Facebook itself; hands the others to their own function |
| `publish-instagram`, `publish-telegram`, `publish-tiktok`, `publish-x`, `publish-youtube` | One per platform. Callable only by `social-publish` with the service key (401 without a key, 403 with any other) |
| `social-generate` | AI captions (Gemini) |
| `social-reply`, `telegram-webhook`, `post-metrics` | Comment replies, the Telegram bot, post statistics |
| Database | `social_accounts` (tokens are Vault references, never plain text), `social_posts`, `social_audit_log`, `social_routing_log`, `city_channels`, `synapse_channels` |

**Tokens never reach the browser, GitHub or logs.** They are stored in Vault, readable only by the service role
(`social_account_token`, `social_account_refresh_token`), and the audit log records *that* a token changed, never its value.

---

## 2. Environments

| | Live | Staging (testing) |
|---|---|---|
| Supabase project | `synapse-platform` · `bhrhejpekmhbhwryjhgk` | `synase-stage` · `mqrdthgqkndftiisghhi` |
| OAuth redirect (all platforms) | `https://bhrhejpekmhbhwryjhgk.supabase.co/functions/v1/social-connect` | `https://mqrdthgqkndftiisghhi.supabase.co/functions/v1/social-connect` |
| Google sign-in callback | `https://bhrhejpekmhbhwryjhgk.supabase.co/auth/v1/callback` | `https://mqrdthgqkndftiisghhi.supabase.co/auth/v1/callback` |
| Local site | — | `Synapse-Demo/web/.env.local` → `NEXT_PUBLIC_SUPABASE_URL` set to staging |

Secrets cannot be copied from one project to another: Supabase stores them write-only. Each environment gets its own,
from the platform developer sites. **Telegram must use a different bot on each** — a bot's webhook can point at one project only.

---

## 3. Secrets checklist

Set with `npx supabase@latest secrets set NAME=value --project-ref <ref>`, the dashboard (Edge Functions → Secrets),
or the **Set function secret** GitHub workflow. Nothing here goes in `.env` files or the repository.

| Secret | Used by | Needed for | Where to get it | Live | Staging |
|---|---|---|---|:-:|:-:|
| `META_APP_ID`, `META_APP_SECRET` | social-connect | Facebook Pages (and Instagram via a Page) | developers.facebook.com → app → Settings → Basic | ☐ | ☐ |
| `META_FB_CONFIG_ID` | social-connect | Facebook Login for Business configuration (optional; also read from `platform_settings.meta_fb_config_id`) | Meta app → Facebook Login for Business → Configurations | ☐ | ☐ |
| `META_IG_APP_ID`, `META_IG_APP_SECRET` | social-connect | Instagram professional accounts (Instagram Login) | Meta app → Instagram → API setup with Instagram login | ☐ | ☐ |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | social-connect, social-publish | TikTok | developers.tiktok.com → app (use the **Sandbox** keys for testing) | ☐ | ☐ |
| `TIKTOK_MEDIA_BASE` | publish-tiktok | Staging only: the verified photo address prefix (default is live's `https://www.synapsecore.dev/m/`) | Set to `https://mqrdthgqkndftiisghhi.supabase.co/storage/v1/object/public/` after verifying that prefix in TikTok | — | ☐ |
| `TELEGRAM_BOT_TOKEN` | social-connect, social-publish, telegram-webhook, synapse-studio | Telegram channels | Telegram → @BotFather → `/newbot` (new bot per environment) | ☐ | ☐ |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | social-connect, social-publish | YouTube | console.cloud.google.com → Google Auth Platform → Clients (Web application) | ☐ | ☑ |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | publish-x | X, posted from Synapse's own account (paid X API plan) | developer.x.com → app (Read and write) → Keys and tokens | ☐ | ☐ |
| `GEMINI_API_KEY` | social-generate, synapse-studio | AI captions | aistudio.google.com/apikey | ☐ | ☐ |
| `SOCIAL_GEMINI_MODEL`, `SOCIAL_GEMINI_FALLBACK_MODEL`, `STUDIO_GEMINI_MODEL`, `STUDIO_GEMINI_FALLBACK_MODEL` | social-generate, synapse-studio | Optional model overrides | — | opt. | opt. |
| `PORTAL_URL`, `STUDIO_URL` | social-connect, social-reply | Where people return after connecting | The dashboard addresses | ☐ | ☑ |
| `META_REDIRECT_URI` | social-connect | Optional; ignored unless it equals the function's own address | — | opt. | opt. |

**Database settings (not secrets):**

| Setting | Where | Purpose |
|---|---|---|
| Vault `project_url`, `service_role_key` | Supabase → Vault | The scheduled jobs call `social-publish` with these. `service_role_key` is the project's legacy `service_role` key (starts `eyJ`). Staging: ☑ both |
| `platform_settings.synapse_twins` | table | Switches Synapse's own channel copies on or off (Synapse studio) |
| `platform_settings.founder_telegram_chat_id` | table | Where Telegram Story kits are sent |

Check what a project is missing at any time — no sign-in needed:
`https://<ref>.supabase.co/functions/v1/social-connect?action=status`

---

## 4. Platform setup

Use the environment's **OAuth redirect** from section 2 wherever a redirect / callback URI is asked for.

**Facebook Pages** — developers.facebook.com: Business app → add Facebook Login for Business → add the redirect →
permissions for managing and publishing to Pages → copy App ID / Secret. Live use needs Meta App Review.

**Instagram (professional accounts)** — same Meta app → Instagram → *API setup with Instagram login* → add the redirect
→ copy the Instagram app ID / secret. The account must be Business or Creator. Scopes asked for:
`instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`.
In development mode, add test accounts under App roles → Instagram testers. Photos must be JPEG; 100 posts per 24 hours.

**TikTok** — developers.tiktok.com: create the app → Login Kit (redirect) + Content Posting API → scopes
`user.info.basic`, `video.upload`. For testing, use a **Sandbox** and add your account as a target user. Posts arrive in
the agent's TikTok **inbox** as drafts. TikTok fetches photos only from a verified URL prefix (URL properties).

**Telegram** — @BotFather → `/newbot` → token. The agency adds the bot as an **admin with Post Messages** in its
channel, then connects it from the dashboard. The webhook is registered automatically and authenticated with a secret
derived from the token.

**YouTube** — Google Cloud: new project → enable *YouTube Data API v3* → Google Auth Platform (External; while in
*Testing*, add each tester under Audience → Test users) → Clients → *Web application* → authorised redirect URIs: the
OAuth redirect (and the Google sign-in callback, if site sign-in with Google is wanted). Scopes:
`youtube.upload`, `youtube.readonly`. Video only. In Testing mode connections expire after 7 days. Videos from an
unaudited app are **private** until the project passes Google's YouTube API audit.

**X** — developer.x.com with **Synapse's** X account: app → User authentication settings → *Read and write* →
generate the API key/secret, then the access token/secret (after enabling write). Requires a paid X API plan; without
the four keys, X posts are marked "not configured" and nothing else is affected.

**AI captions** — aistudio.google.com/apikey → `GEMINI_API_KEY`.

---

## 5. Shipping to live

Order matters: database first, then functions, then the dashboard.

1. **Database** — GitHub → Actions → **Migrate database** → `plan` (dry run), read it, then `apply`. Migrations never
   run on push. New in this release:
   - `20261109100000_a_post_can_be_cancelled.sql`, `20261109100100_cancelling_a_post_keeps_its_history.sql`
   - `20261109110000_who_did_what_and_where_it_went.sql` (audit and routing logs)
   - `20261109120000_a_viewer_role.sql`, `20261109120100_a_viewer_can_look_but_not_touch.sql`
   - `20261109130000_several_accounts_per_platform.sql`
2. **Edge functions** — deploy automatically when merged to `main` (only changed folders).
3. **Dashboard** — Vercel deploys `Synapse-Demo` on merge.
4. **Secrets** — set any new ones (section 3) before switching a platform on.
5. **Check** `?action=status` and send one test post per platform from a test agency.

Rolling back: edge functions — redeploy the previous commit; dashboard — Vercel "promote" the previous deployment;
database — each migration is additive (new tables, functions, a role, a replaced index) and its effect is described at
the top of the file.

---

## 6. Acceptance test checklist

| # | Check | How |
|---|---|---|
| 1 | Connect each platform through its official sign-in | Dashboard → Social studio → Add a channel |
| 2 | Two accounts on one platform; the scheduler offers an account picker | Connect a second account |
| 3 | Disconnect and reconnect | Channel row → Disconnect; connect again |
| 4 | Preview, schedule, post now, reschedule, cancel | Social studio pipeline (*Hold to cancel* on a scheduled card) |
| 5 | Statuses: Draft, Scheduled, Publishing, Published, Failed, Cancelled; listing summary Partially published | `social_listing_publish_status` |
| 6 | A failed post retries without posting twice | Retry ladder; uncertain posts are marked for checking, not resent |
| 7 | Listings route to the right Synapse channels; agencies cannot choose them | Activity → Channel routing |
| 8 | Roles: Owner, Manager, Editor can act; Viewer can only look | Invite a Viewer; try to post |
| 9 | Full history of who did what | Activity → History |
| 10 | No token in the browser, repository or logs | Browser dev tools / repo search / function logs |

---

## 7. Known limits and approvals

- **Meta** (Facebook, Instagram): App Review before agencies outside the app's roles can connect.
- **TikTok**: Content Posting API review; until then Sandbox target users only.
- **Google** (YouTube): verification + YouTube API audit; until then testers only, private videos, 7-day connections.
- **X**: paid API plan.
- A Viewer still sees some action buttons; the database refuses the action. Hiding them is a dashboard follow-up.
