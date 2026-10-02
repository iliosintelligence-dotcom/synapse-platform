/**
 * Tests for migrations/20261002150000_an_agency_can_delete_itself.sql.
 *
 * WHAT THIS RUNS AGAINST. A real Postgres 16 -- PGlite, Postgres compiled to
 * WebAssembly and run in-process, so there is nothing to install and no
 * database anywhere is touched. Its tables are rebuilt from the LIVE
 * database's foreign-key graph (fixtures/live_fk_graph_2026-10-02.txt, read
 * from pg_constraint with migrate.yml mode=query: schema only, no data),
 * with every ON DELETE action and every append-only trigger as they are in
 * production. The migration under test is applied verbatim, and so are the
 * two erasure migrations it depends on (reject_mutation, erase_personal_data).
 *
 * WHAT IT CANNOT SEE. Columns that are not foreign keys are only present when
 * the functions under test or erase_personal_data use them, and other
 * triggers (updated_at, plan limits, twins) are not installed. A column the
 * live table lacks would pass here and fail there -- the migration's column
 * names were checked against the live schema separately.
 *
 * Run from this folder (running from the repo root makes Deno's npm
 * resolution walk into apps/mobile/package.json):
 *
 *   npx -y deno@2 test -A --no-config delete_agency_test.ts
 */
import { PGlite } from 'npm:@electric-sql/pglite@0.2.17';
import {
  assert,
  assertEquals,
  assertRejects,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

const here = new URL('.', import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, here));

const ACT: Record<string, string> = { c: 'cascade', n: 'set null', r: 'restrict', a: 'no action' };

/* Columns the code under test (or erase_personal_data) reads or writes,
   beyond the foreign keys the graph already supplies. */
const EXTRA: Record<string, string[]> = {
  agencies: [
    "name text not null default ''",
    "subscription_tier subscription_tier not null default 'free'",
    'subscription_current_period_end timestamptz',
    'deleted_at timestamptz',
  ],
  profiles: [
    "role user_role not null default 'consumer'",
    'full_name text', 'phone text', 'whatsapp text', 'avatar_url text', 'deleted_at timestamptz',
  ],
  agency_members: ["role user_role not null default 'agent'", 'deleted_at timestamptz'],
  properties: [
    'is_active boolean not null default true',
    "status text not null default 'live'",
    'deleted_at timestamptz',
  ],
  social_posts: [
    "status text not null default 'draft'",
    'deleted_at timestamptz',
    "leg text not null default 'agency'",
  ],
  social_accounts: [
    'access_token_ref uuid', 'refresh_token_ref uuid',
    'deleted_at timestamptz', 'is_active boolean not null default true',
  ],
  social_connect_picks: ['token_ref uuid'],
  message_outbox: ["status text not null default 'queued'"],
  documents: ['entity_type document_entity_type not null', 'entity_id uuid not null'],
  consumer_reviews: ['reviewed_entity_type review_entity_type', 'reviewed_entity_id uuid'],
  fraud_flags: ['entity_type text', 'entity_id uuid'],
  trust_audit_logs: ['entity_type text', 'entity_id uuid'],
  events: ["entity_type text not null default 'test'", 'entity_id uuid not null default gen_random_uuid()'],
  push_subscriptions: ["side text not null default 'customer'", 'agency_id uuid', 'visitor_id text'],
  leads: [
    'consumer_name text', 'consumer_phone text', 'preferences jsonb',
    'budget_range text', 'budget_min numeric', 'budget_max numeric',
  ],
};

/* Polymorphic tables with no foreign key at all, so absent from the graph. */
const STANDALONE: Record<string, string[]> = {
  review_aggregates: ['entity_type review_entity_type not null', 'entity_id uuid not null'],
  reputation_timelines: ['entity_type review_entity_type not null', 'entity_id uuid not null'],
  fraud_events: ['entity_type text not null', 'entity_id uuid not null'],
  viral_loop_events: ['entity_type text', 'entity_id uuid'],
};

function schemaFromGraph(): { ddl: string; appendOnly: string[] } {
  const lines = read('fixtures/live_fk_graph_2026-10-02.txt')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const fks: { child: string; col: string; parent: string; act: string }[] = [];
  const appendOnly: string[] = [];
  for (const l of lines) {
    const p = l.split(/\s+/);
    if (p[0] === 'append-only') appendOnly.push(p[1]);
    else fks.push({ child: p[0], col: p[1], parent: p[2], act: p[3] });
  }
  const tables = new Map<string, Set<string>>();
  const add = (t: string, c?: string) => {
    if (t.startsWith('auth.')) return;
    if (!tables.has(t)) tables.set(t, new Set());
    if (c && c !== 'id') tables.get(t)!.add(c);
  };
  for (const f of fks) { add(f.parent); add(f.child, f.col); }

  let ddl = '';
  for (const [t, cols] of tables) {
    const defs = ['id uuid primary key default gen_random_uuid()',
      ...[...cols].map((c) => `${c} uuid`), ...(EXTRA[t] ?? [])];
    ddl += `create table public.${t} (${defs.join(', ')});\n`;
  }
  for (const [t, defs] of Object.entries(STANDALONE)) {
    ddl += `create table public.${t} (id uuid primary key default gen_random_uuid(), ${defs.join(', ')});\n`;
  }
  for (const f of fks) {
    const parent = f.parent.startsWith('auth.') ? f.parent : `public.${f.parent}`;
    ddl += `alter table public.${f.child} add foreign key (${f.col}) references ${parent} (id) on delete ${ACT[f.act]};\n`;
  }
  return { ddl, appendOnly };
}

/* Just enough of a Supabase project for the migrations to apply as written:
   the three API roles, the default privileges that hand them every new
   function (the trap 20260919120000 describes), auth.uid()/auth.role()
   reading the request's JWT claims, and Vault's secrets table. */
const PLATFORM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
  create function auth.role() returns text language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') $$;
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, secret text);
  create type user_role as enum ('consumer', 'agent', 'agency_admin', 'agency_owner', 'platform_admin');
  create type subscription_tier as enum ('free', 'accelerator', 'market_leader');
  create type document_entity_type as enum ('agency', 'agent', 'property', 'deal_room');
  create type review_entity_type as enum ('agency', 'agent');
`;

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(PLATFORM);
  const { ddl, appendOnly } = schemaFromGraph();
  await db.exec(ddl);
  await db.exec(read('../migrations/20260919100000_erasure_becomes_possible.sql'));
  for (const t of appendOnly) {
    await db.exec(`create trigger ${t}_no_mutate before update or delete on public.${t}
                   for each row execute function reject_mutation();`);
  }
  await db.exec(read('../migrations/20260919140000_erasure_anonymises_and_keeps_the_account.sql'));
  await db.exec(read('../migrations/20261002150000_an_agency_can_delete_itself.sql'));
  return db;
}

const asService = (db: PGlite) =>
  db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'service_role' })]);
const asNobody = (db: PGlite) => db.query(`select set_config('request.jwt.claims', '', false)`);

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
async function one(db: PGlite, sql: string, params: unknown[] = []): Promise<Row> {
  const r = await db.query<Row>(sql, params);
  return r.rows[0];
}
async function count(db: PGlite, sql: string, params: unknown[] = []): Promise<number> {
  return Number((await one(db, `select count(*)::int as n from ${sql}`, params)).n);
}
const id = () => crypto.randomUUID();
const sha = async (s: string) => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
  .map((b) => b.toString(16).padStart(2, '0')).join('');

const preview = (db: PGlite, a: string, actor: string) =>
  one(db, 'select agency_deletion_preview($1, $2) as r', [a, actor]).then((x) => x.r);
const begin = (db: PGlite, a: string, actor: string, confirm: string, ack = false) =>
  one(db, 'select agency_deletion_begin($1, $2, $3, $4) as r', [a, actor, confirm, ack]).then((x) => x.r);
const execute = (db: PGlite, a: string, actor: string) =>
  one(db, 'select agency_deletion_execute($1, $2) as r', [a, actor]).then((x) => x.r);
const finish = (db: PGlite, a: string, actor: string, removed: boolean) =>
  one(db, 'select agency_deletion_finish($1, $2, $3) as r', [a, actor, removed]).then((x) => x.r);

async function user(db: PGlite, role = 'consumer'): Promise<string> {
  const u = id();
  await db.query('insert into auth.users (id) values ($1)', [u]);
  await db.query('insert into profiles (id, role, full_name) values ($1, $2, $3)', [u, role, 'Test person']);
  return u;
}
async function agency(db: PGlite, owner: string, name: string, extra: Row = {}): Promise<string> {
  const a = id();
  await db.query(
    `insert into agencies (id, owner_id, name, subscription_tier, subscription_current_period_end)
     values ($1, $2, $3, coalesce($4, 'free')::subscription_tier, $5)`,
    [a, owner, name, extra.tier ?? null, extra.until ?? null]);
  await db.query(`insert into agency_members (agency_id, profile_id, role) values ($1, $2, 'agency_owner')`, [a, owner]);
  return a;
}

/** An agency with something in every place the deletion has to reach. */
async function fullAgency(db: PGlite) {
  const O = await user(db, 'agency_owner');   // the owner
  const M = await user(db, 'agent');          // a team member
  const C = await user(db, 'consumer');       // a buyer
  const P = await user(db, 'agency_owner');   // owner of another agency
  const A = await agency(db, O, 'Lekki Prime’s Realty');
  const B = await agency(db, P, 'Other Homes');
  await db.query(`insert into agency_members (agency_id, profile_id, role) values ($1, $2, 'agent')`, [A, M]);

  const [P1, P2, PB] = [id(), id(), id()];
  await db.query('insert into properties (id, agency_id, listed_by_agent_id) values ($1, $2, $3), ($4, $2, null), ($5, $6, null)',
    [P1, A, M, P2, PB, B]);
  await db.query('insert into property_media (property_id) values ($1), ($1)', [P1]);
  const [L1, L2, LB] = [id(), id(), id()];
  await db.query(`insert into leads (id, agency_id, property_id, consumer_id, assigned_agent_id)
                  values ($1, $2, $3, $4, $5), ($6, $2, null, $4, null), ($7, $8, $9, $4, null)`,
    [L1, A, P1, C, M, L2, LB, B, PB]);

  // Append-only rows, including one in ANOTHER agency that points at our listing.
  await db.query('insert into lead_attribution (agency_id, lead_id, property_id) values ($1, $2, $3)', [A, L1, P1]);
  await db.query('insert into activity_feed (agency_id, lead_id, property_id, agent_id) values ($1, $2, $3, $4)', [A, L1, P1, M]);
  await db.query('insert into activity_feed (agency_id, property_id) values ($1, $2)', [B, P1]);
  await db.query('insert into activity_feed (agency_id, property_id) values ($1, $2)', [B, PB]);
  await db.query('insert into lead_stage_history (lead_id, moved_by) values ($1, $2)', [L1, O]);
  await db.query('insert into channel_interactions (agency_id, property_id) values ($1, $2)', [A, P1]);
  await db.query('insert into events (agency_id, actor_id) values ($1, $2)', [A, O]);
  await db.query('insert into agency_verification_checks (agency_id) values ($1)', [A]);
  await db.query('insert into agent_disciplinary_records (agency_id, agent_id) values ($1, $2)', [A, M]);

  // Tokens: two on the live account, one a reconnect orphaned, one for a
  // connect pick, one belonging to agency B, one platform secret.
  const [s1, s2, s3, s4, s5, s6] = [id(), id(), id(), id(), id(), id()];
  await db.query(`insert into vault.secrets (id, name) values
      ($1, 'social:facebook:' || $7 || ':access:x'), ($2, 'social:facebook:' || $7 || ':refresh:x'),
      ($3, 'social:instagram:' || $7 || ':access:old'), ($4, 'social:facebook:' || $8 || ':access:y'),
      ($5, 'service_role_key'), ($6, 'connect_pick_z')`, [s1, s2, s3, s4, s5, s6, A, B]);
  const SA = id();
  await db.query('insert into social_accounts (id, agency_id, access_token_ref, refresh_token_ref, connected_by) values ($1, $2, $3, $4, $5)',
    [SA, A, s1, s2, M]);
  await db.query('insert into social_connect_picks (agency_id, profile_id, token_ref) values ($1, $2, $3)', [A, O, s6]);

  const [SP1, SP2, SP3, CAMP] = [id(), id(), id(), id()];
  await db.query('insert into campaigns (id, agency_id) values ($1, $2)', [CAMP, A]);
  await db.query(`insert into social_posts (id, agency_id, property_id, status, social_account_id, created_by, campaign_id) values
      ($1, $3, $4, 'published', $5, $6, $7), ($2, $3, $8, 'scheduled', $5, $6, $7)`,
    [SP1, SP2, A, P1, SA, O, CAMP, P2]);
  await db.query(`insert into social_posts (id, agency_id, property_id, status, leg, twin_of) values ($1, $2, $3, 'scheduled', 'synapse', $4)`,
    [SP3, A, P2, SP2]);
  const SL = id();
  await db.query('insert into short_links (id, agency_id, property_id, social_post_id, created_by) values ($1, $2, $3, $4, $5)',
    [SL, A, P1, SP1, O]);
  await db.query('insert into click_events (link_id) values ($1)', [SL]);

  await db.query('insert into viewings (agency_id, property_id, lead_id, consumer_id, agent_id) values ($1, $2, $3, $4, $5)', [A, P1, L1, C, M]);
  await db.query('insert into inspection_slots (agency_id, property_id, agent_id) values ($1, $2, $3)', [A, P1, M]);
  await db.query('insert into notifications (agency_id, recipient_id, property_id) values ($1, $2, $3)', [A, M, P1]);
  await db.query('insert into fees (agency_id, lead_id) values ($1, $2)', [A, L1]);
  const VI = id();
  await db.query('insert into vendor_items (id, agency_id, created_by) values ($1, $2, $3)', [VI, A, O]);
  await db.query('insert into item_orders (agency_id, item_id, consumer_id) values ($1, $2, $3)', [A, VI, C]);
  await db.query(`insert into documents (entity_type, entity_id) values ('agency', $1), ('property', $2), ('agent', $3), ('agent', $4)`, [A, P1, O, M]);
  await db.query(`insert into consumer_reviews (reviewer_id, reviewed_entity_type, reviewed_entity_id) values ($1, 'agency', $2)`, [C, A]);
  await db.query(`insert into reputation_timelines (entity_type, entity_id) values ('agency', $1)`, [A]);
  await db.query(`insert into fraud_flags (entity_type, entity_id) values ('agency', $1)`, [A]);
  await db.query(`insert into push_subscriptions (user_id, side, agency_id) values ($1, 'agency', $2), ($3, 'customer', null)`, [M, A, C]);
  await db.query(`insert into message_outbox (agency_id, lead_id, status, created_by) values ($1, $2, 'queued', $3)`, [A, L1, O]);
  await db.query('insert into agent_profiles (profile_id) values ($1), ($2)', [O, M]);
  await db.query('insert into subscription_payments (agency_id, initialized_by) values ($1, $2)', [A, O]);
  await db.query('insert into telegram_connect_codes (agency_id, profile_id) values ($1, $2)', [A, O]);
  await db.query('insert into telegram_links (profile_id) values ($1)', [M]);
  await db.query('insert into saved_properties (consumer_id, property_id) values ($1, $2)', [C, P1]);

  return { O, M, C, P, A, B, P1, P2, PB, L1, L2, LB, SA, SP1, SP2, SP3, SL, s1, s2, s3, s4, s5, s6 };
}

Deno.test('agency deletion', async (t) => {
  const db = await freshDb();
  await asService(db);

  await t.step('the hazard is real: without the explicit order, a SET NULL into an append-only table aborts the cascade', async () => {
    const f = await fullAgency(db);
    await assertRejects(
      () => db.transaction(async (tx) => {
        await tx.query(`select set_config('synapse.erasure', 'on', true)`);
        await tx.query('delete from properties where id = $1', [f.P1]);
      }),
      Error, 'append-only');
  });

  await t.step('preview, refusals and the typed name', async () => {
    const f = await fullAgency(db);
    const p = await preview(db, f.A, f.O);
    assertEquals(p.state, 'ready');
    assertEquals(p.confirm_phrase, 'Lekki Prime\'s Realty');
    assertEquals(p.counts.listings, 2);
    assertEquals(p.counts.leads, 2);
    assertEquals(p.counts.team_members, 1);
    assertEquals(p.counts.social_accounts, 1);
    assertEquals(p.counts.documents, 2);
    assertEquals(p.paid_plan, null);
    assertEquals(p.owner_login, { removable: true, kept_because: null });

    await assertRejects(() => preview(db, f.A, f.M), Error, 'not_owner');
    await assertRejects(() => begin(db, f.A, f.M, 'Lekki Prime\'s Realty'), Error, 'not_owner');
    await assertRejects(() => preview(db, id(), f.O), Error, 'agency_not_found');
    await assertRejects(() => begin(db, f.A, f.O, 'lekki prime\'s realty'), Error, 'name_mismatch');
    await assertRejects(() => begin(db, f.A, f.O, 'Lekki Prime'), Error, 'name_mismatch');
    await assertRejects(() => begin(db, f.A, f.O, ''), Error, 'name_mismatch');
    // A refused begin changed nothing.
    assertEquals(await count(db, 'properties where agency_id = $1 and is_active and deleted_at is null', [f.A]), 2);
    assertEquals(await count(db, 'agency_deletions where agency_id = $1', [f.A]), 0);
    await assertRejects(() => execute(db, f.A, f.O), Error, 'not_begun');
  });

  await t.step('a whole agency: begin, files, execute, finish', async () => {
    const f = await fullAgency(db);
    // Straight apostrophe and stray spaces against a name saved with a curly one.
    const b = await begin(db, f.A, f.O, '  Lekki  Prime\'s Realty ');
    assertEquals(b.state, 'begun');
    assertEquals(b.listings_taken_down, 2);
    assertEquals(b.posts_cancelled, 2);            // the scheduled post and its twin
    assertEquals(b.messages_cancelled, 1);
    assertEquals(await count(db, 'properties where agency_id = $1 and (is_active or deleted_at is null)', [f.A]), 0);
    assertEquals(await count(db, `social_posts where id = $1 and deleted_at is null`, [f.SP1]), 1); // published stays until execute
    assertEquals(await count(db, `message_outbox where agency_id = $1 and status = 'cancelled'`, [f.A]), 1);
    assertEquals(await count(db, 'properties where id = $1 and is_active and deleted_at is null', [f.PB]), 1);
    // begin is safe to repeat
    assertEquals((await begin(db, f.A, f.O, 'Lekki Prime’s Realty')).state, 'begun');
    assertEquals((await preview(db, f.A, f.O)).state, 'begun');

    await db.query('select agency_deletion_files_removed($1, $2, $3)', [f.A, f.O, 7]);
    await db.query('select agency_deletion_files_removed($1, $2, $3)', [f.A, f.M, 100]); // not the owner: ignored

    // execute refuses a caller without the service role
    await asNobody(db);
    await assertRejects(() => execute(db, f.A, f.O), Error, 'service_role_only');
    await asService(db);

    const e = await execute(db, f.A, f.O);
    assertEquals(e.state, 'data_deleted');
    assertEquals(e.owner_login, 'pending');
    assertEquals(e.counts.listings, 2);
    assertEquals(e.counts.team_members_released, 1);
    assertEquals(e.counts.vault_secrets, 4);

    // gone
    assertEquals(await count(db, 'agencies where id = $1', [f.A]), 0);
    for (const [table, col, val] of [
      ['properties', 'agency_id', f.A], ['leads', 'agency_id', f.A], ['agency_members', 'agency_id', f.A],
      ['social_accounts', 'agency_id', f.A], ['social_posts', 'agency_id', f.A], ['short_links', 'agency_id', f.A],
      ['campaigns', 'agency_id', f.A], ['viewings', 'agency_id', f.A], ['inspection_slots', 'agency_id', f.A],
      ['notifications', 'agency_id', f.A], ['fees', 'agency_id', f.A], ['vendor_items', 'agency_id', f.A],
      ['item_orders', 'agency_id', f.A], ['lead_attribution', 'agency_id', f.A], ['activity_feed', 'agency_id', f.A],
      ['channel_interactions', 'agency_id', f.A], ['events', 'agency_id', f.A],
      ['agency_verification_checks', 'agency_id', f.A], ['agent_disciplinary_records', 'agency_id', f.A],
      ['message_outbox', 'agency_id', f.A], ['subscription_payments', 'agency_id', f.A],
      ['telegram_connect_codes', 'agency_id', f.A], ['social_connect_picks', 'agency_id', f.A],
      ['push_subscriptions', 'agency_id', f.A], ['property_media', 'property_id', f.P1],
      ['saved_properties', 'property_id', f.P1], ['activity_feed', 'property_id', f.P1],
      ['click_events', 'link_id', f.SL], ['lead_stage_history', 'lead_id', f.L1],
      ['documents', 'entity_id', f.A], ['documents', 'entity_id', f.P1], ['documents', 'entity_id', f.O],
      ['consumer_reviews', 'reviewed_entity_id', f.A], ['reputation_timelines', 'entity_id', f.A],
      ['agent_profiles', 'profile_id', f.O], ['profiles', 'id', f.O],
    ] as const) {
      assertEquals(await count(db, `${table} where ${col} = $1`, [val]), 0, `${table}.${col} still has rows`);
    }
    for (const s of [f.s1, f.s2, f.s3, f.s6]) assertEquals(await count(db, 'vault.secrets where id = $1', [s]), 0);

    // kept
    for (const s of [f.s4, f.s5]) assertEquals(await count(db, 'vault.secrets where id = $1', [s]), 1);
    for (const p of [f.M, f.C, f.P]) assertEquals(await count(db, 'profiles where id = $1', [p]), 1);
    assertEquals(await count(db, 'auth.users where id = $1', [f.O]), 1, 'the login is the edge function\'s job');
    assertEquals(await count(db, 'agent_profiles where profile_id = $1', [f.M]), 1);
    assertEquals(await count(db, 'telegram_links where profile_id = $1', [f.M]), 1);
    assertEquals(await count(db, 'documents where entity_id = $1', [f.M]), 1);
    assertEquals(await count(db, 'fraud_flags where entity_id = $1', [f.A]), 1);
    assertEquals(await count(db, 'agencies where id = $1', [f.B]), 1);
    assertEquals(await count(db, 'properties where id = $1', [f.PB]), 1);
    assertEquals(await count(db, 'leads where id = $1', [f.LB]), 1);
    assertEquals(await count(db, 'activity_feed where property_id = $1', [f.PB]), 1);
    assertEquals(await count(db, 'push_subscriptions where user_id = $1', [f.C]), 1);
    assertEquals(await count(db, `erasure_log where subject_hash = $1`, [await sha(f.O)]), 1);

    // The append-only guard is back on outside the transaction.
    await assertRejects(() => db.query('update activity_feed set agent_id = null where property_id = $1', [f.PB]), Error, 'append-only');
    await assertRejects(() => db.query('delete from activity_feed where property_id = $1', [f.PB]), Error, 'append-only');

    const rec = await one(db, 'select * from agency_deletions where agency_id = $1', [f.A]);
    assert(rec.unlisted_at && rec.data_deleted_at && !rec.completed_at);
    assertEquals(rec.files_removed, 7);
    assertEquals(rec.owner_hash, await sha(f.O));

    // Lost response: every step answers again without failing.
    assertEquals((await execute(db, f.A, f.O)).state, 'data_deleted');
    assertEquals((await begin(db, f.A, f.O, 'anything')).state, 'data_deleted');
    assertEquals((await preview(db, f.A, f.O)).state, 'data_deleted');
    await assertRejects(() => preview(db, f.A, f.M), Error, 'agency_not_found');

    // The login could not be removed: the record stays open, resumable.
    const open = await finish(db, f.A, f.O, false);
    assertEquals(open.state, 'data_deleted');
    assertEquals(open.owner_login, 'pending');
    // Then it was.
    const done = await finish(db, f.A, f.O, true);
    assertEquals(done.state, 'complete');
    assertEquals(done.owner_login, 'removed');
    const closed = await one(db, 'select * from agency_deletions where agency_id = $1', [f.A]);
    assert(closed.completed_at);
    assertEquals(closed.owner_hash, null, 'nothing pseudonymous is kept once complete');
    await assertRejects(() => preview(db, f.A, f.O), Error, 'agency_not_found');
    await assertRejects(() => finish(db, f.A, f.O, true), Error, 'agency_not_found');
  });

  await t.step('a paid plan must be acknowledged; an expired one need not be', async () => {
    const O = await user(db, 'agency_owner');
    const until = new Date(Date.now() + 10 * 86400e3).toISOString();
    const A = await agency(db, O, 'Paid Up', { tier: 'accelerator', until });
    const p = await preview(db, A, O);
    assertEquals(p.paid_plan.tier, 'accelerator');
    await assertRejects(() => begin(db, A, O, 'Paid Up'), Error, 'plan_not_acknowledged');
    assertEquals((await begin(db, A, O, 'Paid Up', true)).state, 'begun');
    const rec = await one(db, 'select plan_at_deletion, paid_until from agency_deletions where agency_id = $1', [A]);
    assertEquals(rec.plan_at_deletion, 'accelerator');
    assert(rec.paid_until);

    const O2 = await user(db, 'agency_owner');
    const A2 = await agency(db, O2, 'Lapsed', { tier: 'accelerator', until: new Date(Date.now() - 86400e3).toISOString() });
    assertEquals((await preview(db, A2, O2)).paid_plan, null);
    assertEquals((await begin(db, A2, O2, 'Lapsed')).state, 'begun');
  });

  await t.step('the owner\'s login stays when it belongs to something else', async () => {
    // owns another agency
    const O = await user(db, 'agency_owner');
    const A = await agency(db, O, 'First');
    const A2 = await agency(db, O, 'Second');
    assertEquals((await preview(db, A, O)).owner_login, { removable: false, kept_because: 'owns_another_agency' });
    await begin(db, A, O, 'First');
    const e = await execute(db, A, O);
    assertEquals([e.owner_login, e.kept_because], ['kept', 'owns_another_agency']);
    assertEquals(await count(db, 'profiles where id = $1', [O]), 1);
    assertEquals(await count(db, 'agencies where id = $1', [A2]), 1);
    const fin = await finish(db, A, O, false);
    assertEquals(fin.state, 'complete', 'a kept login leaves nothing to resume');

    // a member of another agency
    const O3 = await user(db, 'agency_owner');
    const A3 = await agency(db, O3, 'Third');
    const other = await agency(db, await user(db, 'agency_owner'), 'Elsewhere');
    await db.query(`insert into agency_members (agency_id, profile_id, role) values ($1, $2, 'agent')`, [other, O3]);
    await begin(db, A3, O3, 'Third');
    assertEquals((await execute(db, A3, O3)).kept_because, 'member_of_another_agency');
    assertEquals(await count(db, 'agency_members where profile_id = $1 and agency_id = $2', [O3, other]), 1);

    // platform staff
    const O4 = await user(db, 'platform_admin');
    const A4 = await agency(db, O4, 'Staff Test');
    await begin(db, A4, O4, 'Staff Test');
    assertEquals((await execute(db, A4, O4)).kept_because, 'platform_staff');

    // rows elsewhere that refuse the profile: a NO ACTION reference...
    const O5 = await user(db, 'agency_owner');
    const A5 = await agency(db, O5, 'Fifth');
    const managed = await agency(db, await user(db, 'agency_owner'), 'Managed');
    await db.query('update agencies set relationship_manager_id = $1 where id = $2', [O5, managed]);
    await begin(db, A5, O5, 'Fifth');
    const e5 = await execute(db, A5, O5);
    assertEquals([e5.owner_login, e5.kept_because], ['kept', 'records_elsewhere']);
    assertEquals(await count(db, 'agencies where id = $1', [A5]), 0, 'the agency is deleted regardless');
    assertEquals(await count(db, 'profiles where id = $1', [O5]), 1);

    // ...and an append-only row in another agency that would need a SET NULL.
    const O6 = await user(db, 'agency_owner');
    const A6 = await agency(db, O6, 'Sixth');
    const B6 = await agency(db, await user(db, 'agency_owner'), 'Seventh');
    await db.query('insert into events (agency_id, actor_id) values ($1, $2)', [B6, O6]);
    await begin(db, A6, O6, 'Sixth');
    const e6 = await execute(db, A6, O6);
    assertEquals([e6.owner_login, e6.kept_because], ['kept', 'records_elsewhere']);
    assertEquals(await count(db, 'agencies where id = $1', [A6]), 0);
    assertEquals(await count(db, 'events where agency_id = $1', [B6]), 1);
  });

  await t.step('an agency with no name is confirmed with a fixed phrase, and an empty agency deletes cleanly', async () => {
    const O = await user(db, 'agency_owner');
    const A = await agency(db, O, '   ');
    assertEquals((await preview(db, A, O)).confirm_phrase, 'delete my agency');
    await assertRejects(() => begin(db, A, O, ''), Error, 'name_mismatch');
    await assertRejects(() => begin(db, A, O, '   '), Error, 'name_mismatch');
    assertEquals((await begin(db, A, O, 'delete my agency')).state, 'begun');
    const e = await execute(db, A, O);
    assertEquals(e.owner_login, 'pending');
    assertEquals(e.counts.listings, 0);
    assertEquals((await finish(db, A, O, true)).state, 'complete');
  });

  await t.step('only the service role can reach any of it', async () => {
    const fns = [
      'agency_deletion_preview(uuid, uuid)', 'agency_deletion_begin(uuid, uuid, text, boolean)',
      'agency_deletion_files_removed(uuid, uuid, integer)', 'agency_deletion_execute(uuid, uuid)',
      'agency_deletion_finish(uuid, uuid, boolean)', 'agency_deletion_counts(uuid)',
      'agency_deletion_owner_blocker(uuid, uuid)', 'agency_confirm_key(text)',
    ];
    for (const fn of fns) {
      for (const role of ['anon', 'authenticated']) {
        const r = await one(db, `select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]);
        assertEquals(r.ok, false, `${role} can execute ${fn}`);
      }
    }
    for (const fn of fns.slice(0, 5)) {
      const r = await one(db, `select has_function_privilege('service_role', $1, 'execute') as ok`, [fn]);
      assertEquals(r.ok, true, `service_role cannot execute ${fn}`);
    }
    for (const role of ['anon', 'authenticated']) {
      const r = await one(db, `select has_table_privilege($1, 'public.agency_deletions', 'select') as ok`, [role]);
      assertEquals(r.ok, false, `${role} can read agency_deletions`);
    }
  });

  await db.close();
});
