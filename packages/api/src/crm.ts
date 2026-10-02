/**
 * api/crm — the pipeline engine. Reading leads as pipeline rows, moving
 * stages (append-only history via the move_lead_stage RPC), assigning agents,
 * and Realtime pipeline subscriptions.
 */
import { getDb } from '@synapse/database';
import type {
  AssignLeadInput,
  Lead,
  LeadStage,
  LeadStageHistory,
  MoveLeadStageInput,
  PipelineLead,
} from '@synapse/types';

/** All non-terminal-and-terminal leads for an agency, for the board. */
export async function listPipelineLeads(agencyId: string): Promise<PipelineLead[]> {
  const { data, error } = await getDb()
    .from('leads')
    .select(
      'id, property_id, consumer_id, agency_id, source, consumer_name, consumer_phone, ' +
        'assigned_agent_id, current_stage, budget_range, budget_min, budget_max, ' +
        'timeline_to_purchase, interest_level, last_activity_at, next_action_at, risk_level, ' +
        'lead_score, intent_score, financial_readiness_score, engagement_score, urgency_score, ' +
        'responsiveness_score, fit_score, conversion_probability, next_action_recommendation, ' +
        'created_at, updated_at',
    )
    .eq('agency_id', agencyId)
    .is('deleted_at', null)
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .returns<PipelineLead[]>();
  if (error) throw error;
  return data ?? [];
}

/** Move a lead to a new stage. Time-in-stage + history handled server-side. */
export async function moveLeadStage(input: MoveLeadStageInput): Promise<void> {
  const { error } = await getDb().rpc('move_lead_stage', {
    p_lead_id: input.lead_id,
    p_to_stage: input.to_stage,
    p_reason: input.reason ?? null,
  });
  if (error) throw error;
}

export async function assignLead(input: AssignLeadInput): Promise<Lead> {
  const { data, error } = await getDb()
    .from('leads')
    .update({ assigned_agent_id: input.agent_id, last_activity_at: new Date().toISOString() })
    .eq('id', input.lead_id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Lead;
}

export async function getLeadStageHistory(leadId: string): Promise<LeadStageHistory[]> {
  const { data, error } = await getDb()
    .from('lead_stage_history')
    .select('*')
    .eq('lead_id', leadId)
    .order('moved_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as LeadStageHistory[];
}

export async function getLead(leadId: string): Promise<Lead> {
  const { data, error } = await getDb().from('leads').select('*').eq('id', leadId).single();
  if (error) throw error;
  return data as Lead;
}

/** Realtime: any lead change for an agency (stage moves, new leads). */
export function subscribeToPipeline(
  agencyId: string,
  onChange: (stage: LeadStage | null) => void,
): () => void {
  const channel = getDb()
    .channel(`pipeline:${agencyId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'leads', filter: `agency_id=eq.${agencyId}` },
      (payload) => {
        const next = (payload.new as { current_stage?: LeadStage } | null) ?? null;
        onChange(next?.current_stage ?? null);
      },
    )
    .subscribe();
  return () => {
    void getDb().removeChannel(channel);
  };
}
