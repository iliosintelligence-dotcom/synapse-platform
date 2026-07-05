'use client';

/**
 * Dream Home — first consumer page ported from the static prototype to React.
 * Save an aspirational home + budget goal, track savings progress toward it,
 * and jump to Toju to explore homes in that band. State persists in
 * localStorage (synapse_dream_v1), mirroring the prototype exactly.
 */
import { useEffect, useState } from 'react';
import { ConsumerNav } from '../ConsumerNav';

const KEY = 'synapse_dream_v1';
type Dream = { name: string; feat: string[]; goal: number; saved: number };

const naira = (n: number) => {
  n = Number(n) || 0;
  return n >= 1e9 ? '₦' + (n / 1e9).toFixed(1) + 'B'
    : n >= 1e6 ? '₦' + (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M'
    : '₦' + n.toLocaleString();
};
const digits = (s: string) => parseInt((s || '').replace(/[^\d]/g, ''), 10);

export default function DreamPage() {
  const [dream, setDream] = useState<Dream | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [editing, setEditing] = useState(false);
  const [barW, setBarW] = useState(0);

  const [fName, setFName] = useState('Dream Home');
  const [fFeat, setFFeat] = useState('');
  const [fGoal, setFGoal] = useState('');
  const [fSaved, setFSaved] = useState('');
  const [savedInput, setSavedInput] = useState('');

  useEffect(() => {
    try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d) setDream(d); } catch {}
    setHydrated(true);
  }, []);

  const pct = dream ? Math.min(100, Math.round((dream.saved / dream.goal) * 100)) || 0 : 0;
  useEffect(() => {
    if (!dream) return;
    const t = setTimeout(() => setBarW(pct), 60);
    return () => clearTimeout(t);
  }, [dream, pct]);

  function openForm(prefill: boolean) {
    if (prefill && dream) {
      setFName(dream.name); setFFeat(dream.feat.join(', '));
      setFGoal(String(dream.goal)); setFSaved(String(dream.saved));
    } else {
      setFName('Dream Home'); setFFeat(''); setFGoal(''); setFSaved('');
    }
    setEditing(true);
  }
  function saveDream() {
    const goal = digits(fGoal);
    if (!goal) return;
    const d: Dream = {
      name: fName.trim() || 'Dream Home',
      feat: fFeat.split(',').map((s) => s.trim()).filter(Boolean),
      goal, saved: digits(fSaved) || 0,
    };
    localStorage.setItem(KEY, JSON.stringify(d));
    setDream(d); setBarW(0); setEditing(false);
  }
  function updateSaved() {
    const v = digits(savedInput);
    if (isNaN(v) || !dream) return;
    const d = { ...dream, saved: v };
    localStorage.setItem(KEY, JSON.stringify(d));
    setDream(d); setBarW(0); setSavedInput('');
  }

  const gap = dream ? Math.max(0, dream.goal - dream.saved) : 0;
  const yrs = dream && dream.saved > 0 && dream.goal > dream.saved ? Math.ceil(gap / (dream.saved * 0.15)) : null;
  const tojuHref = dream
    ? `/toju?ask=${encodeURIComponent('Show me homes near my dream: ' + dream.feat.join(', ') + ' around ' + naira(dream.goal))}`
    : '/toju';

  return (
    <>
      <div className="bg-scene" />
      <div className="bg-wash" />
      <ConsumerNav active="dream" />
      <div className="dream-wrap">
        <div className="eyebrow">Not ready to buy today?</div>
        <div className="h1">Dream Home</div>
        <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          Save the home you’re working toward. Synapse tracks your progress and nudges you closer.
        </p>

        {!hydrated ? null : editing ? (
          <div className="card dream">
            <div className="field"><label>Name it</label>
              <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Our forever home" /></div>
            <div className="field"><label>Must-haves (comma separated)</label>
              <input value={fFeat} onChange={(e) => setFFeat(e.target.value)} placeholder="4 bedrooms, ocean view, home office" /></div>
            <div className="field"><label>Budget goal (₦)</label>
              <input value={fGoal} onChange={(e) => setFGoal(e.target.value)} inputMode="numeric" placeholder="120000000" /></div>
            <div className="field"><label>Saved so far (₦)</label>
              <input value={fSaved} onChange={(e) => setFSaved(e.target.value)} inputMode="numeric" placeholder="50000000" /></div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveDream}>Save dream</button>
              <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : dream ? (
          <div className="card dream">
            <button className="edit" onClick={() => openForm(true)}>Edit</button>
            <div className="name">{dream.name || 'Dream Home'}</div>
            <div className="feat">{dream.feat.map((f, i) => <span key={i}>{f}</span>)}</div>
            <div className="goal"><span className="lbl">Budget goal</span><span className="val">{naira(dream.goal)}</span></div>
            <div className="track">
              <div className="top"><span>Saved so far</span><span><b>{naira(dream.saved)}</b> · {pct}%</span></div>
              <div className="bar"><i style={{ width: barW + '%' }} /></div>
            </div>
            <div className="saved-so-far">
              <input value={savedInput} onChange={(e) => setSavedInput(e.target.value)} inputMode="numeric"
                placeholder="Update your savings, e.g. 55000000" />
              <button className="btn btn-primary" style={{ padding: '11px 18px', fontSize: 13.5 }} onClick={updateSaved}>Update</button>
            </div>
            <div className="plan">
              {pct >= 100 ? (
                <>🎉 <b>You’re there.</b> Your savings meet your goal — ready to talk to Toju about real verified homes that fit?</>
              ) : (
                <>
                  <b>{naira(gap)}</b> to go. {yrs ? (
                    <>Keep your current pace and you’re on track in about <b>{yrs}{yrs === 1 ? ' year' : ' years'}</b>. </>
                  ) : null}
                  Toju can already show you homes in this band to aim at — <a href={tojuHref}>explore the dream →</a>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="card dream">
            <div className="empty">
              <p>You haven’t set a dream yet. Picture the home you’re building toward — Synapse will help you get there.</p>
              <button className="btn btn-primary" onClick={() => openForm(false)}>Set my dream home</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
