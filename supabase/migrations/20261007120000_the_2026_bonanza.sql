-- THE 2026 BONANZA (Eden, 2026-10-07): any agency that uploads 20 listings this year
-- gets a year free next year.
--
-- What "free" is: the top plan (Leader, unlimited listings and syndication) for all
-- of 2027, to 31 December 2027 at midnight Lagos time. It is set the same way a
-- payment sets a plan (subscription_tier + subscription_current_period_end), so the
-- limits, the Billing page and the paywall all treat it as a real plan with no new
-- code paths, and it simply runs out on the date: no renewal is charged, because no
-- card is on file for it.
--
-- What counts: listings the agency has uploaded in 2026 that are still there (a
-- deleted listing does not count, so uploading and deleting cannot be used to reach
-- 20). The count is checked every time a listing is added, until 31 December 2026
-- at midnight Lagos time. An agency already on a paid plan that runs past 2027 is
-- left alone; one that ends earlier is extended to the end of 2027.
--
-- A platform admin can take a grant back (bonanza_revoke) if a listing turns out to
-- have been junk; every grant is recorded.

create table if not exists public.bonanza_grants (
  agency_id     uuid primary key references public.agencies(id) on delete cascade,
  granted_at    timestamptz not null default now(),
  listings_at   integer not null,
  plan          text not null default 'market_leader',
  free_until    timestamptz not null,
  revoked_at    timestamp with time zone
);
alter table public.bonanza_grants enable row level security;
-- No policies: service role and the functions below only.

insert into public.platform_settings (key, value)
values ('bonanza_2026', jsonb_build_object(
  'enabled', true, 'needed', 20,
  'counts_from', '2026-01-01T00:00:00+01:00', 'counts_until', '2027-01-01T00:00:00+01:00',
  'free_until', '2028-01-01T00:00:00+01:00'))
on conflict (key) do nothing;

create or replace function public.bonanza_count(p_agency uuid)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select count(*)::integer from properties p, platform_settings s
   where s.key = 'bonanza_2026' and p.agency_id = p_agency and p.deleted_at is null
     and p.created_at >= (s.value->>'counts_from')::timestamptz
     and p.created_at <  (s.value->>'counts_until')::timestamptz;
$$;

-- Grant it if the agency has earned it. Safe to call any number of times.
create or replace function public.bonanza_check(p_agency uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare s jsonb; n integer; v_end timestamptz;
begin
  select value into s from platform_settings where key = 'bonanza_2026';
  if s is null or coalesce((s->>'enabled')::boolean, false) is not true then return false; end if;
  if now() >= (s->>'counts_until')::timestamptz then return false; end if;
  if exists (select 1 from bonanza_grants where agency_id = p_agency) then return false; end if;
  n := bonanza_count(p_agency);
  if n < coalesce((s->>'needed')::integer, 20) then return false; end if;
  v_end := (s->>'free_until')::timestamptz;
  insert into bonanza_grants (agency_id, listings_at, free_until) values (p_agency, n, v_end)
    on conflict do nothing;
  update agencies
     set subscription_tier = 'market_leader',
         subscription_current_period_end = v_end
   where id = p_agency
     and (subscription_current_period_end is null or subscription_current_period_end < v_end
          or subscription_tier = 'free');
  return true;
end;
$$;
revoke all on function public.bonanza_check(uuid), public.bonanza_count(uuid) from public, anon, authenticated;
grant execute on function public.bonanza_check(uuid), public.bonanza_count(uuid) to service_role;

create or replace function public.bonanza_after_listing()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.bonanza_check(new.agency_id);
  return null;
end;
$$;
drop trigger if exists bonanza_after_listing_trg on public.properties;
create trigger bonanza_after_listing_trg after insert on public.properties
  for each row execute function public.bonanza_after_listing();

-- What an agency's own portal shows: how far along it is. Members only.
create or replace function public.bonanza_progress(p_agency uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare s jsonb; g record;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_agency_member(p_agency) then
    raise exception 'Not a member of this agency' using errcode = '42501';
  end if;
  select value into s from platform_settings where key = 'bonanza_2026';
  if s is null or coalesce((s->>'enabled')::boolean, false) is not true then return jsonb_build_object('on', false); end if;
  select * into g from bonanza_grants where agency_id = p_agency and revoked_at is null;
  return jsonb_build_object(
    'on', true, 'needed', (s->>'needed')::integer, 'have', bonanza_count(p_agency),
    'open', now() < (s->>'counts_until')::timestamptz,
    'earned', g.agency_id is not null, 'free_until', g.free_until,
    'ends', s->>'counts_until');
end;
$$;
revoke all on function public.bonanza_progress(uuid) from public, anon;
grant execute on function public.bonanza_progress(uuid) to authenticated, service_role;

-- Agencies that already have 20 get it now.
do $$ declare r record; begin
  for r in select id from agencies where deleted_at is null loop perform public.bonanza_check(r.id); end loop;
end $$;

-- Taking a grant back (platform admin, from the SQL console or a function): the plan
-- reverts to Free from this moment.
create or replace function public.bonanza_revoke(p_agency uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update bonanza_grants set revoked_at = now() where agency_id = p_agency and revoked_at is null;
  update agencies set subscription_tier = 'free', subscription_current_period_end = null where id = p_agency;
end;
$$;
revoke all on function public.bonanza_revoke(uuid) from public, anon, authenticated;
grant execute on function public.bonanza_revoke(uuid) to service_role;
