# Layer 4 — Trust Operating System

Trust is infrastructure, not a badge. Layer 4 is a continuously-updated
confidence framework spanning agencies, agents, properties, documents,
transactions, and disputes. Every score and verification state is computed
**server-side** — never on the client. Builds additively on Layers 1–2.

## The seven systems

| # | System | Tables |
|---|---|---|
| 1 | Agency verification (5 tiers) | `agency_verifications`, `agency_verification_checks` |
| 2 | Agency trust score | `agency_trust_scores`, `agency_trust_score_snapshots` |
| 3 | Agent verification & reputation | `agent_verifications`, `agent_disciplinary_records`, `agent_reputation_snapshots` |
| 4 | Property verification | `property_verifications`, `property_verification_checks`, `property_verification_history` |
| 5 | Document intelligence | `documents`, `document_versions` |
| 6 | Fraud detection | `fraud_flags`, `fraud_events` |
| 7 | Dispute resolution | `disputes`, `dispute_evidence`, `dispute_comments` |
| — | Reputation | `consumer_reviews`, `review_aggregates`, `trust_audit_logs`, `reputation_timelines` |

## Migrations 0011–0017

- **0011** agency verification + trust score (+ daily snapshots).
- **0012** agent verification, discipline, reputation snapshots.
- **0013** property verification pipeline + 7-node `recompute_node_score()`;
  adds `image_hash` to `property_media` for image-duplication detection.
- **0014** documents + version chain + `supersede_document()`.
- **0015** fraud flags/events + disputes/evidence/comments.
- **0016** reviews, aggregates, trust audit, reputation timeline, and the
  nightly `recalc_agency_trust()` (pg_cron, 02:00) computing the six
  weighted components and appending a daily snapshot.
- **0017** RLS on all 21 tables.

## Verification tiers (System 1)

`unverified → basic_verified → business_verified → enhanced_verified →
synapse_certified`. Each unlocks capability (listing caps in
`TIER_LISTING_CAP`) and a stronger UI signal. The Layer 1 `verification_tier`
on agencies stays a simple badge; the authoritative status is
`agency_verifications.current_tier`.

## Trust score (System 2)

Continuous, distinct from the tier threshold. Weighted components
(`TRUST_WEIGHTS`): verification 25, response time 20, lead handling 20,
transactions 20, ratings 10, disputes 5. Recalculated nightly and **appended**
to `agency_trust_score_snapshots` (never overwritten) — this powers the trust
timeline.

## Property 7-node score (System 4)

Seven check types derive the consumer-facing score (`NODE_WEIGHTS`). Passed
checks show as green chips, pending as muted chips. **Failed checks never
appear on consumer surfaces** — enforced twice: the `getPropertyTrustSummary`
API filters them, and the `property_checks_select` RLS policy only exposes
non-failed rows to non-members. A property with a failed check leaves the
verified pool.

## Append-only audit spine

`agency_verification_checks`, `agent_disciplinary_records`,
`property_verification_history`, `document_versions`, `fraud_events`,
`trust_audit_logs`, `reputation_timelines`, and all `*_snapshots` are
immutable via the shared `reject_mutation()` trigger.

## RLS summary

- **Consumers** read trust scores, verification status, published reviews,
  and reputation timelines for any agency/agent. They write only their own
  reviews and disputes.
- **Agents** read their own verification/reputation. Cannot modify.
- **Agency owners/admins** read all agency + agent trust data within their
  agency. Cannot modify platform-calculated scores.
- **Fraud flags/events and trust audit logs** have RLS enabled with **zero
  client policies** — readable/writable only by the service role in Edge
  Functions (platform admin operations).
- **Documents** use `can_access_document()`: deal-room docs → parties;
  property docs → the agency + the deal-room consumer; agency credentials →
  agency owner only; agent docs → the agent + agency admins.

## AI preparation (no AI yet)

Schema reserved for four future systems, no migration needed when they land:
`fraud_flags.resolution` (human label → Fraud Detection AI),
`documents.ai_analysis_result` (Document Analysis AI),
`agency_trust_scores.predicted_trust_score` (Trust Scoring AI), and
`risk_indicator` on agency + agent verifications (Reputation Intelligence).

## New design primitives (`packages/ui`)

`TrustScoreRing`, `VerificationTierBadge` (5 variants), `PropertyVerificationPanel`
(7-node), `DocumentVaultCard` (completeness ring), `DisputeCard` (SLA-aware),
`FraudFlagCard` (admin-only), `TrustTimelineStrip`, `ConsumerReviewCard`,
`ReputationSummaryCard`. All extend `GlassCard`, tokens-only.

## Trust as discovery

Trust signals belong at every point of discovery, not a destination:
PropertyCard verification chip, AgentCard badges, agency profile trust ring +
timeline, deal-room vault completeness + party verification. The API ships
`getPropertyTrustSummary`, `getAgencyTrustPublic`, `getReviewAggregate`, and
`getReputationTimeline` for exactly these surfaces.
