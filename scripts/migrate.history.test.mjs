// Exercises scripts/migrate.mjs "export" and "bootstrap" against a local stand-in
// for the Supabase Management API (no real database is touched).
//   node scripts/migrate.history.test.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'migrate.mjs');
const results = [];
const check = (name, cond, extra = '') => results.push((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + extra));

const HISTORY = [
  { version: '20260626034445', name: 'foundation_layer1_mvp', statements: ['create table a (id int)', 'create table b (id int);'] },
  { version: '20260811164753', name: 'claim_outbox_batch', statements: ['create function f() returns int language sql as $$ select 1 $$'] },
  { version: '20261003180000', name: '20261003180000_an_uncertain_post_is_not_resent.sql', statements: ['select 1;'] },
];

let publicTables = 0;
const seen = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const q = String(JSON.parse(body || '{}').query || '');
    seen.push(q);
    res.setHeader('Content-Type', 'application/json');
    if (/from supabase_migrations\.schema_migrations order by version/i.test(q) && /statements/i.test(q)) return res.end(JSON.stringify(HISTORY));
    if (/information_schema\.tables/i.test(q)) return res.end(JSON.stringify([{ n: publicTables }]));
    res.end('[]');
  });
});
await new Promise((r) => server.listen(0, r));
const api = 'http://127.0.0.1:' + server.address().port;

// Async, because the stand-in server runs in THIS process: a synchronous child
// would block it and deadlock.
const run = (mode, env, args = []) => new Promise((resolve) => {
  const c = spawn(process.execPath, [script, mode, ...args], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: 'test', SUPABASE_API_URL: api, ...env },
  });
  let stdout = '', stderr = '';
  c.stdout.on('data', (d) => (stdout += d)); c.stderr.on('data', (d) => (stderr += d));
  c.on('close', (status) => resolve({ status, stdout, stderr }));
});

const dir = mkdtempSync(join(tmpdir(), 'hist-'));

// ── export ────────────────────────────────────────────────────────────────
let r = await run('export', { SUPABASE_PROJECT_REF: 'prodlike', HISTORY_DIR: dir });
const files = readdirSync(dir).sort();
check('export exits 0', r.status === 0, r.stderr);
check('export writes one file per recorded migration, in version order',
  JSON.stringify(files) === JSON.stringify([
    '20260626034445_foundation_layer1_mvp.sql',
    '20260811164753_claim_outbox_batch.sql',
    '20261003180000_an_uncertain_post_is_not_resent.sql']), files.join(','));
check('export joins statements and terminates each', /create table a \(id int\)\n;\ncreate table b \(id int\);/.test(readFileSync(join(dir, files[0]), 'utf8')));
check('export read inside a read-only transaction', seen.some((q) => /begin transaction read only/i.test(q)));

// ── bootstrap refusals ────────────────────────────────────────────────────
r = await run('bootstrap', { HISTORY_DIR: dir, SUPABASE_PROJECT_REF: '' });
check('bootstrap refuses without an explicit project', r.status !== 0 && /Refusing/.test(r.stderr), r.stderr);
r = await run('bootstrap', { HISTORY_DIR: dir, SUPABASE_PROJECT_REF: 'bhrhejpekmhbhwryjhgk' });
check('bootstrap refuses the production project', r.status !== 0 && /production/.test(r.stderr), r.stderr);
r = await run('bootstrap', { HISTORY_DIR: join(dir, 'nope'), SUPABASE_PROJECT_REF: 'newproj' });
check('bootstrap refuses a missing history', r.status !== 0 && /no history/.test(r.stderr), r.stderr);
publicTables = 5;
r = await run('bootstrap', { HISTORY_DIR: dir, SUPABASE_PROJECT_REF: 'newproj' });
check('bootstrap refuses a target that already has tables', r.status !== 0 && /already has 5 table/.test(r.stderr), r.stderr);

// ── bootstrap, empty target ───────────────────────────────────────────────
publicTables = 0; seen.length = 0;
r = await run('bootstrap', { HISTORY_DIR: dir, SUPABASE_PROJECT_REF: 'newproj' });
const applied = seen.filter((q) => /^begin;/i.test(q));
check('bootstrap exits 0 on an empty target', r.status === 0, r.stderr + r.stdout);
check('bootstrap applies every file, each in a transaction with its record', applied.length === 3 && applied.every((q) => /schema_migrations/.test(q) && /commit;\s*$/i.test(q)), String(applied.length));
check('bootstrap applies in version order',
  applied[0].includes('create table a') && applied[1].includes('create function f') && applied[2].includes('select 1'));

server.close(); rmSync(dir, { recursive: true, force: true });
console.log(results.join('\n'));
process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
