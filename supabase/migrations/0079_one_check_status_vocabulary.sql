-- ═══════════════════════════════════════════════════════════════════════════
-- One word for one idea.
--
-- Three vocabularies described the outcome of a verification check:
--
--   property_check_status      pending, passed, failed, not_applicable
--   verification_check_result  passed, failed, pending, expired
--   verification_nodes (jsonb) "pass", "pending" -- free text, unenforced
--
-- Only the first two were enforced, and they disagreed about which extra
-- states exist. The third was whatever the writer felt like: the seeds wrote
-- "pass", app/verify.html wrote "pass"/"fail", and a query looking for
-- "passed" found nothing. That silently answers "has this been checked?"
-- with the wrong answer, on the product whose whole promise is that answer.
--
-- One enum, carrying the union of the meanings that were real:
--   pending         nobody has looked yet
--   passed          checked, and it holds
--   failed          checked, and it does not
--   not_applicable  this check does not apply to this property
--   expired         it passed once and that has lapsed
--
-- Both check tables were empty when this ran, so nothing was migrated.
-- ═══════════════════════════════════════════════════════════════════════════

create type public.check_status as enum
  ('pending', 'passed', 'failed', 'not_applicable', 'expired');

-- property_checks_select reads status, so it stands down for the type change
-- and goes back verbatim. It hides a failed check from the public while
-- showing it to the agency it belongs to.
drop policy if exists property_checks_select on public.property_verification_checks;

alter table public.property_verification_checks alter column status drop default;
alter table public.property_verification_checks
  alter column status type public.check_status using status::text::public.check_status;
alter table public.property_verification_checks
  alter column status set default 'pending'::public.check_status;

create policy property_checks_select on public.property_verification_checks
  for select using (
    status <> 'failed'::public.check_status
    or exists (
      select 1 from properties p
      where p.id = property_verification_checks.property_id
        and is_agency_member(p.agency_id)
    )
  );

alter table public.agency_verification_checks
  alter column result type public.check_status using result::text::public.check_status;

drop type public.property_check_status;
drop type public.verification_check_result;

-- ── the JSON, which is the one that actually drifted ──────────────────────
-- jsonb cannot take an enum, so a constraint enforces the same vocabulary.
-- IMMUTABLE because a CHECK requires it, and it genuinely is.
create or replace function public.verification_nodes_ok(p jsonb)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when p is null then true
    when jsonb_typeof(p) <> 'array' then false
    else not exists (
      select 1
      from jsonb_array_elements(p) e
      where coalesce(e ->> 'status', 'pending') not in
            ('pending', 'passed', 'failed', 'not_applicable', 'expired')
    )
  end;
$$;

comment on function public.verification_nodes_ok(jsonb) is
  'Every node status in properties.verification_nodes must be a check_status '
  'label. jsonb cannot reference an enum, so this is how the two stay in step.';

alter table public.properties
  drop constraint if exists properties_verification_nodes_vocab;
alter table public.properties
  add constraint properties_verification_nodes_vocab
  check (verification_nodes_ok(verification_nodes));
