# Synapse — Complete Build Plan (v2.0)

> **The Full Product.** Upload to syndication. AI sorting and tagging. Toju as full
> deal agent. Social-to-CRM attribution. *This is not a listing platform.*
>
> Version 2.0 · For Oduma Daniel (CTO) · June 2026 · **Supersedes v1.0**
>
> Source: `Synapse_Build_Plan.docx`. This is the authoritative product scope —
> see also [layer7.md](layer7.md)/[layer8.md](layer8.md)/[layer9.md](layer9.md)
> (north-star vision) and [mvp-screen-gap.md](mvp-screen-gap.md).

## What changed from v1.0 and why

v1.0 scoped out social syndication, AI-driven property sorting, Toju's full
agent-like role through a deal, and the social→CRM attribution loop — treating
them as Layer 5 features to defer. That was wrong. **They are the actual
product.** A version of Synapse without them is just a listing site with a
chatbot attached, which is explicitly not what is being built.

This document replaces v1.0 and scopes the real, complete loop: an agency uploads
a property → it's analyzed and tagged automatically → syndicated to real
connected social accounts → consumers find it via Toju in the app *or* by
clicking it on social → Toju acts as a full conversational agent through viewing
and negotiation → every interaction (in-app or from social) feeds back into the
agency's CRM with channel attribution.

> ★ This is a larger build than 8 weeks. The honest timeline is in §02. No scope
> is cut — it is sequenced so the hardest, most differentiated parts are built
> deliberately, not rushed.

## 00 · The complete loop — what the app does, end to end

Two entry points into the same system. Both lead to a qualified conversation with
Toju and a lead that lands in the agency's CRM with full attribution.

**Path A — Agency uploads, Toju recommends**
1. Agency uploads a property — photos, video, price, location, description.
2. The system analyzes the upload — extracts structured data, geotags it for proximity, classifies it for matching.
3. The system generates platform-specific content and auto-publishes to the agency's connected Instagram, TikTok, and Facebook accounts.
4. The property enters the searchable/recommendable database, tagged with a `listed_at` timestamp.
5. A consumer opens the app and talks to Toju — describes what they want, in their own words.
6. Toju searches only properties listed within the last 14 days matching what the consumer asked for, and recommends a short, relevant set — never a browsable list of everything.
7. The consumer taps a recommended property — Toju gives full detail, answers questions, acting like an agent who knows the property.
8. Toju supports viewing requests, follow-up questions, and negotiation-adjacent conversation.
9. As the deal approaches close, Toju connects the consumer directly to the owning agency.

**Path B — Discovered on social media**
1. A consumer sees the property post on IG/TikTok/FB — content generated and published in Path A.
2. They tap the post — it opens a web landing page for that specific property, with an option to open the full experience in the Synapse app.
3. Whether they continue on web or open the app, their interaction is tagged with the originating channel.
4. If they continue into the app, they land in a Toju conversation about that specific property — already in context.
5. Every click, view, and message is attributed back to the social channel it came from.

**Where both paths converge — the agency side**
- Every lead, from either path, lands in the agency's CRM with a visible source: Instagram, TikTok, Facebook, or direct in-app.
- The dashboard shows interaction counts broken down by channel, per property and in aggregate.
- An agency owner can see exactly which channel produces real leads, not just impressions, and act on it.

## 01 · Scope — what's in, stated plainly

Everything below is in scope for the first real build. None of it is deferred.

| System | What it actually does |
|---|---|
| Upload & Analysis | Agency uploads a property; the system extracts structured data, classifies it, and geotags it automatically |
| Social Syndication | **Real auto-publish** to connected Instagram, TikTok, and Facebook agency accounts — not draft generation |
| Toju Recommendation | Conversational intake, filtered to listings from the last 14 days, recommends rather than lists |
| Toju Agent Mode | Full property detail, viewing coordination, negotiation-adjacent conversation, document questions |
| Agency Handoff | Toju connects the consumer to the real agency as the deal approaches close |
| Social Landing Pages | Per-property web page that social clicks land on, with an app-open option |
| Click-to-App | Channel-tagged continuation from web landing page into the app conversation |
| CRM Attribution | Every lead and interaction tagged by source channel, visible to the agency |
| Proximity Geotagging | Every property geotagged at upload time so proximity matching has data later |

> ⚠ Proximity geotagging happens **now, at upload**. The consumer-facing proximity
> alert feature (background location, push on walk-by) is still sequenced for
> later, once there's a dense enough network of geotagged listings. What's
> different from v1.0 is that the data is captured from day one instead of bolted
> on retroactively.

## 02 · Timeline — the honest schedule

Bigger than the previous 8-week plan because it includes real third-party
integrations (Meta, TikTok) with their own approval processes, review times, and
failure modes outside Synapse's control.

| Phase | Duration | What ships |
|---|---|---|
| Phase 1 | Weeks 1–4 | Foundation, auth, schema, property upload with AI analysis and geotagging |
| Phase 2 | Weeks 5–8 | Toju recommendation conversation, property detail, agent-mode conversation depth |
| Phase 3 | Weeks 9–13 | Social syndication — Meta and TikTok API integration, content generation, auto-publish |
| Phase 4 | Weeks 14–16 | Social landing pages, click-to-app continuity, channel attribution wired end to end |
| Phase 5 | Weeks 17–18 | Agency CRM with channel breakdown, agency handoff flow, full loop hardening |

> ★ 18 weeks (~4.5 months) for one engineer. Phase 3 is riskiest — Meta and
> TikTok developer approval is outside Synapse's control. **Start that application
> process in parallel with Phase 1**, so the waiting overlaps other work.

## 03 · Stack — additions to the existing stack

Mobile, dashboard, database, and AI stack from the previous plan are unchanged.
This scope adds:

| Addition | Purpose |
|---|---|
| Meta Graph API | Auto-publish to connected Instagram and Facebook agency accounts |
| TikTok Content Posting API | Auto-publish video content to connected TikTok agency accounts |
| OAuth per platform | Each agency connects their own IG/FB/TikTok accounts via OAuth — Synapse never owns these credentials in plaintext |
| Next.js (web landing pages) | Server-rendered per-property pages for social click-throughs, separate routes from the dashboard app |
| Universal/deep links | iOS & Android deep linking so a landing page can open the installed app directly into the right property |
| PostGIS | Already planned for proximity — now populated at upload time instead of only when proximity alerts are built |

## 04 · Phase 1 (Weeks 1–4) — foundation, upload, analysis, geotagging

**Week 1 — Foundation**
- Create Supabase projects (prod + dev), full schema migration, RLS enabled on every table at creation.
- Set up Supabase Auth — email OTP for consumer and agency roles.
- Generate TypeScript types from schema into a shared types package.
- **In parallel, not blocking:** begin the Meta Developer App review and TikTok Developer application — multi-week review times, start the clock now.

**Week 2 — Agency Upload Flow**
- Build the New Listing form — title, description, price, type, bedrooms, address, photo/video upload via Cloudinary.
- Build the geocoding step — address → lat/lng, store both the structured address and a PostGIS point.
- Add a `listed_at` timestamp on creation, used to drive the "last 14 days" recommendation window.

**Week 3 — AI Analysis on Upload**
- Build the `analyze-listing` Edge Function — runs automatically when a property is created.
- Extracts/normalizes: property type, likely target buyer profile (family, investor, young professional, shared), key selling points from description and photos, and a structured tag set for matching.
- Store AI-derived tags/classification on the property row, **separate from the agency's own input fields — never overwrite what the agency typed**.
- Test against ≥10 real property descriptions of varying quality before considering it reliable.

**Week 4 — Verification (Manual, For Now)**
- Build a hidden admin route for manually marking `verification_status` and filling `verification_nodes` after a physical check.
- Confirm: an unverified property **cannot** be recommended by Toju and **cannot** be auto-syndicated — verification gates both downstream systems.
- Seed and fully verify 5 real properties in one Lagos neighbourhood before Phase 2.

## 05 · Phase 2 (Weeks 5–8) — Toju recommendation and agent mode

**Week 5 — Recommendation Engine**
- Build the `toju-chat` Edge Function with a `search_properties` tool.
- The query is hard-constrained to: `verification_status = verified` AND `listed_at` within the last 14 days AND matches the consumer's stated city, budget, and type.
- Toju never returns more than a small, relevant set — a recommendation, not a results page. Too many matches → ask a narrowing question instead of dumping a list.
- Write the explicit "nothing matches yet" response and the offer to alert the consumer when something new fits.

**Week 6 — The Chat Interface**
- Build the chat screen — message list, input, typing indicator, properties rendered as inline cards in Toju's responses.
- Tapping a card opens a focused property conversation (not a separate static detail page) — the conversation continues, now scoped to that property.

**Week 7 — Toju as Agent: Detail and Questions**
- Extend the AI Gateway prompt so that once a property is the active topic, Toju answers detailed questions from the property's full stored data — price breakdown, amenities, neighbourhood, the AI-derived selling points from Phase 1.
- Toju's answers must only state what's actually in the database — **never invent a detail** about a specific property.
- Build the photo/video viewer reachable from within this conversation.

**Week 8 — Toju as Agent: Viewing and Negotiation-Adjacent**
- Build a request-viewing flow conversationally — Toju collects preferred times, confirms back, writes a `viewing_requested` record.
- Build the negotiation-adjacent layer — Toju discusses price-flexibility framing, what's typically negotiable, next steps, **without ever quoting a number on the agency's behalf or committing the agency**.
- Define and test the handoff trigger — when a consumer signals real intent (explicit interest, a confirmed viewing, or an explicit ask to speak to the agency), Toju transitions to a direct handoff.

## 06 · Phase 3 (Weeks 9–13) — social syndication (the hardest phase)

> ⚠ Depends on Meta/TikTok approval timelines started in Week 1, which may still
> not be complete by Week 9. If delayed, build everything against a sandbox/test
> account and switch to production credentials the moment approval lands — do not
> let an external review process block all other engineering work.

**Week 9 — Agency Social Account Connection**
- OAuth connection flows for Instagram, Facebook, and TikTok inside dashboard settings.
- Store access/refresh tokens encrypted in **Supabase Vault**, accessed only by Edge Functions, never exposed to any frontend.
- Automatic token refresh ahead of expiry, with a clear "reconnect your account" prompt if a refresh fails.

**Week 10 — Content Generation**
- Build `generate-listing-content` — uses property data + Phase 1 analysis to generate platform-specific captions for IG/FB/TikTok.
- Generate the accompanying visual per platform — at minimum correctly cropped/sized photos per aspect ratio; TikTok video where the agency uploaded video, otherwise **skip TikTok for that listing rather than faking a video**.
- Store every generated piece with its target platform and status (`draft`, `ready`, `published`, `failed`).

**Weeks 11–12 — Auto-Publish**
- Build `publish-listing` — calls Meta Graph API and TikTok Content Posting API using the agency's stored tokens.
- Trigger automatically when a property reaches `verified` — the agency never has to remember to post.
- Store the returned post ID and live post URL per platform.
- Retry-with-backoff for failures, and a visible failed-to-publish state in the dashboard — **never fail silently**, same standard as WhatsApp lead delivery.

**Week 13 — Real Platform Testing**
- Real publishes to real connected test accounts on all three platforms.
- Confirm the published post displays correctly — caption, image crop, video playback — on each platform's real app, not just in an API response.
- Fix every formatting/rejection issue before Phase 4 — silently-rejected content is worse than not posting.

## 07 · Phase 4 (Weeks 14–16) — landing pages and click-to-app

**Week 14 — Per-Property Landing Page**
- Server-rendered Next.js page at a public route per property — fast-loading, photos/price/location and a short Toju-style summary.
- Every link in generated social content points here, with a query param identifying source platform and post.
- "Open in App" as the dominant CTA — the page exists to convert to the app, not replace it.

**Week 15 — Deep Linking**
- iOS universal links + Android app links so "Open in App" opens the installed app directly to that property's Toju conversation.
- Fallback for users without the app — app-store link, with the source channel preserved through to post-install attribution.
- Test on real devices, app installed and not — one of the easiest flows to get subtly wrong and only discover on a real device.

**Week 16 — Channel Attribution Wiring**
- Every session originating from a landing-page click carries its source channel and post ID into the in-app conversation and any lead it produces.
- Every interaction record — view, message, viewing request — stores its origin channel: `instagram`, `tiktok`, `facebook`, or `direct_app`.
- Confirm a lead generated entirely from a TikTok click is visibly tagged as such all the way to the agency's CRM, with no point where the tag could be silently dropped.

## 08 · Phase 5 (Weeks 17–18) — agency CRM, handoff, closing the loop

**Week 17 — Agency Dashboard and CRM**
- Listings screen — status, verification state, per-platform publish status per property.
- Leads screen — every lead with its source channel as a visible badge, updating live via Supabase Realtime.
- Channel breakdown — per property and in aggregate, how many views/messages/leads came from each channel.
- `create-lead` Edge Function with WhatsApp delivery, **exactly as rigorously tested as before — the most important single function in the app**.

**Week 18 — The Agency Handoff and Full Loop Test**
- Build the `handoff` Edge Function — triggered by Toju's handoff signal from Phase 2; creates the lead with full conversation context attached and sends the WhatsApp message to the agency including a summary of what Toju and the consumer discussed.
- Run **Path A** in full: upload → confirm AI analysis + geotag → confirm auto-publish to all three platforms → find it through Toju → full agent-mode conversation → trigger handoff → confirm the WhatsApp message arrives with context.
- Run **Path B** in full: click the actual published post → land on the web page → open the app via deep link → land in a Toju conversation already scoped to that property → confirm the channel tag survives to a generated lead.
- Fix every rough edge in both run-throughs before considering the build finished.

## 09 · Still deferred — and why

Everything in §01 is in scope. A few things remain correctly deferred — not
scope-cutting, but a function of what the data actually supports yet:

- **Consumer-facing proximity push alerts (walk-by notifications)** — geotagging happens now (Phase 1), but the alert feature needs a dense network of listings to be useful. Captured from day one specifically so it can be turned on later without a retroactive rebuild.
- **A full CRM pipeline with stages, Deal Rooms, and task automation** — the Phase 5 Leads screen is a flat, channel-attributed list, which is exactly what's needed to prove the attribution loop. A multi-stage pipeline is the next real piece of work after this build.
- **Escrow, payments, and any system that moves money between other parties** — require a signed banking/lending partner, a separate parallel workstream, untouched by this document.
- **A behavioural recommendation engine beyond the 14-day-window content match** — Toju's recommendation here is content + recency based, not yet learning from accumulated behaviour, because that behaviour doesn't exist yet. A real next phase after this build is in use.

> ★ What remains deferred is deferred because the data or infrastructure it
> depends on does not exist until after this build runs in the real world.

---

## Implementation note — how this maps to the current repo (2026-06-26)

This is annotation added at import, not part of the original plan. The **schema
is ahead of this plan** (full Layers 1–6 are pushed to the `synapse-platform`
Supabase project), but the **runtime loop is behind it**. The plan deliberately
*defers things already built in schema* (the full CRM pipeline + deal rooms — the
MVP wants a flat channel-attributed Leads list, so don't surface the pipeline).

**Not yet built (the real work this plan describes):** real OTP auth wiring
(screens are prototypes), property geocoding on upload, the `analyze-listing` /
`generate-listing-content` / `publish-listing` / `handoff` Edge Functions (only
`_shared`, `admin-actions`, `create-lead`, `toju-chat` exist), social OAuth +
token Vault, the Next.js per-property landing pages, deep linking, and the
end-to-end channel-attribution wiring.

**Decisions to settle before building:** (1) add a `listed_at` column vs reuse
`created_at` for the 14-day Toju window (`properties` has no `listed_at` today);
(2) channel attribution reads from `lead_attribution` / `attribution_channel`,
not the `lead_source` enum (`toju_chat`/`contact_button`/`browse`); (3)
`toju-chat` currently has no 14-day recency constraint and must gain one.
