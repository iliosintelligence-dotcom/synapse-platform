# Layer 2 — Transaction Operating System

Layer 2 turns Synapse from a listing+lead product into a revenue operating
system: it makes every inquiry capturable, every interaction auditable, and
every transaction attributable. It builds **additively** on Layer 1 — the
MVP `leads` and `viewings` tables are extended, never rebuilt.

## Modules

| Module | Owns |
|---|---|
| crm | lead intelligence + pipeline engine (`crm.ts`) |
| deal_rooms | transaction workspaces (`dealRooms.ts`) |
| viewings | scheduling + structured outcome capture (`viewings.ts`) |
| communications | every touchpoint + computed response time (`communications.ts`) |
| attribution | raw touchpoints; models derived at query time (`attribution.ts`) |
| tasks | tasks + stage-triggered templates (`tasks.ts`) |
| notifications | recipient reads + read-state (`notifications.ts`) |
| activity | immutable universal feed (`activity.ts`) |
| performance | pre-aggregated snapshot reads (`performance.ts`) |
| events | append-only typed events (table `events`) |

## Migrations

- **0005_layer2_crm** — extends `leads` into a lead-intelligence schema
  (assigned agent, stage, budget, risk, + AI-reserved score columns);
  `lead_stage_history` (append-only) with the `move_lead_stage()` RPC that
  computes time-in-stage; `deal_rooms`; `lead_attribution` (append-only).
- **0006_layer2_ops** — extends `viewings` with the post-viewing AI signal
  fields; `communications` with an insert trigger computing
  `response_time_seconds`; `tasks` + `task_templates`.
- **0007_layer2_events** — `events` + `activity_feed` (both append-only),
  `notifications` + `notification_templates`, and the Realtime publication.
- **0008_layer2_performance** — `agency_daily_snapshots`,
  `agent_daily_snapshots`, `property_performance`, and the nightly
  `pg_cron` job running `aggregate_daily_snapshots()`.
- **0009_layer2_rls** — RLS on every Layer 2 table.
- **0010_layer2_reports** — `channel_first_touch_revenue()` reporting RPC.

## Append-only guarantee

`lead_stage_history`, `lead_attribution`, `events`, and `activity_feed` are
immutable: a `reject_mutation()` trigger blocks every UPDATE and DELETE at
the database level. These are the training data and audit spine for Layer 3
AI. Nothing overwrites history.

## RLS summary

| Who | Sees |
|---|---|
| Consumer | own leads, viewings, deal rooms, notifications |
| Agent | leads assigned to them, deal rooms they're on, own tasks/snapshots |
| Agency admin/owner | all agency data; admins+ manage templates & config |
| Platform admin | service role in Edge Functions only — never in client code |

`can_access_lead()` and the Layer 1 `is_agency_member()` / `agency_role()`
helpers (SECURITY DEFINER) back the policies.

## Performance: snapshots only

Dashboards **never** aggregate raw rows at query time. The nightly cron fills
per-day snapshots; the API exposes only snapshot reads. `property_performance`
is a rolling upsert. Re-running the aggregator is idempotent.

## Realtime

`pipeline`, `deal_rooms`, `activity_feed`, `events`, `notifications`,
`viewings`, and `communications` are in the `supabase_realtime` publication.
The API ships `subscribeToPipeline`, `subscribeToDealRoom`,
`subscribeToActivity`, `subscribeToMyNotifications`, and
`subscribeToAgencyLeads` (Layer 0.5) — boards, deal rooms, feeds, and badges
update without polling.

## AI preparation (Layer 3)

These nullable columns exist now, are rule-populated (or null), and will be
written by AI later with **no schema change**: `lead_score`, `intent_score`,
`financial_readiness_score`, `engagement_score`, `urgency_score`,
`responsiveness_score`, `fit_score`, `conversion_probability`,
`next_action_recommendation` (on `leads`); `sentiment_placeholder` (on
`communications`); and the post-viewing capture fields (on `viewings`).

## New design primitives (`packages/ui`)

`LeadCard`, `PipelineColumn`, `PipelineBoard`, `DealRoomCard`, `TaskCard`,
`TimelineCard`, `ActivityFeed`, `NotificationCard`, `PerformanceCard`, and
`ViewingManagementCard` (agency-side outcome capture — distinct from the
Layer 1 consumer `ViewingCard`). All extend `GlassCard` and use only
`packages/ui` tokens.

### Naming note

The Layer 1 `ViewingCard` (consumer slot scheduling) is unchanged. The
Layer 2 agency viewing with the outcome-capture form is `ViewingManagementCard`
to avoid a breaking rename.
