/**
 * api/commission — System 5. Internal ledger + Paystack payout for money the
 * agency already controls (no banking partner). Payout runs through the
 * commission-payout Edge Function on the existing Paystack rails.
 */
import { getDb } from '@synapse/database';
import type {
  CommissionLedgerEntry,
  CommissionStructure,
  CreateCommissionStructureInput,
  PerformanceBonus,
} from '@synapse/types';

export async function createCommissionStructure(
  input: CreateCommissionStructureInput,
): Promise<CommissionStructure> {
  const { data, error } = await getDb()
    .from('commission_structures')
    .insert({
      agency_id: input.agency_id,
      structure_name: input.structure_name,
      applies_to: input.applies_to,
      applies_to_id: input.applies_to_id ?? null,
      commission_type: input.commission_type,
      base_percentage: input.base_percentage ?? null,
      tier_rules: input.tier_rules ?? null,
      flat_amount: input.flat_amount ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as CommissionStructure;
}

export async function listCommissionStructures(agencyId: string): Promise<CommissionStructure[]> {
  const { data, error } = await getDb()
    .from('commission_structures')
    .select('*')
    .eq('agency_id', agencyId)
    .is('deleted_at', null);
  if (error) throw error;
  return (data ?? []) as CommissionStructure[];
}

export async function listAgencyCommissions(agencyId: string): Promise<CommissionLedgerEntry[]> {
  const { data, error } = await getDb()
    .from('commission_ledger')
    .select('*')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CommissionLedgerEntry[];
}

export async function listAgentCommissions(agentId: string): Promise<CommissionLedgerEntry[]> {
  const { data, error } = await getDb()
    .from('commission_ledger')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CommissionLedgerEntry[];
}

export async function listAgentBonuses(agentId: string): Promise<PerformanceBonus[]> {
  const { data, error } = await getDb()
    .from('performance_bonuses')
    .select('*')
    .eq('agent_id', agentId)
    .order('period_end', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PerformanceBonus[];
}

/** Run the agency's payout cycle — batches approved entries to Paystack. */
export async function runCommissionPayout(agencyId: string): Promise<{ paid: number }> {
  const { data, error } = await getDb().functions.invoke<{ paid: number }>('commission-payout', {
    body: { agency_id: agencyId },
  });
  if (error) throw error;
  return data ?? { paid: 0 };
}
