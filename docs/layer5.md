# Layer 5 — Distribution Operating System

Growth as a system, not ads. An agency uploads once; Synapse generates
content, distributes it across every channel, discovers matched buyers,
delivers qualified leads, and activates referral loops — all automated,
attributed, and compounding. Builds additively on Layers 1–4.

## The nine systems

| # | System | Tables |
|---|---|---|
| 1 | Content generation | `generated_content`, `content_variants`, `campaign_suggestions` |
| 2 | Social syndication | `social_accounts`, `social_posts`, `social_post_metrics` |
| 3 | Campaigns | `campaigns`, `campaign_assets` |
| 4 | Proximity marketing | `geofences`, `proximity_events`, `proximity_alert_outcomes` |
| 5 | Discovery | `discovery_feed_records` |
| 6 | Referrals | `referrals`, `referral_rewards`, `referral_reward_config` |
| 7 | Growth analytics | `growth_metrics` |
| 8 | Marketplace liquidity | `marketplace_health` |
| 9 | Viral loops | `viral_loop_events` |

## Migrations 0018–0022

- **0018** content + social: generated_content, variants, campaign_suggestions;
  social_accounts (tokens in Vault, **not** in the table), social_posts,
  time-series social_post_metrics.
- **0019** campaigns + proximity: campaigns/assets; PostGIS geofences with
  `sync_geofence_centre()` + the `proximity_matches()` definer function
  (ST_DWithin + intelligence-graph filter); append-only proximity_events;
  proximity_alert_outcomes.
- **0020** discovery feed records (one/user/property/feed/day); referrals,
  rewards, reward config.
- **0021** growth_metrics (daily), marketplace_health (weekly) +
  `aggregate_marketplace_health()` pg_cron; append-only viral_loop_events;
  extends the Layer 2 `event_type` enum with 15 distribution events.
- **0022** RLS on all 20 tables.

## Distribution chain

`property published → content generated (AI) → agency approves → syndicated
to platforms → metrics tracked → leads attributed back to the campaign
(Layer 2 lead_attribution.campaign_id) → deal closed → referral loop`.

## Proximity (the defensible feature)

Five services, all server-side: **geofence** (PostGIS circle/property),
**match** (`proximity_matches()` = ST_DWithin + budget/type/city from the
Layer 3 graph), **trigger** (30-day intent, max 1/property/7d, max 1/4h
session, location permission — enforced in the `proximity-check` Edge
Function), **notification** (via Layer 2 orchestration), **attribution**
(source `proximity_alert` in Layer 2). Every event is logged append-only.

## Security highlights

- **Social tokens** never live in `social_accounts` — they're encrypted in
  Supabase Vault, keyed by row id, read only by Edge Functions (service role).
- **Reward logic** runs in Edge Functions, never client-side.
- **Growth, marketplace, and viral-loop tables** have RLS enabled with **zero
  client policies** (platform-admin/service-role only). Marketplace insight
  reaches agencies through a curated Edge-Function surface (the demand
  prompt), never direct table reads.
- Agencies own their content/campaigns/social/geofences; consumers own their
  discovery feed, referrals, and proximity history.

## Append-only

`proximity_events`, `viral_loop_events`, and the Layer 2 `events` table
(extended with Layer 5 types) are immutable via `reject_mutation()` — the
distribution event history is the training data for future optimisation.

## AI integration (Layer 3 gateway)

Content generation, campaign suggestions, discovery ranking (match scores +
trending/liquidity blend), and monthly distribution-optimisation insights
(stored in Layer 3 `marketing_insights`). The agency never sees the model or
prompt — only the output.

## API (`packages/api`)

`content`, `social`, `distribution` modules + hooks: `useGenerateContent`,
`useApproveContent`, `useCampaigns`/`useCreateCampaign`, `useSocialAccounts`,
`useDiscoveryFeed`, `useReferralSummary`/`useCreateReferral`,
`useCampaignSuggestions`. Generation, account connection, proximity checks,
and reward issuance route through Edge Functions.

## New design primitives (`packages/ui`)

`ContentCard`, `CaptionPreviewCard`, `CampaignCard`, `DiscoveryFeedCard`,
`ReferralCard`, `MarketplaceHealthCard`, `GrowthMetricCard` (sparkline),
`ViralLoopCard`, `SocialAccountCard`. `ProximityAlertCard` is reused from
Layer 1. All extend `GlassCard`, tokens-only.

## Edge Functions to implement at deploy

The API references these (contracts defined, handlers are the deploy step):
`content-generate`, `social-connect` (+ token→Vault), `proximity-check`
(trigger rules + alert), plus the scheduled jobs for syndication publishing,
metric fetching, token refresh, discovery feed generation, and the nightly
growth-metric aggregation.
