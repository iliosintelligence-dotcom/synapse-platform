# Platform review pack — Instagram, TikTok, WhatsApp

What each platform needs before Synapse can post on an agency's behalf, what
is already built, and what is still genuinely blocked.

Written 2026-08-13.

---

## The premise worth correcting first

The plan for this week was "things to do while waiting for Meta approval". That
framing is mostly wrong, and it is worth saying plainly because it changes what
to do next.

**Meta's Development Mode grants an app's own admins, developers and testers
every permission the app requests, with no App Review.** So the owner of the
Synapse app can connect their own Instagram professional account and publish a
real post today. App Review is not what unblocks *you* — it is what unblocks
*other agencies*. Business verification is a separate gate again, and it gates
going live for third parties, not testing with your own account.

Practically: you are not blocked from proving the pipeline end to end. You were
blocked by not having an OAuth flow, which now exists.

---

## Where the code stands

| Piece | State |
|---|---|
| Caption + media generation, per platform, validated | Built (`app/syndication.js`) |
| Pre-flight audit across every listing × platform | Built (`app/syndication-audit.js`) |
| Durable publish queue, `dry_run` defaulting to true | Built (migration 0052) |
| Token storage in Vault, never on the row | Built (0053, fixed in 0055) |
| Publisher with swappable adapters | Built (`social-publish`), adapters return "not connected" |
| **OAuth connect flow** | **Built today (`social-connect`), untested against real Meta credentials** |
| Attribution from post → visit → lead | Built and proven live (0054) |
| Real Instagram adapter | **Not written** — needs a token to develop against |

The only thing between here and a real post is credentials.

---

## Before anything else: three settings

1. **`social-connect` must be set to `verify_jwt = false`** in the Supabase
   dashboard. The OAuth callback is a browser redirect from Instagram and
   carries no JWT, so the gateway rejects it before the function runs. The
   function authenticates `?action=start` itself and trusts only state it
   HMAC-signed, so this does not open anything up.

2. **Secrets to set** (in Supabase → Edge Functions → Secrets; do not put these
   in chat or in a file):
   - `META_APP_ID`
   - `META_APP_SECRET`
   - `META_REDIRECT_URI` — must be *character-for-character* what you register
     in the Meta dashboard: `https://bhrhejpekmhbhwryjhgk.supabase.co/functions/v1/social-connect`
   - `PORTAL_URL` — optional; where to send the operator afterwards.

3. **Register that same redirect URI** under the app's Instagram product
   settings. A mismatch here is the single most common cause of a connect flow
   failing with an unhelpful error.

---

## 1. Instagram (Meta)

### Which API, and which permissions

Use the **Instagram API with Instagram Login** — the agency logs in with
Instagram directly, no Facebook Page linkage required. That suits Nigerian
agencies, many of whom run an Instagram professional account and no Page.

Request exactly two scopes, and no more. Every extra scope is another thing to
justify and another reason to be rejected:

| Scope | Why Synapse needs it |
|---|---|
| `instagram_business_basic` | Identify which account was connected, so the portal can show the agency *which* Instagram it is posting to, and so a token can be tied to the right account. |
| `instagram_business_content_publish` | The entire feature: publish a listing the agency already owns to the agency's own account, at a time they scheduled. |

The older `business_basic` / `business_content_publish` names were deprecated in
January 2025 and will not work. The code already uses the current ones.

### Data use justification

Meta asks, per permission, what data you access and what you do with it. Answer
narrowly and concretely — vague answers read as fishing:

> **instagram_business_basic** — We read the connected account's ID and username
> only. We display the username in the agency's dashboard so they can confirm
> which of their accounts is connected, and we store the ID to associate the
> access token with the correct account. We do not read followers, insights,
> media, or audience data, and we do not build profiles of Instagram users.

> **instagram_business_content_publish** — We publish property listings that the
> agency has itself created on Synapse to that agency's own Instagram account,
> at times the agency schedules. Every post is initiated by the agency, is about
> a property they have listed, and links back to that listing. We publish
> nothing automatically and nothing on behalf of any account other than the one
> the agency connected.

### The screencast is the submission

Most rejections are not about the justification text — they are about a video
that does not clearly show a person granting the permission and then seeing the
result. Record one continuous take, no cuts, screen text legible:

1. Land on the Synapse agency portal, signed out. Sign in as an agency owner.
2. Show the dashboard with at least one real listing.
3. Click **Connect Instagram**.
4. **Show the Instagram permission dialog in full** — the scopes must be
   readable on screen. Do not scrub past this; it is the part being reviewed.
5. Grant it. Land back in the portal showing the connected account's username.
6. Open a listing, compose a post, schedule or publish it.
7. **Switch to Instagram and show the published post on the account.**
8. Optionally: disconnect, and show the connection is gone.

Narrate in English. If any screen is in a language other than English, Meta
requires subtitles.

### What the reviewer needs from you

- **A test agency account** — email and password, given in the submission notes,
  logged in without any Nigerian phone number or OTP the reviewer cannot receive.
  Check this by signing in from a fresh browser profile yourself.
- **A test Instagram professional account** they can connect, or clear
  instructions that they should use their own.
- **Step-by-step written instructions** mirroring the screencast.

### Privacy policy — one real gap

The policy at `privacy.html` covers data collection, deletion by request, and
the anonymous visitor ID honestly. Two things to add before submitting, because
Meta checks the policy page itself:

- **Name Instagram explicitly**: what is accessed (account ID and username),
  why, that tokens are stored encrypted, and that they are destroyed on
  disconnect. That is all true of the current implementation.
- **A data deletion route.** Meta requires either a Data Deletion Callback URL
  or a instructions URL. The email route at the bottom of the policy can serve
  as the instructions URL, but it needs to be linkable on its own and say
  plainly how to request deletion and how long it takes.

The `[NEEDS LEGAL]` flag in the policy — registered company name, address, and a
dedicated privacy contact — is still open and is worth closing before
submission, since a policy with no identifiable operator behind it is a weak
answer to "who controls this data".

---

## 2. TikTok

A **separate app and a separate review**, sharing nothing with Meta.

- Product: **Content Posting API**. Permissions `video.publish` (or
  `video.upload` for draft-only) and `user.info.basic`.
- **Domain verification is required** — TikTok will not let you publish links
  to an unverified domain, which matters because the whole point is driving
  traffic back to a listing.
- **Unaudited apps can only post as private/draft.** You get a working
  integration before approval, but not a public post. This is the TikTok
  equivalent of Development Mode and is worth using for the same reason.
- The screencast expectations mirror Meta's: show the consent screen, show the
  post appearing.

Worth sequencing *after* Instagram: the adapter shape, the queue, the
attribution and the connect flow are all shared, so the second platform is
mostly credentials and a `publish()` implementation.

---

## 3. WhatsApp — and a decision that is being deferred

WhatsApp Business is not a syndication channel here; it is how the **lead
outbox** actually reaches people. `send-outbox` is built, queues correctly, and
retries — but it has no delivery provider, so nothing has ever been sent.

- Business-initiated messages require **pre-approved message templates**. You
  cannot free-text a lead 24 hours after they enquired.
- Templates take days to approve and are rejected for anything that reads as
  marketing rather than a service message.
- Three worth submitting early, since the delay is the cost:
  1. *Enquiry acknowledgement* — confirms Synapse received their interest in a
     named property.
  2. *Agent introduction* — names the agent who will contact them.
  3. *Viewing confirmation* — date, time, address.

**This is on the critical path and it is not being treated that way.** The lead
outbox is the difference between a lead being recorded and a buyer being
contacted. Templates are the long pole; start them before the Instagram work.

---

## One known inconsistency to resolve

`app/syndication.js` generates variants for **WhatsApp** and **YouTube**. The
`social_platform` enum in the database is `instagram, facebook, tiktok,
linkedin, x`. So two of the platforms the generator produces content for cannot
be queued at all, and two enum values have no generator.

This has no user-visible effect today because everything is a dry run, but it
will silently drop content the moment publishing is real. It needs a decision
rather than a patch: either the generator stops producing what cannot be sent,
or the enum grows to match. Worth doing before the first live post, not after.

---

## Suggested order

1. Set the three secrets and flip `verify_jwt` — 10 minutes, unblocks everything.
2. Connect your own Instagram in Development Mode and confirm a token lands.
3. Submit the WhatsApp templates — longest wait, start it now.
4. Write the real Instagram adapter against your own token.
5. Publish one real post to your own account. Confirm attribution records the visit.
6. Record the screencast — it is far easier once step 5 works.
7. Submit Meta App Review.
8. TikTok, reusing everything.
