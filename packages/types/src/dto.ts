/**
 * DTOs — typed inputs/outputs for the API layer. UI never constructs raw
 * rows; it speaks these shapes through packages/api.
 */
import type {
  ListingType,
  MediaType,
  PricePeriod,
  PropertyStatus,
  PropertyType,
  TitleType,
  UserRole,
  ViewingStatus,
} from './enums';
import type { Agency, Property, PropertyMedia, TcoBreakdown } from './entities';

/* ───────── auth ───────── */

export interface SignUpConsumerInput {
  email: string;
  full_name: string;
  phone?: string;
}

export interface SignUpAgencyInput {
  email: string;
  full_name: string;
  agency_name: string;
  city: string;
  whatsapp_number?: string;
}

export interface SessionUser {
  id: string;
  email: string | null;
  role: UserRole;
  full_name: string;
  avatar_url: string | null;
  /** Present for agency-side roles */
  agency_id: string | null;
}

/* ───────── profiles ───────── */

export interface UpdateProfileInput {
  full_name?: string;
  phone?: string | null;
  whatsapp?: string | null;
  avatar_url?: string | null;
}

/* ───────── agencies ───────── */

export interface CreateAgencyInput {
  name: string;
  city: string;
  whatsapp_number?: string;
  cac_number?: string;
  address?: string;
}

export interface UpdateAgencyInput {
  name?: string;
  logo_url?: string | null;
  whatsapp_number?: string | null;
  city?: string;
  address?: string | null;
}

export interface InviteMemberInput {
  agency_id: string;
  profile_id: string;
  role: UserRole.AGENT | UserRole.AGENCY_ADMIN;
}

export interface AgencyWithMembers extends Agency {
  member_count: number;
}

/* ───────── properties ───────── */

export interface CreatePropertyInput {
  agency_id: string;
  title: string;
  description: string;
  property_type: PropertyType;
  listing_type: ListingType;
  price: number;
  price_period: PricePeriod;
  move_in_cost?: number;
  bedrooms?: number;
  bathrooms?: number;
  area_sqm?: number;
  address: string;
  city: string;
  state: string;
  latitude?: number;
  longitude?: number;
  amenities?: string[];
  tco_breakdown?: TcoBreakdown;
  service_charge?: number;
  title_type?: TitleType;
  expires_at?: string;
}

export type UpdatePropertyInput = Partial<Omit<CreatePropertyInput, 'agency_id'>> & {
  status?: PropertyStatus;
  is_active?: boolean;
};

export interface PropertyFilters {
  city?: string;
  property_type?: PropertyType;
  listing_type?: ListingType;
  min_price?: number;
  max_price?: number;
  min_bedrooms?: number;
  /** consumer surfaces force verified+active server-side regardless */
  agency_id?: string;
  limit?: number;
  offset?: number;
}

export interface PropertyWithMedia extends Property {
  media: PropertyMedia[];
}

/* ───────── media ───────── */

export interface UploadMediaInput {
  property_id: string;
  /** Local file URI (mobile) or File/Blob (web) is handled by the impl */
  file_name: string;
  mime_type: string;
  size_bytes: number;
  media_type: MediaType;
  display_order?: number;
}

/** Every upload returns all variants — UI never builds Cloudinary URLs */
export interface MediaVariants {
  thumbnail: string; // 200w
  card: string; // 800w
  full: string; // 1600w
  original: string;
}

export interface UploadMediaResult {
  media: PropertyMedia;
  variants: MediaVariants;
}

/* ───────── viewings ───────── */

export interface CreateViewingInput {
  property_id: string;
  scheduled_at: string;
  notes?: string;
}

export interface UpdateViewingInput {
  scheduled_at?: string;
  status?: ViewingStatus;
  notes?: string | null;
}

/* ───────── generic ───────── */

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
