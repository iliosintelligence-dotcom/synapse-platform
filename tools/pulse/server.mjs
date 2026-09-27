/**
 * Synapse Pulse — the founder's usage dashboard, run locally.
 *
 *   node tools/pulse/server.mjs      then open http://localhost:4317
 *
 * Why a local server rather than a page on the site: the numbers include
 * sign-ups and the first line of every Tayo conversation, which only the
 * service role may read (public.pulse_report). The service key therefore
 * stays in tools/pulse/.env on this machine, is used here, server-side, and
 * never reaches the browser or the repository (.env is gitignored).
 *
 * No dependencies: Node 18+ has fetch. Listens on 127.0.0.1 only, so nothing
 * else on the network can ask it for the report.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* .env, read by hand: KEY=value lines, quotes optional, # comments. */
const env = {};
try {
  const raw = await readFile(path.join(HERE, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* no .env yet: the page explains what to put in it */ }

const SUPABASE_URL = (env.SUPABASE_URL || process.env.SUPABASE_URL || 'https://bhrhejpekmhbhwryjhgk.supabase.co').replace(/\/+$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PORT = Number(env.PULSE_PORT || process.env.PULSE_PORT || 4317);
/* For trying the page without a key: a saved report, labelled as a sample
   on screen so it is never mistaken for live figures. */
const SAMPLE = env.PULSE_SAMPLE_FILE || process.env.PULSE_SAMPLE_FILE || '';

async function report(days) {
  if (!KEY) {
    if (SAMPLE) return { status: 200, body: { ...JSON.parse(await readFile(SAMPLE, 'utf8')), sample: true } };
    return { status: 503, body: { error: 'No key yet. Put SUPABASE_SERVICE_ROLE_KEY in tools/pulse/.env (see .env.example), then restart.' } };
  }
  /* The new-style secret keys (sb_secret_…) go in apikey alone; the legacy
     service_role JWT also goes in Authorization. */
  const headers = { apikey: KEY, 'Content-Type': 'application/json' };
  if (!KEY.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + KEY;
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/pulse_report', {
    method: 'POST', headers, body: JSON.stringify({ p_days: days }),
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 300) }; }
  if (!r.ok) return { status: r.status, body: { error: body.message || body.error || ('Supabase answered ' + r.status) } };
  return { status: 200, body };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/report') {
      const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '30', 10) || 30));
      const out = await report(days);
      res.writeHead(out.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out.body));
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await readFile(path.join(HERE, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Synapse Pulse on http://localhost:' + PORT
    + (KEY ? '' : SAMPLE ? '  (SAMPLE data: no key set)' : '  (no key yet: see tools/pulse/.env.example)'));
});
