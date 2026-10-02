/**
 * delete-agency — the steps, without the wiring.
 *
 * Kept apart from index.ts so every branch can be exercised against fakes
 * (logic_test.ts) without a Supabase project: the database, Storage and Auth
 * all arrive through `Deps`. index.ts only authenticates the caller and
 * builds the real clients.
 *
 * The database does the deciding. Every check that matters -- is this the
 * owner, is the typed name right, was a paid plan acknowledged, has begin run
 * before execute -- is made again inside the SQL functions
 * (migration 20261002150000), which only the service role can call. This file
 * decides only the ORDER, and does the two things SQL cannot: removing Storage
 * files and deleting the Auth login.
 *
 * The steps, each safe to repeat:
 *
 *   begin   name and plan checked, listings off the public site
 *   files   the agency's Storage folders emptied -- BEFORE the data, so a
 *           failure here leaves an agency that still exists and a button that
 *           still works
 *   data    every row, in one transaction; the owner's profile erased when
 *           nothing else needs it
 *   finish  a last sweep for anything uploaded in between, the owner's photo,
 *           then the login, then the record is closed
 *
 * The portal calls them one at a time so its progress list is true. `delete`
 * runs all four in one request for anybody calling it by hand.
 */

export interface DbError { message: string; code?: string }
export interface Deps {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: DbError | null }>;
  list(bucket: string, path: string, page: { limit: number; offset: number }):
    Promise<{ data: { name: string; id: string | null }[] | null; error: { message: string } | null }>;
  remove(bucket: string, paths: string[]):
    Promise<{ data: { name: string }[] | null; error: { message: string } | null }>;
  deleteUser(id: string): Promise<{ error: { message: string; status?: number } | null }>;
  /** Live agencies the caller owns, for a request that names none. (An
   *  unfinished deletion is found through the agency_deletion_unfinished
   *  RPC instead, so the hashing stays in SQL, in one place.) */
  ownedAgencies(actor: string): Promise<string[]>;
  sleep(ms: number): Promise<void>;
}

/* The buckets whose first folder is an agency id. The storage policies
   already treat that folder as the agency's (is_agency_member /
   can_access_agency_files on foldername[1]), so it is the boundary used
   here too. A file outside the folder is not the agency's by the same rule,
   and is left alone: a listing that pointed at a shared picture elsewhere
   must not take another agency's picture with it. */
export const AGENCY_BUCKETS = ['property-photos', 'brand', 'agency-documents'] as const;
/* avatars/<profile id>/ -- the owner's own photo, only when their login goes. */
export const AVATAR_BUCKET = 'avatars';

const PAGE = 1000;
const REMOVE_CHUNK = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Result { status: number; body: Record<string, unknown> }
const ok = (body: Record<string, unknown>): Result => ({ status: 200, body });

/* What each refusal from the database means to the person pressing the
   button. The SQL raises a bare code word; the sentence lives here, once. */
const REFUSALS: Record<string, { status: number; error: string }> = {
  agency_not_found: { status: 404, error: 'There is no agency here to delete. If you have just deleted it, you are done.' },
  not_owner: { status: 403, error: 'Only the person who owns this agency can delete it.' },
  name_mismatch: { status: 422, error: 'That is not the agency’s name exactly as shown. Type it again.' },
  plan_not_acknowledged: { status: 409, error: 'Your paid plan is still running. Tick the box to say you understand the days left are not refunded.' },
  not_begun: { status: 409, error: 'The deletion has not been started. Press Delete agency again.' },
  not_deleted_yet: { status: 409, error: 'The agency’s data has not been deleted yet. Press Delete agency again.' },
  agency_and_actor_required: { status: 400, error: 'Which agency? The request did not say.' },
};

export class Refusal extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function refusalFrom(err: DbError): Refusal {
  const code = Object.keys(REFUSALS).find((k) => err.message?.includes(k));
  if (code) return new Refusal(REFUSALS[code].status, code, REFUSALS[code].error);
  return new Refusal(500, 'database', 'The database refused that step. Nothing after it was attempted, and it is safe to try again.');
}

async function call(deps: Deps, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await deps.rpc(fn, args);
  if (error) {
    // The code word, never row contents: these logs are read by people.
    console.error(`delete-agency: ${fn} refused: ${error.code ?? ''} ${error.message}`);
    throw refusalFrom(error);
  }
  return (data ?? {}) as Record<string, unknown>;
}

/** Every file under `prefix/`, however deep. A folder comes back from the
 *  Storage API as an entry with no id. */
async function listAll(deps: Deps, bucket: string, prefix: string): Promise<string[]> {
  const files: string[] = [];
  const folders = [prefix];
  while (folders.length) {
    const dir = folders.pop() as string;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await deps.list(bucket, dir, { limit: PAGE, offset });
      if (error) throw new Error(`could not list ${bucket}: ${error.message}`);
      const items = data ?? [];
      for (const it of items) {
        const path = `${dir}/${it.name}`;
        if (it.id === null) folders.push(path);
        else files.push(path);
      }
      if (items.length < PAGE) break;
    }
  }
  return files;
}

/** Empty one folder of one bucket. Lists everything first and only then
 *  removes, because removing while paging by offset skips files. Repeats
 *  until the folder lists empty, and gives up loudly -- rather than spinning
 *  -- if a round removes nothing. Returns how many files went. */
export async function sweepFolder(deps: Deps, bucket: string, prefix: string, maxRounds = 20): Promise<number> {
  let removed = 0;
  for (let round = 0; round < maxRounds; round++) {
    const files = await listAll(deps, bucket, prefix);
    if (!files.length) return removed;
    let gone = 0;
    for (let i = 0; i < files.length; i += REMOVE_CHUNK) {
      const { data, error } = await deps.remove(bucket, files.slice(i, i + REMOVE_CHUNK));
      if (error) throw new Error(`could not remove files from ${bucket}: ${error.message}`);
      gone += data?.length ?? 0;
    }
    removed += gone;
    if (gone === 0) throw new Error(`${files.length} file(s) in ${bucket} would not delete`);
  }
  throw new Error(`${bucket} still had files after ${maxRounds} rounds`);
}

async function sweepAgency(deps: Deps, agencyId: string): Promise<number> {
  let n = 0;
  for (const bucket of AGENCY_BUCKETS) n += await sweepFolder(deps, bucket, agencyId);
  return n;
}

/** The login. A user Auth no longer has is a login already removed: that is
 *  what a retry after a lost response looks like, and it must not fail. */
async function removeLogin(deps: Deps, actor: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await deps.deleteUser(actor);
    if (!error) return true;
    if (error.status === 404 || /not.?found/i.test(error.message)) return true;
    console.error(`delete-agency: login removal attempt ${attempt + 1} failed: ${error.status ?? ''}`);
    await deps.sleep(400 * (attempt + 1));
  }
  return false;
}

// ── the steps ───────────────────────────────────────────────────────────

async function stepFiles(deps: Deps, actor: string, agencyId: string): Promise<Result> {
  const state = await call(deps, 'agency_deletion_preview', { p_agency_id: agencyId, p_actor: actor });
  if (state.state === 'ready') throw refusalFrom({ message: 'not_begun' });
  let removed: number;
  try {
    removed = await sweepAgency(deps, agencyId);
  } catch (err) {
    console.error(`delete-agency: files: ${err instanceof Error ? err.message : err}`);
    throw new Refusal(502, 'storage', 'Some of your files could not be deleted just now. Nothing else has been deleted yet, and it is safe to try again.');
  }
  await call(deps, 'agency_deletion_files_removed', { p_agency_id: agencyId, p_actor: actor, p_count: removed });
  return ok({ state: state.state, files_removed: removed });
}

async function stepFinish(deps: Deps, actor: string, agencyId: string): Promise<Result> {
  const state = await call(deps, 'agency_deletion_preview', { p_agency_id: agencyId, p_actor: actor });
  if (state.state !== 'data_deleted') throw refusalFrom({ message: 'not_deleted_yet' });

  /* Best effort from here. The data is gone and membership with it, so
     nothing new can be uploaded into these folders; this catches anything
     that arrived between the first sweep and the data step. A failure is
     reported in the answer, never allowed to stop the login being removed. */
  let removed = 0;
  let filesLeft = false;
  try { removed += await sweepAgency(deps, agencyId); } catch (err) {
    filesLeft = true;
    console.error(`delete-agency: final sweep: ${err instanceof Error ? err.message : err}`);
  }

  let loginRemoved = false;
  if (state.owner_login === 'pending') {
    try { removed += await sweepFolder(deps, AVATAR_BUCKET, actor); } catch (err) {
      filesLeft = true;
      console.error(`delete-agency: avatar sweep: ${err instanceof Error ? err.message : err}`);
    }
    loginRemoved = await removeLogin(deps, actor);
  }

  if (removed) await call(deps, 'agency_deletion_files_removed', { p_agency_id: agencyId, p_actor: actor, p_count: removed });
  const fin = await call(deps, 'agency_deletion_finish', {
    p_agency_id: agencyId, p_actor: actor, p_login_removed: loginRemoved,
  });
  return ok({ ...fin, files_left: filesLeft, login_error: state.owner_login === 'pending' && !loginRemoved });
}

// ── the request ─────────────────────────────────────────────────────────

export interface Body {
  action?: unknown; agency_id?: unknown; confirm_name?: unknown; acknowledge_plan?: unknown;
}

export async function handle(deps: Deps, actor: string, body: Body): Promise<Result> {
  try {
    const action = typeof body.action === 'string' ? body.action : '';
    if (!['preview', 'begin', 'files', 'data', 'finish', 'delete'].includes(action)) {
      return { status: 400, body: { error: 'Unknown action.', code: 'bad_request' } };
    }

    let agencyId = typeof body.agency_id === 'string' ? body.agency_id.trim() : '';
    if (!agencyId && action === 'preview') {
      /* Only when it is unambiguous. An owner of two agencies must say which;
         guessing is not something a delete button gets to do. */
      const owned = await deps.ownedAgencies(actor);
      if (owned.length === 1) agencyId = owned[0];
      else if (owned.length === 0) {
        /* Past the data step there is no agency left to own, and the portal
           has no membership to read an id from. The deletion record still
           knows whose it is: this is how a portal opened on another device
           finds the login it has yet to delete. */
        const open = await call(deps, 'agency_deletion_unfinished', { p_actor: actor }) as unknown;
        if (Array.isArray(open) && open.length === 1 && typeof open[0] === 'string') agencyId = open[0];
      }
    }
    if (!UUID.test(agencyId)) {
      return { status: 400, body: { error: 'Which agency? The request did not say.', code: 'bad_request' } };
    }

    const confirm = typeof body.confirm_name === 'string' ? body.confirm_name.slice(0, 300) : '';
    const ack = body.acknowledge_plan === true;
    const ids = { p_agency_id: agencyId, p_actor: actor };

    switch (action) {
      case 'preview':
        return ok(await call(deps, 'agency_deletion_preview', ids));
      case 'begin':
        return ok(await call(deps, 'agency_deletion_begin', { ...ids, p_confirm: confirm, p_acknowledge_plan: ack }));
      case 'files':
        return await stepFiles(deps, actor, agencyId);
      case 'data':
        return ok(await call(deps, 'agency_deletion_execute', ids));
      case 'finish':
        return await stepFinish(deps, actor, agencyId);
      case 'delete': {
        const b = await call(deps, 'agency_deletion_begin', { ...ids, p_confirm: confirm, p_acknowledge_plan: ack });
        if (b.state === 'begun') {
          await stepFiles(deps, actor, agencyId);
          await call(deps, 'agency_deletion_execute', ids);
        }
        return await stepFinish(deps, actor, agencyId);
      }
    }
    return { status: 400, body: { error: 'Unknown action.', code: 'bad_request' } };
  } catch (err) {
    if (err instanceof Refusal) return { status: err.status, body: { error: err.message, code: err.code } };
    console.error(`delete-agency: ${err instanceof Error ? err.message : err}`);
    return {
      status: 500,
      body: { error: 'Something went wrong part-way. It is safe to press Delete again: it carries on from where it stopped.', code: 'internal' },
    };
  }
}
