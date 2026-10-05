-- Pin search_path on our own functions, with pg_temp listed LAST.
--
-- The linter flagged three functions for having no search_path at all. Chasing
-- that turned up something larger: the fifty-odd functions that *do* set one
-- were not protected either, because every one of them sets `search_path=public`
-- and nothing else.
--
-- pg_temp is searched FIRST for relation names unless it appears explicitly in
-- the path. So `set search_path = public` leaves an unqualified table reference
-- resolvable to a temp table any authenticated session can create. Measured on
-- this database, one session, temp table present:
--
--     set search_path = public            -> attacker's temp table
--     set search_path TO 'public'         -> attacker's temp table
--     set search_path = public, pg_temp   -> the real public table
--     set search_path = '' + qualified    -> the real public table
--
-- That matters most for the 35 SECURITY DEFINER functions here, which run with
-- the definer's privileges: a shadowed lookup inside one of those executes
-- elevated. It matters for the guards too even though they are SECURITY
-- INVOKER, because the guard IS the control -- properties_guard_neighbourhood_link
-- reads an unqualified `neighbourhoods` to decide whether a listing may be
-- linked, so shadowing it turns the check into a rubber stamp.
--
-- The fix appends `, pg_temp` rather than replacing the path, so a function that
-- legitimately reaches into `vault`, `cron` or `extensions` keeps doing so. It
-- is deliberately idempotent: it skips anything already listing pg_temp, so it
-- can be re-run after future migrations add functions.
--
-- Only functions owned by us are touched. Extension-owned functions (postgis,
-- vector, pgcrypto) belong to supabase_admin and are left alone -- we do not own
-- them and altering them breaks extension upgrades.

do $$
declare
  r        record;
  v_path   text;
  v_count  int := 0;
begin
  for r in
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args,
      coalesce(
        (select substring(c from 'search_path=(.*)')
           from unnest(p.proconfig) c
          where c like 'search_path=%'),
        'public'
      ) as path
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proowner <> (select oid from pg_roles where rolname = 'supabase_admin')
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c
         where c like 'search_path=%pg_temp%'
      )
  loop
    -- The path comes out of the catalog as a bare list ("public, vault"), which
    -- is exactly the form SET wants. Quoting it as one identifier is the trap
    -- that makes this silently do nothing -- `SET search_path TO 'public, vault'`
    -- stores a single schema literally named "public, vault", which matches no
    -- schema, and the search then falls back to the default.
    v_path := r.path || ', pg_temp';
    execute format(
      'alter function public.%I(%s) set search_path = %s',
      r.proname, r.args, v_path
    );
    v_count := v_count + 1;
  end loop;

  raise notice 'search_path pinned with pg_temp on % function(s)', v_count;
end
$$;
