/**
 * Layer 5 — the Distribution Operating System.
 * Upload once, distribute everywhere: content generation, social syndication,
 * campaigns, proximity marketing, discovery feeds, referrals, growth +
 * marketplace analytics, and viral-loop instrumentation.
 *
 * Builds additively on Layers 1–4. AI routes through the Layer 3 gateway,
 * trust through Layer 4, lead creation + events through Layer 2.
 */
import type { BaseEntity } from './entities';
import type { ListingType, PropertyType } from './enums';

/* ───────────────────────── enums ───────────────────────── */

export enum ContentType {
  INSTAGRAM_POST = 'instagram_post',
  INSTAGRAM_REEL = 'instagram_reel',
  TIKTOK_SCRIPT = 'tiktok_script',
  FACEBOOK_POST = 'facebook_post',
  LINKEDIN_POST = 'linkedin_post',
  WHATSAPP_MESSAGE = 'whatsapp_message',
  BROCHURE_COPY = 'brochure_copy',
  EMAIL_BODY = 'email_body',
}

export enum NarrativeAngle {
  LUXURY = 'luxury',
  INVESTMENT = 'investment',
  RENTAL = 'rental',
  FAMILY = 'family',
  COMMERCIAL = 'commercial',
  SHORTLET = 'shortlet',
}

export enum ContentStatus {
  DRAFT = 'draft',
  APPROVED = 'approved',
  SCHEDULED = 'scheduled',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export enum ContentVariantType {
  HEADLINE = 'headline',
  BODY = 'body',
  CTA = 'cta',
  HASHTAGS = 'hashtags',
}

export enum SocialPlatform {
  INSTAGRAM = 'instagram',
  FACEBOOK = 'facebook',
  TIKTOK = 'tiktok',
  LINKEDIN = 'linkedin',
  X = 'x',
}

export enum SocialPostStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  PUBLISHING = 'publishing',
  PUBLISHED = 'published',
  FAILED = 'failed',
}

export enum CampaignType {
  PROPERTY_SHOWCASE = 'property_showcase',
  AREA_FOCUS = 'area_focus',
  PROPERTY_TYPE = 'property_type',
  INVESTMENT_FOCUS = 'investment_focus',
  PRICE_RANGE = 'price_range',
}

export enum CampaignStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

export enum ProximityEventType {
  ENTERED = 'entered',
  ALERT_SENT = 'alert_sent',
  ALERT_TAPPED = 'alert_tapped',
  ALERT_SUPPRESSED = 'alert_suppressed',
}

/** Six discovery feeds. Named to avoid collision with Layer 3's FeedType. */
export enum DiscoveryFeedType {
  RECOMMENDED = 'recommended',
  NEARBY = 'nearby',
  TRENDING = 'trending',
  NEW_LISTINGS = 'new_listings',
  INVESTMENT_PICKS = 'investment_picks',
  RECENTLY_REDUCED = 'recently_reduced',
}

export enum ReferralType {
  PROPERTY_SHARE = 'property_share',
  AGENCY_REFERRAL = 'agency_referral',
  CONSUMER_REFERRAL = 'consumer_referral',
  AGENT_REFERRAL = 'agent_referral',
}

export enum ReferrerType {
  CONSUMER = 'consumer',
  AGENCY = 'agency',
  AGENT = 'agent',
}

export enum ReferralChannel {
  WHATSAPP_SHARE = 'whatsapp_share',
  COPY_LINK = 'copy_link',
  DIRECT_INVITE = 'direct_invite',
  SOCIAL_SHARE = 'social_share',
}

export enum ReferralStatus {
  PENDING = 'pending',
  SIGNED_UP = 'signed_up',
  ACTIVATED = 'activated',
  TRANSACTED = 'transacted',
}

export enum RewardType {
  CREDIT = 'credit',
  FEE_REDUCTION = 'fee_reduction',
  CASH_EQUIVALENT = 'cash_equivalent',
}

export enum PriceTrend {
  RISING = 'rising',
  STABLE = 'stable',
  FALLING = 'falling',
}

export enum MarketHealthStatus {
  HEALTHY = 'healthy',
  OVERSUPPLIED = 'oversupplied',
  UNDERSUPPLIED = 'undersupplied',
  ILLIQUID = 'illiquid',
}

export enum ViralLoopType {
  CONTENT_LOOP = 'content_loop',
  TRANSACTION_LOOP = 'transaction_loop',
  AGENCY_CONTENT_LOOP = 'agency_content_loop',
}

/** Default geofence radius (metres). */
export const DEFAULT_GEOFENCE_RADIUS = 500;

/* ──────────────── System 1 — Content Generation ──────────────── */

export interface GeneratedContent extends BaseEntity {
  property_id: string;
  agency_id: string;
  content_type: ContentType;
  narrative_angle: NarrativeAngle;
  generated_text: string;
  status: ContentStatus;
  generated_by: string; // ai model version
  generation_prompt_version: string;
  approved_by: string | null;
  approved_at: string | null;
}

export interface ContentVariant {
  id: string;
  content_id: string;
  variant_type: ContentVariantType;
  variant_text: string;
  created_at: string;
}

export interface CampaignSuggestion {
  id: string;
  agency_id: string;
  suggestion_text: string;
  campaign_type: CampaignType;
  property_ids: string[];
  is_dismissed: boolean;
  acted_on: boolean;
  created_at: string;
}

/* ──────────────── System 2 — Social Syndication ──────────────── */

export interface SocialAccount extends BaseEntity {
  agency_id: string;
  platform: SocialPlatform;
  platform_account_id: string;
  platform_username: string;
  // access_token is NEVER returned to clients — stored in Supabase Vault
  token_expires_at: string | null;
  is_active: boolean;
  connected_at: string;
  last_synced_at: string | null;
}

export interface SocialPost extends BaseEntity {
  property_id: string;
  content_id: string;
  agency_id: string;
  platform: SocialPlatform;
  platform_post_id: string | null;
  status: SocialPostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  failure_reason: string | null;
}

export interface SocialPostMetrics {
  id: string;
  social_post_id: string;
  platform: SocialPlatform;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  link_clicks: number;
  profile_visits: number;
  fetched_at: string;
  created_at: string;
}

/* ──────────────── System 3 — Campaigns ──────────────── */

export interface Campaign extends BaseEntity {
  agency_id: string;
  name: string;
  campaign_type: CampaignType;
  status: CampaignStatus;
  start_date: string;
  end_date: string;
  target_platforms: SocialPlatform[];
  target_audience_description: string | null;
  budget_naira: number | null;
  total_impressions: number;
  total_reach: number;
  total_inquiries: number;
  total_viewings: number;
  total_closes: number;
}

export interface CampaignAsset {
  id: string;
  campaign_id: string;
  property_id: string;
  content_id: string;
  platform: SocialPlatform;
  asset_status: SocialPostStatus;
  created_at: string;
}

/* ──────────────── System 4 — Proximity ──────────────── */

export interface Geofence extends BaseEntity {
  property_id: string;
  agency_id: string;
  centre_lat: number;
  centre_lon: number;
  radius_metres: number;
  is_active: boolean;
}

/** Append-only. Training data for future alert-timing optimisation. */
export interface ProximityEvent {
  id: string;
  user_id: string;
  property_id: string;
  geofence_id: string;
  event_type: ProximityEventType;
  suppression_reason: string | null;
  occurred_at: string;
}

export interface ProximityAlertOutcome {
  id: string;
  alert_id: string;
  user_id: string;
  property_id: string;
  was_tapped: boolean;
  tapped_at: string | null;
  led_to_viewing: boolean;
  led_to_deal: boolean;
  created_at: string;
}

/* ──────────────── System 5 — Discovery ──────────────── */

export interface DiscoveryFeedRecord {
  id: string;
  user_id: string;
  feed_type: DiscoveryFeedType;
  property_id: string;
  position_in_feed: number;
  match_score: number | null;
  reason_text: string;
  was_impressed: boolean;
  was_tapped: boolean;
  was_saved: boolean;
  led_to_contact: boolean;
  feed_date: string;
  created_at: string;
}

/* ──────────────── System 6 — Referrals ──────────────── */

export interface Referral {
  id: string;
  referrer_id: string;
  referrer_type: ReferrerType;
  invitee_id: string | null;
  referral_code: string;
  referral_channel: ReferralChannel;
  property_id: string | null;
  status: ReferralStatus;
  signed_up_at: string | null;
  activated_at: string | null;
  transacted_at: string | null;
  reward_issued: boolean;
  created_at: string;
}

export interface ReferralReward {
  id: string;
  referral_id: string;
  reward_type: RewardType;
  reward_amount: number;
  currency: string; // NGN
  issued_at: string | null;
  expires_at: string | null;
  redeemed_at: string | null;
}

export interface ReferralRewardConfig {
  id: string;
  referrer_type: ReferrerType;
  reward_type: RewardType;
  reward_amount: number;
  currency: string;
  is_active: boolean;
}

/* ──────────────── System 7 — Growth analytics ──────────────── */

export interface GrowthMetric {
  id: string;
  metric_category: string; // acquisition | activation | retention | revenue | referral | geographic
  metric_name: string;
  metric_value: number;
  dimension: Record<string, unknown>;
  snapshot_date: string;
  created_at: string;
}

/* ──────────────── System 8 — Marketplace liquidity ──────────────── */

export interface MarketplaceHealth {
  id: string;
  city: string;
  neighbourhood: string | null;
  listing_count: number;
  search_volume: number;
  lead_rate_per_listing: number;
  avg_days_on_market: number;
  inventory_turnover_rate: number;
  price_trend: PriceTrend;
  demand_score: number;
  supply_demand_ratio: number;
  health_status: MarketHealthStatus;
  snapshot_date: string;
  created_at: string;
}

/* ──────────────── System 9 — Viral loops ──────────────── */

/** Append-only funnel event across the three structural loops. */
export interface ViralLoopEvent {
  id: string;
  loop_type: ViralLoopType;
  step_name: string;
  entity_id: string;
  entity_type: string;
  session_id: string | null;
  occurred_at: string;
}

/* ───────────────────────── DTOs ───────────────────────── */

export interface GenerateContentInput {
  property_id: string;
  content_type: ContentType;
  narrative_angle: NarrativeAngle;
}

export interface ApproveContentInput {
  content_id: string;
  scheduled_at?: string;
  platforms?: SocialPlatform[];
}

export interface CreateCampaignInput {
  name: string;
  campaign_type: CampaignType;
  start_date: string;
  end_date: string;
  target_platforms: SocialPlatform[];
  target_audience_description?: string;
  budget_naira?: number;
  property_ids: string[];
}

export interface ConnectSocialAccountInput {
  platform: SocialPlatform;
  platform_account_id: string;
  platform_username: string;
  /** raw token — handed straight to the Edge Function, never persisted client-side */
  access_token: string;
  token_expires_at?: string;
}

export interface CreateReferralInput {
  referrer_type: ReferrerType;
  referral_channel: ReferralChannel;
  property_id?: string;
}

export interface CheckProximityInput {
  lat: number;
  lon: number;
}

/** A proximity match ready to alert (post trigger-rule filtering). */
export interface ProximityMatch {
  property_id: string;
  geofence_id: string;
  distance_metres: number;
  property_type: PropertyType;
  bedrooms: number | null;
  city: string;
  price: number;
}

export interface ReferralSummary {
  referral_code: string;
  total_referred: number;
  total_signed_up: number;
  total_transacted: number;
  rewards_pending: number;
  rewards_issued: number;
}

/** Agency-facing demand prompt derived from marketplace health. */
export interface DemandPrompt {
  area: string;
  health_status: MarketHealthStatus;
  message: string;
}

export type DistributionListingType = ListingType;
