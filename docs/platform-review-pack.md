# Meta App Review pack

**Rewritten 2026-09-25.** The previous version (13 August) covered two
Instagram Login permissions. The code now requests twelve across two login
flows, and almost everything else in it had stopped being true — it said the
Instagram adapter was not written, that `verify_jwt` had to be flipped by hand,
and that there was no data-deletion page. All three are now false.

Every justification below is written to be **literally true of the code as it
stands**. Where a permission does less for us than its name suggests, the text
says so. A reviewer who finds a justification that overclaims rejects the
permission; one who finds it precise tends to approve it.

---

## Why this is the most important thing on the list

While the app is in **Development Mode**, Meta refuses the Connect dialog to
anybody without a role on the app. The owner can connect; a real agency
cannot, and no agency should ever be asked to become a Tester on our app.

**App Review → Advanced Access → Live mode** is the only thing that lets an
agency press Connect and have it work. Nothing in our code can substitute for
it. Reviews take days and are sometimes returned for changes, so starting early
matters more than starting perfectly.

---

## How to do it — step by step

### Before you open the review form

1. **Business verification.** App Dashboard → **Settings → Basic → Business
   verification**, or in Meta Business Suite → Business settings → Security
   Centre. Advanced Access is not granted to an unverified business. This
   needs the registered company name, address and a document proving them —
   it is also the `[NEEDS LEGAL]` gap in the privacy policy, so both close
   together.
2. **Privacy policy URL** — App Dashboard → Settings → Basic. Use
   `https://www.synapsecore.dev/privacy`. Since 2026-09-27 it has a
   "Social accounts an agency connects" section naming Facebook Pages,
   Instagram, TikTok and Telegram and what we read from each.
3. **Data deletion instructions URL** — same screen. Use
   `https://www.synapsecore.dev/your-data#social`. That section (added
   2026-09-27) says how to disconnect, that tokens are deleted at once, how to
   have everything deleted by email, and what a commenter can ask for.
4. **App icon, category, and contact email** filled in on the same screen.
   Incomplete basic settings block submission outright.
5. **Tick every permission below on Login for Business configuration
   `2272646810190199`.** Under Login for Business the configuration decides
   what the dialog asks for, and a permission that is not in it cannot be
   demonstrated in the screencast.

6. **Access verification** may be asked for after business verification,
   because Synapse reaches other businesses' Pages (Meta calls this being a
   "tech provider"). It is a short form about how Synapse serves agencies; it
   appears in the dashboard when it applies.

### Make one real call with every permission first

Meta's App Review page counts the API calls made with each permission and
expects at least one successful call in the last 30 days before it accepts a
request for Advanced Access. As of 2026-09-27 **no Facebook or Instagram
account has ever been connected** (`social_accounts` holds only TikTok and
Telegram rows), so every count is zero. In Development Mode the app's own
admin can do all of this with their own Page:

| Do this in the portal | Calls made | Permissions exercised |
|---|---|---|
| Social studio → Add channel → Facebook, tick the Page and its Instagram | `/me/accounts` with `instagram_business_account`, `/{page}/call_to_actions` (social-connect) | `pages_show_list`, `pages_manage_metadata`, `instagram_basic` |
| New post → Facebook + Instagram → Post now | Page feed/photos publish, IG container + publish (social-publish) | `pages_manage_posts`, `instagram_content_publish` |
| Wait for the metrics sweep | like/comment/share counts (post-metrics) | `pages_read_engagement`, `instagram_basic` |
| Comment on both posts from a second account; wait for the sweep | `/{post}/comments` (post-metrics) | `pages_read_user_content`, `instagram_manage_comments` |
| Switch on comment replies; comment the keyword on the IG post | private reply (social-reply) | `pages_messaging` |

These are the same steps as the screencasts, so record while doing them.

### Recording the screencasts

You need a connected account to record them, so **tomorrow's rehearsal is the
recording session.** Add the test agency's Facebook account under App roles →
**Testers** first (Development Mode will refuse it otherwise), then record
while doing the real thing. See *The screencast* below for the shot list.

### Submitting

6. App Dashboard → **App Review → Permissions and Features.**
7. For each permission below, press **Request Advanced Access**. It moves into
   the submission.
8. For each, paste the **justification** from this document, attach the
   **screencast**, and fill in the step-by-step instructions.
9. **Test credentials** — a Synapse agency login the reviewer can use from a
   fresh browser, with no OTP to a Nigerian number they cannot receive. Test
   this yourself in a private window before submitting.
10. Submit. Watch the App Review page and the email on the app — reviewers
    reply there, and an unanswered question expires the submission.
11. Once approved: App Dashboard → toggle **App Mode: Live.**

---

## The twelve permissions

Two login flows, because agencies run Instagram two ways and we support both.

### Facebook Login for Business — the main path

For an agency whose Instagram is linked to a Facebook Page, which is most of
them. One dialog returns the Page and the Instagram account together.

| Permission | What we do with it | What we do NOT do |
|---|---|---|
| `pages_show_list` | Read the list of Pages the person manages (`/me/accounts`) so they can choose which to connect, and obtain each chosen Page's access token. | Nothing with Pages they did not choose to share. |
| `pages_manage_metadata` | Required by Meta as a dependency of `pages_messaging`, and by `/me/accounts` to return Pages. We also READ the Page's action button (`/{page-id}/call_to_actions`, GET) so we can tell the agency whether it sends buyers off-platform. | We do not subscribe to webhooks and we do not change any Page setting. The write endpoint for the action button is deprecated and we never call it. |
| `pages_manage_posts` | Publish a property listing the agency created on Synapse to that agency's own Page, at a time the agency scheduled. | We never edit or delete posts, and never publish anything the agency did not initiate. |
| `pages_read_engagement` | Read like, comment and share **counts** on posts we published for the agency, so the agency can see what each listing earned. Also a dependency of `pages_manage_posts`. | We do not read Page insights, followers, or audience data. |
| `pages_read_user_content` | Read the **text of comments** buyers leave on the agency's listing posts, so the agency can answer them from Synapse. Also a dependency of `instagram_basic`. | We keep the commenter's handle and the text only — no profile id, photo or other data — and delete it after 90 days. Nothing is aggregated across posts or agencies. |
| `instagram_basic` | Read the linked Instagram professional account's id and username (so the agency sees which account is connected), and like and comment counts on media we published. | We do not read followers, insights, or other users' media. |
| `instagram_content_publish` | Publish the agency's listing to their linked Instagram account: feed photo, carousel, Reel, or Story. | Nothing is published without the agency scheduling it. |
| `instagram_manage_comments` | Read the text of comments on media we published for the agency. Required, with `pages_messaging`, to send a private reply. | We never post public replies, hide or delete comments. |
| `pages_messaging` | Send **one** private reply to a person who commented a keyword the agency's caption asked for (e.g. "Comment PRICE"), containing the link to that listing. | Off by default; only an agency owner or admin can turn it on. One message per comment, ever — no follow-ups, no sequences. Never to anyone who did not comment the keyword. The message says it is automated. |

### Instagram API with Instagram Login — for agencies with no Page

| Permission | What we do with it |
|---|---|
| `instagram_business_basic` | Read the account's id and username so the agency sees which account is connected. |
| `instagram_business_content_publish` | Publish the agency's scheduled listing posts to their own account. |
| `instagram_business_manage_comments` | Read comments on media we published, so the agency can answer them. Same limits as `instagram_manage_comments` above. |

**This flow also needs the Instagram product added to the app** (App Dashboard
→ Add product → Instagram → API setup with Instagram login), which issues its
own App ID and Secret and has its own redirect URI box. It is not set up yet
and is the lower priority — submit the Facebook Login permissions first.

### Deliberately NOT requested

Worth stating in the submission notes — reviewers treat restraint as evidence
of a real use case:

- `business_management` — nothing here manages Business Manager assets.
- `pages_manage_engagement` — we never write or moderate in public.
- `instagram_manage_insights`, `read_insights` — we measure through our own
  short links, not platform analytics.
- Any `ads_*` permission — Synapse buys no advertising.

---

## Justification text, ready to paste

Meta asks per permission: *how will your app use this, and why is it
necessary?* These are written to be pasted as they are.

> **pages_show_list** — Synapse lets a property agency publish its own listings
> to its own Facebook Page. When the agency connects, we list the Pages they
> manage so they can choose which to connect, and obtain the access token for
> the Pages they select. We do nothing with Pages they do not select.

> **pages_manage_metadata** — Required as a dependency of pages_messaging, and
> by /me/accounts to return the agency's Pages. We also read (never write) the
> Page's call-to-action button, so we can tell the agency when it sends buyers
> to a phone call instead of to the listing. We do not subscribe to webhooks
> and do not change Page settings.

> **pages_manage_posts** — The core feature. An agency creates a property
> listing on Synapse, schedules it, and we publish it to their own Page at the
> time they chose. Every post is initiated by the agency, is about a property
> they listed, and links back to that listing. We never edit or delete posts.

> **pages_read_engagement** — We read the like, comment and share counts on
> posts we published for the agency, so they can see which listings earned
> attention. We do not read insights, follower data or audience data.

> **pages_read_user_content** — Buyers ask questions in the comments on listing
> posts ("how much?", "is it still available?"). We read the text of those
> comments on posts we published so the agency can see and answer them in one
> place. We store only the commenter's display name and the comment text, and
> delete them after 90 days.

> **instagram_basic** — Most agencies' Instagram is linked to their Facebook
> Page. We read the linked account's id and username so the agency can see
> which Instagram account is connected, and read like and comment counts on
> media we published for them.

> **instagram_content_publish** — We publish the agency's scheduled property
> listings to their own linked Instagram account as feed posts, carousels,
> Reels or Stories. Nothing is published unless the agency scheduled it.

> **instagram_manage_comments** — We read the text of comments on Instagram
> media we published for the agency, so they can answer buyers' questions. We
> do not post, hide or delete comments. It is also required to send the
> private reply described under pages_messaging.

> **pages_messaging** — Instagram captions cannot contain a working link, so
> agencies write "Comment PRICE and we'll send you the link". When a person
> comments that exact keyword, we send them one private reply containing the
> link to that listing. It is off by default and only an agency owner or admin
> can enable it. One reply per comment, never a follow-up, never to anyone who
> did not comment the keyword, and the message states it is automated.

---

## The screencast

Most rejections are about the video, not the text. One continuous take per
permission group, no cuts, text legible, narrated in English.

**Group 1 — connect and publish** (`pages_show_list`, `pages_manage_metadata`,
`pages_manage_posts`, `pages_read_engagement`, `instagram_basic`,
`instagram_content_publish`, `pages_read_user_content`):

1. Open the Synapse agency portal signed out; sign in as the test agency.
2. Show a real listing.
3. Social studio → Channels → **Connect** on Facebook.
4. **Show the permission dialog in full** — the business portfolio step, the
   Page and Instagram account being ticked, and the permissions screen. Do not
   scrub past this; it is the part under review.
5. Land back in the portal showing the connected Page and Instagram handle.
6. Schedule the listing to both, with **Post now**.
7. **Open the Page and the Instagram account and show both posts live.**
8. Back in the portal, show the post's card with its counts.

**Group 2 — comments** (`pages_read_user_content`,
`instagram_manage_comments`):

1. From a second account, comment on the live post.
2. In the portal, show that comment's text appearing on the post's card.

**Group 3 — private replies** (`pages_messaging`):

1. As the agency owner, open the comment-reply control, show the message and
   the automated notice, and switch it on.
2. From the second account, comment the keyword on the Instagram post.
3. Show the private reply arriving in that account's DMs, with the listing
   link. Tap it and show the listing opening.

---

## Privacy policy — what must be on it before submitting

Meta reads the page. It must say, in words a reviewer can find:

- that Synapse connects to **Facebook Pages and Instagram professional
  accounts** at the agency's request;
- what we read: Page and account ids and names, post engagement counts, and
  comment text on posts we published;
- that access tokens are stored encrypted and **destroyed on disconnect** —
  true today (`disconnect_social_account` deletes the Vault secret);
- that comment handles and text are kept **90 days** — true today
  (`purge-social-comments` cron);
- how to request deletion: `/your-data`.

**Done 2026-09-27:** `privacy.html` now covers all five points in "Social
accounts an agency connects". The "Draft" label and "not a reviewed legal
document" banner were removed the same day at the founder's decision. Still
visible: three `[NEEDS LEGAL]` placeholders (company name and address, data
region and cross-border notice, privacy contact).

---

## Not Meta, and needing no review

- **Telegram** — a bot added as a channel administrator. No review, no app
  mode, no permissions. Live since 2026-09-27.
- **TikTok** — a separate app and review, submitted 2026-09-27 (see below).

---

## Suggested order

Revised 2026-09-27, when review was started.

1. ~~Start business verification~~ — **done**: the founder confirmed on
   2026-09-28 that the business is already verified.
2. **Basic settings**: privacy URL, data deletion URL (`/your-data#social`),
   icon, category, contact email. (Privacy section: done.)
3. **Tick all nine Facebook-leg permissions** on configuration
   `2272646810190199`.
4. **Connect Facebook as the app admin** (own Page, Development Mode) and do
   the five rows under *Make one real call with every permission first*,
   recording the screencasts as you go.
5. **Reviewer login** — a Synapse agency account, no OTP, tested in a private
   window.
6. **Submit** the nine Facebook Login permissions.
7. Afterwards: the Instagram product and its three permissions, for agencies
   with no Page.

---

# TikTok app review

The TikTok app is **Synapse Real Estate** ("Synapse" was taken). Products: **Login Kit** (Web) and the **Content Posting API**. Built 2026-09-27; see `social-connect` (`finishTikTok`) and `social-publish` (`tiktokAdapter`).

## What the integration does, in one paragraph (for the "describe your app" box)

Synapse is a property-listing platform for Nigerian estate agencies. An agent connects their agency's TikTok account; when they choose to share a listing to TikTok, Synapse sends the listing's photos and caption to that account's **TikTok inbox as a draft** (Content Posting API, photo mode, `MEDIA_UPLOAD`). The agent opens TikTok, reviews the draft, adds a sound and publishes it themselves. Synapse never publishes to TikTok directly and posts nothing the agent did not choose to send.

## Scopes, with justification text to paste

| Scope | Justification |
|---|---|
| `user.info.basic` | We read the connected account's display name so the agent can confirm, on the Synapse Channels screen, that the TikTok account they connected is their agency's before anything is sent to it. |
| `video.upload` | When an agent chooses to share a property listing to TikTok, we send its photos and caption to the agent's own TikTok inbox as a draft. The agent finishes and publishes it in the TikTok app. Nothing is posted publicly by Synapse. |

Not requested: `video.publish` (direct posting). If it is ever added, TikTok requires the Direct Post UX in our composer (creator nickname, privacy choice with no default, interaction toggles, commercial-content disclosure, music-usage consent) and a new review.

## Before recording: make the flow work in the Sandbox

1. Developer portal → the app → **Sandbox** → create one. In it, add **Login Kit** (redirect URI `https://bhrhejpekmhbhwryjhgk.supabase.co/functions/v1/social-connect`) and the **Content Posting API** with `user.info.basic` + `video.upload`.
2. Sandbox → **Target users** → add the TikTok account you will record with. Set that account to **private**: an unaudited app can only post to private accounts.
3. **URL properties**: domain `synapsecore.dev` verified by DNS TXT (Vercel → Domains → synapsecore.dev → DNS Records). This covers the Terms and Privacy URLs and the photo address `https://www.synapsecore.dev/m/…` TikTok pulls from.
4. Supabase → Edge Functions → Secrets: `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` = the **Sandbox** pair. Swap to the production pair after approval. Never paste either into chat.
5. Check `…/functions/v1/social-connect?action=status` reports `"tiktok":{"ready":true,…}`.

## The screencast — shot list (about 2–3 minutes, 1080p, browser address bar visible throughout)

1. `https://www.synapsecore.dev/app/agency.html` — signed in as the test agency. Pause on the address bar.
2. **Social → Channels → + Add channel → TikTok.** Let the note be read ("Posts arrive in that account's TikTok inbox as drafts…"). Press **Continue to TikTok**.
3. TikTok's authorization page: the app name **Synapse Real Estate**, the two permissions listed. Press **Authorize**.
4. Back on Synapse: the toast "TikTok connected as <name>. Posts will arrive in that account's TikTok inbox…", and the TikTok account now listed under Channels.
5. **Listings →** a listing with photos **→ Post →** tick **TikTok** → **Generate captions** → open the TikTok caption (full-size editor) to show it → **Send for approval**.
6. On the board: **Keep & schedule** → set the row to **TikTok** (the inbox note appears) → choose the account → **Post now**. Show the toast.
7. The board card now reads **"In your TikTok inbox"**.
8. On the phone (screen recording): TikTok → **Inbox** → the Synapse notification → open the draft → the listing's photos and caption → add a sound → **Post**. End on the published post.

Say, or caption on screen, at step 5–6: *the agent chooses TikTok for this listing; nothing is sent to TikTok unless they do.*
