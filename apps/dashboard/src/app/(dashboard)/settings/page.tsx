'use client';

/**
 * Settings — agency name, WhatsApp number, logo. The WhatsApp number is where
 * the lead bridge delivers; treat it as load-bearing. (Supporting screen.)
 *
 * Wiring note: load via agencies.getAgency(agencyId); save via
 * agencies.updateAgency(agencyId, input). Logo upload routes through the
 * media abstraction.
 */
import { useState } from 'react';

const inputCls =
  'w-full rounded-inner border border-glass-border bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none focus:border-accent/40 transition-colors';

export default function SettingsPage() {
  const [name, setName] = useState('Prestige Realty Ltd.');
  const [whatsapp, setWhatsapp] = useState('+234 803 555 0142');
  const [saved, setSaved] = useState(false);

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO(go-live): agencies.updateAgency(agencyId, { name, whatsapp_number })
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-4xl tracking-wider">SETTINGS</h1>
      <p className="text-ink-muted text-sm mt-2">Your agency profile and where leads are delivered.</p>

      <form onSubmit={onSave} className="mt-8 space-y-6">
        <div className="rounded-card border border-glass-border bg-surface shadow-depth-1 p-6 space-y-5">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-inner bg-accent-soft border border-accent/20 flex items-center justify-center">
              <span className="font-display text-2xl text-accent">{name.slice(0, 1)}</span>
            </div>
            <label className="cursor-pointer text-sm font-semibold text-accent">
              Change logo
              <input type="file" accept="image/*" className="hidden" />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Agency name</span>
            <input className={`${inputCls} mt-1.5`} value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">WhatsApp number</span>
            <input
              className={`${inputCls} mt-1.5`}
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+234…"
            />
            <span className="mt-1.5 block text-[11px] text-ink-dim">
              Qualified leads are delivered here within seconds. Keep it current.
            </span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-full bg-accent text-white text-sm font-semibold px-6 py-2.5 hover:opacity-90 transition-opacity"
          >
            Save changes
          </button>
          {saved && <span className="text-trust text-sm font-medium">✓ Saved</span>}
        </div>
      </form>
    </div>
  );
}
