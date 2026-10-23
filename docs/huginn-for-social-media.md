# Huginn for Synapse's social media work

Research done 2026-10-24 in a cloud session on github.com/huginn/huginn (MIT licence, actively maintained). Huginn paths are relative to that repo. **[Verified]** = read in its code; **[Inferred]** = judgement about today's platform APIs, from the sources at the end. Platform prices and approval rules change: recheck before building.

## Verdict

Do not run Huginn. It has no agent for LinkedIn or YouTube uploads, and its X (Twitter) agents speak the retired v1.1 API, so it adds almost nothing for the platforms Synapse is missing. Take a few of its design patterns and build them as Deno code in our own functions: an X adapter in `social-publish`, then a small sweep that reads X replies into `social_comments`.

## What Huginn is [Verified]

- A self-hosted Ruby on Rails app: "Agents" watch sources and act, and pass JSON "Events" to each other (a self-hosted IFTTT/Zapier). `app/models/agent.rb`; 70+ agent types in `app/models/agents/`.
- Scenarios export/import as JSON (`lib/agents_exporter.rb`). Credentials are per-user name/value pairs (`app/models/user_credential.rb`), apparently stored unencrypted; OAuth tokens via OmniAuth (`app/models/service.rb`, providers in `config/initializers/devise.rb:244-311`: Twitter, Tumblr, Dropbox, Evernote, Google, Threads, Raindrop; none for LinkedIn or Facebook).
- Runs as a web process plus an always-on worker plus MySQL/Postgres (`Procfile`). No free hosting keeps the worker up; the Heroku guide estimates about $19/month (`doc/heroku/install.md`).
- MIT licence: logic can be ported into TypeScript commercially; keep the notice on any closely ported file.

## Relevant agents

| Agent | Platform | Works today? |
|---|---|---|
| TwitterPublish / Search / User / Favorites / Action (`twitter_*_agent.rb`) | X | Likely broken: OAuth 1.0a v1.1 via the `twitter` gem; X now posts through v2 on pay-per-use [Inferred] |
| TwitterStream | X | Retired in Huginn's own code (`twitter_stream_agent.rb:9`) [Verified] |
| ThreadsPublish / ThreadsUser (`lib/threads_api_client.rb`) | Threads | Probably works; text only; needs a Meta app [Inferred] |
| Telegram, Slack | Telegram, Slack | Works; Synapse already has Telegram |
| PostAgent / WebhookAgent | Any REST API, inbound glue | Works; no OAuth2 token refresh |
| RssAgent | Web, YouTube channel feeds | Works (read only, no upload) |
| WebsiteAgent, PhantomJsCloud | Scraping | Works technically, but scraping logged-in social sites breaks their terms |
| OpenAI LLM / image / video | Caption and media generation | Works; Synapse already has `social-generate` |
| Delay, DeDuplication, Trigger, Digest, Scheduler... | Glue | Works |

No agents exist for LinkedIn, YouTube upload, Facebook, Instagram, TikTok, Bluesky or Mastodon [Verified].

## Platform by platform

- **X.** No approval needed, only a developer app and paid credits. Pay-per-use: about $0.015 per post, but **$0.20 per post containing a URL**, $0.005 per post read, about $0.001 per owned read such as our own mentions [Inferred, docs.x.com]. Our captions carry `/s/<token>` links, so each linked post costs $0.20 (about $30/month at 5 linked posts a day). Decide a link policy: links on some posts, or the link in the profile. Build it as a Deno adapter (OAuth 2.0 PKCE, rotating refresh token, `POST /2/tweets`, image upload, mentions polling). `social-publish` already sends X to Synapse's own account (`SYNAPSE_ACCOUNT_ONLY`) and has `fitForX`. Browser automation or scraping of X breaks its terms.
- **LinkedIn company pages.** Blocked by access, not code: posting as a Page needs the vetted Community Management API (`w_organization_social`). ILIOS Digital must apply (registered company, verified business email, screencast review; weeks). Once approved: image upload + `POST /rest/posts`, 60-day tokens, comments via socialActions. Until then only manual posting stays within LinkedIn's terms.
- **YouTube Shorts.** `videos.insert` with Google OAuth works, but **projects that have not passed Google's compliance audit can only upload private videos**. ILIOS Digital must apply for the audit. Reading comments (`commentThreads.list`) is cheap and needs no special tier: the easiest comment read-back of all.
- **Threads.** Huginn's agent works but is text only, and Threads is tied to Instagram's Meta app (with the developer handling Instagram): coordinate first.
- **Nigerian property portals (Nairaland, Nigeria Property Centre, PropertyPro, Jiji).** No public posting API found; bots break their terms. Partnership feeds only.
- **Pinterest** can auto-pin from an RSS feed (cheap, low Nigerian reach). **Bluesky/Mastodon**: free and easy, negligible audience.
- **Mentions without an API:** parsing our *own* platform notification emails is within terms; scraping public pages is not.

## Recommended architecture

Port the logic into Deno edge functions, not a Huginn sidecar. Each new platform is one more entry in `NATIVE_ADAPTERS` (`social-publish/index.ts`); read-back is one sweep per platform into `social_comments` (unique on platform + platform_comment_id). Patterns worth taking from Huginn:
- success/failure result shapes (`twitter_publish_agent.rb:22-43`)
- a per-run cap (l.69)
- a since-id cursor (`threads_user_agent.rb:119-140`)
- throttled emission (DelayAgent)
- a health rule: "an event within N days and no recent errors"

Order:
1. X (credits only)
2. YouTube comment read-back, then upload after the audit
3. LinkedIn after Community Management approval
4. Threads after coordinating with the Instagram developer

A Huginn sidecar would cost $15-25/month plus a second app to maintain, and would still need the API code written (in Ruby), duplicating our queue, pg_cron, Vault tokens and retries.

## First step: X on Synapse's own account, out and back

1. `social_posts` row (platform x, synapse leg) claimed by `social-publish`.
2. `adapterFor` returns an `xAdapter`: refresh the token (X refresh tokens rotate; save the new pair first), upload up to 4 images, `POST /2/tweets`, write `platform_post_id`.
3. A `social-x-listen` function on pg_cron every 15 minutes reads `GET /2/users/:me/mentions?since_id=...`, keeps only replies whose `conversation_id` is one of our posts, and upserts them into `social_comments` (handle and text only); a `social_sync_cursors` table holds since_id, moved only after the write succeeds.
4. Tokens live in one Vault secret behind service-role RPCs, like `social_account_token`.

The cloud session wrote an untested skeleton for this (shared `_shared/x.ts`, the adapter, the listener and the migration); it is in the session report and can be rebuilt from this outline. Needed before it can go live (ILIOS Digital):
- an X developer app (confidential client; scopes `tweet.read tweet.write users.read media.write offline.access`) with credits
- a one-time connect route, deployed with `verify_jwt=false` like the Meta callback
- the link-policy decision

Keyword auto-replies on X would follow the Facebook rules: one reply, only to people who replied to our post.

## Sources

[X API pricing](https://docs.x.com/x-api/getting-started/pricing) · [LinkedIn Community Management API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-api-migration-guide) · [YouTube private-only for unaudited projects](https://forum.vvvv.org/t/vl-youtube/17803) · [Google audit](https://www.ayrshare.com/solutions/google-api-error-403-unverified-app-how-to-fix-the-audit-pipeline/). Several secondary sources are vendor blogs; recheck LinkedIn and YouTube details in the official consoles.
