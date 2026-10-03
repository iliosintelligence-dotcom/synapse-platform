/**
 * Layer 3 — the Intelligence Layer.
 * User + property intelligence graphs, matching, lead qualification, agent
 * copilot, marketing intelligence, the recommendation engine, and the AI
 * Gateway / prompt / memory / vector infrastructure that powers them.
 *
 * Builds additively on Layers 1–2. Lead-qualification writes into the
 * AI-reserved columns already present on the Layer 2 `leads` table.
 */
import type { BaseEntity } from './entities';
import type { ListingType, PropertyType } from './enums';
import type { AttributionChannel, RiskLevel } from './layer2';

/* ───────────────────────── enums ───────────────────────── */

/** The three actors every intelligence system serves, + the systems. */
export enum AISystem {
  TOJU = 'toju',
  COPILOT = 'copilot',
  QUALIFICATION = 'qualification',
  MATCHING = 'matching',
  MARKETING = 'marketing',
}

export enum AIProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GEMINI = 'gemini',
}

export enum Appetite {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum PreferenceSource {
  TOJU_CONVERSATION = 'toju_conversation',
  SEARCH = 'search',
  VIEWING = 'viewing',
  MANUAL = 'manual',
  PROXIMITY = 'proximity',
}

export enum RecommendationSource {
  TOJU = 'toju',
  FEED = 'feed',
  SEARCH = 'search',
  PROXIMITY = 'proximity',
}

export enum FeedType {
  RECOMMENDED = 'recommended',
  TRENDING_NEARBY = 'trending_nearby',
  STRONG_INVESTMENT = 'strong_investment',
  NEW_MATCHES = 'new_matches',
  RECENTLY_REDUCED = 'recently_reduced',
}

export enum MarketingInsightType {
  CHANNEL_PERFORMANCE = 'channel_performance',
  CAMPAIGN_RECOMMENDATION = 'campaign_recommendation',
  PROPERTY_CHANNEL_FIT = 'property_channel_fit',
  TIMING_RECOMMENDATION = 'timing_recommendation',
}

export enum MemoryType {
  SHORT_TERM = 'short_term',
  SESSION = 'session',
  LONG_TERM = 'long_term',
  EPISODIC = 'episodic',
}

/** Embedding model + dimensionality are fixed platform-wide. */
export const EMBEDDING_DIM = 1536;
export const EMBEDDING_MODEL = 'text-embedding-3-small';

/* ──────────────── System 2 — User Intelligence Graph ──────────────── */

export interface UserIntelligence {
  user_id: string;
  extracted_budget_min: number | null;
  extracted_budget_max: number | null;
  extracted_listing_type: ListingType | null;
  extracted_property_type: PropertyType | null;
  extracted_bedrooms_min: number | null;
  preferred_cities: string[];
  preferred_neighbourhoods: string[];
  lifestyle_signals: Record<string, unknown>;
  investment_appetite: Appetite | null;
  commute_origin_lat: number | null;
  commute_origin_lon: number | null;
  commute_max_minutes: number | null;
  family_size: number | null;
  risk_tolerance: Appetite | null;
  last_updated_at: string;
  created_at: string;
}

/** Append-only — preference history, not just current state. */
export interface UserPreferenceHistory {
  id: string;
  user_id: string;
  field_name: string;
  previous_value: string | null;
  new_value: string | null;
  source: PreferenceSource;
  occurred_at: string;
}

/* ──────────────── System 3 — Property Intelligence Graph ──────────────── */

export interface PropertyIntelligence {
  property_id: string;
  investment_score: number | null;
  rental_yield_pct: number | null;
  price_competitiveness_score: number | null;
  demand_score: number | null;
  walkability_score: number | null;
  lifestyle_fit_tags: string[];
  traffic_profile: Record<string, unknown>;
  school_access_score: number | null;
  flood_risk_score: number | null;
  neighbourhood_growth_score: number | null;
  days_on_market: number;
  price_change_history: { price: number; at: string }[];
  view_count: number;
  save_count: number;
  viewing_count: number;
  lead_count: number;
  last_intelligence_updated_at: string | null;
}

/* ──────────────── System 4 — Matching Engine ──────────────── */

export interface MatchResult {
  id: string;
  user_id: string;
  property_id: string;
  match_score: number;
  commute_score: number | null;
  price_score: number | null;
  spec_score: number | null;
  investment_score: number | null;
  lifestyle_score: number | null;
  reasoning_text: string | null;
  recommendation_source: RecommendationSource;
  was_viewed: boolean;
  was_saved: boolean;
  led_to_viewing: boolean;
  led_to_deal: boolean;
  created_at: string;
}

/** Tunable match weights — adjust with conversion data over time. */
export const MATCH_WEIGHTS = {
  location_commute: 0.3,
  price: 0.25,
  spec: 0.2,
  investment: 0.15,
  lifestyle: 0.1,
} as const;

/* ──────────────── System 8 — Recommendation Engine ──────────────── */

export interface RecommendationRecord {
  id: string;
  user_id: string;
  property_id: string;
  feed_type: FeedType;
  match_score: number | null;
  position_in_feed: number;
  was_viewed: boolean;
  was_saved: boolean;
  was_contacted: boolean;
  created_at: string;
}

export interface RecommendationFeedback {
  id: string;
  recommendation_id: string;
  user_id: string;
  signal: 'impression' | 'view' | 'save' | 'contact' | 'dismiss';
  occurred_at: string;
}

/* ──────────────── System 1 — Toju conversations + memory ──────────────── */

export interface AIConversation extends BaseEntity {
  user_id: string;
  title: string | null;
  last_message_at: string | null;
}

export type AIMessageRole = 'user' | 'assistant' | 'system';

export interface AIMessage {
  id: string;
  conversation_id: string;
  role: AIMessageRole;
  content: string;
  /** Property ids recommended in this turn (rendered as cards) */
  property_ids: string[];
  reasoning: string | null;
  created_at: string;
}

export interface AISessionSummary {
  id: string;
  conversation_id: string;
  user_id: string;
  summary: string;
  extracted: Record<string, unknown>;
  created_at: string;
}

export interface AIMemory {
  id: string;
  user_id: string;
  memory_type: MemoryType;
  content: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

/* ──────────────── System 5 — Lead Qualification ──────────────── */

/** Written by the qualification AI into the Layer 2 leads columns. */
export interface LeadQualificationResult {
  financial_readiness_score: number;
  engagement_score: number;
  urgency_score: number;
  responsiveness_score: number;
  fit_score: number;
  conversion_probability: number;
  risk_level: RiskLevel;
  next_action_recommendation: string;
}

/* ──────────────── System 6 — Agent Copilot ──────────────── */

export interface CopilotInsight {
  recommended_action: string;
  reasoning: string;
  questions_to_ask: string[];
  alternative_property_ids: string[];
  optimal_follow_up_at: string | null;
  deal_risks: string[];
}

export interface AgentCopilotCache extends BaseEntity {
  lead_id: string;
  deal_room_id: string | null;
  agent_id: string;
  insight: CopilotInsight;
  /** 4-hour TTL; regenerated on new comms / stage change / viewing */
  expires_at: string;
}

/* ──────────────── System 7 — Marketing Intelligence ──────────────── */

export interface MarketingInsight {
  id: string;
  agency_id: string;
  insight_type: MarketingInsightType;
  insight_text: string;
  supporting_data: Record<string, unknown>;
  confidence_score: number;
  action_recommended: string;
  period_start: string;
  period_end: string;
  created_at: string;
  was_acted_on: boolean;
  acted_on_at: string | null;
}

/* ──────────────── search alerts ──────────────── */

export interface SearchAlert extends BaseEntity {
  user_id: string;
  city: string;
  budget_min: number | null;
  budget_max: number | null;
  property_type: PropertyType | null;
  listing_type: ListingType | null;
  bedrooms_min: number | null;
  is_active: boolean;
  match_count: number;
  last_checked_at: string | null;
}

/* ──────────────── AI Gateway ──────────────── */

export interface AIRequestLog {
  id: string;
  user_id: string | null;
  agency_id: string | null;
  system: AISystem;
  model_used: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  latency_ms: number;
  success: boolean;
  error_message: string | null;
  created_at: string;
}

export interface PromptVersion {
  id: string;
  system: AISystem;
  version: number;
  prompt_text: string;
  is_active: boolean;
  created_at: string;
  deprecated_at: string | null;
}

/* ───────────────────────── DTOs / contracts ───────────────────────── */

export interface TojuTurnInput {
  conversation_id?: string;
  message: string;
}

export interface TojuTurnResult {
  conversation_id: string;
  message: string;
  reasoning: string | null;
  property_ids: string[];
  /** set when no listings exist for the requested city */
  created_search_alert_id: string | null;
}

export interface MatchRequest {
  user_id: string;
  source: RecommendationSource;
  limit?: number;
}

export interface RankedMatch {
  property_id: string;
  match_score: number;
  commute_score: number;
  price_score: number;
  spec_score: number;
  investment_score: number;
  lifestyle_score: number;
  reasoning_text: string;
}

export interface FeedRequest {
  feed_type?: FeedType;
  limit?: number;
}

export interface UpdateSearchAlertInput {
  city?: string;
  budget_min?: number | null;
  budget_max?: number | null;
  property_type?: PropertyType | null;
  listing_type?: ListingType | null;
  bedrooms_min?: number | null;
  is_active?: boolean;
}

/** Typed rate-limit response — never a raw error. */
export interface RateLimitedResult {
  rate_limited: true;
  system: AISystem;
  retry_after_seconds: number;
  message: string;
}

export type ChannelLearning = {
  channel: AttributionChannel;
  leads: number;
  closed_deals: number;
  close_rate: number;
  avg_days_to_close: number | null;
};
