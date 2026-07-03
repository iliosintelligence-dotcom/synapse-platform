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

export type SocialPost = {
  id: string;
  listing: string;
  price: string;
  image: string;
  caption: string;
  channels: Channel[];
  status: PostStatus;
  when: string;        // display slot
  day: number;         // 0..6 offset from today for the calendar
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
  {
    id: 'p1', listing: '3-Bed Apartment, Lekki Phase 1', price: '₦165M',
    image: LISTINGS[0].image,
    caption: CAPTION_ANGLES[0].make('3-Bed Apartment, Lekki Phase 1', '₦165M'),
    channels: ['instagram', 'tiktok'], status: 'queued', when: 'Today 5:00 PM', day: 0,
  },
  {
    id: 'p2', listing: '4-Bed Duplex, Osapa London', price: '₦178M',
    image: LISTINGS[1].image,
    caption: CAPTION_ANGLES[2].make('4-Bed Duplex, Osapa London', '₦178M'),
    channels: ['instagram', 'whatsapp'], status: 'queued', when: 'Tomorrow 9:00 AM', day: 1,
  },
  {
    id: 'p3', listing: '2-Bed Flat, Victoria Island', price: '₦142M',
    image: LISTINGS[3].image,
    caption: CAPTION_ANGLES[1].make('2-Bed Flat, Victoria Island', '₦142M'),
    channels: ['tiktok'], status: 'paused', when: 'Thu 7:30 PM', day: 3,
  },
  {
    id: 'p4', listing: '3-Bed Terrace, Ikate', price: '₦148M',
    image: LISTINGS[2].image,
    caption: 'Ikate 3-bed · ₦148M · verified title. 31 DMs routed straight into the CRM.',
    channels: ['instagram', 'tiktok'], status: 'posted', when: 'Yesterday 5:00 PM', day: -1,
    metrics: { views: 12400, likes: 861, saves: 218, dms: 31, leads: 9 },
  },
  {
    id: 'p5', listing: '4-Bed Duplex, Osapa London', price: '₦178M',
    image: LISTINGS[1].image,
    caption: 'Osapa duplex walkthrough — 4 beds, BQ, gated estate. Full verification in bio.',
    channels: ['tiktok'], status: 'posted', when: 'Mon 7:30 PM', day: -3,
    metrics: { views: 48200, likes: 3120, saves: 704, dms: 87, leads: 22 },
  },
];

export function fmt(n: number) {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
}
