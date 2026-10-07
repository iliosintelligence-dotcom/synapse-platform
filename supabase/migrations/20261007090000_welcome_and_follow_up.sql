-- Follow-up after registering (Eden, 2026-10-07): "our users receive email and
-- notification follow-up after they've registered, to get more information about
-- the application".
--
-- A short, kind sequence, sent by email, that stops when the person has done the
-- thing it asks. It never touches an account that existed before today.
--
--   agency   +10 min  welcome: the three things to do first
--            +1 day   add your first listing        (only if they have none)
--            +3 days  get the Verified badge        (only if not verified)
--            +6 days  connect your social accounts  (only if none connected)
--            +14 days how is it going? reply to this email
--   buyer    +10 min  welcome: tell Tayo what you are looking for
--            +2 days  tell Tayo your budget
--            +7 days  get told when a home that fits appears
--
-- One email per person per day at most; anyone can unsubscribe in one tap; nothing
-- is sent to an address that has not been confirmed. The sending is the
-- lifecycle-followup function (it needs an email provider key; until one is set it
-- sends nothing and says so). The agency portal also shows the same first steps in
-- its bell, which needs no email at all.

create table if not exists public.lifecycle_messages (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  channel     text not null default 'email' check (channel in ('email')),
  status      text not null default 'sent' check (status in ('sent', 'failed')),
  attempts    integer not null default 1,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, kind, channel)
);
create index if not exists lifecycle_messages_recent on public.lifecycle_messages (profile_id, created_at desc);

create table if not exists public.lifecycle_optout (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  at          timestamptz not null default now()
);

alter table public.lifecycle_messages enable row level security;
alter table public.lifecycle_optout enable row level security;
-- No policies: only the service role reads or writes these.

-- When the follow-up began, so it never reaches back to accounts that were here before.
insert into public.platform_settings (key, value)
values ('lifecycle_followup', jsonb_build_object('enabled', true, 'since', to_jsonb(now())))
on conflict (key) do nothing;

-- Who is due an email right now, and which one.
create or replace function public.lifecycle_due(p_limit integer default 40)
returns table (profile_id uuid, email text, full_name text, role text, kind text)
language sql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
  with cfg as (
    select coalesce((value->>'enabled')::boolean, false) as enabled,
           coalesce((value->>'since')::timestamptz, now()) as since
      from platform_settings where key = 'lifecycle_followup'
  ),
  p as (
    select pr.id, u.email::text as email, pr.full_name, pr.role::text as role, u.created_at,
      exists (select 1 from agency_members m join properties x on x.agency_id = m.agency_id
               where m.profile_id = pr.id and m.deleted_at is null and x.deleted_at is null) as has_listing,
      exists (select 1 from agency_members m join agencies a on a.id = m.agency_id
               where m.profile_id = pr.id and m.deleted_at is null and a.deleted_at is null
                 and a.verification_tier::text <> 'unverified') as verified,
      exists (select 1 from agency_members m join social_accounts s on s.agency_id = m.agency_id
               where m.profile_id = pr.id and m.deleted_at is null and s.deleted_at is null and s.is_active) as has_social
      from profiles pr
      join auth.users u on u.id = pr.id
      cross join cfg
     where cfg.enabled
       and pr.deleted_at is null
       and u.email is not null and u.email_confirmed_at is not null
       and u.created_at >= cfg.since
       and pr.role::text <> 'platform_admin'
       and not exists (select 1 from lifecycle_optout o where o.profile_id = pr.id)
       and not exists (select 1 from lifecycle_messages l where l.profile_id = pr.id and l.status = 'sent' and l.created_at > now() - interval '20 hours')
  ),
  steps (kind, audience, delay, needs) as (values
    ('a_welcome',  'agency', interval '10 minutes', 'any'),
    ('a_listing',  'agency', interval '1 day',      'no_listing'),
    ('a_verify',   'agency', interval '3 days',     'unverified'),
    ('a_social',   'agency', interval '6 days',     'no_social'),
    ('a_checkin',  'agency', interval '14 days',    'any'),
    ('b_welcome',  'buyer',  interval '10 minutes', 'any'),
    ('b_tayo',     'buyer',  interval '2 days',     'any'),
    ('b_alerts',   'buyer',  interval '7 days',     'any')
  ),
  due as (
    select p.id, p.email, p.full_name, p.role, s.kind, p.created_at + s.delay as due_at,
           row_number() over (partition by p.id order by p.created_at + s.delay) as n
      from p
      join steps s on s.audience = case when p.role = 'consumer' then 'buyer' else 'agency' end
     where now() >= p.created_at + s.delay
       -- a step that is more than two weeks late is not worth sending
       and now() <= p.created_at + s.delay + interval '14 days'
       and (s.needs = 'any'
            or (s.needs = 'no_listing' and not p.has_listing)
            or (s.needs = 'unverified' and not p.verified)
            or (s.needs = 'no_social' and not p.has_social))
       and not exists (select 1 from lifecycle_messages l
                        where l.profile_id = p.id and l.kind = s.kind and l.channel = 'email'
                          and (l.status = 'sent' or l.attempts >= 3))
  )
  -- the earliest due step per person: one email at a time
  select d.id, d.email, d.full_name, d.role, d.kind
    from due d where d.n = 1
   order by d.due_at
   limit greatest(1, least(coalesce(p_limit, 40), 200));
$$;
revoke all on function public.lifecycle_due(integer) from public, anon, authenticated;
grant execute on function public.lifecycle_due(integer) to service_role;

-- The job: every half hour, ask the function to send what is due.
create or replace function public.run_lifecycle_followup()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $$
declare v_key text; v_url text; v_n integer;
begin
  select count(*) into v_n from lifecycle_due(1);
  if v_n = 0 then return 0; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if v_key is null or v_url is null then return 0; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/lifecycle-followup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('action', 'send_due'),
    timeout_milliseconds := 60000);
  return v_n;
end;
$$;
revoke all on function public.run_lifecycle_followup() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'lifecycle-followup') then
    perform cron.schedule('lifecycle-followup', '*/30 * * * *', 'select public.run_lifecycle_followup()');
  end if;
end $$;
