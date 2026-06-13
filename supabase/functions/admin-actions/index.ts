/**
 * admin-actions — platform-admin operations. Service role lives ONLY here.
 *
 * The caller is authenticated via JWT and must have profiles.role =
 * 'platform_admin'; otherwise every action is refused. This is the single
 * place the service-role key is used to bypass RLS (per the architecture:
 * "platform admins bypass all RLS via service role in Edge Functions only").
 *
 * Actions (MVP, manual / do-things-that-don't-scale):
 *  - approve_agency:  set an agency's verification_tier
 *  - verify_property: set verification_status, trust_score, nodes, go live
 *  - list_all_leads:  read every lead across the platform
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

type Action =
  | { action: 'approve_agency'; agency_id: string; tier: string }
  | {
      action: 'verify_property';
      property_id: string;
      trust_score: number;
      verification_nodes: unknown[];
      go_live?: boolean;
    }
  | { action: 'list_all_leads'; limit?: number };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!serviceKey) return json({ error: 'Server misconfigured' }, 500);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(url, serviceKey);

    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'Not authenticated' }, 401);

    // ── platform-admin gate ──
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (!profile || profile.role !== 'platform_admin') {
      return json({ error: 'Forbidden: platform admin only' }, 403);
    }

    const body = (await req.json()) as Action;

    switch (body.action) {
      case 'approve_agency': {
        const { error } = await admin
          .from('agencies')
          .update({ verification_tier: body.tier })
          .eq('id', body.agency_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case 'verify_property': {
        const { error } = await admin
          .from('properties')
          .update({
            verification_status: 'verified',
            trust_score: body.trust_score,
            verification_nodes: body.verification_nodes,
            ...(body.go_live ? { status: 'live', is_active: true } : {}),
          })
          .eq('id', body.property_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case 'list_all_leads': {
        const { data, error } = await admin
          .from('leads')
          .select('*')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(body.limit ?? 200);
        if (error) return json({ error: error.message }, 500);
        return json({ leads: data ?? [] });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, 500);
  }
});
