/**
 * App boot — wire platform services exactly once.
 * MMKV-backed storage for both Supabase session and Zustand persistence.
 */
import { MMKV } from 'react-native-mmkv';
import { initDatabase } from '@synapse/database';
import { initMedia } from '@synapse/api';
import { setSessionStorage } from '@synapse/auth';

const mmkv = new MMKV({ id: 'synapse' });

const mmkvStorage = {
  getItem: (key: string): string | null => mmkv.getString(key) ?? null,
  setItem: (key: string, value: string): void => mmkv.set(key, value),
  removeItem: (key: string): void => mmkv.delete(key),
};

let booted = false;

export function bootApp(): void {
  if (booted) return;
  booted = true;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env',
    );
  }

  initDatabase({ url, anonKey, storage: mmkvStorage });
  setSessionStorage(mmkvStorage);

  const cloudName = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  if (cloudName && uploadPreset) {
    initMedia({ cloudName, uploadPreset });
  }
}
