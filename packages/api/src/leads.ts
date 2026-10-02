/**
 * api/leads — the lead bridge contract.
 * createLead invokes the create-lead Edge Function (durable write + WhatsApp
 * delivery). listAgencyLeads / realtime are for the agency dashboard.
 */
import { getDb } from '@synapse/database';
import {
  LeadDeliveryStatus,
  type Lead,
  type CreateLeadInput,
} from '@synapse/types';

export interface CreateLeadResult {
  lead_id: string;
  delivery_status: LeadDeliveryStatus;
  error?: string;
}

/** Trigger the lead bridge. Resolves even when delivery fails — the lead is
 *  persisted and flagged, never lost. Callers should surface delivery_failed. */
export async function createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
  const { data, error } = await getDb().functions.invoke<CreateLeadResult>('create-lead', {
    body: { property_id: input.property_id, source: input.source },
  });
  if (error) throw error;
  if (!data) throw new Error('create-lead returned no data');
  return data;
}

/** Reverse-chronological leads for an agency (RLS scopes to members). */
export async function listAgencyLeads(agencyId: string): Promise<Lead[]> {
  const { data, error } = await getDb()
    .from('leads')
    .select('*')
    .eq('agency_id', agencyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Lead[];
}

/** Leads that failed WhatsApp delivery — surfaced for manual follow-up. */
export async function listFailedLeads(agencyId: string): Promise<Lead[]> {
  const { data, error } = await getDb()
    .from('leads')
    .select('*')
    .eq('agency_id', agencyId)
    .eq('delivery_status', LeadDeliveryStatus.DELIVERY_FAILED)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Lead[];
}

/**
 * Subscribe to new leads for an agency via Supabase Realtime.
 * Returns an unsubscribe function. The dashboard Leads page uses this so
 * new leads appear live.
 */
export function subscribeToAgencyLeads(
  agencyId: string,
  onInsert: (lead: Lead) => void,
): () => void {
  const channel = getDb()
    .channel(`leads:${agencyId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'leads', filter: `agency_id=eq.${agencyId}` },
      (payload) => onInsert(payload.new as Lead),
    )
    .subscribe();

  return () => {
    void getDb().removeChannel(channel);
  };
}
