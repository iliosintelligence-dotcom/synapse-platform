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
