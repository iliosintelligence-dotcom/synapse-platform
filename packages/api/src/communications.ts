/**
 * api/communications — communication intelligence. Every touchpoint is
 * logged; response_time_seconds is computed server-side on insert.
 */
import { getDb } from '@synapse/database';
import type { Communication, LogCommunicationInput } from '@synapse/types';

export async function logCommunication(input: LogCommunicationInput): Promise<Communication> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('communications')
    .insert({
      lead_id: input.lead_id,
      agent_id: auth.user?.id ?? null,
      channel: input.channel,
      direction: input.direction,
      duration_seconds: input.duration_seconds ?? null,
      outcome: input.outcome ?? null,
      summary: input.summary ?? null,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Communication;
}

export async function listLeadCommunications(leadId: string): Promise<Communication[]> {
  const { data, error } = await getDb()
    .from('communications')
    .select('*')
    .eq('lead_id', leadId)
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Communication[];
}
