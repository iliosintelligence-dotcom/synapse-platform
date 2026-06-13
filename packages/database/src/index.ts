/**
 * @synapse/database — Supabase client factory.
 * Both apps create exactly one client through here; nothing else in the
 * codebase imports @supabase/supabase-js directly.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type { SupabaseClient };

export interface DatabaseConfig {
  url: string;
  anonKey: string;
  /**
   * Platform-specific storage for session persistence.
   * Mobile passes an MMKV adapter; web uses the default (localStorage).
   */
  storage?: {
    getItem: (key: string) => string | null | Promise<string | null>;
    setItem: (key: string, value: string) => void | Promise<void>;
    removeItem: (key: string) => void | Promise<void>;
  };
}

let client: SupabaseClient | null = null;

/** Initialise the shared client. Call once at app boot. */
export function initDatabase(config: DatabaseConfig): SupabaseClient {
  client = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      ...(config.storage ? { storage: config.storage } : {}),
    },
  });
  return client;
}

/** Get the initialised client. Throws if initDatabase was never called. */
export function getDb(): SupabaseClient {
  if (!client) {
    throw new Error(
      '@synapse/database: initDatabase() must be called at app boot before any data access.',
    );
  }
  return client;
}
