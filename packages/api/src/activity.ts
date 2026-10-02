/**
 * api/activity — the operational memory. Read the immutable feed and
 * subscribe in real time. Writes happen via services / the emit() helper.
 */
import { getDb } from '@synapse/database';
import type { Activity } from '@synapse/types';

export async function listAgencyActivity(agencyId: string, limit = 100): Promise<Activity[]> {
  const { data, error } = await getDb()
    .from('activity_feed')
    .select('*')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Activity[];
}

export async function listLeadActivity(leadId: string, limit = 100): Promise<Activity[]> {
  const { data, error } = await getDb()
    .from('activity_feed')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Activity[];
}

/** Realtime: new activity rows for an agency (feed + badges). */
export function subscribeToActivity(agencyId: string, onInsert: (a: Activity) => void): () => void {
  const channel = getDb()
    .channel(`activity:${agencyId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_feed', filter: `agency_id=eq.${agencyId}` },
      (payload) => onInsert(payload.new as Activity),
    )
    .subscribe();
  return () => {
    void getDb().removeChannel(channel);
  };
}
