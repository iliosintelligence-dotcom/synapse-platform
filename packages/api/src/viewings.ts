/** api/viewings — booking flow between consumers and agencies. */
import { getDb } from '@synapse/database';
import type { CreateViewingInput, UpdateViewingInput, Viewing } from '@synapse/types';

export async function createViewing(input: CreateViewingInput): Promise<Viewing> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  // agency_id is derived from the property server-side via select; the RLS
  // insert policy only checks consumer ownership.
  const { data: property, error: propError } = await db
    .from('properties')
    .select('agency_id')
    .eq('id', input.property_id)
    .single();
  if (propError) throw propError;

  const { data, error } = await db
    .from('viewings')
    .insert({
      property_id: input.property_id,
      consumer_id: auth.user.id,
      agency_id: property.agency_id as string,
      scheduled_at: input.scheduled_at,
      notes: input.notes ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Viewing;
}

export async function listMyViewings(): Promise<Viewing[]> {
  const { data, error } = await getDb()
    .from('viewings')
    .select('*')
    .is('deleted_at', null)
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Viewing[];
}

export async function updateViewing(id: string, input: UpdateViewingInput): Promise<Viewing> {
  const { data, error } = await getDb()
    .from('viewings')
    .update(input)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Viewing;
}
