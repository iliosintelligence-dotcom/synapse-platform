/** api/users — profile reads and updates. RLS limits access to the owner. */
import { getDb } from '@synapse/database';
import type { Profile, UpdateProfileInput } from '@synapse/types';

export async function getMyProfile(): Promise<Profile> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const { data, error } = await db.from('profiles').select('*').eq('id', auth.user.id).single();
  if (error) throw error;
  return data as Profile;
}

export async function updateMyProfile(input: UpdateProfileInput): Promise<Profile> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const { data, error } = await db
    .from('profiles')
    .update(input)
    .eq('id', auth.user.id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Profile;
}
