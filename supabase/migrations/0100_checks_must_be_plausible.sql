-- A check may not be recorded as passed when the data says it cannot have been.
--
-- 0099 built a lock that required three named checks to be 'passed' before a
-- listing could be verified, and then handed out a function that passed all
-- three without looking at anything. The first real use proved it: the test
-- listing was verified with media_validation = 'passed' and ZERO rows in
-- property_media. Nobody validated any media, because there is no media.
--
-- The lock asked "were the checks passed?" and never "could they have been?".
--
-- THE GATE GOES IN record_property_check, NOT IN THE ATTESTATION. Putting it
-- only in attest_property_verification would close one door and leave the
-- other open -- record_property_check is public to the desk and would still
-- take a bare 'passed' for anything. One gate, in the one place both paths go
-- through.

-- ── can this check honestly be marked passed? ─────────────────────────────
-- Returns null when it can, or the reason it cannot. A reason, not a boolean,
-- because the operator has to be told what to go and fix.
--
-- The split is between checks a database can test and checks it cannot:
--
--   testable from data   media_validation, listing_authenticity,
--                        freshness_validation
--   not testable at all  ownership_validation, structural_assessment,
--                        flood_risk, government_acquisition_risk
--
-- The second group is the important half. No query can tell you who owns a
-- house or whether it floods. Those can only be answered by a document or a
-- person who went there -- so they require at least one evidence URL, and
-- "trust me" stops being an accepted answer.
create or replace function public.property_check_attestable(
  p_property_id    uuid,
  p_check_type     public.property_check_type,
  p_evidence_count integer default 0
)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare p record;
begin
  select title, address, price, listed_at into p
  from properties where id = p_property_id and deleted_at is null;
  if not found then
    return 'the listing does not exist';
  end if;

  case p_check_type
    when 'media_validation' then
      -- The one that failed in production. A listing with no photographs has
      -- nothing whose authenticity could have been assessed, and a buyer sent
      -- to it has no idea what they are walking towards.
      if not exists (select 1 from property_media m where m.property_id = p_property_id) then
        return 'the listing has no photos, so there is no media to validate';
      end if;

    when 'listing_authenticity' then
      if coalesce(btrim(p.title), '') = '' then return 'the listing has no title'; end if;
      if coalesce(btrim(p.address), '') = '' then return 'the listing has no address'; end if;
      if coalesce(p.price, 0) <= 0 then return 'the listing has no price'; end if;

    when 'freshness_validation' then
      -- Confirming a listing is current, about one that was last touched a
      -- month ago, is confirming nothing. Same 14-day window the proximity
      -- matcher uses, so the two cannot disagree about what "fresh" means.
      if p.listed_at < now() - interval '14 days' then
        return 'the listing is older than 14 days, so its freshness cannot be confirmed';
      end if;

    else
      -- ownership_validation, structural_assessment, flood_risk,
      -- government_acquisition_risk. Nothing in this database can answer any
      -- of them. Evidence or nothing.
      if coalesce(p_evidence_count, 0) < 1 then
        return 'nothing in the database can establish this -- attach at least one'
            || ' document or photograph as evidence';
      end if;
  end case;

  return null;
end;
$function$;

-- ── the gate, in the one place both paths pass through ────────────────────
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
declare
  v_id     uuid;
  v_reason text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the platform verification desk may record a check'
      using errcode = '42501';
  end if;

  perform 1 from properties where id = p_property_id and deleted_at is null;
  if not found then
    raise exception 'No such listing' using errcode = 'no_data_found';
  end if;

  -- ONLY 'passed' IS GATED. Recording 'failed', 'pending', 'expired' or
  -- 'not_applicable' is always allowed -- an operator must be able to write
  -- down bad news about a listing with no photos, and a gate that blocked that
  -- would push the desk towards recording nothing at all.
  if p_status = 'passed' then
    v_reason := public.property_check_attestable(
                  p_property_id, p_check_type, coalesce(array_length(p_evidence_urls, 1), 0));
    if v_reason is not null then
      raise exception 'Cannot record % as passed: %', p_check_type, v_reason
        using errcode = 'check_violation';
    end if;
  end if;

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

-- ── attestation now has to carry the evidence ─────────────────────────────
-- Dropped rather than replaced: adding a parameter creates an overload, and
-- two attestation functions where one has no evidence argument is precisely
-- the door this migration is closing.
drop function if exists public.attest_property_verification(uuid, text);

create or replace function public.attest_property_verification(
  p_property_id   uuid,
  p_notes         text,
  p_evidence_urls text[] default '{}'
)
returns public.verification_status
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  m       public.property_check_type;
  v_stop  text;
begin
  if not public.is_platform_admin() then
    raise exception 'Only the platform verification desk may attest a listing'
      using errcode = '42501';
  end if;
  if p_notes is null or length(btrim(p_notes)) < 10 then
    raise exception 'An attestation must say what was checked (at least 10 characters)'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Every reason at once, not the first one. An operator who has to discover
  -- three blockers by hitting them one at a time will conclude the desk is
  -- broken, which is how people end up going round it.
  select string_agg(m2::text || ' (' || r.reason || ')', '; ' order by m2::text)
    into v_stop
  from unnest(array['listing_authenticity','ownership_validation','media_validation']
              ::public.property_check_type[]) m2
  cross join lateral (
    select public.property_check_attestable(
             p_property_id, m2, coalesce(array_length(p_evidence_urls, 1), 0)) as reason
  ) r
  where r.reason is not null;

  if v_stop is not null then
    raise exception 'Cannot attest this listing: %', v_stop
      using errcode = 'check_violation';
  end if;

  foreach m in array array['listing_authenticity','ownership_validation','media_validation']
                       ::public.property_check_type[]
  loop
    perform public.record_property_check(
      p_property_id, m, 'passed'::public.check_status, coalesce(p_evidence_urls,'{}'),
      'Attested at the verification desk, not independently inspected: ' || btrim(p_notes));
  end loop;

  return public.set_property_verification(p_property_id, 'verified', btrim(p_notes));
end;
$function$;

-- ── grants, restated for the new signature ────────────────────────────────
-- PUBLIC has to be named: anon inherits the default grant.
revoke all on function public.property_check_attestable(uuid, public.property_check_type, integer)
  from public, anon, authenticated;
revoke all on function public.attest_property_verification(uuid, text, text[])
  from public, anon, authenticated;

-- The desk is a signed-in user; authority is checked inside, not in the grant.
grant execute on function public.attest_property_verification(uuid, text, text[]) to authenticated;
-- Readable by the desk so the portal can say WHY a listing cannot be verified
-- yet, before anyone presses the button and is refused.
grant execute on function public.property_check_attestable(uuid, public.property_check_type, integer)
  to authenticated;

comment on function public.property_check_attestable(uuid, public.property_check_type, integer) is
  'Null when this check may honestly be recorded as passed, otherwise the reason it may not. Checks a database can test are tested; checks it cannot -- ownership, structural, flood, government acquisition -- require at least one evidence URL.';
