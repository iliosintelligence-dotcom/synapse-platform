/**
 * Shared enums — the single vocabulary for mobile, dashboard, API, and
 * database. String enums so values round-trip Postgres cleanly.
 */

export enum UserRole {
  CONSUMER = 'consumer',
  AGENT = 'agent',
  AGENCY_ADMIN = 'agency_admin',
  AGENCY_OWNER = 'agency_owner',
  PLATFORM_ADMIN = 'platform_admin',
}

/** Roles that belong to an agency context */
export const AGENCY_ROLES = [UserRole.AGENT, UserRole.AGENCY_ADMIN, UserRole.AGENCY_OWNER] as const;

export enum VerificationTier {
  UNVERIFIED = 'unverified',
  BASIC = 'basic',
  VERIFIED = 'verified',
  GOLD = 'gold',
}

export enum PropertyType {
  APARTMENT = 'apartment',
  HOUSE = 'house',
  DUPLEX = 'duplex',
  TERRACE = 'terrace',
  PENTHOUSE = 'penthouse',
  BUNGALOW = 'bungalow',
  LAND = 'land',
  COMMERCIAL = 'commercial',
}

export enum ListingType {
  SALE = 'sale',
  RENT = 'rent',
  SHORTLET = 'shortlet',
}

export enum PricePeriod {
  TOTAL = 'total',
  PER_YEAR = 'per_year',
  PER_MONTH = 'per_month',
  PER_NIGHT = 'per_night',
}

export enum PropertyStatus {
  DRAFT = 'draft',
  PENDING_REVIEW = 'pending_review',
  LIVE = 'live',
  UNDER_OFFER = 'under_offer',
  SOLD = 'sold',
  RENTED = 'rented',
  ARCHIVED = 'archived',
}

export enum VerificationStatus {
  UNVERIFIED = 'unverified',
  IN_PROGRESS = 'in_progress',
  VERIFIED = 'verified',
}

/**
 * The 7 verification nodes. Consumer surfaces only ever show
 * passed/pending — failed exists for internal pipelines.
 */
export enum VerificationNodeKey {
  TITLE = 'title',
  SURVEY = 'survey',
  STRUCTURE = 'structure',
  FLOOD_RISK = 'flood_risk',
  NEIGHBOURHOOD = 'neighbourhood',
  LEGAL = 'legal',
  FINANCIAL = 'financial',
}

export enum VerificationNodeStatus {
  PENDING = 'pending',
  PASSED = 'passed',
  FAILED = 'failed',
}

export enum TitleType {
  C_OF_O = 'c_of_o',
  GOVERNORS_CONSENT = 'governors_consent',
  REGISTERED_DEED = 'registered_deed',
  EXCISION = 'excision',
  GAZETTE = 'gazette',
  ALLOCATION = 'allocation',
}

export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
  FLOOR_PLAN = 'floor_plan',
  DOCUMENT = 'document',
}

export enum ViewingStatus {
  REQUESTED = 'requested',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}
