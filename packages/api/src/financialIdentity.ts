/**
 * api/financialIdentity — System 8. The consumer financial trust graph.
 * Strictest access on the platform: the user reads their own in full; anyone
 * else only through an explicit, logged, consent-scoped grant the user
 * triggers (e.g. submitting a rental/mortgage application).
 */
import { getDb } from '@synapse/database';
import type {
  FinancialConsentGrant,
  FinancialIdentity,
  ScoreComponentHistory,
  ShareFinancialIdentityInput,
} from '@synapse/types';

export async function getMyFinancialIdentity(): Promise<FinancialIdentity | null> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await db
    .from('financial_identities')
    .select('*')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as FinancialIdentity | null) ?? null;
}

/** The user's own component history — how their score moved, event by event. */
export async function getMyScoreHistory(financialIdentityId: string): Promise<ScoreComponentHistory[]> {
  const { data, error } = await getDb()
    .from('score_component_history')
    .select('*')
    .eq('financial_identity_id', financialIdentityId)
    .order('recorded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ScoreComponentHistory[];
}

/**
 * Share the financial identity with a landlord/agency or lender — a single,
 * explicit, logged consent event triggered by the user. Lenders receive only
 * the structured subset of components passed here.
 */
export async function shareFinancialIdentity(
  input: ShareFinancialIdentityInput & { shared_components: string[] },
): Promise<FinancialConsentGrant> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await db
    .from('financial_consent_grants')
    .insert({
      user_id: auth.user.id,
      granted_to_id: input.granted_to_id,
      audience: input.audience,
      shared_components: input.shared_components,
      context_type: input.context_type,
      context_id: input.context_id ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as FinancialConsentGrant;
}

export async function revokeConsent(grantId: string): Promise<void> {
  const { error } = await getDb()
    .from('financial_consent_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', grantId);
  if (error) throw error;
}

export async function listMyConsentGrants(): Promise<FinancialConsentGrant[]> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await db
    .from('financial_consent_grants')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('granted_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FinancialConsentGrant[];
}
