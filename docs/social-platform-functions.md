# Social platforms: one function each

Written 2026-11-05. Supabase is the backend for all social publishing. Every platform has its own edge function, and they all follow the same process as Facebook:

```
connect → token in Vault (connect_social_account) → social_accounts row
       → queue_social_post → social-publish claims → social-<platform> publishes and settles the row
       → refresh-social-tokens renews tokens → read-back fills likes, comments and social_comments
```

Platforms differ in four places only: how an account is connected, how a post is sent, how a token is renewed, and how engagement is read back. Everything else lives once in `supabase/functions/_shared/social/core.ts`.

## The functions

| Function | Connect | Publish | Token renewal | Read-back |
|---|---|---|---|---|
| `social-facebook` | `social-connect` (Facebook Login) | photo, gallery, video, text | Page tokens do not expire | `post-metrics` |
| `social-instagram` | `social-connect` (via a Page, or Instagram Login) | Story, Reel, photo, carousel (JPEG only) | 60-day token, renewed 10 days ahead | `post-metrics` |
| `social-telegram` | `social-connect` + `telegram-webhook` (bot + code) | photo or video with a button, album, text; Story kit | none (bot token) | none |
| `social-tiktok` | `social-connect` (TikTok Login Kit) | photos to the agent's TikTok inbox | 24-hour token, renewed 90 min ahead | none |
| `social-x` | **`social-x` itself** (OAuth 2.0 + PKCE) | text + up to 4 photos, fitted to 280 | 2-hour token, rotating refresh | counts + replies (mentions) |
| `social-youtube` | **`social-youtube` itself** (Google OAuth + PKCE) | one video, as a Short | 1-hour token | counts + comments |
| `social-linkedin` | **`social-linkedin` itself** (LinkedIn OAuth) | text + 1–20 photos, profile or company page | 60-day token (refresh only for LinkedIn partners) | company-page counts + comments |

Facebook, Instagram and TikTok are still **connected** through `social-connect`, because their redirect URI is registered with Meta and TikTok as `/functions/v1/social-connect`. Moving them would mean changing those apps first. Their **publishing** now lives in their own functions.

Every platform function answers the same actions: `status`, `start`, the OAuth callback, `pick` (choose between held accounts), and the service-only `publish`, `refresh` and `sweep`.

## Order of deployment

1. **Run the migration** `20261105090000_every_platform_has_its_own_function.sql` (Actions → migrate). It must land before the X, YouTube and LinkedIn sign-ins are used. Facebook, Instagram, Telegram and TikTok publishing does not depend on it.
2. Merge. The deploy workflow deploys every function, because `_shared/` changed.
3. Set the secrets below for each new platform, then press Connect in the portal.

## What each platform needs from ILIOS Digital

| Platform | Secrets | Register this redirect | Approval needed before agencies outside the app's testers can use it |
|---|---|---|---|
| Facebook | already set | already registered | Meta App Review (Advanced Access) |
| Instagram | `META_IG_APP_ID`, `META_IG_APP_SECRET` for standalone accounts | already registered | Meta App Review (`instagram_content_publish`) |
| Telegram | `TELEGRAM_BOT_TOKEN` (already set) | none | none |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | already registered | TikTok's app audit (until then: private accounts only) |
| X | `X_CLIENT_ID`, `X_CLIENT_SECRET` | `https://bhrhejpekmhbhwryjhgk.supabase.co/functions/v1/social-x` | none, but X API credits (pay-per-use; a post with a link costs more) |
| YouTube | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://bhrhejpekmhbhwryjhgk.supabase.co/functions/v1/social-youtube` | Google's YouTube API audit (until then: uploads are private) |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`; `LINKEDIN_PAGES=true` once approved | `https://bhrhejpekmhbhwryjhgk.supabase.co/functions/v1/social-linkedin` | none for profiles ("Share on LinkedIn"); the Community Management API for company pages |

### X app settings
User authentication settings: OAuth 2.0 on, type **Web App (confidential client)**, permissions **Read and write**, callback as above. Scopes asked for: `tweet.read tweet.write users.read media.write offline.access`.

### Google
Google Cloud console: enable **YouTube Data API v3**; OAuth client of type **Web application** with the callback above; consent screen scopes `youtube.upload` and `youtube.readonly`.

### LinkedIn
Products: **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn** (self-serve). Add **Community Management API** for company pages, then set `LINKEDIN_PAGES=true`. The API version defaults to `202610`; set `LINKEDIN_VERSION` to move it (LinkedIn retires each version after about a year).

## What the portal needs (Synapse-Demo)

The backend is complete; the portal needs three small changes to use it:

1. **Connect buttons for X, YouTube and LinkedIn.** `social-connect?action=status` now lists them with `ready` and `fn`. A button calls `GET /functions/v1/<fn>?action=start` with the member's JWT and sends the browser to the returned `url`. The callback returns to the portal with `?connected=<platform>&platform=<platform>` (or `connected=error&detail=…`).
2. **The LinkedIn page chooser.** With company pages on, the callback returns `?connected=choose&platform=linkedin&detail=<pick id>`. The chooser is the Facebook one, pointed at `GET/POST /functions/v1/social-linkedin?action=pick` (`{ pick, ids }`).
3. **Composer platforms.** Offer YouTube only for a listing with a video, and X, YouTube and LinkedIn only when that account is connected.

## Behaviour changes worth knowing

- A rehearsal run no longer consumes a post queued for real; it puts it back untouched.
- A failure the platform calls permanent (bad media, no permission, no account connected) fails at once instead of retrying three times over half an hour.
- An agency's X post goes to the agency's own X account, no longer to Synapse's X (TryPost is gone).
- Synapse's autopilot and mirroring now reach the Facebook Pages the studio connected; before, they only reached Telegram.
- Instagram refuses non-JPEG photos with a clear message before Meta is asked.
- Telegram keeps the listing link whole when a caption is shortened.
- Tokens are renewed hourly by `refresh-social-tokens`, not only when a post happens to go out.
- The Instagram Login connection exchanged its token with the Facebook secret, so the token died after an hour. Fixed in `social-connect`.

## Not in this change

- Synapse's own X, YouTube and LinkedIn accounts in the studio (the studio still connects Facebook Pages and Telegram channels).
- Video to X and LinkedIn, and video to TikTok.
- Keyword auto-replies on X, YouTube and LinkedIn (Facebook and Instagram have them).
