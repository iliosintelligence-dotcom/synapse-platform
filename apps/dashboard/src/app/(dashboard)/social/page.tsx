'use client';

/**
 * Social studio — Buffer-depth syndication & posting.
 * Channels (connect/toggle, best-time hints) · Composer (pick a verified
 * listing → AI caption angles → channels → schedule slot) · Queue (pause,
 * delete, post-now) · Calendar week view · Analytics on posted content,
 * with DMs and leads routed back into the CRM.
 *
 * Demo data in src/lib/social.ts — mirrors social_accounts / social_posts /
 * social_post_metrics for a clean swap to Supabase.
 */
import { useMemo, useState } from 'react';
import {
  CHANNELS, DEMO_POSTS, LISTINGS, CAPTION_ANGLES, fmt,
  type Channel, type SocialPost,
} from '../../../lib/social';

const DAY_LABELS = ['Today', 'Tomorrow', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ChannelDot({ c }: { c: Channel }) {
  const meta = CHANNELS.find((x) => x.id === c)!;
  const initials = { instagram: 'IG', tiktok: 'TT', facebook: 'f', whatsapp: 'WA' }[c];
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[9.5px] font-bold text-white"
      style={{ background: meta.color }} title={meta.label}>{initials}</span>
  );
}

export default function SocialStudioPage() {
  const [tab, setTab] = useState<'queue' | 'calendar' | 'analytics' | 'channels'>('queue');
  const [posts, setPosts] = useState<SocialPost[]>(DEMO_POSTS);
  const [connected, setConnected] = useState<Record<Channel, boolean>>(
    Object.fromEntries(CHANNELS.map((c) => [c.id, c.connected])) as Record<Channel, boolean>,
  );
  const [composing, setComposing] = useState(false);

  // composer state
  const [listingIdx, setListingIdx] = useState(0);
  const [angleIdx, setAngleIdx] = useState(0);
  const [caption, setCaption] = useState(CAPTION_ANGLES[0].make(LISTINGS[0].title, LISTINGS[0].price));
  const [pickChannels, setPickChannels] = useState<Channel[]>(['instagram']);
  const [slot, setSlot] = useState('Today 5:00 PM');

  const queued = posts.filter((p) => p.status === 'queued' || p.status === 'paused');
  const posted = posts.filter((p) => p.status === 'posted');
  const totals = useMemo(() => posted.reduce(
    (a, p) => ({
      views: a.views + (p.metrics?.views ?? 0), saves: a.saves + (p.metrics?.saves ?? 0),
      dms: a.dms + (p.metrics?.dms ?? 0), leads: a.leads + (p.metrics?.leads ?? 0),
    }), { views: 0, saves: 0, dms: 0, leads: 0 }), [posted]);

  function regenerate(li = listingIdx, ai = angleIdx) {
    setCaption(CAPTION_ANGLES[ai].make(LISTINGS[li].title, LISTINGS[li].price));
  }
  function schedulePost() {
    const l = LISTINGS[listingIdx];
    setPosts((ps) => [{
      id: 'p' + Date.now(), listing: l.title, price: l.price, image: l.image,
      caption, channels: pickChannels, status: 'queued', when: slot,
      day: slot.startsWith('Today') ? 0 : slot.startsWith('Tomorrow') ? 1 : 2 + DAY_LABELS.indexOf(slot.split(' ')[0]),
    }, ...ps]);
    setComposing(false);
  }
  function setStatus(id: string, status: SocialPost['status']) {
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status } : p)));
  }
  function remove(id: string) { setPosts((ps) => ps.filter((p) => p.id !== id)); }

  return (
    <div className="max-w-[1100px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-accent text-[11px] font-bold uppercase tracking-[0.16em]">Syndication &amp; posting</p>
          <h1 className="font-display text-4xl mt-1">Social studio</h1>
          <p className="text-ink-muted text-sm mt-1">Every verified listing becomes content — captioned by AI, posted on schedule, DMs routed into the CRM.</p>
        </div>
        <button onClick={() => setComposing(true)}
          className="rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-depth-1">+ New post</button>
      </div>

      {/* tabs */}
      <div className="mt-6 flex gap-1.5 border-b border-glass-border">
        {(['queue', 'calendar', 'analytics', 'channels'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-[13px] font-semibold capitalize transition-colors ${
              tab === t ? 'border-b-2 border-accent text-accent' : 'text-ink-muted hover:text-ink'}`}>
            {t}{t === 'queue' ? ` (${queued.length})` : ''}
          </button>
        ))}
      </div>

      {/* ── QUEUE ── */}
      {tab === 'queue' && (
        <div className="mt-5 space-y-2.5">
          {queued.length === 0 && <p className="py-10 text-center text-sm text-ink-dim">Queue is empty — create a post from a verified listing.</p>}
          {queued.map((p) => (
            <div key={p.id} className={`flex items-center gap-4 rounded-inner border border-glass-border bg-surface/80 px-4 py-3 shadow-depth-1 ${p.status === 'paused' ? 'opacity-60' : ''}`}>
              <img src={p.image} alt="" className="h-14 w-14 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold">{p.listing} · {p.price}</p>
                <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">{p.caption}</p>
                <div className="mt-1.5 flex items-center gap-1.5">{p.channels.map((c) => <ChannelDot key={c} c={c} />)}
                  <span className="ml-2 text-[11px] text-ink-dim">{p.when}</span>
                  {p.status === 'paused' && <span className="rounded-full bg-gold/10 border border-gold/30 px-2 py-0.5 text-[10px] font-bold text-gold">PAUSED</span>}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <button onClick={() => setStatus(p.id, p.status === 'paused' ? 'queued' : 'paused')}
                  className="rounded-full border border-glass-border px-3 py-1 text-[11.5px] font-semibold text-ink-muted hover:text-ink">
                  {p.status === 'paused' ? 'Resume' : 'Pause'}
                </button>
                <button onClick={() => setStatus(p.id, 'posted')}
                  className="rounded-full border border-trust/30 bg-trust/10 px-3 py-1 text-[11.5px] font-semibold text-trust">Post now</button>
                <button onClick={() => remove(p.id)}
                  className="rounded-full border border-glass-border px-3 py-1 text-[11.5px] text-ink-dim hover:text-ink">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── CALENDAR ── */}
      {tab === 'calendar' && (
        <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-7">
          {DAY_LABELS.map((d, i) => {
            const dayPosts = posts.filter((p) => p.day === i && p.status !== 'posted');
            return (
              <div key={d} className="min-h-[150px] rounded-inner border border-glass-border bg-surface/50 p-2.5">
                <p className="pb-2 text-[11.5px] font-bold text-ink-muted">{d}</p>
                <div className="space-y-1.5">
                  {dayPosts.map((p) => (
                    <div key={p.id} className="rounded-lg border border-glass-border bg-surface p-2 shadow-depth-1">
                      <p className="truncate text-[11px] font-semibold">{p.listing.split(',')[0]}</p>
                      <div className="mt-1 flex items-center gap-1">{p.channels.map((c) => <ChannelDot key={c} c={c} />)}</div>
                      <p className="mt-1 text-[10px] text-ink-dim">{p.when.split(' ').slice(-2).join(' ')}</p>
                    </div>
                  ))}
                  {dayPosts.length === 0 && (
                    <button onClick={() => setComposing(true)} className="w-full rounded-lg border border-dashed border-glass-border py-3 text-[11px] text-ink-dim hover:text-accent hover:border-accent/40">+ slot</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ANALYTICS ── */}
      {tab === 'analytics' && (
        <div className="mt-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[[fmt(totals.views), 'Views (30d)'], [fmt(totals.saves), 'Saves'], [totals.dms, 'DMs captured'], [totals.leads, 'Leads → CRM']].map(([v, l]) => (
              <div key={String(l)} className="rounded-inner border border-glass-border bg-surface/70 px-4 py-3 shadow-depth-1">
                <p className="font-display text-2xl text-accent">{v}</p>
                <p className="text-ink-dim text-[11px] mt-0.5">{l}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2.5">
            {posted.map((p) => (
              <div key={p.id} className="flex items-center gap-4 rounded-inner border border-glass-border bg-surface/80 px-4 py-3 shadow-depth-1">
                <img src={p.image} alt="" className="h-14 w-14 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">{p.listing}</p>
                  <p className="mt-0.5 truncate text-[12px] text-ink-muted">{p.caption}</p>
                  <div className="mt-1 flex items-center gap-1.5">{p.channels.map((c) => <ChannelDot key={c} c={c} />)}
                    <span className="ml-2 text-[11px] text-ink-dim">{p.when}</span></div>
                </div>
                {p.metrics && (
                  <div className="flex gap-4 text-center">
                    {[[fmt(p.metrics.views), 'views'], [fmt(p.metrics.saves), 'saves'], [p.metrics.dms, 'DMs'], [p.metrics.leads, 'leads']].map(([v, l]) => (
                      <div key={String(l)}><p className="font-display text-lg text-accent">{v}</p><p className="text-[10px] text-ink-dim">{l}</p></div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CHANNELS ── */}
      {tab === 'channels' && (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {CHANNELS.map((c) => (
            <div key={c.id} className="flex items-center gap-4 rounded-inner border border-glass-border bg-surface/80 px-4 py-4 shadow-depth-1">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl text-[14px] font-bold text-white" style={{ background: c.color }}>
                {{ instagram: 'IG', tiktok: 'TT', facebook: 'f', whatsapp: 'WA' }[c.id]}
              </span>
              <div className="flex-1">
                <p className="text-[14px] font-semibold">{c.label}</p>
                <p className="text-[12px] text-ink-dim">{c.handle} · best time {c.bestTime}</p>
              </div>
              <button onClick={() => setConnected((x) => ({ ...x, [c.id]: !x[c.id] }))}
                className={`rounded-full px-4 py-2 text-[12.5px] font-semibold ${connected[c.id]
                  ? 'border border-trust/30 bg-trust/10 text-trust' : 'bg-accent text-white'}`}>
                {connected[c.id] ? 'Connected ✓' : 'Connect'}
              </button>
            </div>
          ))}
          <p className="text-[12px] text-ink-dim md:col-span-2">Auto-posting follows each channel's best-time slot unless you pick a custom time in the composer. DMs and comment leads are routed into the CRM automatically.</p>
        </div>
      )}

      {/* ── COMPOSER ── */}
      {composing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={() => setComposing(false)}>
          <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" />
          <div onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-card border border-glass-border bg-surface p-6 shadow-depth-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">New post</h2>
              <button onClick={() => setComposing(false)} className="text-ink-dim hover:text-ink">✕</button>
            </div>

            <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-ink-dim">1 · Verified listing</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {LISTINGS.map((l, i) => (
                <button key={l.title} onClick={() => { setListingIdx(i); regenerate(i, angleIdx); }}
                  className={`flex items-center gap-2.5 rounded-inner border p-2 text-left ${i === listingIdx ? 'border-accent/50 bg-accent-soft' : 'border-glass-border bg-canvas'}`}>
                  <img src={l.image} alt="" className="h-10 w-10 rounded-lg object-cover" />
                  <div className="min-w-0"><p className="truncate text-[12px] font-semibold">{l.title}</p><p className="text-[11px] text-accent">{l.price}</p></div>
                </button>
              ))}
            </div>

            <p className="mt-5 text-[11px] font-bold uppercase tracking-widest text-ink-dim">2 · AI caption</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CAPTION_ANGLES.map((a, i) => (
                <button key={a.label} onClick={() => { setAngleIdx(i); regenerate(listingIdx, i); }}
                  className={`rounded-full border px-3 py-1.5 text-[12px] font-medium ${i === angleIdx ? 'border-accent/50 bg-accent-soft text-accent' : 'border-glass-border text-ink-muted'}`}>
                  ✦ {a.label}
                </button>
              ))}
            </div>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3}
              className="mt-2 w-full rounded-inner border border-glass-border bg-canvas p-3 text-[13px] leading-relaxed outline-none focus:border-accent/40" />

            <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-ink-dim">3 · Channels</p>
            <div className="mt-2 flex gap-2">
              {CHANNELS.map((c) => (
                <button key={c.id} disabled={!connected[c.id]}
                  onClick={() => setPickChannels((cs) => cs.includes(c.id) ? cs.filter((x) => x !== c.id) : [...cs, c.id])}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-35 ${
                    pickChannels.includes(c.id) ? 'border-accent/50 bg-accent-soft text-accent' : 'border-glass-border text-ink-muted'}`}>
                  <ChannelDot c={c.id} /> {c.label}
                </button>
              ))}
            </div>

            <p className="mt-4 text-[11px] font-bold uppercase tracking-widest text-ink-dim">4 · Schedule</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {['Today 5:00 PM', 'Tomorrow 9:00 AM', 'Tomorrow 7:30 PM', 'Sat 11:00 AM'].map((s) => (
                <button key={s} onClick={() => setSlot(s)}
                  className={`rounded-full border px-3 py-1.5 text-[12px] font-medium ${slot === s ? 'border-accent/50 bg-accent-soft text-accent' : 'border-glass-border text-ink-muted'}`}>
                  {s}{s.includes('5:00 PM') ? ' · best time' : ''}
                </button>
              ))}
            </div>

            <button onClick={schedulePost} disabled={pickChannels.length === 0}
              className="mt-6 w-full rounded-full bg-accent py-3 text-[14px] font-semibold text-white shadow-depth-1 disabled:opacity-40">
              Add to queue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
