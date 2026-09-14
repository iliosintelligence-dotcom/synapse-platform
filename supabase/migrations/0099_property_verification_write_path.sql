-- A verification desk with no door.
--
-- 0 of 507 live listings are verified, and that one predicate is the only thing
-- between a finished proximity service and its first notification. It is not
-- for want of an operator: 2 platform_admins exist, and 17 of 29 agencies are
-- verified, so agency verification works. Property verification does not,
-- because property_verifications, _checks and _history are all empty and carry
-- only SELECT policies. Nothing can write a verification record, ever.
--
-- THE PART THAT IS ALREADY POSSIBLE IS THE PART THAT IS DANGEROUS.
-- properties_update_platform_admin lets an admin flip
-- properties.verification_status directly, today, from a browser. That path
-- produces a listing that is 'verified' with:
--
--     verified_at         null
--     trust_score         null
--     verification_nodes  []
--     property_verifications      -- no row
--     property_verification_history -- no row: nobody knows who, or when, or why
--
-- A buyer is then walked to a house on the strength of a flag that no one is
-- accountable for. So this is not "add INSERT policies". The point is to make
-- the CORRECT path the EASY one, and to leave the raw flag as the thing you
-- have to go out of your way to touch.
--
-- NO NEW RLS WRITE POLICIES, DELIBERATELY. All three tables stay SELECT-only
-- to every client. The functions below are SECURITY DEFINER, so they are the
-- only way rows appear in them -- which means a verification record cannot
-- exist without the history row that explains it. A policy would have allowed
-- the two to drift apart.

-- ── the evidence ──────────────────────────────────────────────────────────
-- One row per (listing, check type). Recording a check is separate from
-- changing the state on purpose: evidence accumulates over days -- documents
-- today, a scout on Thursday -- and the state moves once, at the end.
create or replace function public.record_property_check(
  p_property_id  uuid,
  p_check_type   public.property_check_type,
  p_status       public.check_status,
  p_evidence_urls text[] default '{}',
  p_notes        text default null,
  p_expiry_date  timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the platform verification desk may record a check'
      using errcode = '42501';
  end if;

  perform 1 from properties where id = p_property_id and deleted_at is null;
  if not found then
    raise exception 'No such listing' using errcode = 'no_data_found';
  end if;

  -- Re-recording a check REPLACES it rather than stacking a second opinion:
  -- "has ownership been validated" has one current answer. The history of how
  -- that answer changed belongs to the listing's state transitions, which are
  -- append-only below.
  update property_verification_checks
     set status = p_status,
         evidence_urls = coalesce(p_evidence_urls, '{}'),
         notes = p_notes,
         expiry_date = p_expiry_date,
         verified_by = auth.uid(),
         verified_at = now()
   where property_id = p_property_id and check_type = p_check_type
  returning id into v_id;

  if v_id is null then
    insert into property_verification_checks
      (property_id, check_type, status, evidence_urls, notes, expiry_date, verified_by, verified_at)
    values (p_property_id, p_check_type, p_status, coalesce(p_evidence_urls,'{}'),
            p_notes, p_expiry_date, auth.uid(), now())
    returning id into v_id;
  end if;

  return v_id;
end;
$function$;

-- ── the state ─────────────────────────────────────────────────────────────
-- Writes the verification record, the history row, and the four
-- platform-owned columns on properties, in one transaction. Any one of those
-- missing is how the flag and the paperwork come apart.
create or replace function public.set_property_verification(
  p_property_id uuid,
  p_state       public.property_verification_state,
  p_notes       text default null,
  p_expires_at  timestamptz default null
)
returns public.verification_status
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  -- The three that answer "is this a real listing, for a real property, that
  -- this agency may actually sell". The other four -- structural_assessment,
  -- flood_risk, government_acquisition_risk, freshness_validation -- are
  -- advice about a property that exists. They raise the trust score; they do
  -- not gate the claim that it is real.
  mandatory constant public.property_check_type[] := array[
    'listing_authenticity', 'ownership_validation', 'media_validation'
  ]::public.property_check_type[];

  v_from     public.property_verification_state;
  v_missing  text;
  v_passed   int;
  v_nodes    jsonb;
  v_score    smallint;
  v_status   public.verification_status;
  v_verified timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the platform verification desk may change a verification state'
      using errcode = '42501';
  end if;

  perform 1 from properties where id = p_property_id and deleted_at is null;
  if not found then
    raise exception 'No such listing' using errcode = 'no_data_found';
  end if;

  -- THE LOCK ON THE DOOR. Without this the whole migration is a longer way to
  -- set a boolean. 'verified' is the state that sends a stranger to an address,
  -- so it is the one state that cannot be asserted -- it has to be earned by
  -- checks that were recorded first, by name, with an author.
  if p_state = 'verified' then
    select string_agg(m::text, ', ' order by m::text) into v_missing
    from unnest(mandatory) m
    where not exists (
      select 1 from property_verification_checks c
      where c.property_id = p_property_id and c.check_type = m and c.status = 'passed'
    );
    if v_missing is not null then
      raise exception 'Cannot verify: these checks have not passed -- %', v_missing
        using errcode = 'check_violation';
    end if;
  end if;

  select state into v_from from property_verifications
   where property_id = p_property_id and deleted_at is null;

  -- Score out of ALL SEVEN check types, not out of the ones someone bothered
  -- to record. A desk attestation covering the three mandatory checks scores
  -- 43, a fully scouted listing scores 100, and the number therefore says
  -- something about how much is actually known.
  select count(*) filter (where status = 'passed'),
         coalesce(jsonb_agg(jsonb_build_object(
           'type', check_type::text, 'status', status::text,
           'at', to_char(coalesce(verified_at, created_at), 'YYYY-MM-DD"T"HH24:MI:SSZ')
         ) order by check_type::text), '[]'::jsonb)
    into v_passed, v_nodes
  from property_verification_checks where property_id = p_property_id;

  v_score := round(100.0 * coalesce(v_passed,0) / 7.0)::smallint;

  v_status := case
    when p_state = 'verified' then 'verified'
    when p_state in ('unverified', 'disputed', 'expired') then 'unverified'
    else 'in_progress'
  end::public.verification_status;

  v_verified := case when p_state = 'verified' then now() else null end;

  update property_verifications
     set state = p_state, node_score = v_score,
         verified_at = v_verified, expires_at = p_expires_at, updated_at = now()
   where property_id = p_property_id and deleted_at is null;
  if not found then
    insert into property_verifications
      (property_id, state, node_score, verified_at, expires_at)
    values (p_property_id, p_state, v_score, v_verified, p_expires_at);
  end if;

  -- Append-only, and never conditional on the state having changed: re-affirming
  -- a verification is itself a decision somebody made, and "who last looked at
  -- this and left it alone" is a question a dispute will ask.
  insert into property_verification_history
    (property_id, from_state, to_state, transitioned_by, notes)
  values (p_property_id, v_from, p_state, auth.uid(), p_notes);

  -- The four platform-owned columns, which the guard trigger permits because
  -- is_platform_admin() is true for the caller this function runs on behalf of.
  update properties
     set verification_status = v_status,
         verified_at = v_verified,
         trust_score = v_score,
         verification_nodes = v_nodes
   where id = p_property_id;

  return v_status;
end;
$function$;

-- ── the desk's own shortcut, named for what it actually is ────────────────
-- An operator reviewing a listing at a desk, without a scout on site, is a
-- real and legitimate level of verification -- it is how this will start. What
-- it must not do is look like a site visit afterwards.
--
-- So it records the three mandatory checks as passed BY ATTESTATION, stamped
-- with the admin's id and their note, and then moves the state. The evidence
-- rows say plainly that a person attested rather than that anything was
-- inspected, the trust score comes out at 43 rather than 100, and the
-- difference between this and a scouted listing stays visible in the data.
create or replace function public.attest_property_verification(
  p_property_id uuid,
  p_notes       text
)
returns public.verification_status
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare m public.property_check_type;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the platform verification desk may attest a listing'
      using errcode = '42501';
  end if;
  if p_notes is null or length(btrim(p_notes)) < 10 then
    -- An attestation with no reason is an unsigned one. Ten characters is not
    -- a quality bar, it is a speed bump in front of a mistake.
    raise exception 'An attestation must say what was checked (at least 10 characters)'
      using errcode = 'invalid_parameter_value';
  end if;

  foreach m in array array['listing_authenticity','ownership_validation','media_validation']
                       ::public.property_check_type[]
  loop
    perform public.record_property_check(
      p_property_id, m, 'passed'::public.check_status, '{}'::text[],
      'Attested at the verification desk, not independently inspected: ' || btrim(p_notes));
  end loop;

  return public.set_property_verification(p_property_id, 'verified', btrim(p_notes));
end;
$function$;

-- ── who may call these ────────────────────────────────────────────────────
-- PUBLIC has to be named: anon inherits the default grant, so revoking anon
-- alone removes one that was never doing the work.
revoke all on function public.record_property_check(uuid, public.property_check_type, public.check_status, text[], text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.set_property_verification(uuid, public.property_verification_state, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.attest_property_verification(uuid, text)
  from public, anon, authenticated;

-- Granted to authenticated because a desk operator IS a signed-in user. The
-- authority check is inside each function (is_platform_admin), not in the
-- grant -- an ordinary member reaching these gets 42501, not silence.
grant execute on function public.record_property_check(uuid, public.property_check_type, public.check_status, text[], text, timestamptz)
  to authenticated;
grant execute on function public.set_property_verification(uuid, public.property_verification_state, text, timestamptz)
  to authenticated;
grant execute on function public.attest_property_verification(uuid, text)
  to authenticated;

comment on function public.attest_property_verification(uuid, text) is
  'Desk attestation: records the three mandatory checks as passed-by-attestation, attributed to the calling platform admin, then verifies. Scores 43/100, not 100 -- a scouted listing must remain distinguishable from an attested one.';

-- ── the desk must be able to read its own work ────────────────────────────
-- Caught while testing the above: the desk can WRITE the audit trail and
-- cannot READ it back. Both existing policies scope to the owning agency --
--
--   property_verification_history: is_agency_member(p.agency_id)
--   property_verification_checks:  status <> 'failed' OR is_agency_member(...)
--
-- -- so a platform admin who has just verified a listing sees zero history
-- rows for it, and can never see a FAILED check on anyone's listing. Those are
-- the two things a verification desk exists to look at: who decided this, and
-- what did not pass. Reviewing a dispute would have meant reading the tables
-- as service_role, outside RLS, which is not a review anyone can be held to.
--
-- A second, parallel route for the desk rather than a widening of the first:
-- an agency still cannot see another agency's history, and still cannot see
-- its own failed checks become someone else's business.
drop policy if exists property_history_select_admin on public.property_verification_history;
create policy property_history_select_admin
  on public.property_verification_history for select
  using (public.is_platform_admin());

drop policy if exists property_checks_select_admin on public.property_verification_checks;
create policy property_checks_select_admin
  on public.property_verification_checks for select
  using (public.is_platform_admin());

-- Still no INSERT, UPDATE or DELETE policy on any of the three: the functions
-- above remain the only writers, so a verification record cannot exist without
-- the history row that explains it.
