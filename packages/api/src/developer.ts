/**
 * api/developer — System 6. Developer sales ERP: developments, unit
 * inventory, installment plans + schedules. Reservation (which holds a unit
 * and can move money via escrow) goes through an Edge Function.
 */
import { getDb } from '@synapse/database';
import type {
  Development,
  FundMovementResult,
  InstallmentPlan,
  InstallmentScheduleRow,
  ReserveUnitInput,
  UnitInventory,
} from '@synapse/types';

export async function listDeveloperDevelopments(developerId: string): Promise<Development[]> {
  const { data, error } = await getDb()
    .from('developments')
    .select('*')
    .eq('developer_id', developerId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Development[];
}

export async function getDevelopment(id: string): Promise<Development> {
  const { data, error } = await getDb().from('developments').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Development;
}

export async function listUnits(developmentId: string): Promise<UnitInventory[]> {
  const { data, error } = await getDb()
    .from('unit_inventory')
    .select('*')
    .eq('development_id', developmentId)
    .is('deleted_at', null)
    .order('unit_number', { ascending: true });
  if (error) throw error;
  return (data ?? []) as UnitInventory[];
}

/** Reserve a unit (held for the configured window). The Edge Function sets the
 *  reservation expiry and, when a down payment is required, routes it through
 *  escrow. Unpaid reservations auto-expire back to available. */
export async function reserveUnit(input: ReserveUnitInput): Promise<FundMovementResult> {
  const { data, error } = await getDb().functions.invoke<FundMovementResult>('unit-reserve', {
    body: input,
  });
  if (error) throw error;
  if (!data) throw new Error('unit-reserve returned no data');
  return data;
}

export async function getMyInstallmentPlans(): Promise<InstallmentPlan[]> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await db
    .from('installment_plans')
    .select('*')
    .eq('buyer_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as InstallmentPlan[];
}

export async function getInstallmentSchedule(planId: string): Promise<InstallmentScheduleRow[]> {
  const { data, error } = await getDb()
    .from('installment_schedules')
    .select('*')
    .eq('installment_plan_id', planId)
    .order('installment_number', { ascending: true });
  if (error) throw error;
  return (data ?? []) as InstallmentScheduleRow[];
}
