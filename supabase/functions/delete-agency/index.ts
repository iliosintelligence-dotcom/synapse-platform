/**
 * delete-agency — an agency's owner deletes the agency and their own account.
 *
 * Called from the Delete agency section at the foot of the Subscription pane
 * in app/agency.html, one step at a time so the portal can show real
 * progress:
 *
 *   POST { action: 'preview', agency_id }                       what would go
 *        (agency_id may be left out: the one agency the caller owns, or
 *        failing that the deletion they left unfinished)
 *   POST { action: 'begin',   agency_id, confirm_name,
 *          acknowledge_plan }                                   name checked, listings down
 *   POST { action: 'files',   agency_id }                       Storage folders emptied
 *   POST { action: 'data',    agency_id }                       every row, one transaction
 *   POST { action: 'finish',  agency_id }                       login removed, record closed
 *   POST { action: 'delete',  agency_id, confirm_name, ... }    all four, for scripts
 *
 * WHY AN EDGE FUNCTION. Two of the steps cannot be done in SQL: Storage files
 * have to be removed through the Storage API (storage.objects refuses a
 * direct DELETE -- protect_objects_delete), and a login can only be deleted
 * through the Auth admin API. Both need the service role, which never leaves
 * this function.
 *
 * WHO. verify_jwt = true (config.toml), and the session is checked again here
 * against Auth. The caller's id is the only identity passed to the database,
 * and every SQL function compares it with agencies.owner_id itself -- this
 * file never decides who owns what. See logic.ts for the steps and
 * migration 20261002150000 for the rules.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both injected by Supabase).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { type Deps, handle } from './logic.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST.', code: 'bad_request' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!url || !serviceKey) return json({ error: 'Server misconfigured.', code: 'internal' }, 500);

    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Sign in to delete your agency.', code: 'not_signed_in' }, 401);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    /* Asked of Auth, not read off the token: a login deleted a moment ago
       still carries a valid signature until it expires, and must not be able
       to start anything. */
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who?.user) {
      return json({ error: 'Your session has ended. Sign in again to continue.', code: 'not_signed_in' }, 401);
    }

    const body = await req.json().catch(() => ({}));

    const deps: Deps = {
      rpc: async (fn, args) => {
        const { data, error } = await admin.rpc(fn, args);
        return { data, error: error ? { message: error.message, code: error.code } : null };
      },
      list: async (bucket, path, page) => {
        const { data, error } = await admin.storage.from(bucket).list(path, {
          limit: page.limit, offset: page.offset, sortBy: { column: 'name', order: 'asc' },
        });
        return {
          data: data ? data.map((o) => ({ name: o.name, id: (o.id as string | null) ?? null })) : null,
          error: error ? { message: error.message } : null,
        };
      },
      remove: async (bucket, paths) => {
        const { data, error } = await admin.storage.from(bucket).remove(paths);
        return {
          data: data ? data.map((o) => ({ name: o.name })) : null,
          error: error ? { message: error.message } : null,
        };
      },
      deleteUser: async (id) => {
        const { error } = await admin.auth.admin.deleteUser(id);
        return { error: error ? { message: error.message, status: error.status } : null };
      },
      ownedAgencies: async (actor) => {
        const { data } = await admin.from('agencies').select('id')
          .eq('owner_id', actor).is('deleted_at', null).limit(2);
        return (data ?? []).map((r: { id: string }) => r.id);
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    };

    const res = await handle(deps, who.user.id, body);
    return json(res.body, res.status);
  } catch (err) {
    console.error(`delete-agency fatal: ${err instanceof Error ? err.message : 'unknown'}`);
    return json({
      error: 'Something went wrong part-way. It is safe to press Delete again: it carries on from where it stopped.',
      code: 'internal',
    }, 500);
  }
});
