/**
 * api/content — the content generation engine surface. Generation routes
 * through the content-generate Edge Function (Layer 3 AI gateway); the UI
 * only ever sees drafts to approve. Approval/scheduling are explicit.
 */
import { getDb } from '@synapse/database';
import {
  ContentStatus,
  type ApproveContentInput,
  type CampaignSuggestion,
  type ContentVariant,
  type GenerateContentInput,
  type GeneratedContent,
} from '@synapse/types';

/** Request AI generation. The Edge Function drafts and persists the content. */
export async function generateContent(input: GenerateContentInput): Promise<GeneratedContent> {
  const { data, error } = await getDb().functions.invoke<GeneratedContent>('content-generate', {
    body: input,
  });
  if (error) throw error;
  if (!data) throw new Error('content-generate returned no data');
  return data;
}

export async function listPropertyContent(propertyId: string): Promise<GeneratedContent[]> {
  const { data, error } = await getDb()
    .from('generated_content')
    .select('*')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GeneratedContent[];
}

export async function getContentVariants(contentId: string): Promise<ContentVariant[]> {
  const { data, error } = await getDb()
    .from('content_variants')
    .select('*')
    .eq('content_id', contentId);
  if (error) throw error;
  return (data ?? []) as ContentVariant[];
}

/** Approve content and (optionally) schedule syndication to platforms. */
export async function approveContent(input: ApproveContentInput): Promise<GeneratedContent> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('generated_content')
    .update({
      status: input.scheduled_at ? ContentStatus.SCHEDULED : ContentStatus.APPROVED,
      approved_by: auth.user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq('id', input.content_id)
    .select('*')
    .single();
  if (error) throw error;
  return data as GeneratedContent;
}

/** Edit a draft's text without regenerating. */
export async function updateContentText(contentId: string, text: string): Promise<GeneratedContent> {
  const { data, error } = await getDb()
    .from('generated_content')
    .update({ generated_text: text })
    .eq('id', contentId)
    .select('*')
    .single();
  if (error) throw error;
  return data as GeneratedContent;
}

export async function listCampaignSuggestions(agencyId: string): Promise<CampaignSuggestion[]> {
  const { data, error } = await getDb()
    .from('campaign_suggestions')
    .select('*')
    .eq('agency_id', agencyId)
    .eq('is_dismissed', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CampaignSuggestion[];
}
