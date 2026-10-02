/**
 * Session store — Zustand. The single source of session truth for UI.
 * Persistence is pluggable: mobile passes an MMKV adapter, web relies on
 * Supabase's own localStorage persistence (store stays in-memory).
 *
 * `status` starts as 'resolving' so route guards can hold a loading state —
 * no auth flash, ever.
 */
import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { auth as authApi } from '@synapse/api';
import { isAgencyRole, type SessionUser } from '@synapse/types';

export type SessionStatus = 'resolving' | 'signed_out' | 'signed_in';

export interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /** Re-resolve the session from Supabase (e.g. on boot or auth event) */
  resolve: () => Promise<void>;
  signOut: () => Promise<void>;
}

let storage: StateStorage | undefined;

/**
 * Install a persistence backend BEFORE the store is first used.
 * Mobile: an MMKV-backed StateStorage. Web: leave unset.
 */
export function setSessionStorage(s: StateStorage): void {
  storage = s;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      status: 'resolving',
      user: null,

      resolve: async () => {
        try {
          const user = await authApi.getSessionUser();
          set(user ? { status: 'signed_in', user } : { status: 'signed_out', user: null });
        } catch {
          set({ status: 'signed_out', user: null });
        }
      },

      signOut: async () => {
        await authApi.signOut();
        set({ status: 'signed_out', user: null });
      },
    }),
    {
      name: 'synapse-session',
      // Persist the user snapshot only; status always re-resolves on boot.
      partialize: (state) => ({ user: state.user }),
      storage: createJSONStorage(() => storage ?? noopStorage),
    },
  ),
);

/** In-memory fallback when no platform storage is installed (web/SSR). */
const memory = new Map<string, string>();
const noopStorage: StateStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

/** Wire Supabase auth events to the store. Call once at app boot. */
export function bindAuthEvents(): () => void {
  return authApi.onAuthStateChange(() => {
    void useSessionStore.getState().resolve();
  });
}

/** Where should this user land? Role-aware entry routing. */
export function homeRouteFor(user: SessionUser | null): string {
  if (!user) return '/(auth)/landing';
  return isAgencyRole(user.role) ? '/(agency)/dashboard' : '/(consumer)/home';
}
