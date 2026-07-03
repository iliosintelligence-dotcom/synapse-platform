'use client';

/**
 * Marketing — campaigns that target active Toju briefs, plus the Gold-only
 * proximity marketing panel (geofenced alerts to matched, opted-in buyers).
 * Demo data mirrors campaigns / geofences / proximity_events tables.
 */
import { useState } from 'react';

const CAMPAIGNS = [
  { icon: '🎯', name: 'Lekki family buyers · ₦120–180M', detail: 'Matched to 214 active Toju briefs · Instagram + in-app', kpi: 38, kpiLabel: 'leads', status: 'live' },
  { icon: '📣', name: 'Diaspora investors — verified title only', detail: 'UK/Canada audiences · landing on trust report', kpi: 21, kpiLabel: 'leads', status: 'live' },
  { icon: '⚡', name: 'Open house — Osapa duplex', detail: 'This weekend · WhatsApp Status + proximity alerts', kpi: 64, kpiLabel: 'RSVPs', status: 'live' },
  { icon: '🌙', name: 'VI short-let investors', detail: 'Paused — awaiting new inventory', kpi: 12, kpiLabel: 'leads', status: 'paused' },
];

const GEOFENCES = [
  { name: '3-Bed Apartment, Lekki Phase 1', radius: '400m', matched: 12, walkins: 5, alerts: 9, leads: 3, active: true },
  { name: '4-Bed Duplex, Osapa London', radius: '600m', matched: 8, walkins: 2, alerts: 4, leads: 2, active: true },
  { name: 'Open house — Sat 11 AM (Ikate)', radius: '1km · Sat only', matched: 31, walkins: 0, alerts: 0, leads: 0, active: false },
];

export default function MarketingPage() {
  const [fences, setFences] = useState(GEOFENCES);

  return (
    <div className="max-w-[1000px]">
      <p className="text-accent text-[11px] font-bold uppercase tracking-[0.16em]">Campaigns</p>
      <h1 className="font-display text-4xl mt-1">Marketing</h1>
      <p className="text-ink-muted text-sm mt-1">Boost verified listings to the buyers Toju says are looking for exactly that.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['3', 'Active campaigns'], ['86k', 'Reach this month'], ['412', 'Clicks to listings'], ['₦96', 'Cost per lead']].map(([v, l]) => (
          <div key={l} className="rounded-inner border border-glass-border bg-surface/70 px-4 py-3 shadow-depth-1">
            <p className="font-display text-2xl text-accent">{v}</p>
            <p className="text-ink-dim text-[11px] mt-0.5">{l}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-2.5">
        {CAMPAIGNS.map((c) => (
          <div key={c.name} className={`flex items-center gap-4 rounded-inner border border-glass-border bg-surface/80 px-4 py-3.5 shadow-depth-1 ${c.status === 'paused' ? 'opacity-60' : ''}`}>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-accent/20 bg-accent-soft text-lg">{c.icon}</span>
            <div className="flex-1">
              <p className="text-[14px] font-semibold">{c.name}</p>
              <p className="text-[12px] text-ink-muted mt-0.5">{c.detail}</p>
            </div>
            <div className="text-right">
              <p className="font-display text-xl text-accent">{c.kpi}</p>
              <p className="text-[10.5px] text-ink-dim">{c.kpiLabel}</p>
            </div>
          </div>
        ))}
        <button className="rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-depth-1">+ New campaign</button>
      </div>

      {/* ── Proximity marketing (Gold) ── */}
      <div className="mt-10 rounded-card border border-gold/35 bg-surface/80 p-6 shadow-depth-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">Proximity marketing</h2>
          <span className="rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-[10.5px] font-bold text-gold">✦ GOLD</span>
          <span className="ml-auto text-[12px] text-ink-dim">geofences · opt-in buyers only</span>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          When a buyer whose Toju brief matches one of your listings walks inside its geofence, their phone shows a
          quiet ripple: <i>“You're 400m from a verified 3-bed that fits your brief.”</i> One tap opens the trust
          report; one more books a viewing. Only opted-in, brief-matched buyers are ever alerted — max one alert per
          listing per week.
        </p>

        <div className="mt-4 space-y-2">
          {fences.map((g, i) => (
            <div key={g.name} className="flex items-center gap-4 rounded-inner border border-glass-border bg-canvas px-4 py-3">
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
                📍{g.active && <span className="absolute inset-0 animate-ping rounded-full border border-accent/40" />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[13px] font-semibold">{g.name}</p>
                <p className="text-[11.5px] text-ink-dim">radius {g.radius} · {g.matched} matched buyers nearby this month</p>
              </div>
              <div className="hidden gap-4 text-center sm:flex">
                {[[g.alerts, 'alerts'], [g.walkins, 'walk-ins'], [g.leads, 'leads']].map(([v, l]) => (
                  <div key={String(l)}><p className="font-display text-lg text-accent">{v}</p><p className="text-[10px] text-ink-dim">{l}</p></div>
                ))}
              </div>
              <button onClick={() => setFences((fs) => fs.map((f, j) => (j === i ? { ...f, active: !f.active } : f)))}
                className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold ${g.active
                  ? 'border border-trust/30 bg-trust/10 text-trust' : 'border border-glass-border text-ink-muted'}`}>
                {g.active ? 'Active' : 'Off'}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-ink-dim">Full plan: docs/proximity-marketing.md — consent, frequency caps, and rollout phases.</p>
      </div>
    </div>
  );
}
