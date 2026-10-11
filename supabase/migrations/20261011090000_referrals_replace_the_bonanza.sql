-- REFERRALS REPLACE THE BONANZA (Eden, 2026-10-11).
--
-- "Remove the 20 listings bonanza ... instead let's do the agent referral: for every
-- five agents they refer they get one month free subscription."
--
-- 1. The bonanza is removed completely: trigger, functions, table and setting. Nobody
--    had earned it (bonanza_grants was empty when this was written), so there is no
--    one to take a plan back from.
--
-- 2. Every agency has a referral code. An agency that signs up through someone's link
--    claims that code once (referral_claim). A claim COUNTS when the referred agency
--    has really started using Synapse: it has uploaded `listings_required` listings
--    (3 by default; platform_settings 'referrals'). That is the guard against a
--    referrer making five empty accounts for themselves. Every 5th counted referral
--    gives the referrer one month free (referral_rewards), applied like a payment
--    applies a plan: the paid-through date moves out a month, and an agency on the
--    Free plan gets Accelerate for that month.
--
-- 3. Limits that keep it honest: a claim must come from the OWNER of an agency made in
--    the last 14 days, an agency can be referred once, never by itself, and the months
--    earned are capped (12 by default). A platform admin can take a referral back
--    (referral_revoke) if it turns out to be fake.

-- ── 1. the bonanza goes ───────────────────────────────────────────────────────
drop trigger if exists bonanza_after_listing_trg on public.properties;
drop function if exists public.bonanza_after_listing();
drop function if exists public.bonanza_progress(uuid);
drop function if exists public.bonanza_check(uuid);
drop function if exists public.bonanza_count(uuid);
drop function if exists public.bonanza_revoke(uuid);
drop table if exists public.bonanza_grants;
delete from public.platform_settings where key = 'bonanza_2026';

-- ── 2. referral codes ─────────────────────────────────────────────────────────
-- No 0/O/1/I/L: a code read out loud or copied from a screenshot should survive.
create or replace function public.gen_referral_code()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
  i integer;
begin
  loop
    c := '';
    for i in 1..7 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.agencies where referral_code = c);
  end loop;
  return c;
end;
$$;
revoke all on function public.gen_referral_code() from public, anon, authenticated;
grant execute on function public.gen_referral_code() to service_role;

alter table public.agencies add column if not exists referral_code text;
update public.agencies set referral_code = public.gen_referral_code() where referral_code is null;
alter table public.agencies alter column referral_code set default public.gen_referral_code();
create unique index if not exists agencies_referral_code_key on public.agencies (referral_code);

-- An agency cannot change its own code (it is how the rewards are tied to it).
-- Same guard the plan and owner already have; this replaces that function with the
-- same body plus the code.
create or replace function public.agencies_guard_plan_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_platform_admin() then
    return new;
  end if;
  if new.subscription_tier is distinct from old.subscription_tier
     or new.subscription_current_period_end is distinct from old.subscription_current_period_end then
    raise exception 'the plan and its paid period are set by billing, not by an agency'
      using errcode = '42501';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'ownership of an agency is changed by Synapse, not from the portal'
      using errcode = '42501';
  end if;
  if new.relationship_manager_id is distinct from old.relationship_manager_id
     or new.relationship_manager_hours is distinct from old.relationship_manager_hours then
    raise exception 'the relationship manager is assigned by Synapse'
      using errcode = '42501';
  end if;
  if new.referral_code is distinct from old.referral_code then
    raise exception 'an agency''s referral code is set by Synapse'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ── tables: server-side only (RLS on, no policies) ────────────────────────────
create table if not exists public.referrals (
  id                  uuid primary key default gen_random_uuid(),
  referrer_agency_id  uuid not null references public.agencies(id) on delete cascade,
  referred_agency_id  uuid not null unique references public.agencies(id) on delete cascade,
  claimed_at          timestamptz not null default now(),
  qualified_at        timestamptz,
  revoked_at          timestamptz,
  check (referrer_agency_id <> referred_agency_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_agency_id);
alter table public.referrals enable row level security;

create table if not exists public.referral_rewards (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  earned_at    timestamptz not null default now(),
  months       integer not null default 1,
  after_count  integer not null,
  unique (agency_id, after_count)
);
alter table public.referral_rewards enable row level security;

insert into public.platform_settings (key, value)
values ('referrals', jsonb_build_object(
  'enabled', true, 'per_reward', 5, 'months_per_reward', 1,
  'listings_required', 3, 'max_rewards', 12, 'claim_window_days', 14))
on conflict (key) do nothing;

-- ── applying a month ──────────────────────────────────────────────────────────
create or replace function public.referral_apply_month(p_agency uuid, p_months integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update agencies
     set subscription_tier = case when subscription_tier = 'free' then 'accelerator' else subscription_tier end,
         subscription_current_period_end =
           greatest(coalesce(subscription_current_period_end, now()), now()) + make_interval(months => p_months)
   where id = p_agency;
end;
$$;
revoke all on function public.referral_apply_month(uuid, integer) from public, anon, authenticated;
grant execute on function public.referral_apply_month(uuid, integer) to service_role;

-- ── rewards: one month for every `per_reward` counted referrals ───────────────
create or replace function public.referral_reward(p_referrer uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s jsonb; per integer; months integer; cap integer; counted integer; given integer; granted integer := 0;
begin
  select value into s from platform_settings where key = 'referrals';
  if s is null or coalesce((s->>'enabled')::boolean, false) is not true then return 0; end if;
  per := greatest(coalesce((s->>'per_reward')::integer, 5), 1);
  months := greatest(coalesce((s->>'months_per_reward')::integer, 1), 1);
  cap := coalesce((s->>'max_rewards')::integer, 12);
  select count(*) into counted from referrals
   where referrer_agency_id = p_referrer and qualified_at is not null and revoked_at is null;
  select count(*) into given from referral_rewards where agency_id = p_referrer;
  while given < counted / per and given < cap loop
    given := given + 1;
    insert into referral_rewards (agency_id, months, after_count) values (p_referrer, months, given * per)
      on conflict do nothing;
    perform referral_apply_month(p_referrer, months);
    granted := granted + 1;
  end loop;
  return granted;
end;
$$;
revoke all on function public.referral_reward(uuid) from public, anon, authenticated;
grant execute on function public.referral_reward(uuid) to service_role;

-- ── a referral counts once the referred agency has really started ─────────────
create or replace function public.referral_check(p_referred uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare s jsonb; r record; need integer; have integer;
begin
  select value into s from platform_settings where key = 'referrals';
  if s is null or coalesce((s->>'enabled')::boolean, false) is not true then return false; end if;
  select * into r from referrals
   where referred_agency_id = p_referred and qualified_at is null and revoked_at is null;
  if not found then return false; end if;
  need := greatest(coalesce((s->>'listings_required')::integer, 3), 1);
  select count(*) into have from properties where agency_id = p_referred and deleted_at is null;
  if have < need then return false; end if;
  update referrals set qualified_at = now() where id = r.id and qualified_at is null;
  perform referral_reward(r.referrer_agency_id);
  return true;
end;
$$;
revoke all on function public.referral_check(uuid) from public, anon, authenticated;
grant execute on function public.referral_check(uuid) to service_role;

create or replace function public.referral_after_listing()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.referral_check(new.agency_id);
  return null;
end;
$$;
drop trigger if exists referral_after_listing_trg on public.properties;
create trigger referral_after_listing_trg after insert on public.properties
  for each row execute function public.referral_after_listing();

-- ── claiming a code (the one door a browser has) ──────────────────────────────
create or replace function public.referral_claim(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  uid uuid := auth.uid();
  s jsonb; mine record; theirs uuid; win integer; code text := upper(btrim(coalesce(p_code, '')));
begin
  if uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select value into s from platform_settings where key = 'referrals';
  if s is null or coalesce((s->>'enabled')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if code !~ '^[A-Z0-9]{6,10}$' then return jsonb_build_object('ok', false, 'reason', 'unknown_code'); end if;
  select id, created_at into mine from agencies where owner_id = uid and deleted_at is null order by created_at limit 1;
  if mine.id is null then return jsonb_build_object('ok', false, 'reason', 'no_agency'); end if;
  win := coalesce((s->>'claim_window_days')::integer, 14);
  if mine.created_at < now() - make_interval(days => win) then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;
  select id into theirs from agencies where referral_code = code and deleted_at is null;
  if theirs is null then return jsonb_build_object('ok', false, 'reason', 'unknown_code'); end if;
  if theirs = mine.id then return jsonb_build_object('ok', false, 'reason', 'own'); end if;
  -- two agencies owned by the same person are one agency for this purpose
  if exists (select 1 from agencies where id = theirs and owner_id = uid) then
    return jsonb_build_object('ok', false, 'reason', 'own');
  end if;
  insert into referrals (referrer_agency_id, referred_agency_id) values (theirs, mine.id)
    on conflict (referred_agency_id) do nothing;
  perform referral_check(mine.id);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.referral_claim(text) from public, anon;
grant execute on function public.referral_claim(text) to authenticated, service_role;

-- ── what an agency's own portal shows (members only) ──────────────────────────
create or replace function public.referral_overview(p_agency uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare s jsonb; per integer; counted integer; pending integer; earned integer; code text; rec jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not is_agency_member(p_agency) then
    raise exception 'Not a member of this agency' using errcode = '42501';
  end if;
  select value into s from platform_settings where key = 'referrals';
  if s is null or coalesce((s->>'enabled')::boolean, false) is not true then return jsonb_build_object('on', false); end if;
  per := greatest(coalesce((s->>'per_reward')::integer, 5), 1);
  select referral_code into code from agencies where id = p_agency;
  select count(*) filter (where qualified_at is not null and revoked_at is null),
         count(*) filter (where qualified_at is null and revoked_at is null)
    into counted, pending from referrals where referrer_agency_id = p_agency;
  select coalesce(sum(months), 0) into earned from referral_rewards where agency_id = p_agency;
  select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) into rec from (
    select jsonb_build_object('name', a.name, 'counted', r.qualified_at is not null, 'at', r.claimed_at) as x
      from referrals r join agencies a on a.id = r.referred_agency_id
     where r.referrer_agency_id = p_agency and r.revoked_at is null
     order by r.claimed_at desc limit 8) t;
  return jsonb_build_object(
    'on', true, 'code', code, 'per_reward', per,
    'months_per_reward', coalesce((s->>'months_per_reward')::integer, 1),
    'listings_required', coalesce((s->>'listings_required')::integer, 3),
    'counted', counted, 'pending', pending, 'months_earned', earned,
    'into_next', counted % per, 'recent', rec);
end;
$$;
revoke all on function public.referral_overview(uuid) from public, anon;
grant execute on function public.referral_overview(uuid) to authenticated, service_role;

-- Taking a referral back (platform admin, from the SQL console).
create or replace function public.referral_revoke(p_referred uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update referrals set revoked_at = now() where referred_agency_id = p_referred and revoked_at is null;
end;
$$;
revoke all on function public.referral_revoke(uuid) from public, anon, authenticated;
grant execute on function public.referral_revoke(uuid) to service_role;
