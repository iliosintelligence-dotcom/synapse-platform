/**
 * api/documents — the document vault. Uploads go through the media
 * abstraction; this records typed metadata, versions prior uploads, and
 * computes deal-room vault completeness. Files are served via signed URLs
 * (Edge Function), never public storage URLs.
 */
import { getDb } from '@synapse/database';
import {
  DocumentEntityType,
  DocumentType,
  type SynapseDocument,
  type VaultCompleteness,
} from '@synapse/types';

export interface RecordDocumentInput {
  entity_type: DocumentEntityType;
  entity_id: string;
  document_type: DocumentType;
  display_name: string;
  storage_url: string;
  cloudinary_public_id: string;
  file_size_bytes?: number;
  mime_type?: string;
  expires_at?: string;
}

/** Record a document and supersede any prior current doc of the same type. */
export async function recordDocument(input: RecordDocumentInput): Promise<SynapseDocument> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();

  const { data, error } = await db
    .from('documents')
    .insert({
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      document_type: input.document_type,
      display_name: input.display_name,
      storage_url: input.storage_url,
      cloudinary_public_id: input.cloudinary_public_id,
      file_size_bytes: input.file_size_bytes ?? null,
      mime_type: input.mime_type ?? null,
      uploaded_by: auth.user?.id ?? null,
      expires_at: input.expires_at ?? null,
      is_current: true,
    })
    .select('*')
    .single();
  if (error) throw error;

  // Archive prior current versions of the same (entity, type).
  await db.rpc('supersede_document', { p_new_id: data.id });
  return data as SynapseDocument;
}

/** Current documents for an entity (deal room, property, agency, agent). */
export async function listDocuments(
  entityType: DocumentEntityType,
  entityId: string,
): Promise<SynapseDocument[]> {
  const { data, error } = await getDb()
    .from('documents')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('is_current', true)
    .is('deleted_at', null)
    .order('document_type', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SynapseDocument[];
}

/** Deal-room categories that count toward vault completeness. */
const DEAL_ROOM_CATEGORIES: DocumentType[] = [
  DocumentType.CERTIFICATE_OF_OCCUPANCY,
  DocumentType.SURVEY_PLAN,
  DocumentType.DEED_OF_ASSIGNMENT,
  DocumentType.GOVERNORS_CONSENT,
  DocumentType.BUILDING_APPROVAL,
];

export async function getVaultCompleteness(dealRoomId: string): Promise<VaultCompleteness> {
  const docs = await listDocuments(DocumentEntityType.DEAL_ROOM, dealRoomId);
  const present = new Set(docs.map((d) => d.document_type));
  const filled = DEAL_ROOM_CATEGORIES.filter((c) => present.has(c)).length;
  const verifiedCount = docs.filter((d) => d.is_verified).length;
  return {
    total_categories: DEAL_ROOM_CATEGORIES.length,
    filled_categories: filled,
    percent: Math.round((filled / DEAL_ROOM_CATEGORIES.length) * 100),
    verified_count: verifiedCount,
  };
}
