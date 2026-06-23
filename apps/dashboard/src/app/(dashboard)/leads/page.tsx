'use client';

/**
 * Agency Leads — the agency's reason to care, and the proof leads arrive.
 * A live, reverse-chronological list: consumer name, property, source,
 * budget, timestamp. One action per lead — message on WhatsApp. No pipeline,
 * no stages (that's Layer 2). The sophistication is in lead quality, not UI.
 * (Defining screen 3/3.)
 *
 * Wiring note: this renders mock leads for the defining-screen build. To go
 * live, replace MOCK_LEADS with `leads.listAgencyLeads(agencyId)` and add
 * `leads.subscribeToAgencyLeads(agencyId, prependLead)` in an effect — the
 * realtime row simply unshifts into `rows`.
 */
import { useState } from 'react';

type LeadRow = {
  id: string;
  name: string;
  phone: string;
  property: string;
  source: 'Toju' | 'Browse' | 'Contact';
  budget: string;
  minsAgo: number;
  failed?: boolean;
};

const MOCK_LEADS: LeadRow[] = [
  { id: 'l1', name: 'Bola Adeyemi', phone: '+234 803 555 0142', property: '3-Bed Apartment, Lekki Phase 1', source: 'Toju', budget: '₦150–180M', minsAgo: 2 },
  { id: 'l2', name: 'Chidi Okafor', phone: '+234 701 555 0199', property: '3-Bed Terrace, Ikate', source: 'Contact', budget: '₦120–150M', minsAgo: 24 },
  { id: 'l3', name: 'Amina Yusuf', phone: '+234 814 555 0177', property: '3-Bed Apartment, Lekki Phase 1', source: 'Browse', budget: '₦140–170M', minsAgo: 96 },
  { id: 'l4', name: 'Tunde Bakare', phone: '+234 802 555 0118', property: '3-Bed Terrace, Ikate', source: 'Toju', budget: '₦130–160M', minsAgo: 310, failed: true },
];

const SOURCE_STYLE: Record<LeadRow['source'], string> = {
  Toju: 'bg-accent-soft text-accent border-accent/20',
  Browse: 'bg-canvas text-ink-muted border-glass-border',
  Contact: 'bg-trust/10 text-trust border-trust/20',
};

function timeAgo(mins: number): string {
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function waLink(phone: string, property: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  const text = encodeURIComponent(`Hello, thank you for your interest in ${property} via Synapse.`);
  return `https://wa.me/${digits}?text=${text}`;
}

export default function LeadsPage() {
  const [rows] = useState<LeadRow[]>(MOCK_LEADS);

  return (
    <div>
      <h1 className="font-display text-4xl tracking-wider">LEADS</h1>
      <p className="text-ink-muted text-sm mt-2">
        Every inquiry that touches Synapse — newest first, in real time.
      </p>

      <div className="mt-8 space-y-3">
        {rows.map((lead) => (
          <div
            key={lead.id}
            className="rounded-card border border-glass-border bg-surface shadow-depth-1 p-5 flex items-center gap-5"
          >
            <div className="h-11 w-11 shrink-0 rounded-full bg-accent-soft border border-accent/20 flex items-center justify-center">
              <span className="text-accent font-semibold text-sm">
                {lead.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate">{lead.name}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${SOURCE_STYLE[lead.source]}`}>
                  {lead.source}
                </span>
                {lead.failed && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-gold/40 text-gold bg-gold/10">
                    ⚠ Delivery failed
                  </span>
                )}
              </div>
              <p className="text-ink-muted text-xs mt-0.5 truncate">{lead.property}</p>
              <p className="text-ink-dim text-xs mt-0.5">
                {lead.phone} · budget {lead.budget}
              </p>
            </div>

            <span className="text-ink-dim text-xs shrink-0">{timeAgo(lead.minsAgo)}</span>

            <a
              href={waLink(lead.phone, lead.property)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-full bg-accent text-white text-sm font-semibold px-4 py-2 hover:opacity-90 transition-opacity"
            >
              WhatsApp
            </a>
          </div>
        ))}

        {rows.length === 0 && (
          <div className="rounded-card border border-glass-border bg-surface shadow-depth-1 p-10 text-ink-dim text-sm text-center">
            No leads yet. They'll appear here the moment a buyer shows interest.
          </div>
        )}
      </div>
    </div>
  );
}
