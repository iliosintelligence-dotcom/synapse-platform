/**
 * Layer 4 — the Trust Operating System.
 * Agency/agent/property verification, trust scoring, documents, fraud
 * detection, disputes, and reputation. Trust is infrastructure: every score
 * and verification state is computed server-side, never on the client.
 *
 * Builds additively on Layers 1–2. The Layer 1 `verification_tier` on
 * agencies stays as a simple badge; the authoritative 5-tier status lives in
 * agency_verifications.current_tier (AgencyVerificationTier below).
 */
import type { BaseEntity } from './entities';
import type { ListingType } from './enums';

/* ───────────────────────── enums ───────────────────────── */

/** The five tiers. Each unlocks capability + a stronger trust signal. */
export enum AgencyVerificationTier {
  UNVERIFIED = 'unverified',
  BASIC_VERIFIED = 'basic_verified',
  BUSINESS_VERIFIED = 'business_verified',
  ENHANCED_VERIFIED = 'enhanced_verified',
  SYNAPSE_CERTIFIED = 'synapse_certified',
}

/** Ordered low→high; index drives badge prominence + listing caps. */
export const TIER_ORDER: readonly AgencyVerificationTier[] = [
  AgencyVerificationTier.UNVERIFIED,
  AgencyVerificationTier.BASIC_VERIFIED,
  AgencyVerificationTier.BUSINESS_VERIFIED,
  AgencyVerificationTier.ENHANCED_VERIFIED,
  AgencyVerificationTier.SYNAPSE_CERTIFIED,
];

/** Listing caps per tier. null = unlimited. */
export const TIER_LISTING_CAP: Record<AgencyVerificationTier, number | null> = {
  [AgencyVerificationTier.UNVERIFIED]: 0,
  [AgencyVerificationTier.BASIC_VERIFIED]: 10,
  [AgencyVerificationTier.BUSINESS_VERIFIED]: 50,
  [AgencyVerificationTier.ENHANCED_VERIFIED]: null,
  [AgencyVerificationTier.SYNAPSE_CERTIFIED]: null,
};

export enum VerificationCheckResult {
  PASSED = 'passed',
  FAILED = 'failed',
  PENDING = 'pending',
  EXPIRED = 'expired',
}

export enum AgentIncidentType {
  CONSUMER_COMPLAINT = 'consumer_complaint',
  MISSED_VIEWING = 'missed_viewing',
  MISREPRESENTATION = 'misrepresentation',
  DISPUTE_UPHELD = 'dispute_upheld',
  OTHER = 'other',
}

export enum IncidentSeverity {
  MINOR = 'minor',
  MODERATE = 'moderate',
  MAJOR = 'major',
}

export enum IncidentOutcome {
  WARNING = 'warning',
  SUSPENSION = 'suspension',
  REMOVAL = 'removal',
}

export enum PropertyVerificationState {
  UNVERIFIED = 'unverified',
  DOCUMENTS_SUBMITTED = 'documents_submitted',
  UNDER_REVIEW = 'under_review',
  SCOUT_SCHEDULED = 'scout_scheduled',
  SCOUT_COMPLETED = 'scout_completed',
  LEGAL_REVIEW = 'legal_review',
  VERIFIED = 'verified',
  DISPUTED = 'disputed',
  EXPIRED = 'expired',
}

/** The seven check types that derive the consumer-facing 7-node trust score. */
export enum PropertyCheckType {
  LISTING_AUTHENTICITY = 'listing_authenticity',
  OWNERSHIP_VALIDATION = 'ownership_validation',
  MEDIA_VALIDATION = 'media_validation',
  FRESHNESS_VALIDATION = 'freshness_validation',
  STRUCTURAL_ASSESSMENT = 'structural_assessment',
  FLOOD_RISK = 'flood_risk',
  GOVERNMENT_ACQUISITION_RISK = 'government_acquisition_risk',
}

/** Weights for the 7-node trust score (sum = 1). Tunable. */
export const NODE_WEIGHTS: Record<PropertyCheckType, number> = {
  [PropertyCheckType.LISTING_AUTHENTICITY]: 0.2,
  [PropertyCheckType.OWNERSHIP_VALIDATION]: 0.25,
  [PropertyCheckType.MEDIA_VALIDATION]: 0.1,
  [PropertyCheckType.FRESHNESS_VALIDATION]: 0.1,
  [PropertyCheckType.STRUCTURAL_ASSESSMENT]: 0.1,
  [PropertyCheckType.FLOOD_RISK]: 0.1,
  [PropertyCheckType.GOVERNMENT_ACQUISITION_RISK]: 0.15,
};

/** Check expiry windows (days). Ownership 12mo, freshness 30d. */
export const CHECK_EXPIRY_DAYS: Partial<Record<PropertyCheckType, number>> = {
  [PropertyCheckType.OWNERSHIP_VALIDATION]: 365,
  [PropertyCheckType.FRESHNESS_VALIDATION]: 30,
};

export enum PropertyCheckStatus {
  PENDING = 'pending',
  PASSED = 'passed',
  FAILED = 'failed',
  NOT_APPLICABLE = 'not_applicable',
}

export enum StructuralRating {
  SOUND = 'sound',
  MINOR_ISSUES = 'minor_issues',
  SIGNIFICANT_ISSUES = 'significant_issues',
}

export enum RiskRating {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum DocumentEntityType {
  AGENCY = 'agency',
  AGENT = 'agent',
  PROPERTY = 'property',
  DEAL_ROOM = 'deal_room',
}

export enum DocumentType {
  CERTIFICATE_OF_OCCUPANCY = 'certificate_of_occupancy',
  SURVEY_PLAN = 'survey_plan',
  DEED_OF_ASSIGNMENT = 'deed_of_assignment',
  ALLOCATION_LETTER = 'allocation_letter',
  BUILDING_APPROVAL = 'building_approval',
  GOVERNORS_CONSENT = 'governors_consent',
  EXCISION_DOCUMENT = 'excision_document',
  AGENCY_LICENSE = 'agency_license',
  CAC_CERTIFICATE = 'cac_certificate',
  DIRECTORS_ID = 'directors_id',
  BANK_STATEMENT = 'bank_statement',
  FRCN_MEMBERSHIP = 'frcn_membership',
  SCOUT_VIDEO = 'scout_video',
  SCOUT_PHOTOGRAPH = 'scout_photograph',
  OTHER = 'other',
}

export enum FraudEntityType {
  AGENCY = 'agency',
  AGENT = 'agent',
  PROPERTY = 'property',
  LISTING = 'listing',
}

export enum FraudFlagType {
  DUPLICATE_LISTING = 'duplicate_listing',
  PRICE_ANOMALY = 'price_anomaly',
  IMAGE_DUPLICATION = 'image_duplication',
  SUSPICIOUS_ACCOUNT_ACTIVITY = 'suspicious_account_activity',
  FAKE_LOCATION = 'fake_location',
  UNVERIFIED_IDENTITY_LISTING = 'unverified_identity_listing',
}

export enum FraudSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum FraudStatus {
  OPEN = 'open',
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

export enum FraudDetectedBy {
  SYSTEM = 'system',
  MANUAL = 'manual',
}

export enum DisputeType {
  PROPERTY_MISREPRESENTED = 'property_misrepresented',
  AGENT_MISCONDUCT = 'agent_misconduct',
  OWNERSHIP_DISPUTE = 'ownership_dispute',
  FALSE_MARKETING_CLAIMS = 'false_marketing_claims',
  VIEWING_NO_SHOW = 'viewing_no_show',
  PAYMENT_DISPUTE = 'payment_dispute',
  DOCUMENT_FRAUD = 'document_fraud',
  OTHER = 'other',
}

export enum DisputeState {
  SUBMITTED = 'submitted',
  ACKNOWLEDGED = 'acknowledged',
  EVIDENCE_REQUESTED = 'evidence_requested',
  UNDER_REVIEW = 'under_review',
  DECISION_PENDING = 'decision_pending',
  RESOLVED = 'resolved',
  APPEALED = 'appealed',
  CLOSED = 'closed',
}

export enum DisputeResolutionType {
  UPHELD = 'upheld',
  DISMISSED = 'dismissed',
  PARTIALLY_UPHELD = 'partially_upheld',
  SETTLED = 'settled',
}

export enum DisputeEvidenceType {
  DOCUMENT = 'document',
  SCREENSHOT = 'screenshot',
  RECORDING = 'recording',
  STATEMENT = 'statement',
}

export enum ReviewEntityType {
  AGENCY = 'agency',
  AGENT = 'agent',
}

export enum ReputationMilestoneType {
  FIRST_VERIFICATION = 'first_verification',
  TIER_UPGRADE = 'tier_upgrade',
  TRANSACTION_10 = 'transaction_10',
  TRANSACTION_50 = 'transaction_50',
  FIRST_REVIEW = 'first_review',
  FIRST_DISPUTE = 'first_dispute',
  DISPUTE_RESOLUTION = 'dispute_resolution',
  TRUST_MILESTONE = 'trust_milestone',
}

/** Agency trust score component weights (sum = 1). */
export const TRUST_WEIGHTS = {
  verification: 0.25,
  response_time: 0.2,
  lead_handling: 0.2,
  transactions: 0.2,
  ratings: 0.1,
  disputes: 0.05,
} as const;

/* ──────────────── System 1 — Agency Verification ──────────────── */

export interface AgencyVerification extends BaseEntity {
  agency_id: string;
  current_tier: AgencyVerificationTier;
  previous_tier: AgencyVerificationTier | null;
  tier_changed_at: string | null;
  tier_changed_by: string | null;
  identity_verified: boolean;
  cac_verified: boolean;
  office_verified: boolean;
  bank_verified: boolean;
  documents_reviewed: boolean;
  verification_notes: string | null;
  expires_at: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  /** reserved for Reputation Intelligence AI */
  risk_indicator: number | null;
}

/** Append-only — every check permanently recorded. */
export interface AgencyVerificationCheck {
  id: string;
  agency_id: string;
  check_type: string;
  check_source: string;
  result: VerificationCheckResult;
  evidence_url: string | null;
  checked_by: string | null;
  checked_at: string;
  notes: string | null;
}

/* ──────────────── System 2 — Agency Trust Score ──────────────── */

export interface AgencyTrustScore {
  id: string;
  agency_id: string;
  current_score: number;
  verification_component: number;
  response_time_component: number;
  lead_handling_component: number;
  transactions_component: number;
  ratings_component: number;
  disputes_component: number;
  /** reserved for Trust Scoring AI */
  predicted_trust_score: number | null;
  calculated_at: string;
  created_at: string;
}

/** One row per agency per day — powers the trust timeline. */
export interface AgencyTrustScoreSnapshot {
  id: string;
  agency_id: string;
  score: number;
  snapshot_date: string;
  component_breakdown: Record<string, number>;
}

/* ──────────────── System 3 — Agent Verification ──────────────── */

export interface AgentVerification extends BaseEntity {
  agent_id: string;
  agency_id: string;
  identity_verified: boolean;
  identity_verified_at: string | null;
  training_completed: boolean;
  training_completed_at: string | null;
  is_suspended: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  suspended_by: string | null;
  /** reserved for Reputation Intelligence AI */
  risk_indicator: number | null;
}

/** Append-only. */
export interface AgentDisciplinaryRecord {
  id: string;
  agent_id: string;
  agency_id: string;
  incident_type: AgentIncidentType;
  description: string;
  severity: IncidentSeverity;
  outcome: IncidentOutcome;
  recorded_by: string | null;
  occurred_at: string;
  created_at: string;
}

export interface AgentReputationSnapshot {
  id: string;
  agent_id: string;
  agency_id: string;
  score: number;
  snapshot_date: string;
  component_breakdown: Record<string, number>;
}

/* ──────────────── System 4 — Property Verification ──────────────── */

export interface PropertyVerification extends BaseEntity {
  property_id: string;
  state: PropertyVerificationState;
  /** weighted 7-node score, 0–100 */
  node_score: number | null;
  verified_at: string | null;
  expires_at: string | null;
}

/** Append-only state machine log. */
export interface PropertyVerificationHistory {
  id: string;
  property_id: string;
  from_state: PropertyVerificationState | null;
  to_state: PropertyVerificationState;
  transitioned_by: string | null;
  transitioned_at: string;
  notes: string | null;
}

export interface PropertyVerificationCheck {
  id: string;
  property_id: string;
  check_type: PropertyCheckType;
  status: PropertyCheckStatus;
  evidence_urls: string[];
  /** structural rating / risk rating stored here when relevant */
  rating: string | null;
  verified_by: string | null;
  verified_at: string | null;
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
}

/* ──────────────── System 5 — Documents ──────────────── */

export interface SynapseDocument {
  id: string;
  entity_type: DocumentEntityType;
  entity_id: string;
  document_type: DocumentType;
  display_name: string;
  storage_url: string;
  cloudinary_public_id: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  is_verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  verification_notes: string | null;
  is_current: boolean;
  expires_at: string | null;
  /** reserved for Document Analysis AI */
  ai_analysis_result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  entity_type: DocumentEntityType;
  entity_id: string;
  document_type: DocumentType;
  version: number;
  storage_url: string;
  cloudinary_public_id: string;
  uploaded_by: string | null;
  created_at: string;
}

/* ──────────────── System 6 — Fraud Detection ──────────────── */

export interface FraudFlag extends BaseEntity {
  entity_type: FraudEntityType;
  entity_id: string;
  flag_type: FraudFlagType;
  severity: FraudSeverity;
  status: FraudStatus;
  detected_by: FraudDetectedBy;
  detection_method: string | null;
  evidence: Record<string, unknown>;
  reviewed_by: string | null;
  reviewed_at: string | null;
  /** the human label — training data for Fraud Detection AI */
  resolution: string | null;
}

/** Append-only — full event history is the fraud-AI training dataset. */
export interface FraudEvent {
  id: string;
  entity_type: FraudEntityType;
  entity_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

/* ──────────────── System 7 — Disputes ──────────────── */

export interface Dispute extends BaseEntity {
  dispute_type: DisputeType;
  raised_by: string;
  raised_against: string;
  property_id: string | null;
  lead_id: string | null;
  deal_room_id: string | null;
  description: string;
  current_state: DisputeState;
  opened_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  decision: string | null;
  decision_by: string | null;
  resolution_type: DisputeResolutionType | null;
}

export interface DisputeEvidence {
  id: string;
  dispute_id: string;
  submitted_by: string;
  evidence_type: DisputeEvidenceType;
  storage_url: string | null;
  description: string | null;
  submitted_at: string;
}

export interface DisputeComment {
  id: string;
  dispute_id: string;
  author_id: string;
  author_role: string;
  content: string;
  is_internal: boolean;
  created_at: string;
}

/* ──────────────── Reputation ──────────────── */

export interface ConsumerReview {
  id: string;
  reviewer_id: string;
  reviewed_entity_type: ReviewEntityType;
  reviewed_entity_id: string;
  rating: number; // 1–5
  review_text: string | null;
  transaction_id: string | null;
  is_verified_transaction: boolean;
  is_published: boolean;
  created_at: string;
}

export interface ReviewAggregate {
  id: string;
  entity_type: ReviewEntityType;
  entity_id: string;
  average_rating: number;
  review_count: number;
  snapshot_date: string;
}

/** Append-only audit spine for every trust-affecting event. */
export interface TrustAuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  event: string;
  delta: number | null;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
}

/** Append-only consumer-visible milestone timeline. */
export interface ReputationTimeline {
  id: string;
  entity_type: ReviewEntityType;
  entity_id: string;
  milestone_type: ReputationMilestoneType;
  label: string;
  occurred_at: string;
  created_at: string;
}

/* ───────────────────────── DTOs ───────────────────────── */

export interface SubmitReviewInput {
  reviewed_entity_type: ReviewEntityType;
  reviewed_entity_id: string;
  rating: number;
  review_text?: string;
  transaction_id?: string;
}

export interface OpenDisputeInput {
  dispute_type: DisputeType;
  raised_against: string;
  property_id?: string;
  lead_id?: string;
  deal_room_id?: string;
  description: string;
}

export interface AddDisputeEvidenceInput {
  dispute_id: string;
  evidence_type: DisputeEvidenceType;
  storage_url?: string;
  description?: string;
}

export interface ResolveFraudFlagInput {
  flag_id: string;
  status: FraudStatus;
  resolution: string;
}

/** A property's public trust summary — the 7 chips + score consumers see. */
export interface PropertyTrustSummary {
  property_id: string;
  node_score: number | null;
  state: PropertyVerificationState;
  /** only passed + pending are ever surfaced; failed is filtered out */
  checks: { check_type: PropertyCheckType; status: 'passed' | 'pending' }[];
}

/** Public agency trust snapshot for discovery surfaces. */
export interface AgencyTrustPublic {
  agency_id: string;
  trust_score: number | null;
  tier: AgencyVerificationTier;
  transaction_count: number;
  average_rating: number | null;
  review_count: number;
}

/** Document vault completeness for a deal room. */
export interface VaultCompleteness {
  total_categories: number;
  filled_categories: number;
  percent: number;
  verified_count: number;
}

export type ClosingType = ListingType;
