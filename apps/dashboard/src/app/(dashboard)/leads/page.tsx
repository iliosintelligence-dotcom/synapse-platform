'use client';

/**
 * CRM · Leads — Zoho-depth pipeline for the agency.
 * Pipeline board (stage columns, drag or menu to advance) + list view,
 * filters, AI lead score, and a full lead workspace drawer: brief from Toju,
 * activity timeline, notes, tasks, WhatsApp action, stage control.
 *
 * Demo data in src/lib/crm.ts — shaped like the live schema
 * (leads / lead_stage_history / tasks / communications) for a clean swap.
 */
import { useMemo, useState } from 'react';
import {
  DEMO_LEADS, STAGES, SOURCE_LABEL, ago, pipelineStats, waLink,
  CHANNEL_META, channelBreakdown, attribChain, wonAttribution,
  type Lead, type LeadStage, type LeadSource, type AttribChannel,
} from '../../../lib/crm';

const STAGE_TINT: Record<LeadStage, string> = {
  new: 'border-t-accent',
  contacted: 'border-t-[#d99a2b]',
  viewing: 'border-t-[#7a5cd6]',
  negotiation: 'border-t-[#2b7bd9]',
  won: 'border-t-trust',
  lost: 'border-t-ink-dim',
};

function ScoreRing({ score }: { score: number }) {
  const tone = score >= 80 ? 'text-trust border-trust' : score >= 60 ? 'text-accent border-accent' : 'text-ink-dim border-ink-dim';
  return (
    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full border-2 text-[11px] font-bold ${tone}`}
      title="AI lead score — intent, budget fit, responsiveness">
      {score}
    </span>
  );
}

function SourceChip({ source }: { source: LeadSource }) {
  const style = source === 'toju' ? 'bg-accent-soft text-accent border-accent/20'
    : source === 'contact' ? 'bg-trust/10 text-trust border-trust/20'
    : source === 'instagram' ? 'bg-[#DD2A7B]/10 text-[#B0225F] border-[#DD2A7B]/25'
    : 'bg-canvas text-ink-muted border-glass-border';
  return <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${style}`}>{SOURCE_LABEL[source]}</span>;
}

function ChannelBadge({ channel, title }: { channel: AttribChannel; title?: string }) {
  const m = CHANNEL_META[channel];
  return (
    <span title={title ?? `Attributed to ${m.label}`}
      className="inline-flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold text-white"
      style={{ background: m.color }}>{m.short}</span>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>(DEMO_LEADS);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [q, setQ] = useState('');
  const [srcFilter, setSrcFilter] = useState<LeadSource | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);

  const filtered = useMemo(
    () => leads.filter((l) =>
      (srcFilter === 'all' || l.source === srcFilter) &&
      (q === '' || (l.name + l.property + l.brief).toLowerCase().includes(q.toLowerCase()))),
    [leads, q, srcFilter],
  );
  const stats = pipelineStats(leads);
  const breakdown = channelBreakdown(leads);
  const open = leads.find((l) => l.id === openId) ?? null;

  function setStage(id: string, stage: LeadStage) {
    setLeads((ls) => ls.map((l) => l.id === id
      ? { ...l, stage, activity: [{ at: 'just now', kind: 'stage' as const, text: `Moved to ${STAGES.find((s) => s.id === stage)?.label}` }, ...l.activity] }
      : l));
  }
  function addNote(id: string) {
    const text = note.trim();
    if (!text) return;
    setLeads((ls) => ls.map((l) => l.id === id
      ? { ...l, notes: [text, ...l.notes], activity: [{ at: 'just now', kind: 'note' as const, text }, ...l.activity] }
      : l));
    setNote('');
  }
  function toggleTask(id: string, taskId: string) {
    setLeads((ls) => ls.map((l) => l.id === id
      ? { ...l, tasks: l.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) }
      : l));
  }

  return (
    <div className="max-w-[1200px]">
      <p className="text-accent text-[11px] font-bold uppercase tracking-[0.16em]">Prestige Realty Ltd. · Gold Verified</p>
      <h1 className="font-display text-4xl mt-1">CRM</h1>
      <p className="text-ink-muted text-sm mt-1">Every inquiry that touches Synapse — scored, staged, and never dropped.</p>

      {/* stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          [stats.active, 'Active leads'], [stats.newToday, 'New today'], [stats.viewings, 'Viewings booked'],
          [stats.won, 'Won'], [`${stats.conversion}%`, 'Conversion'],
        ].map(([v, l]) => (
          <div key={String(l)} className="rounded-inner border border-glass-border bg-surface/70 backdrop-blur px-4 py-3 shadow-depth-1">
            <p className="font-display text-2xl text-accent">{v}</p>
            <p className="text-ink-dim text-[11px] mt-0.5">{l}</p>
          </div>
        ))}
      </div>

      {/* attribution breakdown (Phase B) — which marketing actually made leads */}
      <div className="mt-3 rounded-inner border border-glass-border bg-surface/70 px-4 py-3 shadow-depth-1">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink-dim">Where your leads come from</p>
          <span className="text-[11px] text-ink-dim">{leads.length} leads attributed</span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {breakdown.map(({ channel, count }) => (
            <div key={channel} className="flex items-center gap-2 rounded-full border border-glass-border bg-canvas px-3 py-1.5">
              <ChannelBadge channel={channel} />
              <span className="text-[12px] font-semibold">{CHANNEL_META[channel].label}</span>
              <span className="text-[12px] font-bold text-accent">{count}</span>
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-canvas">
          {breakdown.map(({ channel, count }) => (
            <span key={channel} title={`${CHANNEL_META[channel].label}: ${count}`}
              style={{ background: CHANNEL_META[channel].color, width: `${(count / leads.length) * 100}%` }} />
          ))}
        </div>
      </div>

      {/* toolbar */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-glass-border bg-surface/70 p-1">
          {(['board', 'list'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-full px-4 py-1.5 text-[12.5px] font-semibold capitalize transition-colors ${view === v ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink'}`}>
              {v === 'board' ? 'Pipeline' : 'List'}
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, property, brief…"
          className="w-64 rounded-full border border-glass-border bg-surface/70 px-4 py-2 text-[13px] outline-none placeholder:text-ink-dim focus:border-accent/40" />
        <div className="flex gap-1.5">
          {(['all', 'toju', 'browse', 'contact', 'instagram'] as const).map((s) => (
            <button key={s} onClick={() => setSrcFilter(s)}
              className={`rounded-full border px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${
                srcFilter === s ? 'border-accent/40 bg-accent-soft text-accent' : 'border-glass-border bg-surface/60 text-ink-muted hover:text-ink'}`}>
              {s === 'all' ? 'All sources' : SOURCE_LABEL[s as LeadSource]}
            </button>
          ))}
        </div>
      </div>

      {/* ── pipeline board ── */}
      {view === 'board' && (
        <div className="mt-5 grid gap-3 overflow-x-auto pb-4 md:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((stage) => {
            const col = filtered.filter((l) => l.stage === stage.id);
            return (
              <div key={stage.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragId) { setStage(dragId, stage.id); setDragId(null); } }}
                className={`min-w-[210px] rounded-inner border border-glass-border border-t-[3px] bg-surface/50 backdrop-blur p-2.5 ${STAGE_TINT[stage.id]}`}>
                <div className="flex items-baseline justify-between px-1 pb-2">
                  <p className="text-[12.5px] font-bold">{stage.label} <span className="text-ink-dim font-medium">{col.length}</span></p>
                </div>
                <div className="space-y-2">
                  {col.map((l) => (
                    <button key={l.id} draggable onDragStart={() => setDragId(l.id)} onClick={() => setOpenId(l.id)}
                      className="w-full rounded-inner border border-glass-border bg-surface p-3 text-left shadow-depth-1 transition-transform hover:-translate-y-0.5 cursor-grab active:cursor-grabbing">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-semibold">{l.name}</p>
                        <ScoreRing score={l.score} />
                      </div>
                      <p className="mt-1 truncate text-[11.5px] text-ink-muted">{l.property}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <SourceChip source={l.source} />
                          {l.attribution && <ChannelBadge channel={l.attribution.channel} />}
                        </div>
                        <span className="text-[10.5px] text-ink-dim">{ago(l.minsAgo)}</span>
                      </div>
                      {l.failed && <p className="mt-1.5 text-[10.5px] font-semibold text-gold">⚠ delivery failed</p>}
                    </button>
                  ))}
                  {col.length === 0 && <p className="px-1 py-4 text-center text-[11px] text-ink-dim">{stage.hint}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── list view ── */}
      {view === 'list' && (
        <div className="mt-5 space-y-2.5">
          {filtered.sort((a, b) => a.minsAgo - b.minsAgo).map((l) => (
            <button key={l.id} onClick={() => setOpenId(l.id)}
              className="flex w-full items-center gap-4 rounded-inner border border-glass-border bg-surface/80 px-4 py-3 text-left shadow-depth-1 transition-transform hover:-translate-y-0.5">
              <ScoreRing score={l.score} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13.5px] font-semibold">{l.name}</p>
                  <SourceChip source={l.source} />
                  {l.attribution && <ChannelBadge channel={l.attribution.channel} />}
                  <span className="rounded-full border border-glass-border px-2 py-0.5 text-[10.5px] font-semibold capitalize text-ink-muted">{l.stage}</span>
                  {l.failed && <span className="text-[10.5px] font-semibold text-gold">⚠ delivery failed</span>}
                </div>
                <p className="mt-0.5 truncate text-[12px] text-ink-muted">{l.property} · budget {l.budget}</p>
              </div>
              <span className="text-[11.5px] text-ink-dim">{ago(l.minsAgo)}</span>
              <a href={waLink(l.phone, l.property)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                className="rounded-full bg-accent px-4 py-2 text-[12.5px] font-semibold text-white shadow-depth-1">WhatsApp</a>
            </button>
          ))}
        </div>
      )}

      {/* ── lead workspace drawer ── */}
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpenId(null)}>
          <div className="absolute inset-0 bg-ink/20 backdrop-blur-[2px]" />
          <aside onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 h-full w-full max-w-[440px] overflow-y-auto border-l border-glass-border bg-surface p-6 shadow-depth-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-xl font-bold">{open.name}</h2>
                  <ScoreRing score={open.score} />
                </div>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">{open.phone}{open.email ? ` · ${open.email}` : ''}</p>
              </div>
              <button onClick={() => setOpenId(null)} className="text-ink-dim hover:text-ink text-lg leading-none">✕</button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <SourceChip source={open.source} />
              <select value={open.stage} onChange={(e) => setStage(open.id, e.target.value as LeadStage)}
                className="rounded-full border border-glass-border bg-canvas px-3 py-1.5 text-[12px] font-semibold outline-none">
                {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <a href={waLink(open.phone, open.property)} target="_blank" rel="noreferrer"
                className="ml-auto rounded-full bg-accent px-4 py-2 text-[12.5px] font-semibold text-white">WhatsApp</a>
            </div>

            <section className="mt-5 rounded-inner border border-glass-border bg-canvas p-4">
              <p className="text-[10.5px] font-bold uppercase tracking-widest text-accent">Interested in</p>
              <p className="mt-1 text-[14px] font-semibold">{open.property}</p>
              <p className="text-[12px] text-ink-muted">List {open.propertyPrice} · their budget {open.budget}</p>
            </section>

            {/* attribution chain (Phase B) */}
            {open.attribution && (
              <section className="mt-4 rounded-inner border border-glass-border bg-canvas p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[10.5px] font-bold uppercase tracking-widest text-ink-dim">How this lead reached you</p>
                  <ChannelBadge channel={open.attribution.channel} />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-1 gap-y-1.5">
                  {attribChain(open.attribution).map((step, i, arr) => (
                    <span key={i} className="flex items-center gap-1">
                      <span className="rounded-full border border-glass-border bg-surface px-2 py-1 text-[11px] font-medium">
                        {step.label}{step.sub ? <span className="text-ink-dim"> · {step.sub}</span> : null}
                      </span>
                      {i < arr.length - 1 && <span className="text-ink-dim">→</span>}
                    </span>
                  ))}
                </div>
                {(open.attribution.campaign || open.attribution.shortLink) && (
                  <p className="mt-2.5 text-[11px] text-ink-dim">
                    {open.attribution.shortLink && <>Tracked link <span className="font-semibold text-ink-muted">{open.attribution.shortLink}</span></>}
                    {open.attribution.campaign && <> · campaign <span className="font-semibold text-ink-muted">{open.attribution.campaign}</span></>}
                  </p>
                )}
              </section>
            )}

            {/* revenue attribution for a closed deal */}
            {wonAttribution(open) && (
              <section className="mt-4 rounded-inner border border-trust/30 bg-trust/10 p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-widest text-trust">Revenue attributed</p>
                <p className="mt-1.5 text-[13px] font-semibold leading-relaxed">{wonAttribution(open)}</p>
              </section>
            )}

            <section className="mt-4 rounded-inner border border-accent/20 bg-accent-soft p-4">
              <p className="text-[10.5px] font-bold uppercase tracking-widest text-accent">✦ Brief from Toju</p>
              <p className="mt-1.5 text-[13px] leading-relaxed">{open.brief}</p>
            </section>

            <section className="mt-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-ink-dim">Tasks</p>
              <div className="mt-2 space-y-1.5">
                {open.tasks.length === 0 && <p className="text-[12px] text-ink-dim">No open tasks.</p>}
                {open.tasks.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2.5 rounded-inner border border-glass-border bg-surface px-3 py-2">
                    <input type="checkbox" checked={t.done} onChange={() => toggleTask(open.id, t.id)} className="accent-[#C2552B]" />
                    <span className={`flex-1 text-[13px] ${t.done ? 'text-ink-dim line-through' : ''}`}>{t.text}</span>
                    <span className="text-[11px] text-ink-dim">{t.due}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="mt-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-ink-dim">Notes</p>
              <div className="mt-2 flex gap-2">
                <input value={note} onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addNote(open.id); }}
                  placeholder="Add a note…" className="flex-1 rounded-inner border border-glass-border bg-canvas px-3 py-2 text-[13px] outline-none focus:border-accent/40" />
                <button onClick={() => addNote(open.id)} className="rounded-inner bg-accent px-3.5 text-[13px] font-semibold text-white">Add</button>
              </div>
              <div className="mt-2 space-y-1.5">
                {open.notes.map((n, i) => (
                  <p key={i} className="rounded-inner border border-glass-border bg-canvas px-3 py-2 text-[12.5px] text-ink-muted">{n}</p>
                ))}
              </div>
            </section>

            <section className="mt-5 pb-8">
              <p className="text-[11px] font-bold uppercase tracking-widest text-ink-dim">Activity</p>
              <div className="mt-2 space-y-0">
                {open.activity.map((a, i) => (
                  <div key={i} className="relative border-l-2 border-glass-border pb-4 pl-4 last:pb-0">
                    <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-accent" />
                    <p className="text-[12.5px]">{a.text}</p>
                    <p className="text-[10.5px] text-ink-dim">{a.at}</p>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
