-- 0039 · Agency provisioning at signup (P-A1)
--
-- THE BUG: handle_new_user() created ONLY public.profiles. An agency signup
-- got a profile with role 'agency_owner' but no agencies row and no
-- agency_members row. The portal resolves "which agency am I" exclusively
-- through agency_members (app/agency-listings.js · agencyId()), so a freshly
-- registered agency could not upload a single listing — and nothing told
-- them why.
--
-- Client-side repair is impossible BY DESIGN: agencies_insert_owner lets the
-- new owner insert an agencies row, but agency_members_manage_admin requires
-- an already-existing admin/owner membership to insert any membership row —
-- a chicken-and-egg no client can break (0003_rls.sql). The mobile flow's
-- "createAgency after OTP" (packages/api/src/auth.ts) was always
-- half-broken for the same reason: it could create the agency but never the
-- membership, and a closed tab between the two steps stranded the account.
--
-- Provisioning therefore belongs HERE, in the same transaction that creates
-- the profile. The auth.users insert, the profile, the agency and the owner
-- membership commit together or not at all — a half-provisioned account is
-- unreachable.
--
-- Deliberate non-actions:
-- · verification_tier stays at its column default 'unverified'. Verification
--   is platform-granted only (R-00 / E-8) — nothing here self-certifies.
-- · No sample or placeholder data. Agency name and city come from what the
--   person actually typed at signup (user metadata); absent values stay
--   empty. An empty new agency is correct.
-- · agency_admin / agent signups do NOT get an agency of their own — those
--   roles join an existing agency by invitation.

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role        user_role;
  v_full_name   text;
  v_agency_name text;
  v_agency_id   uuid;
begin
  -- SELF-ASSIGNABLE ROLE WHITELIST (merged in before this was applied).
  -- The original safe cast accepted ANY valid enum value from signup metadata,
  -- including 'platform_admin'. Signup metadata is attacker-controlled, and
  -- is_platform_admin() grants verification authority from profiles.role — so
  -- that version would have let a stranger self-register as a platform
  -- administrator and mark any listing on the platform verified. Audited before
  -- applying: no account had exploited it.
  --
  -- Only the two roles a stranger is entitled to may be self-asserted. Junk and
  -- NULL fall through to 'consumer' as well, so the cast can never raise and
  -- abort the signup transaction — the failure that once 500'd every signup
  -- (see the note above roleOf() in app/auth.js).
  v_role := case new.raw_user_meta_data ->> 'role'
    when 'agency_owner' then 'agency_owner'::user_role
    when 'consumer'     then 'consumer'::user_role
    else 'consumer'::user_role
  end;
  v_full_name := coalesce(new.raw_user_meta_data ->> 'full_name', '');

  insert into public.profiles (id, role, full_name)
  values (new.id, v_role, v_full_name);

  -- A self-serve agency signup is that agency's owner: provision the agency
  -- and the owner's membership atomically with the profile.
  if v_role = 'agency_owner' then
    v_agency_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'agency_name', '')), '');

    insert into public.agencies (owner_id, name, city)
    values (
      new.id,
      -- Their own typed input only, never an invented brand:
      -- agency name → person's name → empty.
      coalesce(v_agency_name, nullif(trim(v_full_name), ''), ''),
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'city'), ''), '')
    )
    returning id into v_agency_id;

    insert into public.agency_members (agency_id, profile_id, role)
    values (v_agency_id, new.id, 'agency_owner');
  end if;

  return new;
end;
$$;

-- 0031_security_hardening revoked direct EXECUTE from client roles.
-- create-or-replace preserves the ACL, but re-assert it so this file stands
-- on its own.
revoke execute on function handle_new_user() from public, anon, authenticated;
