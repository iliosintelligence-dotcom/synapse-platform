'use client';

/**
 * Client providers — initialise Supabase once, install TanStack Query,
 * and resolve the session before rendering protected layouts.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initDatabase } from '@synapse/database';
import { initMedia } from '@synapse/api';
import { bindAuthEvents, useSessionStore } from '@synapse/auth';

let booted = false;
function boot(): void {
  if (booted) return;
  booted = true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Fail loudly in dev; production builds must have env configured.
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
    return;
  }
  initDatabase({ url, anonKey });

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  if (cloudName && uploadPreset) initMedia({ cloudName, uploadPreset });
}

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  const resolve = useSessionStore((s) => s.resolve);

  useEffect(() => {
    boot();
    const unbind = bindAuthEvents();
    void resolve();
    return unbind;
  }, [resolve]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
