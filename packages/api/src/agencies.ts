/** api/agencies — agency CRUD + membership. RLS scopes everything. */
import { getDb } from '@synapse/database';
import {
  UserRole,
  VerificationTier,
  type Agency,
  type AgencyMember,
  type CreateAgencyInput,
  type InviteMemberInput,
  type UpdateAgencyInput,
} from '@synapse/types';

export async function createAgency(input: CreateAgencyInput): Promise<Agency> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const { data, error } = await db
    .from('agencies')
    .insert({
      owner_id: auth.user.id,
      name: input.name,
      city: input.city,
      whatsapp_number: input.whatsapp_number ?? null,
      cac_number: input.cac_number ?? null,
      address: input.address ?? null,
      verification_tier: VerificationTier.UNVERIFIED,
    })
    .select('*')
    .single();
  if (error) throw error;
  const agency = data as Agency;

  // Owner is also a member — membership row drives all RLS checks.
  const { error: memberError } = await db.from('agency_members').insert({
    agency_id: agency.id,
    profile_id: auth.user.id,
    role: UserRole.AGENCY_OWNER,
  });
  if (memberError) throw memberError;

  return agency;
}

export async function getAgency(agencyId: string): Promise<Agency> {
  const { data, error } = await getDb()
    .from('agencies')
    .select('*')
    .eq('id', agencyId)
    .single();
  if (error) throw error;
  return data as Agency;
}

export async function updateAgency(agencyId: string, input: UpdateAgencyInput): Promise<Agency> {
  const { data, error } = await getDb()
    .from('agencies')
    .update(input)
    .eq('id', agencyId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Agency;
}

export async function listMembers(agencyId: string): Promise<AgencyMember[]> {
  const { data, error } = await getDb()
    .from('agency_members')
    .select('*')
    .eq('agency_id', agencyId)
    .is('deleted_at', null)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AgencyMember[];
}

export async function inviteMember(input: InviteMemberInput): Promise<AgencyMember> {
  const { data, error } = await getDb()
    .from('agency_members')
    .insert({
      agency_id: input.agency_id,
      profile_id: input.profile_id,
      role: input.role,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as AgencyMember;
}

export async function removeMember(memberId: string): Promise<void> {
  // Soft delete — history is preserved for attribution later.
  const { error } = await getDb()
    .from('agency_members')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', memberId);
  if (error) throw error;
}
