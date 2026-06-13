'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@synapse/api';
import { useSessionStore } from '@synapse/auth';

export default function LoginPage() {
  const router = useRouter();
  const resolve = useSessionStore((s) => s.resolve);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'otp'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.signInWithOtp(email.trim());
      setStage('otp');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send code');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await auth.verifyOtp(email.trim(), code.trim());
      await resolve();
      router.replace('/overview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm rounded-card bg-surface border border-glass-border shadow-depth-2 p-8">
        <h1 className="font-display text-3xl tracking-widest">SYNAPSE</h1>
        <p className="text-ink-muted text-sm mt-1 mb-8">Agency dashboard sign in</p>

        {stage === 'email' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
            className="space-y-4"
          >
            <input
              type="email"
              required
              placeholder="Work email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-inner border border-glass-border bg-canvas px-4 py-3 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-accent text-white font-semibold text-sm py-3 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
            className="space-y-4"
          >
            <input
              inputMode="numeric"
              required
              placeholder={`Code sent to ${email}`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-inner border border-glass-border bg-canvas px-4 py-3 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-accent text-white font-semibold text-sm py-3 disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
          </form>
        )}

        {error && <p className="text-accent text-xs mt-4">{error}</p>}
      </div>
    </main>
  );
}
