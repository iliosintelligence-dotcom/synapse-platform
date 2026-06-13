/**
 * Entity interfaces — mirror the database schema exactly.
 * One source of truth; imported by api, auth, ui, mobile, and dashboard.
 */
import type {
  UserRole,
  VerificationTier,
  PropertyType,
  ListingType,
  PricePeriod,
  PropertyStatus,
  VerificationStatus,
  VerificationNodeKey,
  VerificationNodeStatus,
  TitleType,
  MediaType,
  ViewingStatus,
} from './enums';

/** Columns shared by every table */
export interface BaseEntity {
  id: string; // uuid
  created_at: string; // ISO timestamp
  updated_at: string;
  deleted_at: string | null; // soft delete
}

export interface Profile extends BaseEntity {
  role: UserRole;
  full_name: string;
  phone: string | null;
  whatsapp: string | null;
  avatar_url: string | null;
}

export interface Agency extends BaseEntity {
  owner_id: string;
  name: string;
  logo_url: string | null;
  cac_number: string | null;
  verification_tier: VerificationTier;
  whatsapp_number: string | null;
  city: string;
  address: string | null;
}

export interface AgencyMember extends BaseEntity {
  agency_id: string;
  profile_id: string;
  role: UserRole; // AGENT | AGENCY_ADMIN | AGENCY_OWNER
  joined_at: string;
}

/** One node of the 7-node verification pipeline, stored in jsonb */
export interface VerificationNode {
  key: VerificationNodeKey;
  status: VerificationNodeStatus;
  checked_at: string | null;
  /** Internal note — never rendered on consumer surfaces */
  note: string | null;
}

/** Total-cost-of-ownership breakdown, stored in jsonb */
export interface TcoBreakdown {
  base_price: number;
  agency_fee: number | null;
  legal_fee: number | null;
  caution_deposit: number | null;
  service_charge_annual: number | null;
  other: { label: string; amount: number }[];
}

export interface Property extends BaseEntity {
  agency_id: string;
  title: string;
  description: string;
  property_type: PropertyType;
  listing_type: ListingType;
  /** Stored in kobo-free naira as numeric; serialised as number */
  price: number;
  price_period: PricePeriod;
  move_in_cost: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: number | null;
  address: string;
  city: string;
  state: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  status: PropertyStatus;
  amenities: string[];
  tco_breakdown: TcoBreakdown | null;
  verification_status: VerificationStatus;
  /** 0–100; null until first verification pass */
  trust_score: number | null;
  verification_nodes: VerificationNode[];
  /** Projected rental yield percentage — investment surfaces */
  yield_pct: number | null;
  expires_at: string | null;
  is_active: boolean;
  service_charge: number | null;
  title_type: TitleType | null;
}

export interface PropertyMedia extends BaseEntity {
  property_id: string;
  url: string;
  cloudinary_public_id: string;
  media_type: MediaType;
  display_order: number;
  width: number | null;
  height: number | null;
}

export interface SavedProperty extends BaseEntity {
  consumer_id: string;
  property_id: string;
}

export interface Viewing extends BaseEntity {
  property_id: string;
  consumer_id: string;
  agency_id: string;
  scheduled_at: string;
  status: ViewingStatus;
  notes: string | null;
}
