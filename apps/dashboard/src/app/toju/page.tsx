'use client';

/**
 * Toju — the consumer AI property consultant as a real React/Next page.
 * Faithful port of the approved prototype (Synapse/app/toju.html):
 * visible warm interior + terracotta wash, blended liquid glass (no shiny
 * edges), chatbox composer with suggestions tucked at the bottom, real
 * verified matches from the seeded inventory, localStorage chat memory.
 */
import { useEffect, useRef, useState } from 'react';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://bhrhejpekmhbhwryjhgk.supabase.co';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_D25gO3eui5oI4L3h7bx-vg_fCHbo3LV';
const STORE = 'toju_chat_v1';

type Match = {
  price: number; title: string; bedrooms: number; trustScore: number;
  city: string; yieldPct?: number | null; whatToWatch?: string | null;
};
type Saved = { role: 'user' | 'assistant'; content: string; matches?: Match[] };
type Entry = Saved | { role: 'typing'; content?: never };

const GREETING =
  "Good afternoon. I'm Toju — your consultant at Synapse. Tell me what you're looking for and I'll find verified homes that fit. No forms, no endless scrolling.";
const STARTERS: Array<[string, string]> = [
  ['3-bed in Lekki under ₦180M', '3-bed in Lekki under ₦180M'],
  ['What can I afford on ₦2M a month?', 'What can I afford monthly?'],
  ['Best value areas for a first home', 'Good areas for a first home'],
];

function naira(n: number) {
  n = Number(n) || 0;
  if (n >= 1e9) return '₦' + (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1) + 'B';
  if (n >= 1e6) return '₦' + Math.round(n / 1e6) + 'M';
  return '₦' + n.toLocaleString();
}

export default function TojuPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const saved = useRef<Saved[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<any>(null);

  // restore the saved conversation so people continue where they left off
  useEffect(() => {
    let s: Saved[] = [];
    try { s = JSON.parse(localStorage.getItem(STORE) || '[]') || []; } catch {}
    if (s.length === 0) s = [{ role: 'assistant', content: GREETING }];
    saved.current = s;
    persist();
    setEntries([...s]);
  }, []);

  useEffect(() => { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }, [entries]);

  function persist() { try { localStorage.setItem(STORE, JSON.stringify(saved.current)); } catch {} }

  function newChat() {
    try { localStorage.removeItem(STORE); } catch {}
    saved.current = [{ role: 'assistant', content: GREETING }];
    persist();
    setEntries([...saved.current]);
  }

  async function send(text?: string) {
    const v = (text ?? input).trim();
    if (!v || busy) return;
    setBusy(true);
    setInput('');
    saved.current.push({ role: 'user', content: v });
    persist();
    setEntries([...saved.current, { role: 'typing' }]);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/toju-demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ messages: saved.current.slice(-14).map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.reply) {
        setEntries([...saved.current, { role: 'assistant', content: "I'm having a moment connecting — mind trying that again in a second?" }]);
      } else {
        const matches: Match[] = data.showMatches === true && Array.isArray(data.matches) ? data.matches : [];
        saved.current.push({ role: 'assistant', content: data.reply, matches });
        persist();
        setEntries([...saved.current]);
      }
    } catch {
      setEntries([...saved.current, { role: 'assistant', content: "I'm having a moment connecting — mind trying that again in a second?" }]);
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
        <span className="spacer" />
        <button className="newchat" onClick={newChat}>↺ New chat</button>
      </header>

      <main className="wrap">
        <div className="eyebrow">AI Property Consultant</div>
        <h1 className="title">Toju <span className="dot" /></h1>

        <div className="convo">
          {entries.map((entry, i) => {
            if (entry.role === 'user')
              return (
                <div className="msg user" key={i}>
                  <div className="col"><div className="bubble">{entry.content}</div></div>
                  <div className="av avu">A</div>
                </div>
              );
            if (entry.role === 'typing')
              return (
                <div className="msg toju" key={i}>
                  <div className="av avt">✦</div>
                  <div className="col"><div className="sender">Toju</div>
                    <div className="bubble typing"><span className="dots"><i /><i /><i /></span><em>thinking…</em></div>
                  </div>
                </div>
              );
            const matches = entry.matches ?? [];
            return (
              <div className="msg toju" key={i}>
                <div className="av avt">✦</div>
                <div className="col">
                  <div className="sender">Toju</div>
                  <div className="bubble">{entry.content}</div>
                  {matches.length > 0 && (
                    <>
                      <div className="mh"><span>✦</span><span className="lbl">VERIFIED MATCHES</span><span className="cnt">{matches.length}</span></div>
                      {matches.map((m, j) => (
                        <a className="pcard" href="#" key={j} onClick={(e) => e.preventDefault()}>
                          <div className="pthumb"><b>{Number(m.bedrooms) || 0}</b><span>BED</span></div>
                          <div>
                            <div className="price">{naira(m.price)}</div>
                            <div className="ttl">{m.title}</div>
                            <div className="meta"><span className="trust">✦ Trust {Number(m.trustScore) || 0}</span> · {m.city}{m.yieldPct != null && m.yieldPct > 0 ? ` · ${m.yieldPct}% yield` : ''}</div>
                            {m.whatToWatch && m.whatToWatch !== 'No major synthetic flags' && (
                              <div className="watch"><b>Watch:</b> {m.whatToWatch}</div>
                            )}
                          </div>
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
        <div className="chatbox">
          <div className="pillrow">
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
              placeholder={listening ? 'Listening… speak now' : "Tell Toju what you're looking for…"} />
            <button className={`mic${listening ? ' on' : ''}`} onClick={toggleMic} aria-label="Voice typing">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" /></svg>
            </button>
            <button className="send" onClick={() => send()} disabled={!input.trim() || busy} aria-label="Send">↑</button>
          </div>
          <div className="suggest">
            {STARTERS.map(([msg, label]) => (<button key={label} onClick={() => send(msg)} disabled={busy}>{label}</button>))}
          </div>
        </div>
      </div>

      <style jsx global>{`
        :root { --brand:#FF7B2C; --ink:#15171a; --ink-muted:rgba(21,23,26,0.55); --ink-dim:rgba(21,23,26,0.35); --border:rgba(15,18,24,0.08); --success:#2e7d4f; }
        body { background: #241208; margin: 0; font-family: 'Inter', system-ui, sans-serif; color: var(--ink); }
      `}</style>
      <style jsx>{`
        .tj { min-height: 100vh; }
        .bg { position: fixed; inset: 0; z-index: 0; background: url('https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=1600&q=80') center/cover no-repeat; }
        .wash { position: fixed; inset: 0; z-index: 0;
          background:
            radial-gradient(130% 85% at 80% 0%, rgba(194,85,43,0.26), transparent 60%),
            linear-gradient(180deg, rgba(176,74,36,0.13) 0%, rgba(150,62,30,0.17) 52%, rgba(54,26,12,0.42) 100%); }
        .bar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 22px; padding: 14px 22px; background: rgba(255,250,246,0.55); backdrop-filter: blur(22px) saturate(1.6); border-bottom: 1px solid rgba(40,24,14,0.06); }
        .brand { font-weight: 700; letter-spacing: 0.22em; font-size: 12px; color: var(--ink); text-decoration: none; }
        nav { display: flex; gap: 4px; }
        nav .active { font-size: 13px; color: var(--brand); padding: 7px 13px; border-radius: 100px; background: rgba(255,123,44,0.1); }
        nav a { font-size: 13px; color: var(--ink-muted); padding: 7px 13px; border-radius: 100px; text-decoration: none; }
        .spacer { flex: 1; }
        .newchat { background: none; border: none; cursor: pointer; font: inherit; font-size: 13px; color: var(--ink-muted); }
        .newchat:hover { color: var(--ink); }
        .wrap { position: relative; z-index: 1; max-width: 480px; margin: 0 auto; padding: 26px 22px 190px; }
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
        .toju .bubble { background: rgba(255,250,246,0.44); backdrop-filter: blur(30px) saturate(1.9); -webkit-backdrop-filter: blur(30px) saturate(1.9); border: 1px solid rgba(40,24,14,0.06); color: var(--ink); border-bottom-left-radius: 6px; box-shadow: 0 14px 38px rgba(20,26,38,0.08); }
        .user .bubble { background: rgba(255,123,44,0.58); backdrop-filter: blur(18px) saturate(1.7); -webkit-backdrop-filter: blur(18px) saturate(1.7); color: #fff; border: 1px solid rgba(150,60,25,0.12); border-bottom-right-radius: 6px; box-shadow: 0 10px 26px rgba(255,123,44,0.2); }
        .bubble.typing { display: flex; align-items: center; gap: 9px; color: var(--ink-muted); }
        .bubble.typing em { font-style: italic; }
        .dots { display: flex; gap: 4px; } .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); animation: p 1.1s infinite; } .dots i:nth-child(2){animation-delay:.18s} .dots i:nth-child(3){animation-delay:.36s}
        @keyframes p { 0%,60%,100%{opacity:.25} 30%{opacity:1} }
        .mh { display: flex; align-items: center; gap: 7px; margin: 12px 0 8px; color: var(--brand); }
        .mh .lbl { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; }
        .mh .cnt { font-size: 11px; font-weight: 700; background: rgba(255,123,44,0.12); border-radius: 9px; min-width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; padding: 0 5px; }
        .pcard { display: flex; gap: 13px; margin-top: 9px; padding: 11px; border-radius: 15px; text-decoration: none; color: var(--ink); background: rgba(255,255,255,0.82); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); border: 1px solid var(--border); box-shadow: 0 10px 26px rgba(20,26,38,0.06); transition: all .2s; }
        .pcard:hover { transform: translateY(-1px); border-color: rgba(255,123,44,0.25); }
        .pthumb { width: 62px; height: 62px; border-radius: 12px; flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; font-family: 'Fraunces', Georgia, serif; background: linear-gradient(135deg, #C2552B, #FF7B2C); box-shadow: inset 0 1px 0 rgba(255,255,255,0.25); }
        .pthumb b { font-size: 20px; line-height: 1; }
        .pthumb span { font-size: 9px; letter-spacing: .08em; opacity: .9; margin-top: 3px; }
        .pcard .price { font-family: 'Fraunces', Georgia, serif; font-size: 21px; color: var(--brand); }
        .pcard .ttl { font-size: 13px; font-weight: 500; } .pcard .meta { font-size: 11.5px; color: var(--ink-dim); }
        .pcard .trust { display: inline-flex; align-items: center; gap: 3px; font-weight: 700; color: var(--brand); }
        .pcard .watch { font-size: 11px; color: var(--ink-dim); margin-top: 3px; }
        .pcard .watch b { color: #b0521f; font-weight: 600; }
        .composer { position: fixed; left: 0; right: 0; bottom: 0; z-index: 3; padding: 14px 22px 34px; display: flex; flex-direction: column; align-items: center; gap: 9px; background: none; }
        .hint { width: 100%; max-width: 480px; text-align: center; font-size: 12.5px; color: var(--ink-muted); background: rgba(255,250,246,0.6); backdrop-filter: blur(16px); border: 1px solid var(--border); border-radius: 12px; padding: 8px 14px; box-shadow: 0 6px 18px rgba(20,26,38,0.08); }
        .chatbox { width: 100%; max-width: 480px; border-radius: 24px; padding: 6px 6px 8px; background: rgba(255,250,246,0.34); backdrop-filter: blur(32px) saturate(1.9); -webkit-backdrop-filter: blur(32px) saturate(1.9); border: 1px solid rgba(40,24,14,0.06); box-shadow: 0 22px 54px rgba(20,26,38,0.16); }
        .pillrow { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 15px; }
        .pillrow input { flex: 1; border: none; outline: none; font-size: 14.5px; background: transparent; color: var(--ink); font-family: inherit; }
        .pillrow input::placeholder { color: var(--ink-dim); }
        .mic, .send { width: 38px; height: 38px; border-radius: 13px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; }
        .mic { background: rgba(255,255,255,0.5); color: var(--ink-muted); }
        .mic.on { background: var(--brand); color: #fff; animation: mp 1.3s infinite; }
        @keyframes mp { 0%{box-shadow:0 0 0 0 rgba(255,123,44,0.5)} 70%{box-shadow:0 0 0 10px rgba(255,123,44,0)} 100%{box-shadow:0 0 0 0 rgba(255,123,44,0)} }
        .send { background: var(--brand); color: #fff; font-size: 17px; }
        .send:disabled { opacity: .45; cursor: default; }
        .suggest { display: flex; gap: 7px; padding: 9px 5px 2px; margin-top: 4px; overflow-x: auto; border-top: 1px solid rgba(255,255,255,0.42); }
        .suggest::-webkit-scrollbar { display: none; }
        .suggest button { white-space: nowrap; font-size: 12px; color: var(--ink-muted); cursor: pointer; background: rgba(255,250,246,0.35); border: 1px solid var(--border); border-radius: 100px; padding: 6px 12px; transition: all .18s; font-family: inherit; }
        .suggest button:hover { color: var(--ink); border-color: rgba(255,123,44,0.35); }
      `}</style>
    </div>
  );
}
