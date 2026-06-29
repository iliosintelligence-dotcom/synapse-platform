# Synapse — Implementation Plan (building the full loop)

The **forward build plan** that turns the [v2.0 product scope](build-plan-v2.md)
into working software. Companion to that doc: build-plan-v2 is *what*, this is
*how it maps onto the codebase*. Grounded in the repo as of 2026-06-26: schema
Layers 1–6 are pushed to Supabase `bhrhejpekmhbhwryjhgk`; the runtime loop is
mostly unbuilt.

## Decisions (settled)

| Decision | Resolution |
|---|---|
| Social publishing | **Real auto-publish** to connected IG/TikTok/FB via Edge Functions using Vault-stored OAuth tokens |
| Where a social click lands | **Web landing page** (`/p/[id]?ch=…`) offering **Open in App** via deep link |
| Toju depth | **Full deal support** — detail Q&A, viewing, negotiation framing, document questions — **short of the actual close**, then handoff |
| 14-day window source | **Add `listed_at`** to `properties` (separate from `created_at`); Toju filters `listed_at > now() - interval '14 days'` |
| Attribution storage | `lead.source` = *how* (`toju_chat`/`contact_button`/`browse`); `lead_attribution.channel` = *which* social channel; pre-lead clicks → new `channel_interactions` |
| Landing-page surface | **New `apps/web`** (Next.js, public SSR), separate from the dashboard |

## Schema deltas — migration `0032`

- `properties.listed_at timestamptz` (+ index) — the recency window.
- `properties.ai_analysis jsonb`, `ai_tags text[]`, `target_buyer_profile text` — analyze-listing output, **separate from agency-typed fields, never overwritten**.
- `chat_sessions.source_channel / source_post_id / source_property_id / active_property_id` — session attribution + agent-mode focus.
- `channel_interactions` (append-only, agency-scoped RLS) — pre-lead views/clicks/messages per channel; powers the per-channel breakdown.

## Build, by subsystem

**A · Auth + roles** (P1) — wire `signInWithOtp` in the mobile/dashboard auth screens (prototypes today). `handle_new_user` already seeds `profiles`; add agency + `agency_members` bootstrap on agency sign-up.

**B · Upload → geocode → analyze** (P1) — wire `listings/new` → Cloudinary → `properties`/`property_media`; geocode address → `location` (existing sync trigger); **`analyze-listing` Edge Function** (new, service-role, reuses the provider-agnostic LLM gateway from `toju-chat`) classifies type/buyer-profile/tags/selling-points into the `ai_*` columns. Test ≥10 real descriptions.

**C · Verification gate** (P1) — `admin-actions` + dashboard `verification` set status; gate enforced in `toju-chat` search **and** `publish-listing` (refuses unverified).

**D · Toju recommend + agent mode** (P2) — modify `toju-chat`: (1) add the 14-day `listed_at` filter; (2) cap + narrowing-question behaviour; (3) agent mode keyed on `active_property_id` with a `get_property_detail` tool answering **only from stored data**; (4) `request_viewing` tool → `viewings` row; (5) negotiation-adjacent prompt rules (never quote/commit); (6) handoff trigger via the existing `suggestedAction` field → `handoff`.

**E · Social syndication** (P3, riskiest) — `social-oauth` (connect IG/FB/TikTok, tokens in **Vault**, auto-refresh); `generate-listing-content` (per-platform captions + cropped media; skip TikTok without video); `publish-listing` (Meta Graph + TikTok APIs, store `platform_post_id`/url, retry+backoff, visible failed state). Links carry `?ch=&post=`. **Start Meta/TikTok dev approval in wk1.**

**F · Web landing + deep links** (P4) — new `apps/web`: SSR `/p/[id]` with dominant Open-in-App CTA, logs `channel_interactions`; iOS universal + Android app links → `synapse://property/[id]?ch=…`; store fallback preserves channel through post-install.

**G · Attribution end-to-end** (P4) — social post → landing → deep link → `chat_sessions.source_*` → interactions log `channel_interactions` → handoff writes `lead_attribution`. No step may drop the tag; verify a pure-TikTok click is tagged through to the CRM.

**H · Agency CRM + handoff** (P5) — `leads` screen = **flat list + channel badge**, Realtime (do **not** surface the built-but-deferred pipeline/deal-rooms); channel-breakdown view from `channel_interactions` + `lead_attribution`; **`handoff` Edge Function** creates the lead with conversation context + channel and WhatsApps the agency a summary.

## Sequencing

```
wk1  ► START Meta/TikTok approval (parallel, non-engineering)
P1 (1-4)  auth · upload+geocode · analyze-listing · verify gate · migration 0032
P2 (5-8)  toju-chat: 14-day window · agent mode · viewing · handoff trigger
P3 (9-13) social OAuth+Vault · generate-content · publish-listing · real tests   (needs approval)
P4 (14-16) apps/web landing · deep links · attribution wiring
P5 (17-18) flat CRM + channel breakdown · handoff fn · full Path A & B tests
```

P1→P2 are pure engineering and unblock the whole Toju side regardless of social
approval status. P3 is the external-dependency critical path.

## Deferred (by design)
Consumer proximity push alerts (geotag now, alert later) · full CRM pipeline/deal-rooms (in schema, hidden in MVP) · escrow/payments (needs banking partner) · behavioural rec engine (no behaviour data yet).

## Progress
- [x] Migration `0032` (listed_at, ai_* columns, session attribution, channel_interactions) — applied + committed
- [x] `analyze-listing` Edge Function
- [x] `toju-chat` 14-day `listed_at` window
- [ ] everything else above, by phase
