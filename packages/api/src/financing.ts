/**
 * api/financing — Systems 2 (Rent Now Pay Monthly) & 3 (Mortgage Marketplace).
 * ⚠ GATED: submission routes to a partner lender / provider via Edge Function,
 * which refuses (partner_not_live) unless the partner is contractually LIVE.
 * Synapse originates + packages + mirrors. It never underwrites or disburses.
 */
import { getDb } from '@synapse/database';
import type {
  FundMovementResult,
  MortgageApplication,
  MortgageProvider,
  RentFinancingApplication,
  RepaymentScheduleRow,
} from '@synapse/types';

/* ───────── System 2 — Rent Now, Pay Monthly ───────── */

export interface SubmitRentFinancingInput {
  property_id: string;
  deal_room_id?: string;
  annual_rent_amount: number;
  requested_monthly_amount: number;
  employment_status: string;
  monthly_income_declared: number;
  existing_debt_obligations?: number;
}

/** Package + submit a rent-financing application to the partner lender. */
export async function submitRentFinancing(
  input: SubmitRentFinancingInput,
): Promise<FundMovementResult & { application_id?: string }> {
  const { data, error } = await getDb().functions.invoke<FundMovementResult & { application_id?: string }>(
    'rent-financing-submit',
    { body: input },
  );
  if (error) throw error;
  if (!data) throw new Error('rent-financing-submit returned no data');
  return data;
}

export async function listMyRentApplications(): Promise<RentFinancingApplication[]> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await db
    .from('rent_financing_applications')
    .select('*')
    .eq('tenant_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as RentFinancingApplication[];
}

/** The partner lender's schedule, mirrored for the tenant UI. */
export async function getRepaymentSchedule(applicationId: string): Promise<RepaymentScheduleRow[]> {
  const { data, error } = await getDb()
    .from('rent_repayment_schedules')
    .select('*')
    .eq('application_id', applicationId)
    .order('installment_number', { ascending: true });
  if (error) throw error;
  return (data ?? []) as RepaymentScheduleRow[];
}

/* ───────── System 3 — Mortgage Marketplace ───────── */

export async function listMortgageProviders(): Promise<MortgageProvider[]> {
  const { data, error } = await getDb()
    .from('mortgage_providers')
    .select('*')
    .eq('is_active', true)
    .order('institution_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MortgageProvider[];
}

export interface SubmitMortgageInput {
  property_id: string;
  mortgage_provider_id: string;
  declared_income: number;
  declared_expenses: number;
  requested_loan_amount: number;
  requested_tenor_years: number;
  down_payment_available: number;
}

/** Submit a mortgage application — API providers go live, others become a
 *  structured manual referral. Synapse never underwrites. */
export async function submitMortgage(
  input: SubmitMortgageInput,
): Promise<{ application_id: string }> {
  const { data, error } = await getDb().functions.invoke<{ application_id: string }>(
    'mortgage-submit',
    { body: input },
  );
  if (error) throw error;
  if (!data) throw new Error('mortgage-submit returned no data');
  return data;
}

export async function listMyMortgageApplications(): Promise<MortgageApplication[]> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await db
    .from('mortgage_applications')
    .select('*')
    .eq('buyer_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MortgageApplication[];
}
