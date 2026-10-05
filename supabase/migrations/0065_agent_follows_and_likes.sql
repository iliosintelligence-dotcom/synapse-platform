-- Applied to the live project on 2026-08-25.
--
-- Social proof for agents, counted rather than scored. Deliberately not stars:
-- a like is one person saying "this agent was good", and the number of people
-- who said it is the whole signal.

-- The composite primary key is the integrity rule, not a convenience: one row
-- per (agent, person) makes a second follow or like a no-op at the database
-- level, so a count can never be inflated by tapping twice.
create table if not exists public.agent_follows (
  agent_id    uuid not null references public.profiles(id) on delete cascade,
  follower_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (agent_id, follower_id)
);

create table if not exists public.agent_likes (
  agent_id   uuid not null references public.profiles(id) on delete cascade,
  liker_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agent_id, liker_id)
);

create index if not exists agent_follows_agent_idx on public.agent_follows (agent_id);
create index if not exists agent_likes_agent_idx  on public.agent_likes  (agent_id);

alter table public.agent_follows enable row level security;
alter table public.agent_likes   enable row level security;

-- You may read, create and remove ONLY your own follow/like. Nobody can
-- enumerate who follows an agent — the public number comes from the aggregate
-- view below, so the count is public while the list of people is not.
drop policy if exists agent_follows_own on public.agent_follows;
create policy agent_follows_own on public.agent_follows
  for all using (follower_id = auth.uid()) with check (follower_id = auth.uid());

drop policy if exists agent_likes_own on public.agent_likes;
create policy agent_likes_own on public.agent_likes
  for all using (liker_id = auth.uid()) with check (liker_id = auth.uid());

-- Counts only, for anyone. Definer-rights so it can aggregate rows the caller
-- is not allowed to read individually — which is the point.
create or replace view public.agent_social_counts
with (security_invoker = false) as
select p.id as agent_id,
       (select count(*) from public.agent_follows f where f.agent_id = p.id) as followers,
       (select count(*) from public.agent_likes   l where l.agent_id = p.id) as likes
from public.profiles p
where p.deleted_at is null;

grant select on public.agent_social_counts to anon, authenticated;

-- The buyer-facing agent card carries the same two numbers.
create or replace view public.listing_agent_cards
with (security_invoker = false) as
select
  p.id                    as agent_id,
  m.agency_id             as agency_id,
  p.full_name,
  p.avatar_url,
  ap.bio,
  ap.years_experience,
  ap.languages,
  ap.specializations,
  ap.areas_covered,
  ap.response_rate_pct,
  ap.closed_deals,
  ap.avg_rating,
  ap.certifications,
  (select count(*) from public.agent_follows f where f.agent_id = p.id) as followers,
  (select count(*) from public.agent_likes   l where l.agent_id = p.id) as likes
from public.profiles p
join public.agency_members m
  on m.profile_id = p.id and m.deleted_at is null
left join public.agent_profiles ap
  on ap.profile_id = p.id
where p.deleted_at is null
  and m.role = 'agent';

grant select on public.listing_agent_cards to anon, authenticated;
