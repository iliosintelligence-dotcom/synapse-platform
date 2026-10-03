/**
 * api/escrow — System 1. Reads are RLS-scoped to the parties. Every
 * fund-movement (funding, release, refund) goes through the escrow Edge
 * Function, which checks partner_is_live and only advances status on a
 * CONFIRMED partner webhook — never on internal state alone.
 */
import { getDb } from '@synapse/database';
import type {
  ApproveMilestoneInput,
  EscrowAccount,
  EscrowEvent,
  EscrowMilestone,
  FundMovementResult,
  InitiateEscrowInput,
} from '@synapse/types';

/** Open an escrow account + request a funding instruction from the partner. */
export async function initiateEscrow(input: InitiateEscrowInput): Promise<FundMovementResult> {
  const { data, error } = await getDb().functions.invoke<FundMovementResult>('escrow-initiate', {
    body: input,
  });
  if (error) throw error;
  if (!data) throw new Error('escrow-initiate returned no data');
  return data;
}

export async function getEscrowAccount(id: string): Promise<EscrowAccount> {
  const { data, error } = await getDb().from('escrow_accounts').select('*').eq('id', id).single();
  if (error) throw error;
  return data as EscrowAccount;
}

export async function listDealEscrows(dealRoomId: string): Promise<EscrowAccount[]> {
  const { data, error } = await getDb()
    .from('escrow_accounts')
    .select('*')
    .eq('deal_room_id', dealRoomId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as EscrowAccount[];
}

export async function listEscrowMilestones(escrowAccountId: string): Promise<EscrowMilestone[]> {
  const { data, error } = await getDb()
    .from('escrow_milestones')
    .select('*')
    .eq('escrow_account_id', escrowAccountId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as EscrowMilestone[];
}

/** Approve a milestone. The Edge Function verifies the approver role, records
 *  approval, and — when a release tranche is fully satisfied — calls the
 *  partner's release API. Status advances only on the partner's confirmation. */
export async function approveMilestone(input: ApproveMilestoneInput): Promise<FundMovementResult> {
  const { data, error } = await getDb().functions.invoke<FundMovementResult>('escrow-approve-milestone', {
    body: input,
  });
  if (error) throw error;
  if (!data) throw new Error('escrow-approve-milestone returned no data');
  return data;
}

export async function getEscrowEvents(escrowAccountId: string): Promise<EscrowEvent[]> {
  const { data, error } = await getDb()
    .from('escrow_events')
    .select('*')
    .eq('escrow_account_id', escrowAccountId)
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as EscrowEvent[];
}
