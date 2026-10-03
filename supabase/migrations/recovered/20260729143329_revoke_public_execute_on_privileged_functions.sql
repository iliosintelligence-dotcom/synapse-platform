-- The previous migration revoked EXECUTE from `anon` and appeared to succeed,
-- but anon could still call every function. Reason: Postgres grants EXECUTE on
-- functions to PUBLIC by default, and anon INHERITS that grant — revoking from
-- the role is a no-op while the PUBLIC grant stands. This drops the PUBLIC
-- grant (the actual source of access) and re-grants only to `authenticated`,
-- which several of these need because they are called from inside RLS policy
-- expressions, evaluated with the querying user's privileges.

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('move_lead_stage','supersede_document','can_read_financial_identity',
                        'can_access_lead','can_access_document','is_agency_member','agency_role',
                        'channel_first_touch_revenue','partner_is_live','proximity_matches')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
