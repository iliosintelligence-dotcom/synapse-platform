/**
 * Tests for delete-agency/logic.ts, against fakes: an in-memory Storage that
 * answers list() the way the Storage API does (a folder is an entry with no
 * id), a database that answers each SQL function with what the test sets,
 * and an Auth that can be told to fail. No network, no Supabase project.
 *
 * The SQL functions themselves are tested against a real Postgres in
 * supabase/tests/delete_agency_test.ts.
 *
 *   cd supabase/functions/delete-agency && npx -y deno@2 test --no-config logic_test.ts
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { AGENCY_BUCKETS, type Deps, handle, sweepFolder } from './logic.ts';

const AGENCY = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';

type Rpc = (args: Record<string, unknown>) => { data?: unknown; error?: { message: string } };

function fakes(opts: {
  rpc?: Record<string, Rpc>;
  files?: Record<string, string[]>;
  removeWorks?: boolean;
  listFails?: boolean;
  deleteUser?: (n: number) => { message: string; status?: number } | null;
  owned?: string[];
} = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const store = new Map<string, Set<string>>();
  for (const [b, paths] of Object.entries(opts.files ?? {})) store.set(b, new Set(paths));
  const userDeletes: string[] = [];
  const sleeps: number[] = [];

  const deps: Deps = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      const h = opts.rpc?.[fn];
      if (!h) return Promise.resolve({ data: null, error: { message: `unexpected call ${fn}` } });
      const r = h(args);
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    list: (bucket, dir, page) => {
      if (opts.listFails) return Promise.resolve({ data: null, error: { message: 'boom' } });
      const all = [...(store.get(bucket) ?? [])].filter((p) => p.startsWith(dir + '/'));
      const entries = new Map<string, string | null>();
      for (const p of all) {
        const rest = p.slice(dir.length + 1);
        const [head, ...tail] = rest.split('/');
        entries.set(head, tail.length ? null : `id-${p}`);
      }
      const items = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([name, id]) => ({ name, id }));
      return Promise.resolve({ data: items.slice(page.offset, page.offset + page.limit), error: null });
    },
    remove: (bucket, paths) => {
      const set = store.get(bucket) ?? new Set();
      if (opts.removeWorks === false) return Promise.resolve({ data: [], error: null });
      const gone = paths.filter((p) => set.delete(p)).map((name) => ({ name }));
      return Promise.resolve({ data: gone, error: null });
    },
    deleteUser: (id) => {
      userDeletes.push(id);
      return Promise.resolve({ error: opts.deleteUser ? opts.deleteUser(userDeletes.length) : null });
    },
    ownedAgencies: () => Promise.resolve(opts.owned ?? []),
    sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
  };
  return { deps, calls, store, userDeletes, sleeps, fns: () => calls.map((c) => c.fn) };
}

const state = (s: string, extra: Record<string, unknown> = {}): Rpc => () => ({ data: { state: s, ...extra } });

Deno.test('sweepFolder empties a folder at any depth, across pages and chunks, and nothing else', async () => {
  const many = Array.from({ length: 1205 }, (_, i) => `${AGENCY}/photo-${String(i).padStart(4, '0')}.jpg`);
  const f = fakes({ files: { 'property-photos': [...many, `${AGENCY}/deep/er/x.png`, `${OTHER}/keep.jpg`] } });
  const n = await sweepFolder(f.deps, 'property-photos', AGENCY);
  assertEquals(n, 1206);
  assertEquals([...f.store.get('property-photos')!], [`${OTHER}/keep.jpg`]);
});

Deno.test('sweepFolder fails loudly instead of spinning when files will not delete', async () => {
  const f = fakes({ files: { brand: [`${AGENCY}/logo.png`] }, removeWorks: false });
  let threw = '';
  try { await sweepFolder(f.deps, 'brand', AGENCY); } catch (e) { threw = (e as Error).message; }
  assert(threw.includes('would not delete'), threw);
});

Deno.test('bad requests are refused before the database is asked anything', async () => {
  const f = fakes();
  assertEquals((await handle(f.deps, OWNER, { action: 'nope', agency_id: AGENCY })).status, 400);
  assertEquals((await handle(f.deps, OWNER, { action: 'begin' })).status, 400);
  assertEquals((await handle(f.deps, OWNER, { action: 'begin', agency_id: 'x; drop table' })).status, 400);
  assertEquals(f.calls.length, 0);
});

Deno.test('preview without an agency id uses the one agency the caller owns, and only one', async () => {
  const one = fakes({ owned: [AGENCY], rpc: { agency_deletion_preview: state('ready') } });
  const r = await handle(one.deps, OWNER, { action: 'preview' });
  assertEquals(r.status, 200);
  assertEquals(one.calls[0].args, { p_agency_id: AGENCY, p_actor: OWNER });

  const two = fakes({ owned: [AGENCY, OTHER], rpc: { agency_deletion_preview: state('ready') } });
  assertEquals((await handle(two.deps, OWNER, { action: 'preview' })).status, 400);
  assertEquals(two.calls.length, 0);
});

Deno.test('preview without an agency id finds the deletion the caller left unfinished, when they own none', async () => {
  const f = fakes({
    owned: [],
    rpc: {
      agency_deletion_unfinished: () => ({ data: [AGENCY] }),
      agency_deletion_preview: state('data_deleted', { owner_login: 'pending' }),
    },
  });
  const r = await handle(f.deps, OWNER, { action: 'preview' });
  assertEquals(r.status, 200);
  assertEquals(r.body.state, 'data_deleted');
  assertEquals(f.calls[0], { fn: 'agency_deletion_unfinished', args: { p_actor: OWNER } });
  assertEquals(f.calls[1].args, { p_agency_id: AGENCY, p_actor: OWNER });

  // Nothing unfinished, or two of them: no guess, and preview is never asked.
  for (const open of [[], [AGENCY, OTHER]]) {
    const g = fakes({ owned: [], rpc: { agency_deletion_unfinished: () => ({ data: open }) } });
    assertEquals((await handle(g.deps, OWNER, { action: 'preview' })).status, 400);
    assertEquals(g.fns(), ['agency_deletion_unfinished']);
  }

  // Only preview looks: no other step may act on an agency it was not named.
  const h = fakes({ owned: [], rpc: { agency_deletion_unfinished: () => ({ data: [AGENCY] }) } });
  assertEquals((await handle(h.deps, OWNER, { action: 'finish' })).status, 400);
  assertEquals(h.calls.length, 0);
});

Deno.test('database refusals become plain answers with the right status', async () => {
  const cases: [string, number][] = [
    ['not_owner', 403], ['name_mismatch', 422], ['plan_not_acknowledged', 409],
    ['agency_not_found', 404], ['something else entirely', 500],
  ];
  for (const [message, status] of cases) {
    const f = fakes({ rpc: { agency_deletion_begin: () => ({ error: { message } }) } });
    const r = await handle(f.deps, OWNER, { action: 'begin', agency_id: AGENCY, confirm_name: 'X' });
    assertEquals(r.status, status, message);
    assert(typeof r.body.error === 'string' && !String(r.body.error).includes('something else'), 'raw database text is not echoed');
  }
});

Deno.test('begin passes the typed name and the plan acknowledgement through untouched', async () => {
  const f = fakes({ rpc: { agency_deletion_begin: state('begun') } });
  await handle(f.deps, OWNER, { action: 'begin', agency_id: AGENCY, confirm_name: 'Lekki Prime', acknowledge_plan: true });
  assertEquals(f.calls[0].args, { p_agency_id: AGENCY, p_actor: OWNER, p_confirm: 'Lekki Prime', p_acknowledge_plan: true });
  // anything other than literal true is not an acknowledgement
  const g = fakes({ rpc: { agency_deletion_begin: state('begun') } });
  await handle(g.deps, OWNER, { action: 'begin', agency_id: AGENCY, confirm_name: 'X', acknowledge_plan: 'yes' });
  assertEquals(g.calls[0].args.p_acknowledge_plan, false);
});

Deno.test('files: refused before begin, and touches no storage', async () => {
  const f = fakes({ rpc: { agency_deletion_preview: state('ready') }, files: { brand: [`${AGENCY}/logo.png`] } });
  const r = await handle(f.deps, OWNER, { action: 'files', agency_id: AGENCY });
  assertEquals(r.status, 409);
  assertEquals(f.store.get('brand')!.size, 1);
});

Deno.test('files: empties all three agency buckets and records the count', async () => {
  const f = fakes({
    rpc: { agency_deletion_preview: state('begun'), agency_deletion_files_removed: () => ({ data: null }) },
    files: {
      'property-photos': [`${AGENCY}/a.jpg`, `${AGENCY}/b.mp4`, `${OTHER}/c.jpg`],
      brand: [`${AGENCY}/logo-light.png`],
      'agency-documents': [`${AGENCY}/cac.pdf`],
      avatars: [`${OWNER}/me.jpg`],
    },
  });
  const r = await handle(f.deps, OWNER, { action: 'files', agency_id: AGENCY });
  assertEquals(r.status, 200);
  assertEquals(r.body.files_removed, 4);
  assertEquals(f.calls.at(-1), { fn: 'agency_deletion_files_removed', args: { p_agency_id: AGENCY, p_actor: OWNER, p_count: 4 } });
  assertEquals([...f.store.get('property-photos')!], [`${OTHER}/c.jpg`]);
  assertEquals(f.store.get('avatars')!.size, 1, 'the owner\'s photo goes only with their login');
  for (const b of AGENCY_BUCKETS) assert(![...(f.store.get(b) ?? [])].some((p) => p.startsWith(AGENCY)));
});

Deno.test('delete: a storage failure stops before any data is deleted', async () => {
  const f = fakes({
    listFails: true,
    rpc: { agency_deletion_begin: state('begun'), agency_deletion_preview: state('begun') },
  });
  const r = await handle(f.deps, OWNER, { action: 'delete', agency_id: AGENCY, confirm_name: 'X' });
  assertEquals(r.status, 502);
  assertEquals(r.body.code, 'storage');
  assert(!f.fns().includes('agency_deletion_execute'));
});

Deno.test('finish: removes the photo and the login, then closes the record', async () => {
  const f = fakes({
    files: { avatars: [`${OWNER}/me.jpg`], brand: [`${AGENCY}/late-upload.png`] },
    rpc: {
      agency_deletion_preview: state('data_deleted', { owner_login: 'pending' }),
      agency_deletion_files_removed: () => ({ data: null }),
      agency_deletion_finish: (a) => ({ data: { state: a.p_login_removed ? 'complete' : 'data_deleted', owner_login: a.p_login_removed ? 'removed' : 'pending' } }),
    },
  });
  const r = await handle(f.deps, OWNER, { action: 'finish', agency_id: AGENCY });
  assertEquals(r.body.state, 'complete');
  assertEquals(r.body.login_error, false);
  assertEquals(f.userDeletes, [OWNER]);
  assertEquals(f.store.get('avatars')!.size, 0);
  assertEquals(f.store.get('brand')!.size, 0);
  assertEquals(f.calls.find((c) => c.fn === 'agency_deletion_files_removed')!.args.p_count, 2);
  assertEquals(f.calls.at(-1)!.args.p_login_removed, true);
});

Deno.test('finish: a login Auth no longer has counts as removed', async () => {
  const f = fakes({
    deleteUser: () => ({ message: 'User not found', status: 404 }),
    rpc: {
      agency_deletion_preview: state('data_deleted', { owner_login: 'pending' }),
      agency_deletion_finish: state('complete'),
    },
  });
  await handle(f.deps, OWNER, { action: 'finish', agency_id: AGENCY });
  assertEquals(f.calls.at(-1)!.args.p_login_removed, true);
});

Deno.test('finish: if the login will not go, the record stays open and the answer says so', async () => {
  const f = fakes({
    deleteUser: () => ({ message: 'upstream timeout', status: 500 }),
    rpc: {
      agency_deletion_preview: state('data_deleted', { owner_login: 'pending' }),
      agency_deletion_finish: state('data_deleted', { owner_login: 'pending' }),
    },
  });
  const r = await handle(f.deps, OWNER, { action: 'finish', agency_id: AGENCY });
  assertEquals(r.status, 200);
  assertEquals(r.body.login_error, true);
  assertEquals(f.userDeletes.length, 3);
  assertEquals(f.sleeps, [400, 800, 1200]);
  assertEquals(f.calls.at(-1)!.args.p_login_removed, false);
});

Deno.test('finish: a kept login is never deleted, and neither is the photo', async () => {
  const f = fakes({
    files: { avatars: [`${OWNER}/me.jpg`] },
    rpc: {
      agency_deletion_preview: state('data_deleted', { owner_login: 'kept', kept_because: 'owns_another_agency' }),
      agency_deletion_finish: state('complete', { owner_login: 'kept' }),
    },
  });
  const r = await handle(f.deps, OWNER, { action: 'finish', agency_id: AGENCY });
  assertEquals(r.body.login_error, false);
  assertEquals(f.userDeletes, []);
  assertEquals(f.store.get('avatars')!.size, 1);
});

Deno.test('finish: a failed last sweep is reported but does not stop the login going', async () => {
  const f = fakes({
    listFails: true,
    rpc: {
      agency_deletion_preview: state('data_deleted', { owner_login: 'pending' }),
      agency_deletion_finish: state('complete'),
    },
  });
  const r = await handle(f.deps, OWNER, { action: 'finish', agency_id: AGENCY });
  assertEquals(r.body.files_left, true);
  assertEquals(f.userDeletes, [OWNER]);
});

Deno.test('finish: refused while the data is still there', async () => {
  const f = fakes({ rpc: { agency_deletion_preview: state('begun') } });
  const r = await handle(f.deps, OWNER, { action: 'finish', agency_id: AGENCY });
  assertEquals(r.status, 409);
  assertEquals(f.userDeletes, []);
});

Deno.test('delete: the steps run in order, files before data, login last', async () => {
  let phase = 'begun';
  const f = fakes({
    files: { 'property-photos': [`${AGENCY}/a.jpg`] },
    rpc: {
      agency_deletion_begin: state('begun'),
      agency_deletion_preview: () => ({ data: { state: phase, owner_login: 'pending' } }),
      agency_deletion_files_removed: () => ({ data: null }),
      agency_deletion_execute: () => { phase = 'data_deleted'; return { data: { state: 'data_deleted', owner_login: 'pending' } }; },
      agency_deletion_finish: state('complete', { owner_login: 'removed' }),
    },
  });
  const r = await handle(f.deps, OWNER, { action: 'delete', agency_id: AGENCY, confirm_name: 'X' });
  assertEquals(r.body.state, 'complete');
  assertEquals(f.fns(), [
    'agency_deletion_begin', 'agency_deletion_preview', 'agency_deletion_files_removed',
    'agency_deletion_execute', 'agency_deletion_preview', 'agency_deletion_finish',
  ]);
  assertEquals(f.userDeletes, [OWNER]);
});

Deno.test('delete: resuming after the data step goes straight to finish', async () => {
  const f = fakes({
    rpc: {
      agency_deletion_begin: state('data_deleted', { owner_login: 'pending' }),
      agency_deletion_preview: state('data_deleted', { owner_login: 'pending' }),
      agency_deletion_finish: state('complete'),
    },
  });
  await handle(f.deps, OWNER, { action: 'delete', agency_id: AGENCY, confirm_name: '' });
  assertEquals(f.fns(), ['agency_deletion_begin', 'agency_deletion_preview', 'agency_deletion_finish']);
});
