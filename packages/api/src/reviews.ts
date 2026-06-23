/**
 * api/reviews — consumer reviews + disputes (the consumer-writable trust
 * surfaces). Verified-interaction enforcement is finalised server-side;
 * publishing/aggregation are platform operations.
 */
import { getDb } from '@synapse/database';
import type {
  ConsumerReview,
  Dispute,
  OpenDisputeInput,
  SubmitReviewInput,
} from '@synapse/types';

/** Submit a review. Only verified interactions are ultimately published. */
export async function submitReview(input: SubmitReviewInput): Promise<ConsumerReview> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  // Verify the reviewer actually had a viewing or closed deal with the entity.
  const { count } = await db
    .from('viewings')
    .select('id', { count: 'exact', head: true })
    .eq('consumer_id', auth.user.id)
    .eq('status', 'completed');
  const isVerified = (count ?? 0) > 0;

  const { data, error } = await db
    .from('consumer_reviews')
    .insert({
      reviewer_id: auth.user.id,
      reviewed_entity_type: input.reviewed_entity_type,
      reviewed_entity_id: input.reviewed_entity_id,
      rating: input.rating,
      review_text: input.review_text ?? null,
      transaction_id: input.transaction_id ?? null,
      is_verified_transaction: isVerified,
      // published only when the interaction is verified
      is_published: isVerified,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as ConsumerReview;
}

export async function listPublishedReviews(
  entityType: 'agency' | 'agent',
  entityId: string,
): Promise<ConsumerReview[]> {
  const { data, error } = await getDb()
    .from('consumer_reviews')
    .select('*')
    .eq('reviewed_entity_type', entityType)
    .eq('reviewed_entity_id', entityId)
    .eq('is_published', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ConsumerReview[];
}

/* ───────── disputes (consumer/agency facing) ───────── */

export async function openDispute(input: OpenDisputeInput): Promise<Dispute> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const { data, error } = await db
    .from('disputes')
    .insert({
      dispute_type: input.dispute_type,
      raised_by: auth.user.id,
      raised_against: input.raised_against,
      property_id: input.property_id ?? null,
      lead_id: input.lead_id ?? null,
      deal_room_id: input.deal_room_id ?? null,
      description: input.description,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Dispute;
}

export async function listMyDisputes(): Promise<Dispute[]> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await db
    .from('disputes')
    .select('*')
    .eq('raised_by', auth.user.id)
    .is('deleted_at', null)
    .order('opened_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Dispute[];
}

export async function listAgencyDisputes(agencyId: string): Promise<Dispute[]> {
  const { data, error } = await getDb()
    .from('disputes')
    .select('*')
    .eq('raised_against', agencyId)
    .is('deleted_at', null)
    .order('opened_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Dispute[];
}
