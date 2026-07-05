import type { ReactNode } from 'react';
import './consumer.css';

/**
 * Consumer route-group shell. Wraps every consumer page in `.consumer` so the
 * ported design system applies without touching the agency dashboard. This is
 * the foundation of the consumer→React merge; pages (dream, then landing,
 * browse, Toju, property) live under this group.
 */
export default function ConsumerLayout({ children }: { children: ReactNode }) {
  return <div className="consumer">{children}</div>;
}
