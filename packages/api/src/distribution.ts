/**
 * api/distribution — proximity, discovery feed, and referrals.
 * Proximity check + reward issuance run in Edge Functions (trigger rules and
 * reward logic must never live client-side). Discovery + referral reads are
 * consumer-owned via RLS.
 */
import { getDb } from '@synapse/database';
import type {
  CheckProximityInput,
  CreateReferralInput,
  DiscoveryFeedRecord,
  DiscoveryFeedType,
  ProximityMatch,
  Referral,
  ReferralSummary,
} from '@synapse/types';

/* ───────── proximity ───────── */

/**
 * Report the user's location. The proximity-check Edge Function applies the
 * intelligence-graph match + all trigger rules (30-day intent, 1/property/7d,
 * 1/4h session cap, location permission) and fires the alert. Returns the
 * matches it acted on (empty when suppressed).
 */
export async function checkProximity(input: CheckProximityInput): Promise<ProximityMatch[]> {
  const { data, error } = await getDb().functions.invoke<{ matches: ProximityMatch[] }>(
    'proximity-check',
    { body: input },
  );
  if (error) throw error;
  return data?.matches ?? [];
}

/* ───────── discovery feed ───────── */

export async function getDiscoveryFeed(
  feedType: DiscoveryFeedType,
  date: string,
): Promise<DiscoveryFeedRecord[]> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const { data, error } = await db
    .from('discovery_feed_records')
    .select('*')
    .eq('user_id', auth.user.id)
    .eq('feed_type', feedType)
    .eq('feed_date', date)
    .order('position_in_feed', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DiscoveryFeedRecord[];
}

/** Record an outcome signal on a feed item (impression/tap/save). */
export async function markFeedSignal(
  recordId: string,
  signal: 'impressed' | 'tapped' | 'saved' | 'contact',
): Promise<void> {
  const field =
    signal === 'impressed'
      ? 'was_impressed'
      : signal === 'tapped'
        ? 'was_tapped'
        : signal === 'saved'
          ? 'was_saved'
          : 'led_to_contact';
  const { error } = await getDb()
    .from('discovery_feed_records')
    .update({ [field]: true })
    .eq('id', recordId);
  if (error) throw error;
}

/* ───────── referrals ───────── */

/** Create a referral link carrying the user's unique code. */
export async function createReferral(input: CreateReferralInput): Promise<Referral> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  // short, unique, shareable code
  const code = `SYN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const { data, error } = await db
    .from('referrals')
    .insert({
      referrer_id: auth.user.id,
      referrer_type: input.referrer_type,
      referral_code: code,
      referral_channel: input.referral_channel,
      property_id: input.property_id ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Referral;
}

export async function getReferralSummary(): Promise<ReferralSummary> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const { data, error } = await db
    .from('referrals')
    .select('referral_code, status, reward_issued')
    .eq('referrer_id', auth.user.id);
  if (error) throw error;
  const rows = data ?? [];

  return {
    referral_code: (rows[0]?.referral_code as string) ?? '',
    total_referred: rows.length,
    total_signed_up: rows.filter((r) => r.status !== 'pending').length,
    total_transacted: rows.filter((r) => r.status === 'transacted').length,
    rewards_issued: rows.filter((r) => r.reward_issued).length,
    rewards_pending: rows.filter((r) => r.status === 'transacted' && !r.reward_issued).length,
  };
}
