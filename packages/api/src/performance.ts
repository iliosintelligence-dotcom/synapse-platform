/**
 * api/performance — dashboards read ONLY from pre-aggregated snapshots,
 * never from raw rows. The nightly pg_cron job fills these.
 */
import { getDb } from '@synapse/database';
import type {
  AgencyDailySnapshot,
  AgentDailySnapshot,
  PropertyPerformance,
} from '@synapse/types';

export async function getAgencySnapshots(
  agencyId: string,
  fromDate: string,
  toDate: string,
): Promise<AgencyDailySnapshot[]> {
  const { data, error } = await getDb()
    .from('agency_daily_snapshots')
    .select('*')
    .eq('agency_id', agencyId)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AgencyDailySnapshot[];
}

export async function getAgentSnapshots(
  agentId: string,
  fromDate: string,
  toDate: string,
): Promise<AgentDailySnapshot[]> {
  const { data, error } = await getDb()
    .from('agent_daily_snapshots')
    .select('*')
    .eq('agent_id', agentId)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AgentDailySnapshot[];
}

export async function getPropertyPerformance(propertyId: string): Promise<PropertyPerformance | null> {
  const { data, error } = await getDb()
    .from('property_performance')
    .select('*')
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw error;
  return (data as PropertyPerformance | null) ?? null;
}
