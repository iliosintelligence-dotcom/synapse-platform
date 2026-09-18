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
 * what has run and either can take over later. `version` is the 14-digit
 * timestamp prefix, which is what this database already records: 153 entries
 * from 20260626034445 to 20260915080921. The 110 files named 0001_… upward are
 * LEGACY, already applied under those timestamps, and are left alone.
 *
 * MODES, and the default is the harmless one:
 *
 *   plan      (default) list what would run. Touches nothing.
 *   apply     run every pending migration, oldest first, stopping at the first
 *             failure.
 *   baseline  record every migration file as applied WITHOUT running it.
 *
 * BASELINE is for a database whose history was never tracked at all: it
 * records the managed files as applied WITHOUT running them. This project does
 * not need it — its 153 entries are already there — and it refuses outright if
 * anything is recorded, so it cannot silently skip a migration that never ran.
 *
 * NEW MIGRATIONS: `supabase migration new <name>`, which generates the
 * timestamp. A file that follows neither scheme is refused before any network
 * call rather than ignored.
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
if (!['plan', 'apply', 'baseline', 'query'].includes(MODE)) {
  console.error(`Unknown mode "${MODE}". Use plan, apply, baseline or query.`);
  process.exit(1);
}

/* READ-ONLY, AND ENFORCED RATHER THAN TRUSTED. The Supabase connector is
   authorised for another organisation, so a session cannot see this database
   at all — which has meant answering "did that post carousel?" by guessing.
   This gives the same token a way to LOOK without a way to change anything.

   The Management API endpoint will run whatever it is given, so the guard is
   here: one statement, and it must be a SELECT or a WITH. Anything else is
   refused before it is sent. That is deliberately blunt — a clever allowlist
   invites somebody to widen it, and the whole point is that the read path
   cannot become a write path by accident. Schema changes go through `apply`,
   where they are recorded and reviewable. */
function assertReadOnly(q) {
  const stripped = q
    .replace(/--[^\n]*/g, ' ')            // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ')    // block comments
    .trim()
    .replace(/;\s*$/, '');                // one trailing semicolon is fine
  if (!stripped) throw new Error('Empty query.');
  if (stripped.includes(';')) {
    throw new Error('One statement only \u2014 found a semicolon inside the query.');
  }
  if (!/^(select|with)\b/i.test(stripped)) {
    throw new Error('Read-only: the query must begin with SELECT or WITH. '
      + 'Schema and data changes belong in a migration, applied with mode "apply".');
  }
  /* THE WORD BOUNDARIES ARE NOT DECORATION. Without \b this matches inside
     ordinary identifiers \u2014 "created_at" contains "create", "updated_at"
     contains "update" \u2014 so `select created_at from social_posts` would be
     refused as a write. A guard that blocks the query you actually need is a
     guard somebody switches off. */
  const banned = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|refresh)\b/i;
  const hit = stripped.match(banned);
  if (hit) throw new Error(`Read-only: "${hit[0]}" is not allowed in a query.`);
  return stripped;
}

/** One round trip. Errors carry the server's own words — a migration that
 *  fails is read by a human who needs the Postgres message, not a status. */
async function sql(query) {
  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
  } catch (err) {
    /* DNS, TLS, a dropped connection. Nothing was applied, and whoever is
       reading the log needs that in a sentence rather than a stack trace
       about fetch. */
    throw new Error(`could not reach ${API_BASE}: ${err instanceof Error ? err.message : err}`);
  }
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

/* TWO NAMING SCHEMES LIVE IN THIS FOLDER, and only one of them is tracked.
   The database records migrations by CLI timestamp — 20260626034445 through
   20260915080921, 153 of them — while the 110 files committed here are named
   0001_extensions.sql upward. Those numbers were this repo's own convention
   and were never the recorded version, so matching on them made every file
   look pending on a database that already had all of it.

   The timestamp wins, because it is what the database and the Supabase CLI
   both already use, and because renaming 110 applied migrations would change
   nothing except the chance of getting it wrong.

   So: a file named <14 digits>_name.sql is MANAGED by this script. A file
   named <short number>_name.sql is LEGACY — already applied, left alone, and
   reported so it is never silently confused for something new. Create new ones
   with `supabase migration new <name>`, which generates the timestamp. */
const TIMESTAMP = /^(\d{14})_/;
const LEGACY = /^(\d{1,6})[_-]/;

function versionOf(file) {
  const m = basename(file).match(TIMESTAMP);
  if (!m) throw new Error(`Migration "${file}" is not timestamp-named; cannot version it.`);
  return m[1];
}

/** Every .sql in the folder, split by which scheme names it. */
function partition() {
  const all = readdirSync(DIR).filter((f) => f.endsWith('.sql'));
  const managed = all.filter((f) => TIMESTAMP.test(f)).sort();
  const legacy = all.filter((f) => !TIMESTAMP.test(f) && LEGACY.test(f)).sort();
  const unnamed = all.filter((f) => !TIMESTAMP.test(f) && !LEGACY.test(f));
  return { managed, legacy, unnamed };
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

/* EVERYTHING BELOW RUNS INSIDE main(), and that is not cosmetic. This module
   used top-level await, and in Node 22 a rejected top-level await surfaces as
   an uncaught exception that process.on('unhandledRejection') never sees — so
   an unreachable API printed a stack trace instead of the sentence the throw
   already carried. An explicit catch is the only version that works. */
async function main() {
  /* Before the migration bookkeeping: a query neither reads nor writes
   schema_migrations, and should not fail because a file is misnamed. */
if (MODE === 'query') {
  const q = process.argv.slice(3).join(' ').trim() || process.env.QUERY || '';
  if (!q) {
    console.error('Nothing to run. Pass the SQL after the mode, or set QUERY.');
    process.exit(1);
  }
  const safe = assertReadOnly(q);
  const rows = await sql(safe);
  if (!Array.isArray(rows) || rows.length === 0) console.log('(no rows)');
  else {
    console.log(`${rows.length} row(s)`);
    console.log(JSON.stringify(rows, null, 2));
  }
  process.exit(0);
}

const { managed: files, legacy, unnamed } = partition();

  /* BEFORE ANY NETWORK CALL. A misnamed file is a problem with the checkout, not
     with the database, and finding out about it after two round trips — or worse,
     after the first migration has been applied — helps nobody. Nothing has
     happened yet at this point, so exiting here is free. */
  if (unnamed.length) {
    console.error(`Refusing to continue: ${unnamed.length} file(s) in ${DIR} follow neither `
      + `naming scheme and would be silently ignored:\n  ${unnamed.join('\n  ')}\n`
      + 'Name new migrations with `supabase migration new <name>`.');
    process.exit(1);
  }

  await ensureTable();
  const done = await applied();
  const pending = files.filter((f) => !done.has(versionOf(f)));

  console.log(`project   ${REF}`);
  console.log(`mode      ${MODE}`);
  console.log(`managed   ${files.length} timestamp-named migration(s)`);
  console.log(`legacy    ${legacy.length} number-named, already applied — not managed here`);
  console.log(`recorded  ${done.size} in the database`);
  console.log(`pending   ${pending.length}`);

  /* THE TRAP THIS REPLACES. Matching on the old 0001-style prefix made all 110
     committed files read as pending against a database that already had every
     one of them, which is indistinguishable from a fresh database by the counts
     alone — and apply would have tried to recreate the objects in
     0001_extensions.sql on production. Managed files now share the database's
     own scheme, so a zero overlap here means genuinely new work, not a mismatch.
     The check stays as the alarm for the day somebody reintroduces one. */
  const overlap = files.filter((f) => done.has(versionOf(f))).length;
  const mismatched = files.length > 0 && done.size > 0 && overlap === 0;
  if (mismatched) {
    console.log('\n!! None of the managed files match the recorded history.');
    console.log(`   recorded: ${[...done].slice(-3).join(', ')}`);
    console.log(`   on disk : ${files.slice(0, 3).map(versionOf).join(', ')}`);
    console.log('   If these are genuinely new, this is fine. If not, do NOT apply.');
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
  /* No mismatch guard here any more, and that is the point of the rename:
     managed files now share the database's own timestamp scheme, so a version
     nobody has recorded really is new work rather than a naming accident. The
     warning above still prints if the overlap is ever zero, which is the alarm
     for the day somebody reintroduces a second scheme. */
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
}

main().catch((err) => {
  console.error(`
${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
