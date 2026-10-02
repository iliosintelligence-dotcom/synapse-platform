/**
 * api/attribution — the strategic moat. Record raw touchpoints; never
 * pre-compute models. First/last/linear attribution all derive from queries.
 */
import { getDb } from '@synapse/database';
import type { AttributionChannel, LeadAttribution, RecordAttributionInput } from '@synapse/types';

/**
 * Record a touchpoint. is_first_touch is set automatically when this is the
 * lead's first touch; is_last_touch is moved to this row (the previous last
 * touch is left intact as history — models derive correctness from occurred_at).
 */
export async function recordTouchpoint(
  input: RecordAttributionInput & { agency_id: string },
): Promise<LeadAttribution> {
  const db = getDb();
  const { count } = await db
    .from('lead_attribution')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', input.lead_id);

  const { data, error } = await db
    .from('lead_attribution')
    .insert({
      lead_id: input.lead_id,
      property_id: input.property_id ?? null,
      agency_id: input.agency_id,
      channel: input.channel,
      is_first_touch: (count ?? 0) === 0,
      is_last_touch: true,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      campaign_id: input.campaign_id ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as LeadAttribution;
}

/** Full ordered touchpoint chain for a lead. */
export async function getAttributionChain(leadId: string): Promise<LeadAttribution[]> {
  const { data, error } = await getDb()
    .from('lead_attribution')
    .select('*')
    .eq('lead_id', leadId)
    .order('occurred_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as LeadAttribution[];
}

export interface ChannelRevenue {
  channel: AttributionChannel;
  closed_deals: number;
  revenue: number;
}

/**
 * Which channels generate CLOSED deals (not just leads) — first-touch model.
 * Derived live from raw touchpoints + closed deal rooms.
 */
export async function channelRevenueReport(agencyId: string): Promise<ChannelRevenue[]> {
  // Derivation is non-trivial in PostgREST; expose a typed view-style RPC.
  // TODO(layer-3): move to a SQL view `channel_revenue` for richer models
  // (linear, time-decay). First-touch is sufficient for the Layer 2 report.
  const { data, error } = await getDb().rpc('channel_first_touch_revenue', {
    p_agency_id: agencyId,
  });
  if (error) throw error;
  return (data ?? []) as ChannelRevenue[];
}
