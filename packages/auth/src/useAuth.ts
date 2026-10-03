/**
 * useAuth — the one hook screens use for session state and auth actions.
 */
import { useSessionStore, type SessionStatus } from './store';
import { auth as authApi } from '@synapse/api';
import { hasPermission, type Permission, type SessionUser, type UserRole } from '@synapse/types';

export interface UseAuthResult {
  status: SessionStatus;
  user: SessionUser | null;
  isSignedIn: boolean;
  /** Client-side affordance check only — RLS is the security boundary. */
  can: (permission: Permission) => boolean;
  role: UserRole | null;
  signInWithOtp: typeof authApi.signInWithOtp;
  verifyOtp: typeof authApi.verifyOtp;
  signUpConsumer: typeof authApi.signUpConsumer;
  signUpAgency: typeof authApi.signUpAgency;
  signInWithGoogle: typeof authApi.signInWithGoogle;
  signInWithApple: typeof authApi.signInWithApple;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const status = useSessionStore((s) => s.status);
  const user = useSessionStore((s) => s.user);
  const signOut = useSessionStore((s) => s.signOut);

  return {
    status,
    user,
    isSignedIn: status === 'signed_in',
    can: (permission) => (user ? hasPermission(user.role, permission) : false),
    role: user?.role ?? null,
    signInWithOtp: authApi.signInWithOtp,
    verifyOtp: authApi.verifyOtp,
    signUpConsumer: authApi.signUpConsumer,
    signUpAgency: authApi.signUpAgency,
    signInWithGoogle: authApi.signInWithGoogle,
    signInWithApple: authApi.signInWithApple,
    signOut,
  };
}
