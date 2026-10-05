/**
 * Who is calling a function that uses the service role.
 *
 * verify_jwt only proves that SOME signed-in user is calling. A function that then
 * reads or writes with the service key (which ignores RLS) must also decide whether
 * THIS caller may touch THIS row, or any signed-in buyer can aim it at another
 * agency's listing and spend its quota. Two kinds of caller are legitimate:
 *   - the platform itself (the drain, a trigger): the bearer IS the service key;
 *   - a person who works for the agency that owns the listing, or Synapse staff.
 * The person check runs as the caller, so RLS decides: an agency_members row is only
 * visible to its own agency.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function bearer(req: Request): string {
  const h = req.headers.get('Authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

/** The caller is the platform itself, not a person. */
export function isServiceCall(req: Request, serviceKey: string): boolean {
  const t = bearer(req);
  return !!serviceKey && !!t && sameString(t, serviceKey);
}

/** The caller is signed in AND belongs to this agency (or is Synapse staff). */
export async function callerManagesAgency(req: Request, url: string, agencyId: string | null | undefined): Promise<boolean> {
  const token = bearer(req);
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!token || !anon || !agencyId) return false;
  const me = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: u } = await me.auth.getUser(token);
  if (!u?.user) return false;
  const { data: m } = await me.from('agency_members').select('id').eq('agency_id', agencyId).is('deleted_at', null).limit(1);
  if (m && m.length) return true;
  const { data: staff } = await me.rpc('is_synapse_staff');
  return staff === true;
}
