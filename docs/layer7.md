# Layer 7 — Synapse Network (Vision & Sequencing)

> **This is not a build document.** Do not generate schemas, Edge Functions, or
> screens from it. It is the long-range vision for Synapse beyond Layer 6,
> written as a **constraint-checker** for current work: every architectural
> decision in Layers 1–6 should be checked against it — *"does this choice keep
> Layer 7 open, or does it close a door we'll want later?"*
>
> Layer 6 made Synapse the infrastructure transactions move *through*. Layer 7
> is the vision of Synapse becoming the infrastructure the *industry* runs on:
> *"if real estate happens in Africa, it happens through Synapse."* That is a
> 10-year vision, not a sprint. When any system below reaches its readiness
> threshold, it earns its own dedicated build prompt at that time — with the
> same architectural detail as Layers 1–6.

## Readiness legend

- **[BUILD NOW]** — natural extension of Layers 1–6; data already exists, minimal new risk.
- **[NEEDS SCALE]** — requires transaction volume / user density / liquidity first, or it ships as a ghost town.
- **[NEEDS LICENSING]** — requires a regulatory permission, partnership, or legal entity that code cannot create.
- **[REASSESS]** — real opportunity, but may be better served by Synapse exposing data/API to a specialist than by building the marketplace itself.

## The ten systems

| # | System | Readiness | One-line essence |
|---|--------|-----------|------------------|
| 7.1 | **Synapse Identity** | **BUILD NOW** | Unify L4 agency/agent verification + L6 consumer financial identity into one portable identity object per participant type, consistent ID scheme (`#SJ-` tenant, `#AG-` agent, `#DV-` developer), single trust-score presentation. No new trust mechanics — unification + portability of what exists. |
| 7.2 | **Reputation Layer** | **BUILD NOW** | Aggregation view per identity type over signals *already collected* — L4 reviews, L2 performance snapshots, L6 repayment reliability. Presentation + aggregation, not new data collection. |
| 7.3 | **Services Marketplace** | NEEDS SCALE | Verified movers/lawyers/surveyors plugging into live transactions. A second two-sided marketplace with its own supply cold-start. Revisit when one city's closed-deal volume makes post-transaction service demand measurable, not anecdotal. |
| 7.4 | **Property Management Cloud** | NEEDS SCALE | Rent collection, maintenance, occupancy, landlord reporting. Distinct buyer (landlord), distinct sales motion. Revisit once enough completed rentals exist — those landlords are the warm first customers, sourced from Synapse's own transaction history. |
| 7.5 | **Community Layer** | NEEDS SCALE | Building/development resident communities. A *retention* play, not acquisition. A 3-member community is a ghost town that damages trust. Revisit once geographic density in specific developments is proven. |
| 7.6 | **Market Intelligence** | NEEDS SCALE | Not new — this is **Layer 5's** marketplace-health/growth analytics, *productised and sold externally* (banks, developers, investors) once the data has volume + history worth paying for. A go-to-market decision, not new architecture. |
| 7.7 | **AI Property OS** | NEEDS SCALE | Toju's evolution from finder → portfolio/ops decision engine ("which property to sell," "which tenants will renew," "which agents underperform"). A later capability of the **Layer 3 AI Gateway**, gated on the underlying data layers having *history*. The gateway is now provider-agnostic + prompt-versioned (door 3, below), so this is an evolution, not a rewrite. |
| 7.8 | **Developer Cloud** | NEEDS SCALE | Extends L6 System 6 (inventory, installments, reservations, reminders) into full SaaS — launch tooling, lead distribution, sales-velocity forecasting. Revisit once 3–5 developers actively use the L6 infra and ask for more. |
| 7.9 | **Investment Marketplace** | **NEEDS LICENSING** | Fractional property investment / syndication = a **securities product**. Requires SEC (Nigeria) registration or a licensed capital-markets partner and a separate legal/compliance structure. **Do not write schema until that legal structure is confirmed in writing** — exactly the Layer-6 escrow/lending rule. Needs board-level + legal-counsel sign-off, not an engineering sprint. |
| 7.10 | **API Platform** | NEEDS SCALE | Open Synapse verification/trust/identity data to banks, insurers, government. The natural endpoint of the whole roadmap, and entirely demand-led: an API with no data of consequence is just an API. The L6 Financial Identity Graph + L4 Trust OS are the two assets most likely to make it compelling. Revisit once those have scale **and** a partner expresses inbound interest. |

**The only two worth concrete planning now are 7.1 and 7.2** — and even those are
presentation/unification over data Layers 1–6 already collect. Everything else
is vision; today's correct action is not to build it but to ensure nothing in
Layers 1–6 forecloses it.

## Door status — verified against the codebase (2026-06-25)

The four invariants that keep Layer 7 open, checked against what is actually in
the repo today:

| # | Door (keep-open invariant) | Status | Evidence |
|---|-----------------------------|--------|----------|
| 1 | Identity data structured for later unification (UUID keys, clean FKs) | ✅ **Open** | `profiles`, `agencies`, `financial_identities` are all UUID-keyed tables with clean FKs — 7.1 can reference them without migration. |
| 2 | Trust/reputation as discrete, attributable, append-only events (not opaque scores) | ✅ **Open** | `reject_mutation()` append-only guard across **12+** migrations incl. all of L4 trust (`0011`–`0016`) and L6 (`0023`/`0025`/`0026`). 7.2 aggregates a real event history. |
| 3 | **AI Gateway provider-agnostic + prompt-versioned** (so 7.7 isn't a rewrite) | ✅ **Open** (as of `96565b2`, 2026-06-25) | `toju-chat/index.ts` now has an `LLMProvider` abstraction with OpenAI + Anthropic adapters (default `claude-opus-4-8`), a versioned prompt registry that records prompt version + model per turn, and a tool registry. Was closed; widened the same day it was flagged. |
| 4 | Synapse stays out of fund custody (keeps 7.9 / banking optionality open) | ✅ **Open** | `0027_layer6_lending_wallet.sql` verbatim: *"Synapse originates, packages, mirrors. It does not underwrite or custody"*; wallet balance *"MIRRORED + reconciled — never the source of truth."* |

### Door 3 — flagged closed, then opened the same day

When this document was first written, Toju was a single-provider (OpenAI),
single-model (`gpt-4o`), single-hardcoded-unversioned-prompt, one-tool Edge
Function — fine for an MVP finder, but **not** the provider-agnostic,
prompt-versioned gateway 7.7 assumes, so 7.7 as written would have required an
architecture change, not a feature add.

It was widened the same day (commit `96565b2`), exactly along the lines flagged:
(a) an `LLMProvider` abstraction with OpenAI + Anthropic adapters, defaulting to
`claude-opus-4-8`; (b) a versioned prompt registry that records prompt version +
model on every assistant turn; (c) a tool registry the gateway iterates instead
of a single inline tool. Toju's behavior, prompt text, RLS scoping, and
mandatory-city rule were left unchanged.

So all three keep-Layer-7-open doors are now verified open. The lesson worth
keeping: a vision doc is only useful if its self-checks are run against the
*code*, not the *intent* — this one caught a door that intent said was open and
code said was shut, and the gap got closed because the check was honest.

## The one-line test for every future Layer 7 decision

> Before building any system here, ask: **does Synapse currently have the
> volume, trust, or licensing this system needs to not be a ghost town or a
> regulatory violation on day one?** If the honest answer is no, it stays in
> this document as vision — not in a sprint, not in a Claude Code prompt, and
> not in an investor deck as a near-term roadmap item.
