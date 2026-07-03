'use client';

/**
 * Subscription — the agency's plan. Verification speed, syndication reach,
 * and (Gold) proximity marketing are the levers. Demo pricing for testing.
 */
const TIERS = [
  {
    name: 'Starter', price: '₦0', per: 'forever', cta: 'Current plan', primary: false,
    features: ['5 live listings', 'Standard verification queue', 'CRM with WhatsApp handoff', 'Toju referrals when you match'],
  },
  {
    name: 'Growth', price: '₦75k', per: 'per month', cta: 'Upgrade to Growth', primary: true, popular: true,
    features: ['40 live listings · 5 agent seats', 'Priority verification (48h)', 'Social syndication — 2 channels', 'AI captions & auto-posting', 'Lead analytics & pipeline'],
  },
  {
    name: 'Gold', price: '₦250k', per: 'per month', cta: 'Talk to sales', primary: false, gold: true,
    features: [
      'Unlimited listings & seats',
      'Gold Verified badge on every listing',
      'All social channels + marketing campaigns',
      'Proximity marketing — geofenced alerts when matched buyers walk near your listings',
      'Top placement in Toju matches',
      'Dedicated verification desk',
    ],
  },
];

export default function SubscriptionPage() {
  return (
    <div className="max-w-[1000px]">
      <p className="text-accent text-[11px] font-bold uppercase tracking-[0.16em]">Plans</p>
      <h1 className="font-display text-4xl mt-1">Subscription</h1>
      <p className="text-ink-muted text-sm mt-1">Verification is the product. Pick how fast and how far your listings travel.</p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {TIERS.map((t) => (
          <div key={t.name}
            className={`relative rounded-card border bg-surface/80 p-6 shadow-depth-1 backdrop-blur ${t.gold ? 'border-gold/40' : 'border-glass-border'}`}>
            {t.popular && (
              <span className="absolute -top-3 right-5 rounded-full bg-accent px-3 py-1 text-[10px] font-bold tracking-wider text-white shadow-depth-1">
                MOST POPULAR
              </span>
            )}
            <p className="text-[15px] font-bold">{t.name}{t.gold && <span className="ml-1.5 text-gold">✦</span>}</p>
            <p className="mt-2 font-display text-4xl text-accent">{t.price}</p>
            <p className="text-[12px] text-ink-dim">{t.per}</p>
            <ul className="mt-5 space-y-2.5">
              {t.features.map((f) => (
                <li key={f} className="flex gap-2 text-[13px] text-ink-muted">
                  <span className={`font-bold ${f.startsWith('Proximity') ? 'text-gold' : 'text-trust'}`}>✓</span>
                  <span>{f.startsWith('Proximity') ? <b className="text-ink font-semibold">{f}</b> : f}</span>
                </li>
              ))}
            </ul>
            <button className={`mt-6 w-full rounded-full py-2.5 text-[13.5px] font-semibold ${
              t.primary ? 'bg-accent text-white shadow-depth-1' : 'border border-glass-border text-ink hover:bg-canvas'}`}>
              {t.cta}
            </button>
          </div>
        ))}
      </div>

      <p className="mt-6 text-[12px] text-ink-dim">
        Proximity marketing is exclusive to Gold: when a buyer whose Toju brief matches one of your verified listings
        walks within its geofence, they get a respectful, opt-in alert — and you get the warm lead. See Marketing → Proximity.
      </p>
    </div>
  );
}
