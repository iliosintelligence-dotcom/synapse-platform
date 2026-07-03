'use client';

/**
 * Protected dashboard layout — sidebar navigation, role-aware tabs,
 * session guard with loading state (no auth flash).
 */
import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { UserRole } from '@synapse/types';
import { useSessionStore } from '@synapse/auth';

type NavItem = { href: string; label: string; roles: UserRole[] };

const NAV: NavItem[] = [
  {
    href: '/overview',
    label: 'Overview',
    roles: [UserRole.AGENCY_OWNER, UserRole.AGENCY_ADMIN],
  },
  {
    href: '/listings',
    label: 'Listings',
    roles: [UserRole.AGENCY_OWNER, UserRole.AGENCY_ADMIN, UserRole.AGENT],
  },
  {
    href: '/leads',
    label: 'CRM · Leads',
    roles: [UserRole.AGENCY_OWNER, UserRole.AGENCY_ADMIN, UserRole.AGENT],
  },
  {
    href: '/social',
    label: 'Social studio',
    roles: [UserRole.AGENCY_OWNER, UserRole.AGENCY_ADMIN, UserRole.AGENT],
  },
  {
    href: '/marketing',
    label: 'Marketing',
    roles: [UserRole.AGENCY_OWNER, UserRole.AGENCY_ADMIN],
  },
  {
    href: '/subscription',
    label: 'Subscription',
    roles: [UserRole.AGENCY_OWNER],
  },
  {
    href: '/agents',
    label: 'Agents',
    roles: [UserRole.AGENCY_OWNER, UserRole.AGENCY_ADMIN],
  },
  {
    href: '/verification',
    label: 'Verification',
    roles: [UserRole.AGENCY_OWNER, UserRole.AGENCY_ADMIN],
  },
  { href: '/settings', label: 'Settings', roles: [UserRole.AGENCY_OWNER] },
];

// Build/test mode: skip the login wall and act as a demo agency owner.
// Set NEXT_PUBLIC_BYPASS_AUTH=false (or remove this) before launch.
const BYPASS_AUTH = process.env.NEXT_PUBLIC_BYPASS_AUTH !== 'false';
const DEMO_USER = {
  id: 'd0000000-0000-4000-8000-000000000001',
  email: 'demo@synapse.test',
  full_name: 'Synapse Demo (no sign-in)',
  role: UserRole.AGENCY_OWNER,
} as never;

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const status = useSessionStore((s) => s.status);
  const sessionUser = useSessionStore((s) => s.user);
  const signOut = useSessionStore((s) => s.signOut);
  const pathname = usePathname();
  const router = useRouter();

  const user = sessionUser ?? (BYPASS_AUTH ? DEMO_USER : null);

  useEffect(() => {
    if (!BYPASS_AUTH && status === 'signed_out') router.replace('/login');
  }, [status, router]);

  if (!user || (!BYPASS_AUTH && status !== 'signed_in')) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-canvas">
        <div className="h-2 w-2 rounded-full bg-accent animate-ping" />
      </main>
    );
  }

  const visibleNav = NAV.filter((item) => item.roles.includes(user.role));

  return (
    <div className="min-h-screen bg-canvas flex">
      <aside className="w-60 shrink-0 border-r border-glass-border bg-surface flex flex-col">
        <div className="px-6 py-6">
          <span className="font-display text-2xl tracking-widest">SYNAPSE</span>
          <p className="text-ink-dim text-xs mt-0.5">Agency dashboard</p>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {visibleNav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-inner px-4 py-2.5 text-sm transition-colors ${
                  active
                    ? 'bg-accent-soft text-accent font-semibold'
                    : 'text-ink-muted hover:text-ink hover:bg-canvas'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-6 py-5 border-t border-glass-border">
          <p className="text-sm font-medium truncate">{user.full_name || user.email}</p>
          <button onClick={() => void signOut()} className="text-xs text-ink-dim hover:text-accent mt-1">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-10">{children}</main>
    </div>
  );
}
