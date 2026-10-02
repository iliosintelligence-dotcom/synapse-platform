/**
 * api/dealRooms — transaction workspaces. A deal room activates when a lead
 * is qualified or manually promoted; it holds the full lifecycle.
 */
import { getDb } from '@synapse/database';
import {
  DealRoomStatus,
  LeadStage,
  type CloseDealInput,
  type DealRoom,
  type OpenDealRoomInput,
} from '@synapse/types';

/** Promote a lead into a deal room (idempotent on lead_id). */
export async function openDealRoom(input: OpenDealRoomInput): Promise<DealRoom> {
  const db = getDb();
  const { data: lead, error: leadErr } = await db
    .from('leads')
    .select('id, property_id, consumer_id, agency_id, assigned_agent_id, current_stage')
    .eq('id', input.lead_id)
    .single();
  if (leadErr) throw leadErr;

  const { data, error } = await db
    .from('deal_rooms')
    .upsert(
      {
        lead_id: lead.id,
        property_id: lead.property_id as string,
        consumer_id: lead.consumer_id as string,
        agency_id: lead.agency_id as string,
        agent_id: (lead.assigned_agent_id as string | null) ?? null,
        status: DealRoomStatus.ACTIVE,
      },
      { onConflict: 'lead_id' },
    )
    .select('*')
    .single();
  if (error) throw error;

  // Keep the pipeline in step: a promoted lead is at least QUALIFIED.
  if (lead.current_stage === LeadStage.NEW || lead.current_stage === LeadStage.CONTACTED) {
    await db.rpc('move_lead_stage', {
      p_lead_id: lead.id,
      p_to_stage: LeadStage.QUALIFIED,
      p_reason: 'Promoted to deal room',
    });
  }
  return data as DealRoom;
}

export async function getDealRoom(dealRoomId: string): Promise<DealRoom> {
  const { data, error } = await getDb()
    .from('deal_rooms')
    .select('*')
    .eq('id', dealRoomId)
    .single();
  if (error) throw error;
  return data as DealRoom;
}

export async function listAgencyDealRooms(agencyId: string): Promise<DealRoom[]> {
  const { data, error } = await getDb()
    .from('deal_rooms')
    .select('*')
    .eq('agency_id', agencyId)
    .is('deleted_at', null)
    .order('opened_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DealRoom[];
}

/** Close the deal: records price/type, moves the lead to CLOSED. */
export async function closeDeal(input: CloseDealInput): Promise<DealRoom> {
  const db = getDb();
  const { data, error } = await db
    .from('deal_rooms')
    .update({
      status: DealRoomStatus.CLOSED,
      closed_at: new Date().toISOString(),
      closing_price: input.closing_price,
      closing_type: input.closing_type,
    })
    .eq('id', input.deal_room_id)
    .select('*')
    .single();
  if (error) throw error;
  const room = data as DealRoom;
  await db.rpc('move_lead_stage', {
    p_lead_id: room.lead_id,
    p_to_stage: LeadStage.CLOSED,
    p_reason: 'Deal closed',
  });
  return room;
}

/** Realtime: every change inside one deal room. */
export function subscribeToDealRoom(dealRoomId: string, onChange: () => void): () => void {
  const channel = getDb()
    .channel(`deal_room:${dealRoomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'deal_rooms', filter: `id=eq.${dealRoomId}` },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void getDb().removeChannel(channel);
  };
}
