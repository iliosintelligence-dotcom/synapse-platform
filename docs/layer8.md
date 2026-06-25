# Layer 8 — North Star (NOT a build document)

> **Do not paste this into Claude Code. Nobody builds toward this document.**
>
> This is a drawer document — take it out roughly once a year and use it to
> check whether Synapse is still pointed the right direction. Its only function:
> when Synapse makes a decision in Years 1–5 (a partnership, a data structure, a
> hire, an API design), there is a written articulation of the long arc that
> decision should not foreclose. Layers 1–7 either keep the door open to this
> future or they don't — that is the *only* way this document should ever be
> used.

## What Layer 8 actually is

Every Layer 8 system shares one property: it requires Synapse to have already
*become* something that does not exist yet — verified data spanning years and
millions of transactions, institutional trust from banks and governments, and in
several cases a regulatory license that has nothing to do with software. You do
not build your way there with a sprint. You earn it by being right, repeatedly,
at the layers beneath, for a long time.

| # | System | Honest category |
|---|--------|-----------------|
| 8.1 | African Property Graph | Not a new system — the *eventual breadth* of the Layer 4/6 data after years across many cities. |
| 8.8 | Property DNA | Same — the *eventual depth* of Layer 4 verification + Layer 6 transaction history per property. |
| 8.3 | Property Credit Bureau | The multi-year, multi-thousand-user version of Layer 6's Financial Identity Graph. Scale + time, no new system. |
| 8.5 | Urban Intelligence Platform | Government/country-scale version of the Layer 5/7 data-product GTM vector. A sales decision, not architecture. |
| 8.7 | Toju as Real Estate Co-Pilot | Continuous evolution of the Layer 3 AI Gateway as data + history accumulate — *if* the gateway is built right (see door check). |
| 8.2 | Digital Twin | Visualisation layer atop 8.1/8.3/8.5. Nothing to build or design now. |
| 8.10 | Economic Engine | Modelling layer atop everything above. Nothing to build or design now. |
| 8.4 | Capital Markets | **Separate business.** Needs fund-management licensing + institutional sales. Not Synapse-the-company to build directly. |
| 8.6 | Autonomous Transactions | **Separate business / government's job.** Needs title-registry + legal-settlement infrastructure changes. Not a startup's to build. |
| 8.9 | Synapse University | **Separate business.** Needs an accreditation body + an education company. Spin-off / partnership at most. |

8.4, 8.6, and 8.9 are flagged explicitly as **out of scope for Synapse ever to
build directly** — if they happen, they happen as a partnership, an investment,
or a spin-off, years after Synapse has the credibility each requires.

## The only thing this document asks of today's work

> Keep every data structure, every trust signal, and every AI architecture
> decision in Layers 1–6 general enough that it *could* extend to more cities,
> more years, and more signal types — **without ever building toward that
> extension directly.**

### Three concrete checks — re-run at each layer's real implementation, not just at prompt-writing

Verified against the codebase, 2026-06-25:

1. **Property schema stores city/state as structured fields, not free-text address?**
   ✅ **Yes.** That is the whole difference between "data that can become 8.1 someday" and data that can't.

2. **Financial Identity Graph stores scores as derived, recalculable values from append-only event logs, not opaque numbers updated in place?**
   ✅ **Yes.** `reject_mutation` append-only event tables; scores recompute from history. This is what makes 8.3 possible later without a rewrite.

3. **AI Gateway provider-agnostic and prompt-versioned, not hardcoded to one model + one prompt set?**
   ⚠️ **Not yet — specified that way, but not built that way.** `supabase/functions/toju-chat/index.ts` today hardcodes a single provider + model (`OPENAI_URL`, `MODEL = 'gpt-4o'`), a single inline **unversioned** `SYSTEM_PROMPT`, and one inline tool. There is no provider abstraction, prompt registry, or version field. Until that is widened, 8.7 (and 7.7) would require an architecture change, not a feature add. Tracked as a flagged refactor to do the next time Toju is touched — *not* a reason to build anything Layer-8-shaped now. See [layer7.md](layer7.md) "door 3."

If checks 1–3 all stay **yes** as Layers 1–6 actually get built, Layer 8 remains
genuinely possible without anyone needing to think about it for years. Check 3 is
the one currently at risk.

## What to do with this document

Keep it. Don't build from it. **Don't put it in a pitch deck as a near-term
roadmap** — "Bloomberg meets Stripe meets Airbnb for African real estate" is a
pattern investors recognise as a substitute for a credible near-term plan, and
it undermines the very real, very buildable Layers 1–6 you can actually show.

If a future version of you opens this in three to five years and Synapse is
sitting on verified property data across multiple Nigerian cities, with real
transaction volume and institutional partners asking what's next — *that* is when
this document earns a place in a real planning conversation. Not before.
