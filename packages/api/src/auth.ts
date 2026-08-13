/**
 * api/auth — Supabase Auth flows. Email OTP, Google OAuth, Apple Sign-In.
 * Signup metadata drives the profile-creation trigger (role, full_name).
 */
import { getDb } from '@synapse/database';
import {
  UserRole,
  isAgencyRole,
  type SessionUser,
  type SignUpAgencyInput,
  type SignUpConsumerInput,
} from '@synapse/types';

/** Send a one-time passcode. Creates the user on first sign-in. */
export async function signInWithOtp(
  email: string,
  meta?: { role: UserRole; full_name: string; agency_name?: string; city?: string },
): Promise<void> {
  const { error } = await getDb().auth.signInWithOtp({
    email,
    options: meta
      ? {
          data: {
            role: meta.role,
            full_name: meta.full_name,
            // Read by the handle_new_user trigger (migration 0039) to name
            // the agency it provisions for agency_owner signups.
            ...(meta.agency_name ? { agency_name: meta.agency_name } : {}),
            ...(meta.city ? { city: meta.city } : {}),
          },
        }
      : undefined,
  });
  if (error) throw error;
}

export async function verifyOtp(email: string, token: string): Promise<void> {
  const { error } = await getDb().auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function signUpConsumer(input: SignUpConsumerInput): Promise<void> {
  await signInWithOtp(input.email, { role: UserRole.CONSUMER, full_name: input.full_name });
}

/**
 * Agency signup: OTP with owner role + agency metadata. The agencies row and
 * the owner's agency_members row are provisioned by the handle_new_user
 * trigger (migration 0039) in the same transaction as the profile — the
 * client must NOT create them itself. RLS makes client-side membership
 * creation impossible anyway (a new owner has no membership, so it can never
 * pass agency_members_manage_admin), and any client-sequenced step can be
 * abandoned mid-flow, stranding a half-provisioned account.
 */
export async function signUpAgency(input: SignUpAgencyInput): Promise<void> {
  await signInWithOtp(input.email, {
    role: UserRole.AGENCY_OWNER,
    full_name: input.full_name,
    agency_name: input.agency_name,
    city: input.city,
  });
}

export async function signInWithGoogle(redirectTo?: string): Promise<void> {
  const { error } = await getDb().auth.signInWithOAuth({
    provider: 'google',
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw error;
}

export async function signInWithApple(redirectTo?: string): Promise<void> {
  const { error } = await getDb().auth.signInWithOAuth({
    provider: 'apple',
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await getDb().auth.signOut();
  if (error) throw error;
}

/**
 * Resolve the full session user: auth identity + profile row + agency
 * membership. Returns null when signed out.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const db = getDb();
  const { data: authData } = await db.auth.getUser();
  const user = authData.user;
  if (!user) return null;

  const { data: profile, error } = await db
    .from('profiles')
    .select('role, full_name, avatar_url')
    .eq('id', user.id)
    .single();
  if (error || !profile) return null;

  const role = profile.role as UserRole;
  let agencyId: string | null = null;

  if (isAgencyRole(role)) {
    const { data: membership } = await db
      .from('agency_members')
      .select('agency_id')
      .eq('profile_id', user.id)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    agencyId = membership?.agency_id ?? null;
  }

  return {
    id: user.id,
    email: user.email ?? null,
    role,
    full_name: profile.full_name as string,
    avatar_url: (profile.avatar_url as string | null) ?? null,
    agency_id: agencyId,
  };
}

/** Subscribe to auth state changes. Returns an unsubscribe function. */
export function onAuthStateChange(callback: (signedIn: boolean) => void): () => void {
  const { data } = getDb().auth.onAuthStateChange((_event, session) => {
    callback(session !== null);
  });
  return () => data.subscription.unsubscribe();
}
