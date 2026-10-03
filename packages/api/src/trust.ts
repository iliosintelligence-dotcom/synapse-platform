/**
 * api/trust — public trust reads (agency/agent/property). All scores are
 * platform-calculated; this layer only reads. Discovery surfaces use these.
 */
import { getDb } from '@synapse/database';
import {
  PropertyCheckStatus,
  type AgencyTrustPublic,
  type AgencyTrustScore,
  type AgencyTrustScoreSnapshot,
  type AgencyVerification,
  type AgentReputationSnapshot,
  type AgentVerification,
  type PropertyTrustSummary,
  type PropertyVerificationCheck,
  type ReputationTimeline,
  type ReviewAggregate,
} from '@synapse/types';

export async function getAgencyVerification(agencyId: string): Promise<AgencyVerification | null> {
  const { data, error } = await getDb()
    .from('agency_verifications')
    .select('*')
    .eq('agency_id', agencyId)
    .maybeSingle();
  if (error) throw error;
  return (data as AgencyVerification | null) ?? null;
}

export async function getAgencyTrustScore(agencyId: string): Promise<AgencyTrustScore | null> {
  const { data, error } = await getDb()
    .from('agency_trust_scores')
    .select('*')
    .eq('agency_id', agencyId)
    .maybeSingle();
  if (error) throw error;
  return (data as AgencyTrustScore | null) ?? null;
}

/** The trust timeline — daily score history for the sparkline/timeline. */
export async function getAgencyTrustTimeline(
  agencyId: string,
  fromDate: string,
): Promise<AgencyTrustScoreSnapshot[]> {
  const { data, error } = await getDb()
    .from('agency_trust_score_snapshots')
    .select('*')
    .eq('agency_id', agencyId)
    .gte('snapshot_date', fromDate)
    .order('snapshot_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AgencyTrustScoreSnapshot[];
}

/** One call for a discovery card: tier + score + ratings + txn count. */
export async function getAgencyTrustPublic(agencyId: string): Promise<AgencyTrustPublic> {
  const db = getDb();
  const [verif, score, agg, txn] = await Promise.all([
    db.from('agency_verifications').select('current_tier').eq('agency_id', agencyId).maybeSingle(),
    db.from('agency_trust_scores').select('current_score').eq('agency_id', agencyId).maybeSingle(),
    db
      .from('review_aggregates')
      .select('average_rating, review_count')
      .eq('entity_type', 'agency')
      .eq('entity_id', agencyId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from('deal_rooms').select('id', { count: 'exact', head: true }).eq('agency_id', agencyId).eq('status', 'closed'),
  ]);

  return {
    agency_id: agencyId,
    tier: (verif.data?.current_tier ?? 'unverified') as AgencyTrustPublic['tier'],
    trust_score: (score.data?.current_score as number | undefined) ?? null,
    average_rating: (agg.data?.average_rating as number | undefined) ?? null,
    review_count: (agg.data?.review_count as number | undefined) ?? 0,
    transaction_count: txn.count ?? 0,
  };
}

export async function getAgentVerification(
  agentId: string,
  agencyId: string,
): Promise<AgentVerification | null> {
  const { data, error } = await getDb()
    .from('agent_verifications')
    .select('*')
    .eq('agent_id', agentId)
    .eq('agency_id', agencyId)
    .maybeSingle();
  if (error) throw error;
  return (data as AgentVerification | null) ?? null;
}

export async function getAgentReputationTimeline(
  agentId: string,
  fromDate: string,
): Promise<AgentReputationSnapshot[]> {
  const { data, error } = await getDb()
    .from('agent_reputation_snapshots')
    .select('*')
    .eq('agent_id', agentId)
    .gte('snapshot_date', fromDate)
    .order('snapshot_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AgentReputationSnapshot[];
}

/**
 * The consumer-facing property trust summary: node score + the 7 chips,
 * with failed checks filtered out (RLS also enforces this).
 */
export async function getPropertyTrustSummary(propertyId: string): Promise<PropertyTrustSummary> {
  const db = getDb();
  const [verif, checks] = await Promise.all([
    db.from('property_verifications').select('state, node_score').eq('property_id', propertyId).maybeSingle(),
    db
      .from('property_verification_checks')
      .select('check_type, status')
      .eq('property_id', propertyId)
      .neq('status', PropertyCheckStatus.FAILED),
  ]);

  const visible = ((checks.data ?? []) as PropertyVerificationCheck[])
    .filter((c) => c.status === PropertyCheckStatus.PASSED || c.status === PropertyCheckStatus.PENDING)
    .map((c) => ({ check_type: c.check_type, status: c.status as 'passed' | 'pending' }));

  return {
    property_id: propertyId,
    node_score: (verif.data?.node_score as number | undefined) ?? null,
    state: (verif.data?.state ?? 'unverified') as PropertyTrustSummary['state'],
    checks: visible,
  };
}

export async function getReputationTimeline(
  entityType: 'agency' | 'agent',
  entityId: string,
): Promise<ReputationTimeline[]> {
  const { data, error } = await getDb()
    .from('reputation_timelines')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('occurred_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ReputationTimeline[];
}

export async function getReviewAggregate(
  entityType: 'agency' | 'agent',
  entityId: string,
): Promise<ReviewAggregate | null> {
  const { data, error } = await getDb()
    .from('review_aggregates')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ReviewAggregate | null) ?? null;
}
