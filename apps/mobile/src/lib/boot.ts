/**
 * App boot — wire platform services exactly once.
 * MMKV-backed storage for both Supabase session and Zustand persistence.
 */
import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { initDatabase } from '@synapse/database';
import { initMedia } from '@synapse/api';
import { setSessionStorage } from '@synapse/auth';

/* THE SESSION IS ENCRYPTED AT REST (Greptile audit). The store used to be a
   plain MMKV file holding Supabase's access and refresh tokens, readable by
   anyone who could read the app's storage (a backup, a rooted device). It is
   now encrypted with a random key that lives only in the platform's secure
   store (iOS Keychain / Android Keystore) and is made on first launch.

   The old unencrypted store is wiped the first time this runs, so anyone
   signed in under the old build signs in again once. */
const KEY_NAME = 'synapse_mmkv_key_v1';

function storageKey(): string {
  let key = SecureStore.getItem(KEY_NAME);
  if (!key) {
    key = Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
    SecureStore.setItem(KEY_NAME, key);
  }
  return key;
}

new MMKV({ id: 'synapse' }).clearAll();            // the old, unencrypted store
const mmkv = new MMKV({ id: 'synapse-secure', encryptionKey: storageKey() });

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
