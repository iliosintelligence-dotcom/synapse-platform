/**
 * api/social — syndication + connected accounts + campaigns. Token storage,
 * platform publishing, and metric fetching happen in Edge Functions (the
 * token never touches the client). The UI reads accounts/posts/metrics and
 * triggers connect/schedule via functions.
 */
import { getDb } from '@synapse/database';
import type {
  Campaign,
  CampaignAsset,
  ConnectSocialAccountInput,
  CreateCampaignInput,
  SocialAccount,
  SocialPost,
  SocialPostMetrics,
} from '@synapse/types';

/* ───────── connected accounts ───────── */

export async function listSocialAccounts(agencyId: string): Promise<SocialAccount[]> {
  const { data, error } = await getDb()
    .from('social_accounts')
    .select('*')
    .eq('agency_id', agencyId)
    .is('deleted_at', null);
  if (error) throw error;
  return (data ?? []) as SocialAccount[];
}

/** Connect an account — the raw token goes straight to the Edge Function,
 *  which encrypts it into Supabase Vault. Nothing is persisted client-side. */
export async function connectSocialAccount(
  input: ConnectSocialAccountInput,
): Promise<SocialAccount> {
  const { data, error } = await getDb().functions.invoke<SocialAccount>('social-connect', {
    body: input,
  });
  if (error) throw error;
  if (!data) throw new Error('social-connect returned no data');
  return data;
}

export async function disconnectSocialAccount(accountId: string): Promise<void> {
  const { error } = await getDb()
    .from('social_accounts')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', accountId);
  if (error) throw error;
}

/* ───────── posts + metrics ───────── */

export async function listSocialPosts(agencyId: string): Promise<SocialPost[]> {
  const { data, error } = await getDb()
    .from('social_posts')
    .select('*')
    .eq('agency_id', agencyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SocialPost[];
}

/** Latest metric snapshot per post. */
export async function getPostMetrics(socialPostId: string): Promise<SocialPostMetrics | null> {
  const { data, error } = await getDb()
    .from('social_post_metrics')
    .select('*')
    .eq('social_post_id', socialPostId)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SocialPostMetrics | null) ?? null;
}

/* ───────── campaigns ───────── */

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const db = getDb();
  const { data: agencyMember } = await db.auth.getUser();
  void agencyMember;
  // agency_id is resolved server-side from the first property's owner; for
  // the typed client we require the caller to pass properties of one agency.
  const { data: prop, error: propErr } = await db
    .from('properties')
    .select('agency_id')
    .eq('id', input.property_ids[0] ?? '')
    .single();
  if (propErr) throw propErr;

  const { data, error } = await db
    .from('campaigns')
    .insert({
      agency_id: prop.agency_id as string,
      name: input.name,
      campaign_type: input.campaign_type,
      start_date: input.start_date,
      end_date: input.end_date,
      target_platforms: input.target_platforms,
      target_audience_description: input.target_audience_description ?? null,
      budget_naira: input.budget_naira ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  const campaign = data as Campaign;

  // seed one asset per property (content generated/attached later)
  const assets = input.property_ids.flatMap((pid) =>
    input.target_platforms.map((platform) => ({
      campaign_id: campaign.id,
      property_id: pid,
      platform,
    })),
  );
  if (assets.length > 0) {
    const { error: aErr } = await db.from('campaign_assets').insert(assets);
    if (aErr) throw aErr;
  }
  return campaign;
}

export async function listCampaigns(agencyId: string): Promise<Campaign[]> {
  const { data, error } = await getDb()
    .from('campaigns')
    .select('*')
    .eq('agency_id', agencyId)
    .is('deleted_at', null)
    .order('start_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Campaign[];
}

export async function listCampaignAssets(campaignId: string): Promise<CampaignAsset[]> {
  const { data, error } = await getDb()
    .from('campaign_assets')
    .select('*')
    .eq('campaign_id', campaignId);
  if (error) throw error;
  return (data ?? []) as CampaignAsset[];
}
