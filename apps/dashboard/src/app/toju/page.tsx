'use client';

/**
 * Toju — the consumer AI property consultant, as a real React/Next page
 * (replaces the static app/toju.html prototype). Liquid-glass light theme in the
 * landing palette; wired to the live toju-demo Edge Function. Standalone route
 * (/toju) with no agency-dashboard chrome.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://bhrhejpekmhbhwryjhgk.supabase.co';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_D25gO3eui5oI4L3h7bx-vg_fCHbo3LV';

type Msg = { role: 'user' | 'assistant'; content: string };
type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'toju'; text: string; matches: boolean }
  | { kind: 'typing' };

const GREETING =
  "Good afternoon. I'm Toju — your consultant at Synapse. Tell me what you're looking for and I'll find verified homes that fit. No forms, no endless scrolling.";
const STARTERS = ['3-bed in Lekki under ₦180M', 'What can I afford monthly?', 'Good areas for a first home'];

const MATCHES = [
  { price: '₦165M', title: '3-Bed Apartment, Lekki Phase 1', meta: 'Trust 94 · ↓ below market', img: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=300&q=70' },
  { price: '₦148M', title: '3-Bed Terrace, Ikate', meta: 'Trust 91 · high-growth area', img: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=300&q=70' },
];

export default function TojuPage() {
  const [entries, setEntries] = useState<Entry[]>([{ kind: 'toju', text: GREETING, matches: false }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const history = useRef<Msg[]>([{ role: 'assistant', content: GREETING }]);
  const inputRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<any>(null);

  useEffect(() => { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }, [entries]);

  async function send(text?: string) {
    const v = (text ?? input).trim();
    if (!v || busy) return;
    setBusy(true);
    setInput('');
    history.current.push({ role: 'user', content: v });
    setEntries((e) => [...e, { kind: 'user', text: v }, { kind: 'typing' }]);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/toju-demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ messages: history.current.slice(-14) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.reply) {
        setEntries((e) => [...e.filter((x) => x.kind !== 'typing'), { kind: 'toju', text: "I'm having a moment connecting — mind trying that again in a second?", matches: false }]);
      } else {
        history.current.push({ role: 'assistant', content: data.reply });
        setEntries((e) => [...e.filter((x) => x.kind !== 'typing'), { kind: 'toju', text: data.reply, matches: data.showMatches === true }]);
      }
    } catch {
      setEntries((e) => [...e.filter((x) => x.kind !== 'typing'), { kind: 'toju', text: "I'm having a moment connecting — mind trying that again in a second?", matches: false }]);
    } finally {
      setBusy(false);
    }
  }

  function flash(msg: string) { setHint(msg); setTimeout(() => setHint(null), 5000); }

  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return flash('Voice typing needs Chrome or Edge on this device.');
    if (!window.isSecureContext) return flash('Voice needs a secure (https) page to access the mic.');
    if (listening) { try { recogRef.current?.stop(); } catch {} setListening(false); return; }
    const recog = new SR();
    recogRef.current = recog;
    recog.lang = 'en-NG'; recog.interimResults = true; recog.continuous = true;
    const base = input.trim() ? input.trim() + ' ' : '';
    recog.onresult = (e: any) => {
      let txt = '';
      for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setInput(base + txt);
    };
    recog.onerror = (e: any) => {
      setListening(false);
      const inIframe = window.self !== window.top;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
        flash(inIframe ? 'Open this page in its own tab to use voice — the mic is blocked inside an embedded preview.'
                       : 'Microphone is blocked. Click the mic icon in the address bar → Allow, then tap the mic again.');
      else if (e.error === 'no-speech') flash('Didn’t catch that — tap the mic and speak.');
    };
    recog.onend = () => setListening(false);
    try { recog.start(); setListening(true); inputRef.current?.focus(); } catch { setListening(false); }
  }

  return (
    <div className="tj">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Fraunces:opsz,wght@9..144,300;9..144,400&display=swap"
      />
      <div className="bg" /><div className="wash" />
      <header className="bar">
        <a className="brand" href="/">SYNAPSE</a>
        <nav><span className="active">Toju</span><a href="/">Browse</a></nav>
      </header>

      <main className="wrap">
        <div className="eyebrow">AI Property Consultant</div>
        <h1 className="title">Toju <span className="dot" /></h1>

        <div className="convo">
          {entries.map((entry, i) => {
            if (entry.kind === 'user')
              return (
                <div className="msg user" key={i}>
                  <div className="bubble">{entry.text}</div>
                  <div className="av avu">A</div>
                </div>
              );
            if (entry.kind === 'typing')
              return (
                <div className="msg toju" key={i}>
                  <div className="av avt">✦</div>
                  <div className="col"><div className="sender">Toju</div>
                    <div className="bubble typing"><span className="dots"><i /><i /><i /></span><em>thinking…</em></div>
                  </div>
                </div>
              );
            return (
              <div className="msg toju" key={i}>
                <div className="av avt">✦</div>
                <div className="col">
                  <div className="sender">Toju</div>
                  <div className="bubble">{entry.text}</div>
                  {entry.matches && (
                    <>
                      <div className="mh"><span>✦</span><span className="lbl">VERIFIED MATCHES</span><span className="cnt">{MATCHES.length}</span></div>
                      {MATCHES.map((m) => (
                        <a className="pcard" href="/" key={m.title}>
                          <img src={m.img} alt="" />
                          <div><div className="price">{m.price}</div><div className="ttl">{m.title}</div><div className="meta">{m.meta}</div></div>
                        </a>
                      ))}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <div className="composer">
        {hint && <div className="hint">{hint}</div>}
        <div className="suggest">
          {STARTERS.map((s) => (<button key={s} onClick={() => send(s)} disabled={busy}>{s}</button>))}
        </div>
        <div className="pill">
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
            placeholder={listening ? 'Listening… speak now' : "Tell Toju what you're looking for…"} />
          <button className={`mic${listening ? ' on' : ''}`} onClick={toggleMic} aria-label="Voice typing">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" /></svg>
          </button>
          <button className="send" onClick={() => send()} disabled={!input.trim() || busy} aria-label="Send">↑</button>
        </div>
      </div>

      <style jsx global>{`
        :root { --brand:#FF7B2C; --bg:#fafaf8; --ink:#15171a; --ink-muted:rgba(21,23,26,0.55); --ink-dim:rgba(21,23,26,0.35); --border:rgba(15,18,24,0.08); --success:#2e7d4f; }
        body { background: var(--bg); margin: 0; font-family: 'Inter', system-ui, sans-serif; color: var(--ink); }
      `}</style>
      <style jsx>{`
        .tj { min-height: 100vh; }
        .bg { position: fixed; inset: 0; z-index: 0; opacity: .5; background: url('https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=1600&q=80') center/cover no-repeat; }
        .wash { position: fixed; inset: 0; z-index: 0; background: radial-gradient(120% 90% at 80% 0%, rgba(255,123,44,0.08), transparent 55%), linear-gradient(180deg, rgba(250,250,248,0.78), rgba(250,250,248,0.9) 60%, var(--bg) 100%); }
        .bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 22px; padding: 14px 22px; background: rgba(250,250,248,0.82); backdrop-filter: blur(20px) saturate(1.4); border-bottom: 1px solid var(--border); }
        .brand { font-weight: 700; letter-spacing: 0.22em; font-size: 12px; color: var(--ink); text-decoration: none; }
        nav { display: flex; gap: 4px; }
        nav .active { font-size: 13px; color: var(--brand); padding: 7px 13px; border-radius: 100px; background: rgba(255,123,44,0.1); }
        nav a { font-size: 13px; color: var(--ink-muted); padding: 7px 13px; border-radius: 100px; text-decoration: none; }
        .wrap { position: relative; z-index: 1; max-width: 480px; margin: 0 auto; padding: 26px 22px 170px; }
        .eyebrow { font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--brand); }
        .title { font-family: 'Fraunces', Georgia, serif; font-weight: 300; font-size: 40px; letter-spacing: -0.02em; margin: 2px 0 0; display: flex; align-items: center; gap: 10px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 4px rgba(46,125,79,0.14); }
        .convo { display: flex; flex-direction: column; gap: 18px; padding-top: 22px; }
        .msg { display: flex; align-items: flex-end; gap: 9px; }
        .msg.user { flex-direction: row-reverse; }
        .col { max-width: 84%; display: flex; flex-direction: column; }
        .av { width: 30px; height: 30px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center; font-size: 14px; }
        .avt { background: var(--brand); color: #fff; }
        .avu { background: rgba(15,18,24,0.05); border: 1px solid var(--border); color: var(--ink-muted); font-size: 13px; font-weight: 600; }
        .sender { font-size: 11.5px; font-weight: 600; color: var(--brand); margin: 0 0 5px 3px; }
        .bubble { padding: 13px 16px; border-radius: 20px; font-size: 14.5px; line-height: 1.55; }
        .toju .bubble { background: rgba(255,255,255,0.74); backdrop-filter: blur(22px) saturate(1.4); border: 1px solid var(--border); border-bottom-left-radius: 6px; box-shadow: 0 12px 32px rgba(20,26,38,0.06); }
        .user .bubble { background: var(--brand); color: #fff; border-bottom-right-radius: 6px; max-width: 84%; box-shadow: 0 8px 22px rgba(255,123,44,0.22); }
        .bubble.typing { display: flex; align-items: center; gap: 9px; color: var(--ink-muted); }
        .bubble.typing em { font-style: italic; }
        .dots { display: flex; gap: 4px; } .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); animation: p 1.1s infinite; } .dots i:nth-child(2){animation-delay:.18s} .dots i:nth-child(3){animation-delay:.36s}
        @keyframes p { 0%,60%,100%{opacity:.25} 30%{opacity:1} }
        .mh { display: flex; align-items: center; gap: 7px; margin: 12px 0 8px; color: var(--brand); }
        .mh .lbl { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; }
        .mh .cnt { font-size: 11px; font-weight: 700; background: rgba(255,123,44,0.12); border-radius: 9px; min-width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; }
        .pcard { display: flex; gap: 13px; margin-top: 9px; padding: 11px; border-radius: 15px; text-decoration: none; color: inherit; background: rgba(255,255,255,0.82); backdrop-filter: blur(18px); border: 1px solid var(--border); box-shadow: 0 10px 26px rgba(20,26,38,0.06); transition: all .2s; }
        .pcard:hover { transform: translateY(-1px); border-color: rgba(255,123,44,0.25); }
        .pcard img { width: 62px; height: 62px; border-radius: 12px; object-fit: cover; }
        .pcard .price { font-family: 'Fraunces', Georgia, serif; font-size: 21px; color: var(--brand); }
        .pcard .ttl { font-size: 13px; font-weight: 500; } .pcard .meta { font-size: 11.5px; color: var(--ink-dim); }
        .composer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 3; padding: 14px 22px 22px; display: flex; flex-direction: column; align-items: center; gap: 10px; background: linear-gradient(transparent, var(--bg) 38%); }
        .hint, .suggest, .pill { width: 100%; max-width: 460px; }
        .hint { text-align: center; font-size: 12.5px; color: var(--ink-muted); background: rgba(255,255,255,0.8); backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: 12px; padding: 8px 14px; box-shadow: 0 6px 18px rgba(20,26,38,0.06); }
        .suggest { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; }
        .suggest button { font-size: 12.5px; color: var(--ink-muted); cursor: pointer; background: rgba(255,255,255,0.72); backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: 100px; padding: 7px 13px; box-shadow: 0 4px 14px rgba(20,26,38,0.05); }
        .suggest button:hover { color: var(--ink); border-color: rgba(255,123,44,0.3); }
        .pill { display: flex; align-items: center; gap: 8px; padding: 7px 7px 7px 16px; border-radius: 18px; background: rgba(255,255,255,0.82); backdrop-filter: blur(24px) saturate(1.4); border: 1px solid var(--border); box-shadow: 0 16px 40px rgba(20,26,38,0.1); }
        .pill input { flex: 1; border: none; outline: none; font-size: 14.5px; background: transparent; color: var(--ink); font-family: inherit; }
        .pill input::placeholder { color: var(--ink-dim); }
        .mic, .send { width: 38px; height: 38px; border-radius: 12px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; }
        .mic { background: rgba(15,18,24,0.05); color: var(--ink-muted); }
        .mic.on { background: var(--brand); color: #fff; animation: mp 1.3s infinite; }
        @keyframes mp { 0%{box-shadow:0 0 0 0 rgba(255,123,44,0.5)} 70%{box-shadow:0 0 0 10px rgba(255,123,44,0)} 100%{box-shadow:0 0 0 0 rgba(255,123,44,0)} }
        .send { background: var(--brand); color: #fff; font-size: 17px; }
        .send:disabled { opacity: .45; cursor: default; }
      `}</style>
    </div>
  );
}
