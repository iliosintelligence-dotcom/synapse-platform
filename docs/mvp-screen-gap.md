# MVP Defining Screens — Gap Scope & Build Prompt

The three defining screens (commit `c43e158`) are **presentation-complete and
typecheck clean**, built from real `@synapse/ui` primitives. They are **not** a
from-scratch job. Every one of them, however, reads **100% mock data**, and
every real API function they need **already exists** in `@synapse/api`. The work
remaining is *wiring*, not building.

This document scopes only that gap, and is written so it can be handed to Claude
Code as a build prompt when you choose to close it.

## The demo this unlocks (why it's worth doing)

> On the phone, a buyer talks to Toju and taps **Contact Agency**. On the
> dashboard open on the table, the lead appears **live, within a second** — name,
> property, budget, WhatsApp button.

That single end-to-end moment is the most persuasive thing in an MD conversation.
Today it cannot happen: the phone's Contact button is a no-op and the dashboard
list is a hardcoded array.

## Verified gaps (file · line · what's mock)

| Screen | File | Gap |
|--------|------|-----|
| Property Experience | `apps/mobile/app/property/[id].tsx:109` | **Contact Agency only sets local `contacted` state — no lead is created.** This is the conversion action of the entire MVP and it's a no-op. |
| Property Experience | `apps/mobile/app/property/[id].tsx:94-100` | `AgentCard` is **hardcoded** ("Prestige Realty Ltd." / "Adaeze Okonkwo" / "Gold Partner" / fixed summary), not sourced from the property's listing agency. |
| Property Experience | `apps/mobile/app/property/[id].tsx:28,35` | `findProperty(mock)` instead of `properties.getProperty(id)`. |
| Agency Leads | `apps/dashboard/.../leads/page.tsx:28-33,54` | `MOCK_LEADS` hardcoded; no `listAgencyLeads`, no realtime subscribe, no signed-in agency id. The "live, real-time" promise is faked. |
| Toju Conversation | `apps/mobile/app/(consumer)/home.tsx:131` | `FloatingSearch onActivate` ignores typed text — always sends `'I want to buy a home'`. |
| Toju Conversation | `apps/mobile/app/(consumer)/home.tsx:58` | `mockToju()` instead of `toju.sendTojuMessage(text, sessionId)`; no `session_id` tracked across turns. |

## The API is already there — these are the swap targets

- `leads.createLead({ property_id, source })` → invokes the `create-lead` Edge
  Function. **Resolves even on delivery failure** (lead persisted + flagged);
  caller must surface `delivery_status === 'delivery_failed'`. Agency + consumer
  are derived server-side, so the screen passes only `property_id` + `source`.
- `leads.listAgencyLeads(agencyId)` — reverse-chron, RLS-scoped to members.
- `leads.subscribeToAgencyLeads(agencyId, onInsert)` — Supabase Realtime; returns
  an unsubscribe fn. New lead just unshifts into the list.
- `toju.sendTojuMessage(text, sessionId)` and `toju.getCurrentSession()`.
- `properties.getProperty(id)` for the real listing + its agency/agent fields.

---

## BUILD PROMPT (hand to Claude Code when ready)

> Wire the three defining MVP screens to `@synapse/api` + Supabase, replacing
> their mock data. Do **not** redesign them — keep every layout, primitive, and
> style exactly as-is; this is data wiring only. Keep each screen's existing mock
> as a fallback path behind a `USE_MOCK` flag so the screens still render with no
> backend.
>
> **Task 1 — close the lead loop (highest priority).**
> - `property/[id].tsx`: on Contact Agency press, call
>   `leads.createLead({ property_id: id, source: 'contact' })`. Keep the existing
>   optimistic "Lead sent…" state, but on `delivery_status === 'delivery_failed'`
>   show the lead-saved-but-WhatsApp-failed variant. Handle thrown errors with a
>   retryable state — never lose the tap silently.
> - `dashboard leads/page.tsx`: replace `MOCK_LEADS` with
>   `leads.listAgencyLeads(agencyId)` on mount, and add
>   `leads.subscribeToAgencyLeads(agencyId, (lead) => setRows(r => [lead, ...r]))`
>   in an effect with cleanup. Map the real `Lead` shape to the existing row UI
>   (keep `timeAgo`, source badges, the failed-delivery flag, the `wa.me` link).
>   Source `agencyId` from the signed-in session.
>
> **Task 2 — real property data.** In `property/[id].tsx` use
> `properties.getProperty(id)`; feed `AgentCard` from the property's listing
> agency/agent fields (name, verification tier, Toju summary) instead of the
> hardcoded values.
>
> **Task 3 — real Toju.** In `home.tsx`, capture the user's typed text from
> `FloatingSearch` and pass it to `send(text)`; swap `mockToju()` for
> `toju.sendTojuMessage(text, sessionId)`, tracking `session_id` across turns and
> resuming via `getCurrentSession()`. Add error + offline states. **Do not touch
> the model/provider** — that is the separate door-3 refactor (see below).
>
> Verify: typecheck mobile + dashboard; smoke-test the lead loop against a
> Supabase project with migrations applied (see prerequisite).

### Explicit non-goals (do NOT do these here)
- The AI Gateway provider/prompt-versioning refactor — **already tracked
  separately** (layer7.md / layer8.md "door 3", task `task_1775701b`). Task 3 is
  wiring only.
- Auth screens / onboarding flows, property ingestion pipeline, Layer 2 pipeline
  stages. Out of scope for the defining trio.

### The real critical-path item (not code)
Wiring is ~a day. The **live demo cannot run** until there is a Supabase project
with migrations `0001`–`0028` applied, **one signed-in test agency**, and **a
few seeded verified+active properties** whose listing agency is that agency.
Without seeded data and a logged-in agency, the wired screens read empty and the
demo shows nothing. Stand that up first — it is the actual blocker, not the
wiring.
