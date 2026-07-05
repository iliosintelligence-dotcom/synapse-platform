import Link from 'next/link';

/** Shared consumer top bar — ported from the prototype's .appbar. */
export function ConsumerNav({ active }: { active?: 'toju' | 'browse' | 'dream' }) {
  return (
    <div className="appbar">
      <Link className="brand" href="/toju">
        <svg viewBox="0 0 64 78" fill="#15171a" aria-hidden>
          <rect x="0" y="0" width="10" height="78" rx="1" />
          <rect x="10" y="0" width="44" height="10" rx="1" />
          <rect x="44" y="10" width="10" height="17" rx="1" />
          <rect x="10" y="17" width="44" height="10" rx="1" />
          <rect x="10" y="36" width="44" height="10" rx="1" />
          <rect x="46" y="46" width="8" height="22" rx="1" />
          <rect x="18" y="46" width="8" height="22" rx="1" />
          <rect x="10" y="68" width="44" height="10" rx="1" />
        </svg>
        Synapse
      </Link>
      <nav>
        <Link href="/toju" className={active === 'toju' ? 'active' : ''}>Toju</Link>
        <Link href="/browse" className={active === 'browse' ? 'active' : ''}>Your matches</Link>
        <Link href="/dream" className={active === 'dream' ? 'active' : ''}>Dream Home</Link>
      </nav>
      <span className="spacer" />
      <a className="home" href="/overview">Agency portal →</a>
    </div>
  );
}
