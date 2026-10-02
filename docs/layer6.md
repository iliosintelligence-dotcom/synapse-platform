# Layer 6 — Financial Infrastructure

Layer 6 turns Synapse from a marketplace that *originates* transactions into the
rail those transactions *move through*. The ambition: every naira that moves
during a property transaction moves through Synapse.

## The regulatory invariant (the first architectural decision)

**Synapse never custodies consumer money.** Synapse is not a deposit-taking
institution and is not licensed as one. Every feature that touches consumer or
agency funds is an **orchestration layer over a licensed partner** — a
CBN-licensed Microfinance Bank (MFB), Payment Service Bank (PSB), commercial
bank, or lending partner — reached through their APIs (or Paystack's licensed
rails where applicable).

Concretely, this shows up everywhere in the schema:

- Every money-touching table carries `partner_institution_id`.
- The Synapse ledger is a **mirror** of the partner's ledger, reconciled
  continuously — **never** the source of truth for custody.
- Fund-movement state (`released`, `refunded`, `confirmed`, wallet `balance`)
  only advances on a **confirmed partner webhook**, never on internal state.
- `partner_institutions.integration_status` gates activation. The
  `partner_is_live()` SQL guard and the Edge Functions both refuse to move real
  money unless the relevant partner is `live` (contract + regulatory sign-off
  confirmed in writing). API clients receive `partner_not_live: true`.

> Building the schema is cheap. Holding a stranger's ₦500,000 is not. Systems
> **1, 2, 3, and 7 must not go live for a single real user** until the relevant
> banking/lending partnership is **signed**, not architecturally assumed.

## The eight systems

| # | System | Partner needed? | Risk | Synapse's role |
|---|--------|-----------------|------|----------------|
| 1 | **Escrow** | Yes (MFB/PSB) | Med | Ledger, milestones, release rules |
| 2 | **Rent Now, Pay Monthly** | **Yes — gated** | **Highest** | Origination + data packaging + thin servicing |
| 3 | **Mortgage Marketplace** | Yes (referral) | Med | Connect pre-qualified buyers to providers |
| 4 | **Affordability Engine** | No | Low | Advisory math surfaced through Toju |
| 5 | **Agent Commission** | No (Paystack) | Lowest | Internal ledger + payout of the agency's own funds |
| 6 | **Developer Sales** | Escrow (S1) | Med | Inventory, installment plans, reservations |
| 7 | **Wallet** | **Yes — gated** | **Highest** | Interface + savings logic over partner virtual accounts |
| 8 | **Financial Identity Graph** | No (consumes 1–3) | — | The compounding consumer-trust moat |

### System 1 — Escrow
`escrow_accounts` → `escrow_milestones` → append-only `escrow_events`. A
milestone is satisfied by a verified action (e.g. Layer 4 property verification
reaching `verified` auto-clears a `verification_complete` milestone) or by the
required approver. When a release tranche is fully satisfied, the
`escrow-approve-milestone` Edge Function calls the partner's release API; status
advances only on the partner's confirmation webhook. `escrow_events` feeds Layer
4 dispute resolution.

### System 2 — Rent Now, Pay Monthly *(gated)*
Synapse **originates** — packaging verified identity (L4), declared/verified
income, and lease terms into a structured application to a partner lender. The
lender underwrites, approves/declines, and disburses annual rent to the landlord
(via escrow). The tenant repays the **lender** monthly;
`rent_repayment_schedules` mirrors the lender's schedule, never generated
independently. Guarantors verified via Smile Identity (L4). Synapse earns an
origination fee + optional servicing fee — **no interest income**, no balance-
sheet risk.

### System 3 — Mortgage Marketplace *(gated)*
A marketplace, not a lender. `mortgage_providers` may be `api_connected` or
`manual_referral` (a platform admin advances status from provider feedback).
Synapse earns a referral/origination fee per closed mortgage. Never underwrites
or disburses.

### System 4 — Affordability Engine
Advisory only — **never a credit decision.** `analyseAffordability()` is pure,
conservative math (rent ≤ ~30% of net income; DTI ceiling ~40%) stored in
`affordability_analyses`. `recommendation_reasoning` always discloses the basis
and that it is *not* a credit approval. Toju surfaces it in
`MatchScoreCard`/`TojuResponseCard`, so affordability is a visible factor in
every recommendation — not an isolated calculator.

### System 5 — Agent Commission
No banking partner: the **agency** disburses its **own** commission funds over
the existing Paystack rails — a payroll-like automation, not third-party
custody. `commission_structures` (flat / tiered / flat-amount) →
`commission_ledger` (gross, split, net) → the `commission-payout` Edge Function
batches approved entries per agent and calls Paystack transfers. Plus
`performance_bonuses`. Closes the "agencies running blind" pain point from L2.

### System 6 — Developer Sales
A lightweight sales ERP for developers. `developments` → `unit_inventory` →
`installment_plans` → `installment_schedules` (reminders via L2 notifications at
7d / 1d / due). Reservations hold a unit (e.g. 72h) and auto-expire back to
`available` if the down payment is unpaid. Down payments route through escrow.

### System 7 — Wallet *(gated)*
Each wallet is a **dedicated virtual account at the partner bank** — not a
Synapse balance. `wallets.balance` is mirrored + reconciled, never the source of
truth; `wallet_transactions` rows only become `confirmed` on a partner webhook.
`savings_goals` (auto-save toward rent / down-payment) is Synapse-side logic and
safe to write. Opening a wallet and every movement go through the `wallet-open`
/ wallet Edge Functions, which refuse unless the partner is `live`.

### System 8 — Financial Identity Graph
The moat. `financial_identities` carries a **consumer** trust score (distinct
from L4 agency/agent scores) built from payment reliability (S2/S3), verification
completeness (L4), and transaction history (S1). `score_component_history` is
append-only — every movement traces to a contributing event.
**Strictest RLS on the platform:** readable by the user themselves, and by
others **only** through an explicit, logged, consent-scoped
`financial_consent_grants` row the user creates (e.g. on submitting an
application). Landlords/agencies see an aggregate; lenders get a structured
subset; the user sees the full breakdown. Never exposed by default.

## Events

Layer 6 emits into the L2 event log (append-only, immutable): `escrow_funded`,
`escrow_milestone_approved`, `escrow_released`, `escrow_disputed`,
`rent_financing_*`, `repayment_received`/`_missed`, `mortgage_application_submitted`,
`mortgage_approved`, `commission_calculated`/`_paid`, `unit_reserved`/`_sold`,
`installment_paid`/`_missed`, `wallet_transaction_confirmed`,
`financial_identity_score_updated`.

## Security & compliance

- Fund-movement Edge Functions run under stricter rate limits and require recent
  re-authentication (not just a valid session) above a threshold amount.
- Partner API credentials live in **Supabase Vault**, accessed only by dedicated
  Edge Functions — each partner is its own credential boundary.
- RLS everywhere: a user reads only their own financial records; an agency reads
  only its own commission/transaction records; no cross-user/cross-agency
  visibility. Platform admins act via the service role in Edge Functions only,
  and **every admin access to a financial record is logged**
  (`financial_admin_access_log`, append-only).

## Build sequencing

1. **System 5** (Commission) — no partner, immediate agency value.
2. **System 4** (Affordability) — no partner, advisory, extends Toju.
3. **System 8** (Financial Identity) — schema/scoring early so events write in.
4. **System 1** (Escrow) — once a banking partner is signed; unlocks S6.
5. **System 6** (Developer Sales) — once escrow is live.
6. **Systems 2, 3, 7** — last, and **only** with written, signed partnership +
   compliance sign-off, regardless of engineering completeness.

## Migrations

`0023` partners + admin-access log · `0024` commission + affordability · `0025`
financial identity + consent · `0026` escrow + developer sales · `0027` lending
+ mortgage + wallet (gated) · `0028` event types + strict RLS.

## Package surface

- **types:** `packages/types/src/layer6.ts`
- **api:** `commission`, `affordability`, `financialIdentity`, `escrow`,
  `developer`, `financing`, `wallet` (+ hooks)
- **ui:** `EscrowCard`, `CommissionLedgerCard`, `RepaymentScheduleCard`,
  `FinancialIdentityCard`, `WalletCard`

## ⚠ Activation checklist (do not skip)

Before Systems **1, 2, 3, or 7** serve real money to a real user, confirm **in
writing**:

- [ ] The partner (MFB/PSB/lender) contract is **signed**.
- [ ] Regulatory sign-off for the specific flow is obtained.
- [ ] `partner_institutions.integration_status = 'live'` for that partner.
- [ ] Vault credentials are loaded and scoped to that partner's Edge Functions.
- [ ] A compliance review of the flow is complete.

A proptech company survives a bad UI decision. It does not survive operating an
unlicensed deposit-taking or lending product in Nigeria.
