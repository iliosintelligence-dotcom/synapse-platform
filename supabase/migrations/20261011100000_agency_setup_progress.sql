-- THE SETUP ANCHOR (Eden, 2026-10-11): "people come to use the app and usually end up
-- texting me later to ask what they should do next". The portal now keeps a "what to
-- do next" anchor in view, and this is what feeds it: one read-only call that says
-- what an agency has actually done, counted from the real tables rather than from
-- anything the browser remembers.
--
-- Members only. It returns counts and flags, never other agencies' data. Rehearsal
-- posts (dry_run) do not count as posting.
create or replace function public.agency_setup_progress(p_agency uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_agency_member(p_agency) then
    raise exception 'Not a member of this agency' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'role', coalesce(agency_role(p_agency)::text, ''),
    'logo', exists (select 1 from agencies where id = p_agency and btrim(coalesce(logo_url, '')) <> ''),
    'cac', agency_may_list(p_agency),
    'listings', (select count(*) from properties where agency_id = p_agency and deleted_at is null),
    'verified', (select count(*) from properties where agency_id = p_agency and deleted_at is null and verification_status = 'verified'),
    'channels', (select count(*) from social_accounts where agency_id = p_agency and deleted_at is null and is_active),
    'posts', (select count(*) from social_posts where agency_id = p_agency and deleted_at is null and coalesce(dry_run, false) = false),
    'team', (select count(*) from agency_members where agency_id = p_agency and deleted_at is null),
    'leads', (select count(*) from leads where agency_id = p_agency and deleted_at is null),
    'referrals', (select count(*) from agency_referrals where referrer_agency_id = p_agency and revoked_at is null));
end;
$$;
revoke all on function public.agency_setup_progress(uuid) from public, anon;
grant execute on function public.agency_setup_progress(uuid) to authenticated, service_role;
