/**
 * Social studio data layer — types mirror the live schema (social_accounts,
 * social_posts, social_post_metrics, content_variants). Demo dataset for the
 * build/testing phase; swap to Supabase queries when auth lands.
 */

export type Channel = 'instagram' | 'tiktok' | 'facebook' | 'whatsapp';

export type ChannelAccount = {
  id: Channel;
  label: string;
  handle: string;
  connected: boolean;
  color: string;
  bestTime: string;
};

export type PostStatus = 'draft' | 'queued' | 'posted' | 'paused';

/**
 * Content-pipeline stage (plan Feature 2 — the content Kanban, distinct from
 * the lead pipeline). A property's content flows uploaded → generating →
 * approval → scheduled → published, and drops to underperforming when its
 * engagement falls below the agency's own average.
 */
export type ContentStage =
  | 'uploaded' | 'generating' | 'approval' | 'scheduled' | 'published' | 'underperforming';

export const STAGES: { id: ContentStage; label: string; who: string }[] = [
  { id: 'uploaded', label: 'Listing uploaded', who: 'Auto-generation triggers' },
  { id: 'generating', label: 'Content generating', who: 'GPT-4o — no action needed' },
  { id: 'approval', label: 'Awaiting approval', who: 'You review before publishing' },
  { id: 'scheduled', label: 'Scheduled', who: 'Auto-publishes at best time' },
  { id: 'published', label: 'Published', who: 'Metrics collected every 6h' },
  { id: 'underperforming', label: 'Underperforming', who: 'Toju suggests a boost' },
];

export type SocialPost = {
  id: string;
  listing: string;
  price: string;
  image: string;
  caption: string;
  channels: Channel[];
  status: PostStatus;
  stage: ContentStage;
  when: string;        // display slot
  day: number;         // 0..6 offset from today for the calendar
  reach?: number;      // expected reach estimate (pre-publish) or realised
  underperfReason?: string;
  metrics?: { views: number; likes: number; saves: number; dms: number; leads: number };
};

export const CHANNELS: ChannelAccount[] = [
  { id: 'instagram', label: 'Instagram', handle: '@prestigerealty', connected: true, color: '#DD2A7B', bestTime: '5:00 PM' },
  { id: 'tiktok', label: 'TikTok', handle: '@prestige.lagos', connected: true, color: '#161616', bestTime: '7:30 PM' },
  { id: 'facebook', label: 'Facebook', handle: 'Prestige Realty', connected: false, color: '#1877F2', bestTime: '12:30 PM' },
  { id: 'whatsapp', label: 'WhatsApp Status', handle: '+234 803 ··· 42', connected: true, color: '#25D366', bestTime: '8:00 AM' },
];

export const LISTINGS = [
  { title: '3-Bed Apartment, Lekki Phase 1', price: '₦165M', image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=300&q=60' },
  { title: '4-Bed Duplex, Osapa London', price: '₦178M', image: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=300&q=60' },
  { title: '3-Bed Terrace, Ikate', price: '₦148M', image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=300&q=60' },
  { title: '2-Bed Flat, Victoria Island', price: '₦142M', image: 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=300&q=60' },
];

/** AI caption angles — in production these come from generated_content. */
export const CAPTION_ANGLES: { label: string; make: (t: string, p: string) => string }[] = [
  { label: 'Trust-first', make: (t, p) => `${t} · ${p}. Seven verification checks, zero surprises. The listing that actually survives due diligence ✦` },
  { label: 'Lifestyle', make: (t, p) => `Sunday morning light in ${t.split(', ')[1] ?? 'Lagos'}. ${p}, verified title, move-in ready. Your school run just got 15 minutes shorter 🏡` },
  { label: 'Investor', make: (t, p) => `${p} · gross yield beats the Lagos average. ${t} — DM 'REPORT' and Toju sends the full verification + yield breakdown 🧾` },
  { label: 'Urgency', make: (t, p) => `3 viewings booked this week on ${t} (${p}). Verified, priced under area median. When it's gone, it's gone.` },
];

export const DEMO_POSTS: SocialPost[] = [
  // ── content pipeline: freshly uploaded, no content yet ──
  {
    id: 'u1', listing: '2-Bed Flat, Victoria Island', price: '₦142M',
    image: LISTINGS[3]!.image, caption: '',
    channels: [], status: 'draft', stage: 'uploaded', when: 'Uploaded 12 min ago', day: 0,
  },
  // ── GPT-4o mid-generation ──
  {
    id: 'g1', listing: '3-Bed Terrace, Ikate', price: '₦148M',
    image: LISTINGS[2]!.image, caption: 'Generating captions + sizing images…',
    channels: ['instagram', 'tiktok', 'facebook'], status: 'draft', stage: 'generating',
    when: 'Auto', day: 0,
  },
  // ── drafted, waiting on the agency to approve ──
  {
    id: 'a1', listing: '3-Bed Apartment, Lekki Phase 1', price: '₦165M',
    image: LISTINGS[0]!.image,
    caption: CAPTION_ANGLES[2]!.make('3-Bed Apartment, Lekki Phase 1', '₦165M'),
    channels: ['instagram', 'tiktok', 'facebook'], status: 'draft', stage: 'approval',
    when: 'Ready', day: 0, reach: 13200,
  },
  // ── scheduled ──
  {
    id: 'p1', listing: '3-Bed Apartment, Lekki Phase 1', price: '₦165M',
    image: LISTINGS[0]!.image,
    caption: CAPTION_ANGLES[0]!.make('3-Bed Apartment, Lekki Phase 1', '₦165M'),
    channels: ['instagram', 'tiktok'], status: 'queued', stage: 'scheduled',
    when: 'Today 5:00 PM', day: 0, reach: 11800,
  },
  {
    id: 'p2', listing: '4-Bed Duplex, Osapa London', price: '₦178M',
    image: LISTINGS[1]!.image,
    caption: CAPTION_ANGLES[2]!.make('4-Bed Duplex, Osapa London', '₦178M'),
    channels: ['instagram', 'whatsapp'], status: 'queued', stage: 'scheduled',
    when: 'Tomorrow 9:00 AM', day: 1, reach: 4100,
  },
  {
    id: 'p3', listing: '2-Bed Flat, Victoria Island', price: '₦142M',
    image: LISTINGS[3]!.image,
    caption: CAPTION_ANGLES[1]!.make('2-Bed Flat, Victoria Island', '₦142M'),
    channels: ['tiktok'], status: 'paused', stage: 'scheduled', when: 'Thu 7:30 PM', day: 3, reach: 8600,
  },
  // ── published ──
  {
    id: 'p4', listing: '3-Bed Terrace, Ikate', price: '₦148M',
    image: LISTINGS[2]!.image,
    caption: 'Ikate 3-bed · ₦148M · verified title. 31 DMs routed straight into the CRM.',
    channels: ['instagram', 'tiktok'], status: 'posted', stage: 'published',
    when: 'Yesterday 5:00 PM', day: -1, reach: 12400,
    metrics: { views: 12400, likes: 861, saves: 218, dms: 31, leads: 9 },
  },
  {
    id: 'p5', listing: '4-Bed Duplex, Osapa London', price: '₦178M',
    image: LISTINGS[1]!.image,
    caption: 'Osapa duplex walkthrough — 4 beds, BQ, gated estate. Full verification in bio.',
    channels: ['tiktok'], status: 'posted', stage: 'published', when: 'Mon 7:30 PM', day: -3, reach: 48200,
    metrics: { views: 48200, likes: 3120, saves: 704, dms: 87, leads: 22 },
  },
  // ── flagged underperforming (below the agency's own average) ──
  {
    id: 'up1', listing: '2-Bed Flat, Victoria Island', price: '₦142M',
    image: LISTINGS[3]!.image,
    caption: 'VI 2-bed, ₦142M. Verified. Available now.',
    channels: ['facebook'], status: 'posted', stage: 'underperforming', when: 'Sun 12:30 PM', day: -4,
    reach: 1900,
    underperfReason: 'Facebook photo post — 61% below your average reach. Your VI listings do 3× better as TikTok video.',
    metrics: { views: 1900, likes: 44, saves: 12, dms: 2, leads: 0 },
  },
];

export function fmt(n: number) {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
}

// ── expected-reach estimate (plan Feature 1 — calendar cards show it) ──
const CH_REACH: Record<Channel, number> = { instagram: 3200, tiktok: 8600, facebook: 1500, whatsapp: 900 };
export function estimateReach(channels: Channel[], seed = ''): number {
  const base = channels.reduce((s, c) => s + CH_REACH[c], 0);
  // deterministic ±12% jitter so estimates feel real without a backend
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  const factor = 0.88 + (h % 240) / 1000; // 0.88..1.12
  return Math.round((base * factor) / 100) * 100;
}

/**
 * Guided Post Creation (plan Feature 5) — the recommended caption angle for a
 * channel, with the data-backed reason we surface to the agency. In production
 * these come from the agency's own content_variant performance history.
 */
export const ANGLE_RECO: Record<Channel, { angle: number; reason: string }> = {
  tiktok: { angle: 2, reason: 'Your investment-angle captions get 34% more link clicks on TikTok than lifestyle ones.' },
  instagram: { angle: 1, reason: 'Lifestyle captions earn 22% more saves with your Instagram audience.' },
  facebook: { angle: 0, reason: 'Trust-first framing converts best with your Facebook followers — older, higher buy-intent.' },
  whatsapp: { angle: 3, reason: 'Urgency framing gets the fastest replies on WhatsApp Status.' },
};
export function recommendAngle(channels: Channel[]): { angle: number; reason: string } {
  const primary = channels[0] ?? 'instagram';
  return ANGLE_RECO[primary];
}
