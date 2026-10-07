-- Two more agency emails: add your team (day 2, only if they are the only person on the agency) and
-- proximity marketing (day 9). Same rules as the rest of the sequence.

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
               where m.profile_id = pr.id and m.deleted_at is null and s.deleted_at is null and s.is_active) as has_social,
      (select count(distinct m2.profile_id) from agency_members m2 where m2.deleted_at is null
          and m2.agency_id in (select m3.agency_id from agency_members m3 where m3.profile_id = pr.id and m3.deleted_at is null)) < 2 as solo
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
    ('a_team',     'agency', interval '2 days',     'solo'),
    ('a_social',   'agency', interval '6 days',     'no_social'),
    ('a_proximity','agency', interval '9 days',     'any'),
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
            or (s.needs = 'no_social' and not p.has_social)
            or (s.needs = 'solo' and p.solo))
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
