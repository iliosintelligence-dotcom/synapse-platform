'use client';

/**
 * Listings — agency inventory with verification status. Pending review /
 * verified / inactive. New Listing CTA. (Supporting screen.)
 *
 * Wiring note: swap MOCK_LISTINGS for `properties.listProperties({ agency_id })`.
 */
import Link from 'next/link';
import { useState } from 'react';

type Status = 'verified' | 'pending' | 'inactive';
type Listing = {
  id: string;
  title: string;
  city: string;
  price: string;
  status: Status;
  leads: number;
  image: string;
};

const MOCK_LISTINGS: Listing[] = [
  { id: 'p1', title: '3-Bed Apartment, Lekki Phase 1', city: 'Lekki', price: '₦165M', status: 'verified', leads: 6, image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&q=70' },
  { id: 'p2', title: '3-Bed Terrace, Ikate', city: 'Lekki', price: '₦148M', status: 'pending', leads: 1, image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&q=70' },
  { id: 'p3', title: '4-Bed Duplex, Osapa London', city: 'Lekki', price: '₦178M', status: 'verified', leads: 3, image: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&q=70' },
  { id: 'p4', title: '2-Bed Flat, Victoria Island', city: 'VI', price: '₦142M', status: 'inactive', leads: 0, image: 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=400&q=70' },
];

const STATUS_STYLE: Record<Status, { label: string; cls: string }> = {
  verified: { label: 'Verified', cls: 'bg-trust/10 text-trust border-trust/20' },
  pending: { label: 'Pending review', cls: 'bg-gold/10 text-gold border-gold/30' },
  inactive: { label: 'Inactive', cls: 'bg-canvas text-ink-dim border-glass-border' },
};

export default function ListingsPage() {
  const [rows] = useState<Listing[]>(MOCK_LISTINGS);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wider">LISTINGS</h1>
          <p className="text-ink-muted text-sm mt-2">Your inventory and its verification status.</p>
        </div>
        <Link
          href="/listings/new"
          className="rounded-full bg-accent text-white text-sm font-semibold px-5 py-2.5 hover:opacity-90 transition-opacity"
        >
          + New listing
        </Link>
      </div>

      <div className="mt-8 space-y-3">
        {rows.map((l) => {
          const st = STATUS_STYLE[l.status];
          return (
            <div
              key={l.id}
              className="rounded-card border border-glass-border bg-surface shadow-depth-1 p-4 flex items-center gap-5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.image} alt="" className="h-16 w-16 rounded-inner object-cover shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate">{l.title}</p>
                <p className="font-display text-xl text-accent tracking-wide">{l.price}</p>
                <span className={`inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full border ${st.cls}`}>
                  {st.label}
                </span>
              </div>
              <div className="text-right shrink-0">
                <p className="font-display text-2xl">{l.leads}</p>
                <p className="text-ink-dim text-xs">leads</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
