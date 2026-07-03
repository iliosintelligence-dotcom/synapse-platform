/**
 * CRM data layer — types mirror the live schema (leads, lead_stage_history,
 * tasks, communications). Demo dataset for the build/testing phase; swap the
 * exported functions to Supabase queries when auth lands (RLS needs a session).
 */

export type LeadStage = 'new' | 'contacted' | 'viewing' | 'negotiation' | 'won' | 'lost';
export type LeadSource = 'toju' | 'browse' | 'contact' | 'instagram' | 'referral';

export type Activity = {
  at: string; // relative for demo
  kind: 'stage' | 'note' | 'whatsapp' | 'viewing' | 'system';
  text: string;
};

export type LeadTask = { id: string; text: string; due: string; done: boolean };

export type Lead = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  property: string;
  propertyPrice: string;
  budget: string;
  source: LeadSource;
  stage: LeadStage;
  score: number; // AI lead score 0-100
  minsAgo: number;
  brief: string; // what they told Toju / asked for
  activity: Activity[];
  tasks: LeadTask[];
  notes: string[];
  failed?: boolean;
};

export const STAGES: { id: LeadStage; label: string; hint: string }[] = [
  { id: 'new', label: 'New', hint: 'Untouched — respond fast' },
  { id: 'contacted', label: 'Contacted', hint: 'Conversation open' },
  { id: 'viewing', label: 'Viewing', hint: 'Inspection booked' },
  { id: 'negotiation', label: 'Negotiation', hint: 'Offer on the table' },
  { id: 'won', label: 'Won', hint: 'Deal closed' },
  { id: 'lost', label: 'Lost', hint: 'Went cold or elsewhere' },
];

export const SOURCE_LABEL: Record<LeadSource, string> = {
  toju: 'Toju', browse: 'Browse', contact: 'Contact', instagram: 'Instagram', referral: 'Referral',
};

export function ago(mins: number): string {
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 60 / 24)}d ago`;
}

export const DEMO_LEADS: Lead[] = [
  {
    id: 'l1', name: 'Bola Adeyemi', phone: '+234 803 555 0142', email: 'bola.a@gmail.com',
    property: '3-Bed Apartment, Lekki Phase 1', propertyPrice: '₦165M', budget: '₦150–180M',
    source: 'toju', stage: 'new', score: 92, minsAgo: 2,
    brief: 'Family of four relocating from Abuja. Needs good schools within 15 min, works on the Island, wants to move within 3 months.',
    activity: [
      { at: '2m ago', kind: 'system', text: 'Lead created from Toju conversation — brief attached' },
    ],
    tasks: [{ id: 't1', text: 'First response (SLA 15 min)', due: 'in 13 min', done: false }],
    notes: [],
  },
  {
    id: 'l2', name: 'Chidi Okafor', phone: '+234 701 555 0199', email: 'chidi.ok@yahoo.com',
    property: '4-Bed Duplex, Osapa London', propertyPrice: '₦178M', budget: '₦170–200M',
    source: 'contact', stage: 'contacted', score: 78, minsAgo: 24,
    brief: 'Asked for the title report and service charge history before committing to a viewing.',
    activity: [
      { at: '10m ago', kind: 'whatsapp', text: 'You: sent verification report PDF' },
      { at: '24m ago', kind: 'system', text: 'Lead created from listing contact form' },
    ],
    tasks: [{ id: 't1', text: 'Follow up on report questions', due: 'today 4 PM', done: false }],
    notes: ['Very detail-oriented. Lead with the 7-node verification — that is what hooked him.'],
  },
  {
    id: 'l3', name: 'Amina Yusuf', phone: '+234 814 555 0177',
    property: '3-Bed Terrace, Ikate', propertyPrice: '₦148M', budget: '₦140–170M',
    source: 'toju', stage: 'viewing', score: 85, minsAgo: 60 * 26,
    brief: 'First-time buyer, pre-approved mortgage with Stanbic. Toju matched on school access + commute.',
    activity: [
      { at: '2h ago', kind: 'viewing', text: 'Viewing confirmed — Saturday 11:00 AM, agent Funke' },
      { at: '1d ago', kind: 'whatsapp', text: 'Amina: "Saturday works, thank you!"' },
      { at: '1d ago', kind: 'stage', text: 'Moved to Contacted by Funke' },
    ],
    tasks: [
      { id: 't1', text: 'Confirm Saturday viewing on Friday', due: 'Fri 10 AM', done: false },
      { id: 't2', text: 'Print verification summary for viewing', due: 'Fri', done: true },
    ],
    notes: ['Bring the flood-risk annex — she asked twice about drainage.'],
  },
  {
    id: 'l4', name: 'Tunde Bakare', phone: '+234 802 555 0118',
    property: '2-Bed Flat, Victoria Island', propertyPrice: '₦142M', budget: '₦130–160M',
    source: 'toju', stage: 'new', score: 64, minsAgo: 60 * 5, failed: true,
    brief: 'Investor — asked about short-let regulations and gross yield on VI 2-beds.',
    activity: [
      { at: '5h ago', kind: 'system', text: 'WhatsApp delivery failed — number may be unreachable' },
      { at: '5h ago', kind: 'system', text: 'Lead created from Toju conversation' },
    ],
    tasks: [{ id: 't1', text: 'Retry via SMS / call', due: 'today', done: false }],
    notes: [],
  },
  {
    id: 'l5', name: 'Ngozi Eze', phone: '+234 809 555 0104', email: 'ngozi.e@outlook.com',
    property: '4-Bed Duplex, Osapa London', propertyPrice: '₦178M', budget: '₦175M cash',
    source: 'browse', stage: 'negotiation', score: 96, minsAgo: 60 * 24 * 3,
    brief: 'Cash buyer. Offered ₦170M, countered at ₦175M. Lawyer reviewing draft contract.',
    activity: [
      { at: '3h ago', kind: 'note', text: 'Her lawyer requested survey plan — sent' },
      { at: '1d ago', kind: 'stage', text: 'Moved to Negotiation — offer ₦170M received' },
      { at: '3d ago', kind: 'viewing', text: 'Viewing completed — very positive' },
    ],
    tasks: [{ id: 't1', text: 'Chase counter-offer response', due: 'tomorrow', done: false }],
    notes: ['Decision maker is her husband abroad — allow 24h turnaround on anything.'],
  },
  {
    id: 'l6', name: 'Ibrahim Musa', phone: '+234 806 555 0121',
    property: '3-Bed Apartment, Lekki Phase 1', propertyPrice: '₦165M', budget: '₦160M',
    source: 'instagram', stage: 'won', score: 88, minsAgo: 60 * 24 * 9,
    brief: 'Came from the Instagram syndicated post. Closed at ₦161M.',
    activity: [
      { at: '2d ago', kind: 'stage', text: 'WON — ₦161M · escrow initiated' },
      { at: '6d ago', kind: 'stage', text: 'Negotiation — offer ₦158M' },
    ],
    tasks: [],
    notes: [],
  },
  {
    id: 'l7', name: 'Kemi Alabi', phone: '+234 810 555 0163',
    property: '3-Bed Terrace, Ikate', propertyPrice: '₦148M', budget: '₦120M max',
    source: 'browse', stage: 'lost', score: 41, minsAgo: 60 * 24 * 6,
    brief: 'Budget ceiling ₦120M — 20% below list. Referred to Toju for better-fit areas.',
    activity: [{ at: '6d ago', kind: 'stage', text: 'Lost — budget mismatch. Toju re-matching in Sangotedo.' }],
    tasks: [],
    notes: [],
  },
];

/** Stats derived from the pipeline. */
export function pipelineStats(leads: Lead[]) {
  const active = leads.filter((l) => !['won', 'lost'].includes(l.stage));
  const won = leads.filter((l) => l.stage === 'won');
  return {
    active: active.length,
    newToday: leads.filter((l) => l.stage === 'new' && l.minsAgo < 60 * 24).length,
    viewings: leads.filter((l) => l.stage === 'viewing').length,
    won: won.length,
    conversion: leads.length ? Math.round((won.length / leads.length) * 100) : 0,
  };
}

export function waLink(phone: string, property: string) {
  return `https://wa.me/${phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
    `Hello, thank you for your interest in ${property} via Synapse.`,
  )}`;
}
