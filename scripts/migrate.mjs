#!/usr/bin/env node
/**
 * Apply supabase/migrations/*.sql through the Supabase Management API.
 *
 * WHY NOT `supabase db push`. That is the right tool and it needs the database
 * password, which is a second secret nobody has put anywhere. The Management
 * API takes the SUPABASE_ACCESS_TOKEN the deploy workflow already holds, so
 * this needs no new credential. If the password ever lands in CI, delete this
 * and use db push.
 *
 * WHAT IT TRACKS. The same table the CLI uses —
 * supabase_migrations.schema_migrations — so this and `db push` agree about
 * what has run and either can take over later. `version` is the numeric prefix
 * of the filename (0112), because that is how this repo names migrations.
 *
 * MODES, and the default is the harmless one:
 *
 *   plan      (default) list what would run. Touches nothing.
 *   apply     run every pending migration, oldest first, stopping at the first
 *             failure.
 *   baseline  record every migration file as applied WITHOUT running it.
 *
 * BASELINE EXISTS BECAUSE THIS DATABASE IS NOT EMPTY. 112 migrations were
 * applied to it by hand long before any of this, and schema_migrations may
 * know about none of them. Running `apply` against that would try to create
 * tables that already exist, fail on the first one, and tell you nothing
 * useful. Baseline draws the line at "everything committed today is already
 * live" — which is true — so only genuinely new files ever run.
 *
 * Run baseline ONCE, before the first apply. It is refused if anything is
 * already recorded, so it cannot silently skip a migration that never ran.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const REF = process.env.SUPABASE_PROJECT_REF || 'bhrhejpekmhbhwryjhgk';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const MODE = (process.argv[2] || 'plan').toLowerCase();
const DIR = process.env.MIGRATIONS_DIR || join(process.cwd(), 'supabase', 'migrations');
/* Overridable so the whole thing can be exercised against a stub before it is
   ever pointed at a real database. A migration runner that has only been
   tested in production is not a runner, it is a hope. */
const API_BASE = process.env.SUPABASE_API_URL || 'https://api.supabase.com';
const API = `${API_BASE}/v1/projects/${REF}/database/query`;

if (!TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN is not set.');
  process.exit(1);
}
if (!['plan', 'apply', 'baseline'].includes(MODE)) {
  console.error(`Unknown mode "${MODE}". Use plan, apply or baseline.`);
  process.exit(1);
}

/** One round trip. Errors carry the server's own words — a migration that
 *  fails is read by a human who needs the Postgres message, not a status. */
async function sql(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 1500);
    try {
      const j = JSON.parse(text);
      detail = j.message || j.error || detail;
    } catch { /* not JSON; the raw body is the best we have */ }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  try { return JSON.parse(text); } catch { return []; }
}

/** The numeric prefix is the version. A file without one is a naming mistake
 *  rather than a migration, and is refused rather than guessed at. */
function versionOf(file) {
  const m = basename(file).match(/^(\d+)[_-]/);
  if (!m) throw new Error(`Migration "${file}" has no numeric prefix; cannot version it.`);
  return m[1];
}

function migrationFiles() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => versionOf(a).localeCompare(versionOf(b), undefined, { numeric: true }));
}

/* Postgres has transactional DDL, so a migration that fails midway should
   leave nothing behind. A few statements legitimately cannot run inside a
   transaction block; those files opt out with this marker on any line. */
const NO_TX = /--\s*migrate:\s*no-transaction/i;

async function ensureTable() {
  await sql(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  `);
}

async function applied() {
  const rows = await sql(
    'select version from supabase_migrations.schema_migrations order by version;',
  );
  return new Set((Array.isArray(rows) ? rows : []).map((r) => String(r.version)));
}

/** Recorded in the same shape the CLI writes, so `db push` reads it correctly.
 *  The body is stored as a single-element statements array: this applies a
 *  file whole rather than splitting it on semicolons, because splitting SQL on
 *  semicolons breaks every function body and dollar-quoted string in this
 *  repo — and most of these migrations are plpgsql. */
function recordSql(version, name, body) {
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  return `insert into supabase_migrations.schema_migrations (version, name, statements)
          values (${lit(version)}, ${lit(name)}, array[${lit(body)}]::text[])
          on conflict (version) do nothing;`;
}

const files = migrationFiles();
await ensureTable();
const done = await applied();
const pending = files.filter((f) => !done.has(versionOf(f)));

console.log(`project   ${REF}`);
console.log(`mode      ${MODE}`);
console.log(`on disk   ${files.length} migration(s)`);
console.log(`recorded  ${done.size}`);
console.log(`pending   ${pending.length}`);

/* WHEN NOTHING MATCHES, SAY SO LOUDLY. A database with history recorded under
   a different version scheme reports every file as pending, which looks
   identical to a fresh database and is the most dangerous state this script
   can be in: `apply` would try to recreate tables that already exist. The
   numbers alone do not reveal it, so the versions themselves are printed. */
const overlap = files.filter((f) => done.has(versionOf(f))).length;
if (done.size > 0 && overlap === 0) {
  const sample = [...done].slice(0, 3).join(', ');
  const last = [...done].slice(-3).join(', ');
  console.log('\n!! The recorded history does not use this repo\'s version scheme.');
  console.log(`   recorded versions look like: ${sample} … ${last}`);
  console.log(`   this repo's files look like: ${files.slice(0, 3).map(versionOf).join(', ')}`);
  console.log('   Every file therefore reads as pending when it may already be applied.');
  console.log('   Do NOT run apply until these are reconciled.');
}

if (MODE === 'plan') {
  if (!pending.length) console.log('\nNothing pending.');
  else {
    console.log('\nWould apply, in this order:');
    for (const f of pending) console.log(`  ${versionOf(f).padStart(4)}  ${f}`);
    console.log('\nRun with mode "apply" to execute. If this database already has '
      + 'these changes, run "baseline" first.');
  }
  process.exit(0);
}

if (MODE === 'baseline') {
  if (done.size > 0) {
    console.error(`\nRefusing to baseline: ${done.size} migration(s) are already recorded. `
      + 'Baseline is only for a database whose history has never been tracked — '
      + 'running it now could mark a genuinely pending migration as done.');
    process.exit(1);
  }
  for (const f of files) {
    const body = readFileSync(join(DIR, f), 'utf8');
    await sql(recordSql(versionOf(f), f, body));
    console.log(`  recorded (not run)  ${f}`);
  }
  console.log(`\nBaselined ${files.length} migration(s). Only new files will run from now on.`);
  process.exit(0);
}

// apply
if (done.size > 0 && overlap === 0) {
  console.error('\nRefusing to apply: this database has ' + done.size + ' migration(s) recorded '
    + 'and not one of them matches a file in this repo. That means the history was tracked under '
    + 'a different version scheme, not that these files are new — applying them would try to '
    + 'recreate objects that already exist, against a live database. Reconcile the versions first.');
  process.exit(1);
}
if (!pending.length) {
  console.log('\nNothing pending.');
  process.exit(0);
}
for (const f of pending) {
  const version = versionOf(f);
  const body = readFileSync(join(DIR, f), 'utf8');
  const wrap = !NO_TX.test(body);
  process.stdout.write(`  applying ${f}${wrap ? '' : ' (no transaction)'} ... `);
  try {
    /* The record goes in the SAME transaction as the migration, so a file can
       never be marked applied unless it actually was. Without that, a failure
       after the DDL but before the insert leaves a migration that has run and
       will run again on the next push. */
    await sql(wrap ? `begin;\n${body}\n${recordSql(version, f, body)}\ncommit;` : body);
    if (!wrap) await sql(recordSql(version, f, body));
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    console.error(`\n${f} did not apply:\n${err.message}\n`);
    if (!wrap) {
      console.error('This file opted out of the transaction wrapper, so part of it may '
        + 'have run. Check the database before retrying.');
    }
    console.error('Stopped. Nothing after this file was attempted.');
    process.exit(1);
  }
}
console.log(`\nApplied ${pending.length} migration(s).`);
