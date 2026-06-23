/**
 * api/hooks — TanStack Query wrappers. Every READ goes through these;
 * mutations call API functions directly and invalidate the relevant keys.
 * React + @tanstack/react-query are peer dependencies supplied by each app.
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  Agency,
  AgencyMember,
  CreateLeadInput,
  CreatePropertyInput,
  CreateViewingInput,
  Lead,
  Paginated,
  Profile,
  Property,
  PropertyFilters,
  PropertyWithMedia,
  SessionUser,
  TojuChatResponse,
  UpdateProfileInput,
  UpdatePropertyInput,
  Viewing,
} from '@synapse/types';
import { getSessionUser } from './auth';
import { getMyProfile, updateMyProfile } from './users';
import { getAgency, listMembers } from './agencies';
import {
  createProperty,
  getProperty,
  listProperties,
  listSavedProperties,
  saveProperty,
  unsaveProperty,
  updateProperty,
} from './properties';
import { createViewing, listMyViewings } from './viewings';
import { sendTojuMessage } from './toju';
import { createLead, listAgencyLeads, type CreateLeadResult } from './leads';
import { listPipelineLeads, moveLeadStage, assignLead, getLeadStageHistory } from './crm';
import { listAgencyDealRooms, getDealRoom, openDealRoom, closeDeal } from './dealRooms';
import { listLeadCommunications, logCommunication } from './communications';
import { listAgentTasks, listLeadTasks, createTask, setTaskStatus } from './tasks';
import { listAgencyActivity, listLeadActivity } from './activity';
import { listMyNotifications, unreadCount, markRead } from './notifications';
import { getAgencySnapshots } from './performance';
import {
  getAgencyTrustPublic,
  getAgencyTrustTimeline,
  getPropertyTrustSummary,
  getReputationTimeline,
} from './trust';
import { listPublishedReviews, submitReview, openDispute, listAgencyDisputes } from './reviews';
import { listDocuments, getVaultCompleteness } from './documents';
import { generateContent, listPropertyContent, approveContent, listCampaignSuggestions } from './content';
import { listSocialAccounts, listSocialPosts, listCampaigns, createCampaign } from './social';
import { getDiscoveryFeed, createReferral, getReferralSummary } from './distribution';
import type {
  ApproveContentInput,
  Campaign,
  CampaignSuggestion,
  CreateCampaignInput,
  CreateReferralInput,
  DiscoveryFeedRecord,
  DiscoveryFeedType,
  GenerateContentInput,
  GeneratedContent,
  Referral,
  ReferralSummary,
  SocialAccount,
  SocialPost,
} from '@synapse/types';
import type {
  AgencyTrustPublic,
  AgencyTrustScoreSnapshot,
  ConsumerReview,
  Dispute,
  DocumentEntityType,
  OpenDisputeInput,
  PropertyTrustSummary,
  ReputationTimeline,
  SubmitReviewInput,
  SynapseDocument,
  VaultCompleteness,
} from '@synapse/types';
import type {
  AgencyDailySnapshot,
  Activity,
  AssignLeadInput,
  CloseDealInput,
  Communication,
  CreateTaskInput,
  DealRoom,
  LeadStageHistory,
  LogCommunicationInput,
  MoveLeadStageInput,
  Notification,
  OpenDealRoomInput,
  PipelineLead,
  Task,
  TaskStatus,
} from '@synapse/types';

/** Centralised query keys — never write string keys inline. */
export const queryKeys = {
  session: ['session'] as const,
  profile: ['profile'] as const,
  agency: (id: string) => ['agency', id] as const,
  agencyMembers: (id: string) => ['agency', id, 'members'] as const,
  properties: (filters: PropertyFilters) => ['properties', filters] as const,
  property: (id: string) => ['property', id] as const,
  saved: ['saved-properties'] as const,
  viewings: ['viewings'] as const,
  agencyLeads: (id: string) => ['leads', id] as const,
  pipeline: (agencyId: string) => ['pipeline', agencyId] as const,
  stageHistory: (leadId: string) => ['stage-history', leadId] as const,
  dealRooms: (agencyId: string) => ['deal-rooms', agencyId] as const,
  dealRoom: (id: string) => ['deal-room', id] as const,
  leadComms: (leadId: string) => ['communications', leadId] as const,
  agentTasks: (agentId: string) => ['tasks', 'agent', agentId] as const,
  leadTasks: (leadId: string) => ['tasks', 'lead', leadId] as const,
  agencyActivity: (agencyId: string) => ['activity', agencyId] as const,
  leadActivity: (leadId: string) => ['activity', 'lead', leadId] as const,
  myNotifications: ['notifications', 'me'] as const,
  unreadCount: ['notifications', 'unread'] as const,
  agencySnapshots: (agencyId: string) => ['snapshots', 'agency', agencyId] as const,
  agencyTrust: (agencyId: string) => ['trust', 'agency', agencyId] as const,
  agencyTrustTimeline: (agencyId: string) => ['trust', 'agency', agencyId, 'timeline'] as const,
  propertyTrust: (propertyId: string) => ['trust', 'property', propertyId] as const,
  reputationTimeline: (t: string, id: string) => ['reputation', t, id] as const,
  reviews: (t: string, id: string) => ['reviews', t, id] as const,
  agencyDisputes: (agencyId: string) => ['disputes', 'agency', agencyId] as const,
  vaultDocs: (id: string) => ['documents', id] as const,
  vault: (dealRoomId: string) => ['vault', dealRoomId] as const,
  propertyContent: (propertyId: string) => ['content', propertyId] as const,
  campaignSuggestions: (agencyId: string) => ['campaign-suggestions', agencyId] as const,
  socialAccounts: (agencyId: string) => ['social-accounts', agencyId] as const,
  socialPosts: (agencyId: string) => ['social-posts', agencyId] as const,
  campaigns: (agencyId: string) => ['campaigns', agencyId] as const,
  discoveryFeed: (feed: string, date: string) => ['discovery', feed, date] as const,
  referralSummary: ['referral-summary'] as const,
};

/* ───────── session + profile ───────── */

export function useSessionUser(): UseQueryResult<SessionUser | null> {
  return useQuery({ queryKey: queryKeys.session, queryFn: getSessionUser });
}

export function useProfile(): UseQueryResult<Profile> {
  return useQuery({ queryKey: queryKeys.profile, queryFn: getMyProfile });
}

export function useUpdateProfile(): UseMutationResult<Profile, Error, UpdateProfileInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateMyProfile,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.profile });
      void qc.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
}

/* ───────── agencies ───────── */

export function useAgency(agencyId: string | null): UseQueryResult<Agency> {
  return useQuery({
    queryKey: queryKeys.agency(agencyId ?? 'none'),
    queryFn: () => getAgency(agencyId as string),
    enabled: agencyId !== null,
  });
}

export function useAgencyMembers(agencyId: string | null): UseQueryResult<AgencyMember[]> {
  return useQuery({
    queryKey: queryKeys.agencyMembers(agencyId ?? 'none'),
    queryFn: () => listMembers(agencyId as string),
    enabled: agencyId !== null,
  });
}

/* ───────── properties ───────── */

export function useProperties(
  filters: PropertyFilters = {},
): UseQueryResult<Paginated<PropertyWithMedia>> {
  return useQuery({
    queryKey: queryKeys.properties(filters),
    queryFn: () => listProperties(filters),
  });
}

export function useProperty(id: string | null): UseQueryResult<PropertyWithMedia> {
  return useQuery({
    queryKey: queryKeys.property(id ?? 'none'),
    queryFn: () => getProperty(id as string),
    enabled: id !== null,
  });
}

export function useCreateProperty(): UseMutationResult<Property, Error, CreatePropertyInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProperty,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['properties'] }),
  });
}

export function useUpdateProperty(
  id: string,
): UseMutationResult<Property, Error, UpdatePropertyInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePropertyInput) => updateProperty(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.property(id) });
      void qc.invalidateQueries({ queryKey: ['properties'] });
    },
  });
}

/* ───────── saved ───────── */

export function useSavedProperties(): UseQueryResult<PropertyWithMedia[]> {
  return useQuery({ queryKey: queryKeys.saved, queryFn: listSavedProperties });
}

export function useToggleSave(): UseMutationResult<
  void,
  Error,
  { propertyId: string; saved: boolean }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, saved }) =>
      saved ? unsaveProperty(propertyId) : saveProperty(propertyId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.saved }),
  });
}

/* ───────── viewings ───────── */

export function useViewings(): UseQueryResult<Viewing[]> {
  return useQuery({ queryKey: queryKeys.viewings, queryFn: listMyViewings });
}

export function useCreateViewing(): UseMutationResult<Viewing, Error, CreateViewingInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createViewing,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.viewings }),
  });
}

/* ───────── toju chat ───────── */

/** Send a message to Toju. History/session is managed server-side. */
export function useSendTojuMessage(): UseMutationResult<
  TojuChatResponse,
  Error,
  { message: string; sessionId?: string }
> {
  return useMutation({
    mutationFn: ({ message, sessionId }) => sendTojuMessage(message, sessionId),
  });
}

/* ───────── leads (the bridge) ───────── */

/** Agency leads, reverse-chronological. Pair with subscribeToAgencyLeads. */
export function useAgencyLeads(agencyId: string | null): UseQueryResult<Lead[]> {
  return useQuery({
    queryKey: queryKeys.agencyLeads(agencyId ?? 'none'),
    queryFn: () => listAgencyLeads(agencyId as string),
    enabled: agencyId !== null,
  });
}

/** Trigger the lead bridge. Resolves even on delivery failure (lead persisted). */
export function useCreateLead(): UseMutationResult<CreateLeadResult, Error, CreateLeadInput> {
  return useMutation({ mutationFn: createLead });
}

/* ───────── Layer 2: pipeline ───────── */

export function usePipeline(agencyId: string | null): UseQueryResult<PipelineLead[]> {
  return useQuery({
    queryKey: queryKeys.pipeline(agencyId ?? 'none'),
    queryFn: () => listPipelineLeads(agencyId as string),
    enabled: agencyId !== null,
  });
}

export function useMoveLeadStage(agencyId: string): UseMutationResult<void, Error, MoveLeadStageInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: moveLeadStage,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.pipeline(agencyId) }),
  });
}

export function useAssignLead(agencyId: string): UseMutationResult<unknown, Error, AssignLeadInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: assignLead,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.pipeline(agencyId) }),
  });
}

export function useStageHistory(leadId: string | null): UseQueryResult<LeadStageHistory[]> {
  return useQuery({
    queryKey: queryKeys.stageHistory(leadId ?? 'none'),
    queryFn: () => getLeadStageHistory(leadId as string),
    enabled: leadId !== null,
  });
}

/* ───────── Layer 2: deal rooms ───────── */

export function useDealRooms(agencyId: string | null): UseQueryResult<DealRoom[]> {
  return useQuery({
    queryKey: queryKeys.dealRooms(agencyId ?? 'none'),
    queryFn: () => listAgencyDealRooms(agencyId as string),
    enabled: agencyId !== null,
  });
}

export function useDealRoom(id: string | null): UseQueryResult<DealRoom> {
  return useQuery({
    queryKey: queryKeys.dealRoom(id ?? 'none'),
    queryFn: () => getDealRoom(id as string),
    enabled: id !== null,
  });
}

export function useOpenDealRoom(): UseMutationResult<DealRoom, Error, OpenDealRoomInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: openDealRoom,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['deal-rooms'] }),
  });
}

export function useCloseDeal(): UseMutationResult<DealRoom, Error, CloseDealInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closeDeal,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['deal-rooms'] }),
  });
}

/* ───────── Layer 2: communications ───────── */

export function useLeadCommunications(leadId: string | null): UseQueryResult<Communication[]> {
  return useQuery({
    queryKey: queryKeys.leadComms(leadId ?? 'none'),
    queryFn: () => listLeadCommunications(leadId as string),
    enabled: leadId !== null,
  });
}

export function useLogCommunication(leadId: string): UseMutationResult<
  Communication,
  Error,
  LogCommunicationInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logCommunication,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.leadComms(leadId) }),
  });
}

/* ───────── Layer 2: tasks ───────── */

export function useAgentTasks(agentId: string | null): UseQueryResult<Task[]> {
  return useQuery({
    queryKey: queryKeys.agentTasks(agentId ?? 'none'),
    queryFn: () => listAgentTasks(agentId as string),
    enabled: agentId !== null,
  });
}

export function useLeadTasks(leadId: string | null): UseQueryResult<Task[]> {
  return useQuery({
    queryKey: queryKeys.leadTasks(leadId ?? 'none'),
    queryFn: () => listLeadTasks(leadId as string),
    enabled: leadId !== null,
  });
}

export function useCreateTask(): UseMutationResult<Task, Error, CreateTaskInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTask,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useSetTaskStatus(): UseMutationResult<
  Task,
  Error,
  { taskId: string; status: TaskStatus }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, status }) => setTaskStatus(taskId, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

/* ───────── Layer 2: activity + notifications + performance ───────── */

export function useAgencyActivity(agencyId: string | null): UseQueryResult<Activity[]> {
  return useQuery({
    queryKey: queryKeys.agencyActivity(agencyId ?? 'none'),
    queryFn: () => listAgencyActivity(agencyId as string),
    enabled: agencyId !== null,
  });
}

export function useLeadActivity(leadId: string | null): UseQueryResult<Activity[]> {
  return useQuery({
    queryKey: queryKeys.leadActivity(leadId ?? 'none'),
    queryFn: () => listLeadActivity(leadId as string),
    enabled: leadId !== null,
  });
}

export function useMyNotifications(): UseQueryResult<Notification[]> {
  return useQuery({ queryKey: queryKeys.myNotifications, queryFn: () => listMyNotifications() });
}

export function useUnreadCount(): UseQueryResult<number> {
  return useQuery({ queryKey: queryKeys.unreadCount, queryFn: unreadCount });
}

export function useMarkNotificationRead(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markRead,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.myNotifications });
      void qc.invalidateQueries({ queryKey: queryKeys.unreadCount });
    },
  });
}

export function useAgencySnapshots(
  agencyId: string | null,
  fromDate: string,
  toDate: string,
): UseQueryResult<AgencyDailySnapshot[]> {
  return useQuery({
    queryKey: [...queryKeys.agencySnapshots(agencyId ?? 'none'), fromDate, toDate],
    queryFn: () => getAgencySnapshots(agencyId as string, fromDate, toDate),
    enabled: agencyId !== null,
  });
}

/* ───────── Layer 4: trust + reputation ───────── */

export function useAgencyTrust(agencyId: string | null): UseQueryResult<AgencyTrustPublic> {
  return useQuery({
    queryKey: queryKeys.agencyTrust(agencyId ?? 'none'),
    queryFn: () => getAgencyTrustPublic(agencyId as string),
    enabled: agencyId !== null,
  });
}

export function useAgencyTrustTimeline(
  agencyId: string | null,
  fromDate: string,
): UseQueryResult<AgencyTrustScoreSnapshot[]> {
  return useQuery({
    queryKey: [...queryKeys.agencyTrustTimeline(agencyId ?? 'none'), fromDate],
    queryFn: () => getAgencyTrustTimeline(agencyId as string, fromDate),
    enabled: agencyId !== null,
  });
}

export function usePropertyTrust(propertyId: string | null): UseQueryResult<PropertyTrustSummary> {
  return useQuery({
    queryKey: queryKeys.propertyTrust(propertyId ?? 'none'),
    queryFn: () => getPropertyTrustSummary(propertyId as string),
    enabled: propertyId !== null,
  });
}

export function useReputationTimeline(
  entityType: 'agency' | 'agent',
  entityId: string | null,
): UseQueryResult<ReputationTimeline[]> {
  return useQuery({
    queryKey: queryKeys.reputationTimeline(entityType, entityId ?? 'none'),
    queryFn: () => getReputationTimeline(entityType, entityId as string),
    enabled: entityId !== null,
  });
}

export function useReviews(
  entityType: 'agency' | 'agent',
  entityId: string | null,
): UseQueryResult<ConsumerReview[]> {
  return useQuery({
    queryKey: queryKeys.reviews(entityType, entityId ?? 'none'),
    queryFn: () => listPublishedReviews(entityType, entityId as string),
    enabled: entityId !== null,
  });
}

export function useSubmitReview(): UseMutationResult<ConsumerReview, Error, SubmitReviewInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitReview,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['reviews'] }),
  });
}

export function useOpenDispute(): UseMutationResult<Dispute, Error, OpenDisputeInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: openDispute,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['disputes'] }),
  });
}

export function useAgencyDisputes(agencyId: string | null): UseQueryResult<Dispute[]> {
  return useQuery({
    queryKey: queryKeys.agencyDisputes(agencyId ?? 'none'),
    queryFn: () => listAgencyDisputes(agencyId as string),
    enabled: agencyId !== null,
  });
}

/* ───────── Layer 4: document vault ───────── */

export function useDocuments(
  entityType: DocumentEntityType,
  entityId: string | null,
): UseQueryResult<SynapseDocument[]> {
  return useQuery({
    queryKey: queryKeys.vaultDocs(entityId ?? 'none'),
    queryFn: () => listDocuments(entityType, entityId as string),
    enabled: entityId !== null,
  });
}

export function useVaultCompleteness(dealRoomId: string | null): UseQueryResult<VaultCompleteness> {
  return useQuery({
    queryKey: queryKeys.vault(dealRoomId ?? 'none'),
    queryFn: () => getVaultCompleteness(dealRoomId as string),
    enabled: dealRoomId !== null,
  });
}

/* ───────── Layer 5: content + social + campaigns ───────── */

export function usePropertyContent(propertyId: string | null): UseQueryResult<GeneratedContent[]> {
  return useQuery({
    queryKey: queryKeys.propertyContent(propertyId ?? 'none'),
    queryFn: () => listPropertyContent(propertyId as string),
    enabled: propertyId !== null,
  });
}

export function useGenerateContent(): UseMutationResult<GeneratedContent, Error, GenerateContentInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: generateContent,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['content'] }),
  });
}

export function useApproveContent(): UseMutationResult<GeneratedContent, Error, ApproveContentInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: approveContent,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['content'] }),
  });
}

export function useCampaignSuggestions(agencyId: string | null): UseQueryResult<CampaignSuggestion[]> {
  return useQuery({
    queryKey: queryKeys.campaignSuggestions(agencyId ?? 'none'),
    queryFn: () => listCampaignSuggestions(agencyId as string),
    enabled: agencyId !== null,
  });
}

export function useSocialAccounts(agencyId: string | null): UseQueryResult<SocialAccount[]> {
  return useQuery({
    queryKey: queryKeys.socialAccounts(agencyId ?? 'none'),
    queryFn: () => listSocialAccounts(agencyId as string),
    enabled: agencyId !== null,
  });
}

export function useSocialPosts(agencyId: string | null): UseQueryResult<SocialPost[]> {
  return useQuery({
    queryKey: queryKeys.socialPosts(agencyId ?? 'none'),
    queryFn: () => listSocialPosts(agencyId as string),
    enabled: agencyId !== null,
  });
}

export function useCampaigns(agencyId: string | null): UseQueryResult<Campaign[]> {
  return useQuery({
    queryKey: queryKeys.campaigns(agencyId ?? 'none'),
    queryFn: () => listCampaigns(agencyId as string),
    enabled: agencyId !== null,
  });
}

export function useCreateCampaign(): UseMutationResult<Campaign, Error, CreateCampaignInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCampaign,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

/* ───────── Layer 5: discovery + referrals ───────── */

export function useDiscoveryFeed(
  feedType: DiscoveryFeedType,
  date: string,
): UseQueryResult<DiscoveryFeedRecord[]> {
  return useQuery({
    queryKey: queryKeys.discoveryFeed(feedType, date),
    queryFn: () => getDiscoveryFeed(feedType, date),
  });
}

export function useReferralSummary(): UseQueryResult<ReferralSummary> {
  return useQuery({ queryKey: queryKeys.referralSummary, queryFn: getReferralSummary });
}

export function useCreateReferral(): UseMutationResult<Referral, Error, CreateReferralInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createReferral,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.referralSummary }),
  });
}
