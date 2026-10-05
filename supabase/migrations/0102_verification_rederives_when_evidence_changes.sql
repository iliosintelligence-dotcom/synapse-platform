-- Verification has to follow its evidence, not outlive it.
--
-- set_property_verification re-checks the mandatory checks only when moving TO
-- 'verified'. After that the state is frozen and the evidence is not: an
-- operator can mark ownership_validation 'failed' on a verified listing and it
-- stays verified, still eligible for proximity, still wearing the badge on
-- every card. The check that says the house may not be the agency's to sell and
-- the flag that tells a stranger to walk there would sit side by side,
-- disagreeing, and nothing would notice.
--
-- Same class of bug as 0100 -- the state and the evidence drifting apart -- and
-- this closes the other direction of it. 0100 stopped a check being recorded as
-- passed when it could not have been; this stops verification surviving a check
-- that is no longer passed.

-- ── the re-derivation ─────────────────────────────────────────────────────
create or replace function public.property_checks_rederive()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_pid       uuid := coalesce(new.property_id, old.property_id);
  v_passed    int;
  v_nodes     jsonb;
  v_score     smallint;
  v_state     public.property_verification_state;
  v_missing   text;
  v_to        public.property_verification_state;
begin
  if v_pid is null then return coalesce(new, old); end if;

  -- The listing may be on its way out: checks cascade from properties, and a
  -- trigger that chased a row being deleted would turn a legitimate delete into
  -- an error.
  perform 1 from properties where id = v_pid;
  if not found then return coalesce(new, old); end if;

  -- ALWAYS re-derive the score and the nodes. They are pure functions of the
  -- checks, and the only reason they were ever stale is that nothing recomputed
  -- them outside set_property_verification.
  select count(*) filter (where status = 'passed'),
         coalesce(jsonb_agg(jsonb_build_object(
           'type', check_type::text, 'status', status::text,
           'at', to_char(coalesce(verified_at, created_at), 'YYYY-MM-DD"T"HH24:MI:SSZ')
         ) order by check_type::text), '[]'::jsonb)
    into v_passed, v_nodes
  from property_verification_checks where property_id = v_pid;

  v_score := round(100.0 * coalesce(v_passed, 0) / 7.0)::smallint;

  update properties
     set trust_score = v_score, verification_nodes = v_nodes
   where id = v_pid;

  -- ── demotion only, NEVER promotion ──────────────────────────────────────
  -- Three green checks are a PRECONDITION for verifying a listing, not an
  -- instruction to. Auto-promoting here would mean that recording evidence
  -- silently publishes a house as verified -- no decision, no author, no
  -- history row anybody signed. 0099 exists to make verification a thing a
  -- named person does; a trigger that did it for them would undo that quietly.
  select state into v_state
  from property_verifications where property_id = v_pid and deleted_at is null;

  if v_state is distinct from 'verified' then
    return coalesce(new, old);
  end if;

  select string_agg(m::text, ', ' order by m::text) into v_missing
  from unnest(array['listing_authenticity','ownership_validation','media_validation']
              ::public.property_check_type[]) m
  where not exists (
    select 1 from property_verification_checks c
    where c.property_id = v_pid and c.check_type = m and c.status = 'passed'
  );

  if v_missing is null then
    return coalesce(new, old);      -- still fully evidenced; nothing to do
  end if;

  -- Where it lands says WHY it fell, because those are different situations to
  -- an operator working a queue: something was found wrong, something aged out,
  -- or something is simply no longer answered.
  --
  -- IF rather than a CASE over new.status: NEW does not exist on DELETE, and
  -- PL/pgSQL gives no short-circuit guarantee inside a SQL expression, so a
  -- guarded CASE would still evaluate it.
  if tg_op = 'DELETE' then
    v_to := 'under_review';
  elsif new.status = 'failed' then
    v_to := 'disputed';
  elsif new.status = 'expired' then
    v_to := 'expired';
  else
    v_to := 'under_review';
  end if;

  -- Inlined rather than calling set_property_verification, deliberately. That
  -- function demands is_platform_admin(), which is right for a person pressing
  -- a button and wrong for a trigger: a cascade running in a service context
  -- (auth.uid() null) would be refused, and a guard that can block a legitimate
  -- delete is worse than the duplication.
  update property_verifications
     set state = v_to, node_score = v_score, verified_at = null, updated_at = now()
   where property_id = v_pid and deleted_at is null;

  insert into property_verification_history
    (property_id, from_state, to_state, transitioned_by, notes)
  values (v_pid, 'verified', v_to, auth.uid(),
          'Automatic: verification withdrawn because these checks are no longer passed -- '
          || v_missing);

  update properties
     set verification_status = case when v_to in ('disputed','expired','unverified')
                                    then 'unverified' else 'in_progress' end
                               ::public.verification_status,
         verified_at = null
   where id = v_pid;

  return coalesce(new, old);
end;
$function$;

drop trigger if exists property_checks_rederive_trg on public.property_verification_checks;
create trigger property_checks_rederive_trg
  after insert or update or delete on public.property_verification_checks
  for each row execute function public.property_checks_rederive();

revoke all on function public.property_checks_rederive() from public, anon, authenticated;

comment on function public.property_checks_rederive() is
  'Re-derives trust_score and verification_nodes from the checks on every change, and withdraws verification when a mandatory check stops being passed. Demotes only -- never promotes, because verifying a listing is a decision a named person makes, not something recording evidence does on their behalf.';
