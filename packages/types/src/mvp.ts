/**
 * Layer 0.5 (MVP) types — leads and Toju chat sessions.
 * The lead bridge is the product: these shapes are treated as load-bearing.
 */
import type { BaseEntity } from './entities';
import type { ListingType, PropertyType } from './enums';

/* ───────── leads ───────── */

export enum LeadSource {
  TOJU_CHAT = 'toju_chat',
  CONTACT_BUTTON = 'contact_button',
  BROWSE = 'browse',
}

/**
 * Delivery status of the WhatsApp bridge. NEVER silently lost:
 * delivery_failed leads are flagged in the dashboard.
 */
export enum LeadDeliveryStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  DELIVERY_FAILED = 'delivery_failed',
}

/** Consumer preferences extracted by Toju, attached to every lead */
export interface LeadPreferences {
  city: string | null;
  budget_min: number | null;
  budget_max: number | null;
  property_type: PropertyType | null;
  listing_type: ListingType | null;
  timeline: string | null;
}

export interface Lead extends BaseEntity {
  property_id: string;
  consumer_id: string;
  agency_id: string;
  source: LeadSource;
  /** Snapshot at creation — survives later profile edits */
  consumer_name: string;
  consumer_phone: string | null;
  preferences: LeadPreferences | null;
  delivery_status: LeadDeliveryStatus;
  /** Twilio message SID when delivered */
  whatsapp_message_sid: string | null;
  delivered_at: string | null;
  /** Populated when both attempts failed */
  delivery_error: string | null;
}

export interface CreateLeadInput {
  property_id: string;
  source: LeadSource;
}

/* ───────── chat sessions ───────── */

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Property ids Toju recommended in this turn (rendered as cards) */
  property_ids?: string[];
  at: string; // ISO timestamp
}

export interface ChatSession extends BaseEntity {
  consumer_id: string;
  /** Rolling window — trimmed to the last 30 messages server-side */
  messages: ChatMessage[];
  /** Extracted preferences — promoted to columns for querying */
  pref_city: string | null;
  pref_budget_min: number | null;
  pref_budget_max: number | null;
  pref_property_type: PropertyType | null;
  pref_listing_type: ListingType | null;
}

/** Response of the toju-chat Edge Function */
export interface TojuChatResponse {
  message: string;
  property_ids: string[];
  session_id: string;
}
