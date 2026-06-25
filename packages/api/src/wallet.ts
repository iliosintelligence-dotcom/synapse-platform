/**
 * api/wallet — System 7. ⚠ GATED. Each wallet is a dedicated virtual account
 * at a licensed partner bank; balance is mirrored + reconciled, never the
 * source of truth. Opening a wallet and every money movement go through the
 * wallet Edge Function (partner webhooks); reads here are RLS-scoped to owner.
 */
import { getDb } from '@synapse/database';
import {
  WalletPurpose,
  type FundMovementResult,
  type SavingsGoal,
  type Wallet,
  type WalletTransaction,
} from '@synapse/types';

/** Open a wallet — provisions a partner virtual account. Refuses unless the
 *  partner is contractually LIVE (returns partner_not_live). */
export async function openWallet(purpose: WalletPurpose): Promise<FundMovementResult & { wallet_id?: string }> {
  const { data, error } = await getDb().functions.invoke<FundMovementResult & { wallet_id?: string }>(
    'wallet-open',
    { body: { wallet_purpose: purpose } },
  );
  if (error) throw error;
  if (!data) throw new Error('wallet-open returned no data');
  return data;
}

export async function getMyWallets(): Promise<Wallet[]> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await db
    .from('wallets')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Wallet[];
}

export async function getWalletTransactions(walletId: string): Promise<WalletTransaction[]> {
  const { data, error } = await getDb()
    .from('wallet_transactions')
    .select('*')
    .eq('wallet_id', walletId)
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as WalletTransaction[];
}

export async function getSavingsGoals(walletId: string): Promise<SavingsGoal[]> {
  const { data, error } = await getDb()
    .from('savings_goals')
    .select('*')
    .eq('wallet_id', walletId);
  if (error) throw error;
  return (data ?? []) as SavingsGoal[];
}

/** Savings-goal config is Synapse-side logic (no money moves) — safe to write. */
export async function setSavingsGoal(input: {
  wallet_id: string;
  goal_type: 'rent_target' | 'down_payment_target';
  target_amount: number;
  target_date?: string;
  auto_save_enabled?: boolean;
  auto_save_amount?: number;
  auto_save_frequency?: 'weekly' | 'monthly';
}): Promise<SavingsGoal> {
  const { data, error } = await getDb()
    .from('savings_goals')
    .insert({
      wallet_id: input.wallet_id,
      goal_type: input.goal_type,
      target_amount: input.target_amount,
      target_date: input.target_date ?? null,
      auto_save_enabled: input.auto_save_enabled ?? false,
      auto_save_amount: input.auto_save_amount ?? null,
      auto_save_frequency: input.auto_save_frequency ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as SavingsGoal;
}
