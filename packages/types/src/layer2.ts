/**
 * Layer 2 — the transaction operating system.
 * CRM/pipeline, viewings, communications, attribution, tasks, deal rooms,
 * activity feed, notifications, performance, and the event architecture.
 *
 * Builds additively on Layer 1: the MVP `leads` and `viewings` tables are
 * EXTENDED (see migration 0005/0006), not replaced. closing_type reuses
 * ListingType; LeadSource reuses the MVP enum.
 */
import type { BaseEntity } from './entities';
import type { ListingType } from './enums';
import type { LeadSource } from './mvp';

/* ───────────────────────── enums ───────────────────────── */

export enum LeadStage {
  NEW = 'new',
  CONTACTED = 'contacted',
  QUALIFIED = 'qualified',
  VIEWING_SCHEDULED = 'viewing_scheduled',
  VIEWING_COMPLETED = 'viewing_completed',
  NEGOTIATING = 'negotiating',
  COMMITMENT = 'commitment',
  CLOSED = 'closed',
  LOST = 'lost',
}

/** Ordered pipeline — index = canonical column order. CLOSED/LOST are terminal. */
export const PIPELINE_STAGES: readonly LeadStage[] = [
  LeadStage.NEW,
  LeadStage.CONTACTED,
  LeadStage.QUALIFIED,
  LeadStage.VIEWING_SCHEDULED,
  LeadStage.VIEWING_COMPLETED,
  LeadStage.NEGOTIATING,
  LeadStage.COMMITMENT,
  LeadStage.CLOSED,
  LeadStage.LOST,
];

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum DealRoomStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  CLOSED = 'closed',
  LOST = 'lost',
}

export enum ViewingOutcome {
  INTERESTED = 'interested',
  NOT_INTERESTED = 'not_interested',
  OFFER_PENDING = 'offer_pending',
  OFFER_MADE = 'offer_made',
}

export enum PostViewingBudgetFit {
  YES = 'yes',
  MAYBE = 'maybe',
  NO = 'no',
}

export enum CommunicationChannel {
  CALL = 'call',
  WHATSAPP = 'whatsapp',
  EMAIL = 'email',
  PLATFORM_MESSAGE = 'platform_message',
  MEETING = 'meeting',
}

export enum CommunicationDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
}

export enum CommunicationOutcome {
  CONNECTED = 'connected',
  VOICEMAIL = 'voicemail',
  NO_ANSWER = 'no_answer',
  REPLIED = 'replied',
  NO_REPLY = 'no_reply',
}

export enum AttributionChannel {
  INSTAGRAM = 'instagram',
  TIKTOK = 'tiktok',
  FACEBOOK = 'facebook',
  PROXIMITY_ALERT = 'proximity_alert',
  AI_RECOMMENDATION = 'ai_recommendation',
  DIRECT_SEARCH = 'direct_search',
  WHATSAPP_CAMPAIGN = 'whatsapp_campaign',
  REFERRAL = 'referral',
  WEBSITE = 'website',
  ORGANIC = 'organic',
}

export enum TaskType {
  CALL = 'call',
  FOLLOW_UP = 'follow_up',
  SEND_DOCUMENTS = 'send_documents',
  SCHEDULE_VIEWING = 'schedule_viewing',
  VERIFY_DOCUMENTS = 'verify_documents',
  MAKE_OFFER = 'make_offer',
  CUSTOM = 'custom',
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum NotificationChannel {
  PUSH = 'push',
  EMAIL = 'email',
  SMS = 'sms',
  WHATSAPP = 'whatsapp',
  IN_APP = 'in_app',
}

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  READ = 'read',
}

export enum ActivityType {
  LEAD_CREATED = 'lead_created',
  LEAD_ASSIGNED = 'lead_assigned',
  LEAD_STAGE_CHANGED = 'lead_stage_changed',
  CALL_LOGGED = 'call_logged',
  WHATSAPP_SENT = 'whatsapp_sent',
  EMAIL_SENT = 'email_sent',
  VIEWING_SCHEDULED = 'viewing_scheduled',
  VIEWING_COMPLETED = 'viewing_completed',
  VIEWING_CANCELLED = 'viewing_cancelled',
  DOCUMENT_UPLOADED = 'document_uploaded',
  OFFER_MADE = 'offer_made',
  OFFER_REJECTED = 'offer_rejected',
  DEAL_CLOSED = 'deal_closed',
  DEAL_LOST = 'deal_lost',
  TASK_CREATED = 'task_created',
  TASK_COMPLETED = 'task_completed',
  NOTE_ADDED = 'note_added',
  PROXIMITY_ALERT_TRIGGERED = 'proximity_alert_triggered',
  SOCIAL_POST_PUBLISHED = 'social_post_published',
  VIEWING_INCOMPLETE = 'viewing_incomplete',
}

export enum EventType {
  LEAD_CREATED = 'lead_created',
  LEAD_ASSIGNED = 'lead_assigned',
  LEAD_STAGE_CHANGED = 'lead_stage_changed',
  VIEWING_SCHEDULED = 'viewing_scheduled',
  VIEWING_COMPLETED = 'viewing_completed',
  MESSAGE_SENT = 'message_sent',
  TASK_CREATED = 'task_created',
  TASK_COMPLETED = 'task_completed',
  OFFER_SUBMITTED = 'offer_submitted',
  DEAL_CLOSED = 'deal_closed',
  DEAL_LOST = 'deal_lost',
  COMMUNICATION_LOGGED = 'communication_logged',
  ATTRIBUTION_RECORDED = 'attribution_recorded',
}

/* ───────────────────────── entities ───────────────────────── */

/**
 * Lead intelligence — extends the MVP leads row. The *_score / *probability
 * fields are reserved for AI (Layer 3): nullable now, rule-populated, and
 * written by AI later with no schema change.
 */
export interface LeadIntelligence {
  assigned_agent_id: string | null;
  current_stage: LeadStage;
  budget_range: string | null;
  budget_min: number | null;
  budget_max: number | null;
  timeline_to_purchase: string | null;
  interest_level: number | null; // 1–5
  last_activity_at: string | null;
  next_action_at: string | null;
  risk_level: RiskLevel | null;

  // ── reserved for AI (Layer 3) ──
  lead_score: number | null;
  intent_score: number | null;
  financial_readiness_score: number | null;
  engagement_score: number | null;
  urgency_score: number | null;
  responsiveness_score: number | null;
  fit_score: number | null;
  conversion_probability: number | null;
  next_action_recommendation: string | null;
}

/** Append-only. Never overwritten — training data for conversion models. */
export interface LeadStageHistory {
  id: string;
  lead_id: string;
  from_stage: LeadStage | null;
  to_stage: LeadStage;
  moved_by: string | null;
  moved_at: string;
  reason: string | null;
  time_in_previous_stage_seconds: number | null;
}

export interface DealRoom extends BaseEntity {
  lead_id: string;
  property_id: string;
  consumer_id: string;
  agency_id: string;
  agent_id: string | null;
  status: DealRoomStatus;
  opened_at: string;
  closed_at: string | null;
  closing_price: number | null;
  closing_type: ListingType | null;
  documents: DealDocument[];
  notes: string | null;
}

export interface DealDocument {
  name: string;
  url: string;
  uploaded_by: string;
  uploaded_at: string;
}

/** Viewing intelligence — extends the Layer 1 viewings row. */
export interface ViewingDetail {
  lead_id: string | null;
  agent_id: string | null;
  duration_minutes: number | null;
  location_notes: string | null;
  pre_viewing_notes: string | null;
  // ── AI signal layer ──
  post_viewing_interest_level: number | null; // 1–5
  post_viewing_concerns: string | null;
  post_viewing_budget_fit: PostViewingBudgetFit | null;
  post_viewing_likelihood_to_proceed: number | null; // 1–10
  outcome: ViewingOutcome | null;
  completed_at: string | null;
}

export interface Communication extends BaseEntity {
  lead_id: string;
  agent_id: string | null;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  duration_seconds: number | null; // calls only
  outcome: CommunicationOutcome | null;
  sentiment_placeholder: string | null; // reserved for AI
  summary: string | null;
  occurred_at: string;
}

/** Append-only touchpoint. Attribution models derive from raw rows. */
export interface LeadAttribution {
  id: string;
  lead_id: string;
  property_id: string | null;
  agency_id: string;
  channel: AttributionChannel;
  is_first_touch: boolean;
  is_last_touch: boolean;
  occurred_at: string;
  campaign_id: string | null;
  created_at: string;
}

export interface Task extends BaseEntity {
  agency_id: string;
  lead_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  title: string;
  description: string | null;
  task_type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  due_at: string | null;
  completed_at: string | null;
}

export interface TaskTemplate extends BaseEntity {
  agency_id: string;
  name: string;
  task_type: TaskType;
  description: string | null;
  default_priority: TaskPriority;
  due_offset_hours: number;
  trigger_stage: LeadStage | null;
  is_active: boolean;
}

export interface Notification extends BaseEntity {
  recipient_id: string;
  agency_id: string | null;
  channel: NotificationChannel;
  template_id: string | null;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failure_reason: string | null;
  retry_count: number;
}

export interface NotificationTemplate extends BaseEntity {
  name: string;
  channel: NotificationChannel;
  subject: string | null;
  body_template: string;
  variables: Record<string, unknown>;
  is_active: boolean;
}

/** Append-only universal timeline row. Immutable. */
export interface Activity {
  id: string;
  agency_id: string;
  lead_id: string | null;
  property_id: string | null;
  agent_id: string | null;
  activity_type: ActivityType;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Append-only typed event. Powers feed, notifications, future AI. */
export interface PlatformEvent {
  id: string;
  event_type: EventType;
  agency_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/* ───────── performance snapshots (pre-aggregated) ───────── */

export interface AgencyDailySnapshot {
  agency_id: string;
  date: string;
  new_leads: number;
  leads_contacted: number;
  viewings_scheduled: number;
  viewings_completed: number;
  deals_closed: number;
  revenue_generated: number;
  average_response_time_seconds: number | null;
  pipeline_velocity_days: number | null;
}

export interface AgentDailySnapshot {
  agent_id: string;
  agency_id: string;
  date: string;
  assigned_leads: number;
  leads_contacted: number;
  viewings_scheduled: number;
  viewings_completed: number;
  deals_closed: number;
  revenue_generated: number;
  average_response_time_seconds: number | null;
}

export interface PropertyPerformance {
  property_id: string;
  total_leads: number;
  total_viewings: number;
  conversion_rate: number | null;
  average_days_to_close: number | null;
  total_revenue_generated: number;
  top_source_channel: AttributionChannel | null;
}

/* ───────────────────────── DTOs ───────────────────────── */

export interface MoveLeadStageInput {
  lead_id: string;
  to_stage: LeadStage;
  reason?: string;
}

export interface AssignLeadInput {
  lead_id: string;
  agent_id: string;
}

export interface LogCommunicationInput {
  lead_id: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  duration_seconds?: number;
  outcome?: CommunicationOutcome;
  summary?: string;
  occurred_at?: string;
}

export interface CompleteViewingInput {
  viewing_id: string;
  post_viewing_interest_level: number;
  post_viewing_concerns?: string;
  post_viewing_budget_fit: PostViewingBudgetFit;
  post_viewing_likelihood_to_proceed: number;
  outcome: ViewingOutcome;
}

export interface CreateTaskInput {
  agency_id: string;
  lead_id?: string;
  assigned_to?: string;
  title: string;
  description?: string;
  task_type: TaskType;
  priority?: TaskPriority;
  due_at?: string;
}

export interface RecordAttributionInput {
  lead_id: string;
  property_id?: string;
  channel: AttributionChannel;
  campaign_id?: string;
  occurred_at?: string;
}

export interface OpenDealRoomInput {
  lead_id: string;
}

export interface CloseDealInput {
  deal_room_id: string;
  closing_price: number;
  closing_type: ListingType;
}

/** A lead joined with the fields the pipeline board needs to render. */
export interface PipelineLead extends LeadIntelligence {
  id: string;
  property_id: string;
  consumer_id: string;
  agency_id: string;
  source: LeadSource;
  consumer_name: string;
  consumer_phone: string | null;
  created_at: string;
  updated_at: string;
}
