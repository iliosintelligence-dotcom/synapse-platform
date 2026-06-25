/**
 * Layer 6 — Financial Infrastructure.
 *
 * ⚠ REGULATORY INVARIANT (the first architectural decision):
 * Synapse never custodies funds. Every money-touching record carries a
 * partner_institution_id and the Synapse ledger is a MIRROR of the licensed
 * partner's ledger — never the source of truth for custody. Fund-movement
 * state only advances on a confirmed partner webhook.
 *
 * Build sequence (by regulatory readiness): commission (5) → affordability
 * (4) → financial identity schema (8) → escrow (1) → developer sales (6) →
 * [gated, partner-signed only] rent-now-pay-monthly (2), mortgage (3),
 * wallet (7).
 *
 * Builds additively on Layers 1–5.
 */
import type { BaseEntity } from './entities';

/* ───────────────────────── partner registry ───────────────────────── */

export enum PartnerInstitutionType {
  MICROFINANCE_BANK = 'microfinance_bank',
  PAYMENT_SERVICE_BANK = 'payment_service_bank',
  COMMERCIAL_BANK = 'commercial_bank',
  LENDING_PARTNER = 'lending_partner',
  MORTGAGE_PROVIDER = 'mortgage_provider',
  PAYMENT_PROCESSOR = 'payment_processor',
}

export enum PartnerIntegrationStatus {
  PROSPECTIVE = 'prospective',
  CONTRACTED = 'contracted',
  LIVE = 'live',
  SUSPENDED = 'suspended',
}

/** The licensed institution that actually holds money / carries liability. */
export interface PartnerInstitution extends BaseEntity {
  name: string;
  type: PartnerInstitutionType;
  /** Whether the contract + regulatory sign-off is confirmed in writing.
   *  Systems 1/2/3/7 must NOT activate for real users unless this is LIVE. */
  integration_status: PartnerIntegrationStatus;
  /** CBN/NAICOM license reference, for the record. */
  license_reference: string | null;
  /** Vault key id for this partner's API credentials — never the secret. */
  vault_credential_key: string | null;
  supports_escrow: boolean;
  supports_virtual_accounts: boolean;
  supports_lending: boolean;
}

/* ──────────────── System 5 — Agent Commission (no partner) ──────────────── */

export enum CommissionAppliesTo {
  ALL_AGENTS = 'all_agents',
  SPECIFIC_AGENT = 'specific_agent',
  SPECIFIC_TEAM = 'specific_team',
}
export enum CommissionType {
  FLAT_PERCENTAGE = 'flat_percentage',
  TIERED = 'tiered',
  FLAT_AMOUNT = 'flat_amount',
}
export enum CommissionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  PAID = 'paid',
}
export enum BonusType {
  VOLUME_MILESTONE = 'volume_milestone',
  SPEED_BONUS = 'speed_bonus',
  QUALITY_BONUS = 'quality_bonus',
}

export interface CommissionStructure extends BaseEntity {
  agency_id: string;
  structure_name: string;
  applies_to: CommissionAppliesTo;
  applies_to_id: string | null; // agent or team id when scoped
  commission_type: CommissionType;
  base_percentage: number | null;
  tier_rules: { threshold: number; percentage: number }[] | null;
  flat_amount: number | null;
  is_active: boolean;
}

export interface CommissionSplits {
  agent: number;
  team_lead?: number;
  agency: number;
}

export interface CommissionLedgerEntry {
  id: string;
  deal_room_id: string;
  lead_id: string | null;
  agent_id: string;
  agency_id: string;
  transaction_value: number;
  commission_structure_id: string | null;
  gross_commission_amount: number;
  splits: CommissionSplits;
  net_agent_payout: number;
  status: CommissionStatus;
  approved_by: string | null;
  paid_at: string | null;
  payout_reference: string | null; // Paystack transfer reference
  created_at: string;
}

export interface PerformanceBonus {
  id: string;
  agent_id: string;
  agency_id: string;
  bonus_type: BonusType;
  trigger_condition: Record<string, unknown>;
  bonus_amount: number;
  period_start: string;
  period_end: string;
  status: 'pending' | 'paid';
  created_at: string;
}

/* ──────────────── System 4 — Affordability (advisory) ──────────────── */

export enum FinancingRecommendation {
  CASH = 'cash',
  RENT_NOW_PAY_MONTHLY = 'rent_now_pay_monthly',
  MORTGAGE_MARKETPLACE = 'mortgage_marketplace',
  NOT_RECOMMENDED = 'not_recommended',
}

/** Affordability benchmarks (advisory, conservative — never a credit decision). */
export const AFFORDABILITY = {
  rent_to_income_ceiling: 0.3,
  debt_to_income_ceiling: 0.4,
} as const;

export interface AffordabilityAnalysis {
  id: string;
  user_id: string;
  property_id: string | null;
  declared_monthly_income: number;
  declared_monthly_expenses: number;
  declared_existing_debt: number;
  safe_monthly_budget: number;
  stretch_monthly_budget: number;
  recommended_max_property_price: number;
  financing_recommendation: FinancingRecommendation;
  /** Always discloses the basis + that it is NOT a credit approval. */
  recommendation_reasoning: string;
  calculated_at: string;
}

/* ──────────────── System 8 — Financial Identity Graph ──────────────── */

export interface FinancialIdentity {
  id: string;
  user_id: string;
  /** Consumer financial trust score — distinct from Layer 4 agency/agent scores. */
  synapse_trust_score: number | null;
  payment_reliability_score: number | null;
  verification_completeness_score: number | null;
  transaction_history_score: number | null;
  rental_history_verified: boolean;
  /** reserved for a future AI scoring model */
  predicted_score: number | null;
  score_calculated_at: string | null;
  score_version: number;
}

/** Append-only — every score movement traces to a specific event. */
export interface ScoreComponentHistory {
  id: string;
  financial_identity_id: string;
  component_name: string;
  component_value: number;
  contributing_event_type: string;
  contributing_event_id: string | null;
  recorded_at: string;
}

export enum FinancialScoreAudience {
  SELF = 'self',
  LANDLORD_AGENCY = 'landlord_agency',
  LENDER = 'lender',
}

/** A user-triggered, logged, consent-scoped share of their financial identity. */
export interface FinancialConsentGrant {
  id: string;
  user_id: string;
  granted_to_id: string;
  audience: FinancialScoreAudience;
  /** which components were shared (lenders get a structured subset) */
  shared_components: string[];
  context_type: string; // rental_application | mortgage_application
  context_id: string | null;
  granted_at: string;
  revoked_at: string | null;
}

/* ──────────────── System 1 — Escrow (partner-gated) ──────────────── */

export enum EscrowType {
  EARNEST_MONEY_DEPOSIT = 'earnest_money_deposit',
  RENTAL_ESCROW = 'rental_escrow',
  PURCHASE_ESCROW = 'purchase_escrow',
  INSPECTION_DEPOSIT = 'inspection_deposit',
  MILESTONE_ESCROW = 'milestone_escrow',
}
export enum EscrowStatus {
  PENDING_FUNDING = 'pending_funding',
  FUNDED = 'funded',
  HELD = 'held',
  PARTIALLY_RELEASED = 'partially_released',
  RELEASED = 'released',
  REFUNDED = 'refunded',
  DISPUTED = 'disputed',
}
export enum MilestoneType {
  VERIFICATION_COMPLETE = 'verification_complete',
  DOCUMENT_SIGNED = 'document_signed',
  INSPECTION_PASSED = 'inspection_passed',
  POSSESSION_CONFIRMED = 'possession_confirmed',
  MANUAL_APPROVAL = 'manual_approval',
}
export enum EscrowApproverRole {
  CONSUMER = 'consumer',
  AGENT = 'agent',
  AGENCY_OWNER = 'agency_owner',
  PLATFORM_ADMIN = 'platform_admin',
}
export enum MilestoneStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export interface EscrowAccount extends BaseEntity {
  deal_room_id: string;
  escrow_type: EscrowType;
  partner_institution_id: string;
  /** The partner's account that actually holds the money. */
  partner_account_reference: string | null;
  payer_id: string;
  payee_id: string;
  amount: number;
  currency: string; // NGN
  status: EscrowStatus;
  funded_at: string | null;
}

export interface EscrowMilestone {
  id: string;
  escrow_account_id: string;
  milestone_name: string;
  milestone_type: MilestoneType;
  required_approver_role: EscrowApproverRole;
  status: MilestoneStatus;
  approved_by: string | null;
  approved_at: string | null;
  release_amount: number | null;
  release_percentage: number | null;
}

/** Append-only escrow audit — feeds Layer 4 dispute resolution. */
export interface EscrowEvent {
  id: string;
  escrow_account_id: string;
  event_type:
    | 'funded'
    | 'milestone_approved'
    | 'release_requested'
    | 'release_confirmed'
    | 'dispute_raised'
    | 'refunded';
  payload: Record<string, unknown>;
  occurred_at: string;
}

/* ──────────────── System 6 — Developer Sales ──────────────── */

export enum DevelopmentStatus {
  PRE_LAUNCH = 'pre_launch',
  SELLING = 'selling',
  SOLD_OUT = 'sold_out',
  COMPLETED = 'completed',
}
export enum UnitStatus {
  AVAILABLE = 'available',
  RESERVED = 'reserved',
  SOLD = 'sold',
  ALLOCATED = 'allocated',
}
export enum InstallmentFrequency {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
}
export enum InstallmentPlanStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  DEFAULTED = 'defaulted',
  CANCELLED = 'cancelled',
}
export enum InstallmentStatus {
  UPCOMING = 'upcoming',
  PAID = 'paid',
  LATE = 'late',
  MISSED = 'missed',
}

export interface Development extends BaseEntity {
  developer_id: string;
  development_name: string;
  location: string;
  total_units: number;
  unit_types: { type: string; count: number; from_price: number }[];
  launch_date: string | null;
  completion_date_estimated: string | null;
  status: DevelopmentStatus;
}

export interface UnitInventory extends BaseEntity {
  development_id: string;
  unit_number: string;
  unit_type: string;
  floor_size_sqm: number | null;
  list_price: number;
  status: UnitStatus;
  allocated_to_buyer_id: string | null;
  reservation_expires_at: string | null;
}

export interface InstallmentPlan extends BaseEntity {
  unit_id: string;
  buyer_id: string;
  total_price: number;
  down_payment_amount: number;
  down_payment_paid: boolean;
  installment_count: number;
  installment_amount: number;
  installment_frequency: InstallmentFrequency;
  plan_status: InstallmentPlanStatus;
  start_date: string;
}

export interface InstallmentScheduleRow {
  id: string;
  installment_plan_id: string;
  installment_number: number;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  paid_at: string | null;
  status: InstallmentStatus;
  reminder_sent_at: string | null;
}

/* ──────────────── System 2 — Rent Now Pay Monthly (GATED) ──────────────── */

export enum RentFinancingStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  DECLINED = 'declined',
  DISBURSED = 'disbursed',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  DEFAULTED = 'defaulted',
}
export enum EmploymentStatus {
  EMPLOYED = 'employed',
  SELF_EMPLOYED = 'self_employed',
  BUSINESS_OWNER = 'business_owner',
  CONTRACT = 'contract',
  UNEMPLOYED = 'unemployed',
  STUDENT = 'student',
}
export enum RepaymentStatus {
  UPCOMING = 'upcoming',
  PAID = 'paid',
  LATE = 'late',
  MISSED = 'missed',
}

export interface RentFinancingApplication extends BaseEntity {
  tenant_id: string;
  property_id: string;
  deal_room_id: string | null;
  annual_rent_amount: number;
  requested_monthly_amount: number;
  employment_status: EmploymentStatus;
  monthly_income_declared: number;
  monthly_income_verified: number | null;
  existing_debt_obligations: number;
  guarantor_id: string | null;
  partner_lender_id: string;
  application_status: RentFinancingStatus;
  declined_reason: string | null;
  approved_amount: number | null;
  approved_monthly_repayment: number | null;
}

export interface RepaymentScheduleRow {
  id: string;
  application_id: string;
  installment_number: number;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  paid_at: string | null;
  status: RepaymentStatus;
  late_fee_applied: number | null;
}

export interface Guarantor {
  id: string;
  application_id: string;
  guarantor_name: string;
  guarantor_phone: string;
  guarantor_relationship: string;
  guarantor_identity_verified: boolean;
  consent_given: boolean;
  consent_given_at: string | null;
}

/* ──────────────── System 3 — Mortgage Marketplace (GATED) ──────────────── */

export enum MortgageInstitutionType {
  COMMERCIAL_BANK = 'commercial_bank',
  PRIMARY_MORTGAGE_INSTITUTION = 'primary_mortgage_institution',
  COOPERATIVE = 'cooperative',
  REAL_ESTATE_FINANCE_COMPANY = 'real_estate_finance_company',
}
export enum MortgageIntegrationStatus {
  MANUAL_REFERRAL = 'manual_referral',
  API_CONNECTED = 'api_connected',
}
export enum MortgageApplicationStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  DOCUMENT_COLLECTION = 'document_collection',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  DECLINED = 'declined',
  DISBURSED = 'disbursed',
}

export interface MortgageProvider {
  id: string;
  institution_name: string;
  institution_type: MortgageInstitutionType;
  api_integration_status: MortgageIntegrationStatus;
  min_loan_amount: number;
  max_loan_amount: number;
  interest_rate_range_min: number;
  interest_rate_range_max: number;
  max_tenor_years: number;
  eligibility_criteria: Record<string, unknown>;
  is_active: boolean;
}

export interface MortgageApplication extends BaseEntity {
  buyer_id: string;
  property_id: string;
  mortgage_provider_id: string;
  declared_income: number;
  declared_expenses: number;
  requested_loan_amount: number;
  requested_tenor_years: number;
  down_payment_available: number;
  application_status: MortgageApplicationStatus;
  provider_reference_id: string | null;
  approved_loan_amount: number | null;
  approved_interest_rate: number | null;
}

/* ──────────────── System 7 — Wallet (GATED) ──────────────── */

export enum WalletPurpose {
  GENERAL = 'general',
  RENT_SAVINGS = 'rent_savings',
  DOWN_PAYMENT_SAVINGS = 'down_payment_savings',
  INSPECTION_FEES = 'inspection_fees',
  BOOKING_FEES = 'booking_fees',
}
export enum WalletStatus {
  ACTIVE = 'active',
  FROZEN = 'frozen',
  CLOSED = 'closed',
}
export enum WalletTransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  TRANSFER_TO_ESCROW = 'transfer_to_escrow',
  FEE_PAYMENT = 'fee_payment',
}
export enum WalletTransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}
export enum SavingsGoalType {
  RENT_TARGET = 'rent_target',
  DOWN_PAYMENT_TARGET = 'down_payment_target',
}

export interface Wallet {
  id: string;
  user_id: string;
  partner_institution_id: string;
  /** A dedicated virtual account at the partner bank. */
  partner_virtual_account_reference: string | null;
  wallet_purpose: WalletPurpose;
  /** Mirrored from the partner, reconciled continuously — NOT the source of truth. */
  balance: number;
  status: WalletStatus;
  created_at: string;
}

export interface SavingsGoal {
  id: string;
  wallet_id: string;
  goal_type: SavingsGoalType;
  target_amount: number;
  target_date: string | null;
  current_progress: number;
  auto_save_enabled: boolean;
  auto_save_amount: number | null;
  auto_save_frequency: 'weekly' | 'monthly' | null;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  transaction_type: WalletTransactionType;
  amount: number;
  partner_transaction_reference: string | null;
  status: WalletTransactionStatus;
  occurred_at: string;
}

/* ───────────────────────── DTOs ───────────────────────── */

export interface AffordabilityRequest {
  property_id?: string;
  monthly_income: number;
  monthly_expenses: number;
  existing_debt?: number;
}

export interface CreateCommissionStructureInput {
  agency_id: string;
  structure_name: string;
  applies_to: CommissionAppliesTo;
  applies_to_id?: string;
  commission_type: CommissionType;
  base_percentage?: number;
  tier_rules?: { threshold: number; percentage: number }[];
  flat_amount?: number;
}

export interface InitiateEscrowInput {
  deal_room_id: string;
  escrow_type: EscrowType;
  payee_id: string;
  amount: number;
}

export interface ApproveMilestoneInput {
  milestone_id: string;
}

export interface ReserveUnitInput {
  unit_id: string;
}

export interface ShareFinancialIdentityInput {
  granted_to_id: string;
  audience: FinancialScoreAudience;
  context_type: string;
  context_id?: string;
}

/** Result of any fund-movement request — the partner confirms asynchronously. */
export interface FundMovementResult {
  accepted: boolean;
  /** the partner reference once the request is lodged; confirmation arrives by webhook */
  partner_reference: string | null;
  /** true when the relevant partner is not yet LIVE — the gated case */
  partner_not_live?: boolean;
  message: string;
}
