# Layer 9 — Advisory Intelligence Layer (North Star)

> **Do not paste this into Claude Code as-is.** North star document, same use as
> [layer7.md](layer7.md) / [layer8.md](layer8.md): check that current
> architecture doesn't *foreclose* this future — not a sprint backlog. One
> system (9.4, advisory form) is flagged as the closest to a real near-term
> (~Year 2) scope; the rest are correctly later.

## The revision that makes this layer legitimate

Every system here keeps Toju and Synapse strictly **advisory**. Toju analyzes,
predicts, explains, and recommends — it **never** executes a transaction, moves
funds, signs a document, or acts on a user's behalf without the user explicitly
initiating and confirming each step. This is the Layer 3 boundary (visible
reasoning, no autonomous action) *extended forward*, not abandoned.

> "Your lease expires in 60 days; three verified listings beat your rent by
> 8–15% — want me to start a conversation with one?" ✅ advisory
> A system that renegotiates and re-signs the lease itself ❌ different
> regulatory category

Removing autonomy doesn't make these buildable *sooner* — it makes them
**legitimate destinations** rather than liabilities. The originally-autonomous
9.3 (transactions) and the original 9.6 (building control) were "never build
this way" problems, not "build later" ones. The advisory reframing fixes that;
timing is unchanged.

## The systems

| # | System | Readiness | Essence (advisory form) |
|---|--------|-----------|--------------------------|
| 9.2 | **Synapse World Model** | NEEDS SCALE | Not a new model — what the L3 matching engine + L5 liquidity engine *become* with years of data across many cities. "World model" = enough history that price/demand/movement predictions are statistically meaningful. |
| 9.4 | **Personal Property Agent** | **NEEDS SCALE — closest to buildable (~Yr 2)** | A standing Toju context per user that *proactively surfaces* things worth attention — never acts. Tenant: lease-expiry + market-comparison nudges. Landlord/investor: occupancy/pricing observations. Developer: demand-mix signals. User initiates every next step. |
| 9.5 | **Property Economy Layer** | NEEDS SCALE (partnerships) | Utilities/insurance/security/facilities plug in via referral/aggregation — Synapse is the place they connect, not the provider. Same cold-start sequencing as 7.3. No new licensing of Synapse's own. |
| 9.6 | **Building Intelligence** (advisory/monitoring) | NEEDS SCALE (IoT partnership) | Ingest 3rd-party building-sensor data via API, surface predictive-maintenance *advisories* ("elevator likely needs service in 14 days"). **Synapse builds no hardware.** Demand-led off 7.4's Property Management Cloud customers. |
| 9.8 | **Property Knowledge Graph** | NEEDS SCALE (no new arch) | Same as 8.1: the depth/connectedness L4 + L6 relational data reaches at scale. A graph is a *query pattern* over clean normalized schemas — already specified. Nothing to build now. |
| 9.9 | **Synapse Exchange** | **REASSESS — likely never Synapse directly** | Trading whole/fractional property, income streams, RE funds = a **securities exchange**. Needs a capital-markets license / SEC-recognized exchange status. Happens via partnership with or acquisition by a licensed operator, or not at all. **Do not scope as Synapse-built-and-operated.** |
| 9.10 | **Built World API** | NEEDS SCALE (demand-led) | Same as 7.10: programmatic access to hard-to-replicate data (verification, trust, market intel). Worthless without data worth paying for. Revisit on real data depth + inbound partner interest. |

The only system worth concrete scoping in a Year-2 horizon is **9.4 in advisory
form** — it needs no autonomy and only data earlier layers already collect (L2
lease dates, L6 portfolio/escrow, L4 property intel, L5 demand signals).

## What this document asks of work happening *now*

Two concrete instructions fall out of this layer. Both checked against the code
on 2026-06-25.

### 1. Store geographic data at fine resolution from day one (for 9.2)

> Coarse data collected early can't be refined later; fine data can always be
> aggregated up.

✅ **Already satisfied — and finer than asked.** `properties` carries `city`,
`state`, `latitude`, `longitude`, **and** a PostGIS `geography(point, 4326)`
`location` column (gist-indexed, sync-triggered) — coordinate-level, not just
neighbourhood. Layer 5's growth snapshots are keyed
`unique (city, neighbourhood, snapshot_date)`, and proximity search uses
`ST_DWithin` over geography points. No action needed.

### 2. Separate "observation/recommendation" from "action" in Toju's output

> As the L3 AI Gateway + memory service get built, Toju's output should always
> separate *"here is what I observed and recommend"* from *"here is the action
> you'd need to take"* as distinct, labeled fields — never one blended response.
> That discipline, applied from L3 onward, makes 9.4 a natural extension rather
> than a UI rewrite.

⚠️ **Not satisfied today.** `toju-chat` returns a single blended
`{ message, property_ids, session_id }` — `message` is one free-text blob; there
is no structural `recommendation` vs `suggestedAction` split, in the Edge
Function, the `TojuChatResponse` type, or the mobile chat UI. The recommendation
*enums* in `layer3.ts` belong to the separate recommendation engine, not the
chat contract.

This is the door-3 situation again: cheap to add now (one structured field on a
response that's already small), expensive once the mobile UI, notifications, and
any 9.4 surface all assume "message is one blob." It does **not** block anything
today and 9.4 is ~Year 2 — but the cheap moment to apply the discipline is the
next time Toju's contract is touched, defaulting `suggestedAction` to null so
nothing changes for current callers. Flagged as a task; not a reason to build
anything Layer-9-shaped now.

## Door status after this layer

All three Layer-7/8 keep-open doors remain ✅ open (UUID identity anchors;
append-only attributable scores; provider-agnostic + prompt-versioned gateway,
closed in `96565b2`). Layer 9 adds one **half-open** door — Toju's advisory
output contract (instruction 2 above) — the only structural thing standing
between today's Toju and 9.4's advisory agent being an extension rather than a
rewrite.
