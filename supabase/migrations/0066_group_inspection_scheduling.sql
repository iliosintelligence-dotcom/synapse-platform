-- Applied to the live project on 2026-08-25.
--
-- Group inspection scheduling — consolidate buyers interested in the same
-- property into one visit, drawn only from times the agent has pre-cleared.
--
-- Shape:
--   agent_availability   when an agent will show. Availability belongs to the
--                        AGENT because the agent does the showing. property_id
--                        null widens a rule to all their listings; agent_id
--                        null makes it an agency-wide fallback, so a listing is
--                        never unbookable just because one calendar is empty.
--   inspection_slots     a concrete occurrence, created when the FIRST buyer
--                        books it. UNIQUE (property, agent, starts_at) is what
--                        makes later buyers JOIN that group rather than open a
--                        parallel one.
--   viewings.slot_id     viewings stays the per-buyer attendance record — it
--                        already carries lead_id, outcome and post-viewing
--                        feedback. The link is all that makes a group a group.
--
-- The rules live in three SECURITY DEFINER functions, so a client that skips
-- the UI gains nothing:
--   inspection_readiness   the qualification gate. Reports what is MISSING
--                          rather than only refusing, so Toju can ask for
--                          exactly that. Every *_score column on leads is null
--                          today, so financial_readiness_score is a bonus
--                          signal and never a blocker — gating on it would
--                          qualify nobody and the feature would look broken
--                          rather than strict.
--   open_inspection_slots  expands availability into concrete times, stepping
--                          across each window, and folds in existing slots.
--   book_inspection        re-qualifies, re-derives that the time really was
--                          pre-cleared, and re-counts capacity under a lock.


create table if not exists public.agent_availability (
  id            uuid primary key default uuid_generate_v4(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  agent_id      uuid references public.profiles(id) on delete cascade,
  property_id   uuid references public.properties(id) on delete cascade,
  weekday       smallint check (weekday between 0 and 6),
  specific_date date,
  start_time    time not null,
  end_time      time not null,
  slot_minutes  smallint not null default 60 check (slot_minutes between 15 and 240),
  capacity      smallint not null default 4 check (capacity between 1 and 20),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  -- A row is either a weekly pattern or a single date, never both and never
  -- neither: anything else has no meaning when slots are generated.
  constraint availability_shape check (
    (weekday is not null and specific_date is null)
    or (weekday is null and specific_date is not null)),
  constraint availability_window check (end_time > start_time)
);

create index if not exists agent_availability_lookup_idx
  on public.agent_availability (agency_id, agent_id, property_id)
  where deleted_at is null;

create table if not exists public.inspection_slots (
  id               uuid primary key default uuid_generate_v4(),
  agency_id        uuid not null references public.agencies(id) on delete cascade,
  agent_id         uuid not null references public.profiles(id) on delete cascade,
  property_id      uuid not null references public.properties(id) on delete cascade,
  starts_at        timestamptz not null,
  duration_minutes smallint not null default 60,
  capacity         smallint not null default 4 check (capacity between 1 and 20),
  status           text not null default 'open'
                     check (status in ('open','confirmed','cancelled','completed')),
  agency_note      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (property_id, agent_id, starts_at)
);

create index if not exists inspection_slots_property_idx
  on public.inspection_slots (property_id, starts_at);

alter table public.viewings
  add column if not exists slot_id uuid references public.inspection_slots(id) on delete set null;

create index if not exists viewings_slot_idx
  on public.viewings (slot_id) where slot_id is not null;

alter table public.agent_availability enable row level security;
alter table public.inspection_slots   enable row level security;

drop policy if exists availability_agency on public.agent_availability;
create policy availability_agency on public.agent_availability
  for all using (is_agency_member(agency_id)) with check (is_agency_member(agency_id));

-- Buyers must see what is on offer, so slots are publicly readable: they are
-- times and headcounts, never buyer identities. Who is coming lives in
-- `viewings`, which stays restricted.
drop policy if exists slots_read on public.inspection_slots;
create policy slots_read on public.inspection_slots for select using (true);

drop policy if exists slots_agency_manage on public.inspection_slots;
create policy slots_agency_manage on public.inspection_slots
  for all using (is_agency_member(agency_id)) with check (is_agency_member(agency_id));

grant select on public.inspection_slots to anon, authenticated;

-- ── the qualification gate ─────────────────────────────────────────────────
create or replace function public.inspection_readiness(p_property_id uuid)
returns table (ready boolean, missing text[], lead_id uuid)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid       uuid := auth.uid();
  v_price     numeric;
  v_lead      record;
  v_missing   text[] := '{}';
begin
  if v_uid is null then
    return query select false, array['sign_in']::text[], null::uuid;
    return;
  end if;

  select price into v_price from properties where id = p_property_id;
  if v_price is null then
    return query select false, array['listing']::text[], null::uuid;
    return;
  end if;

  select l.id, l.current_stage, l.budget_max, l.financial_readiness_score
    into v_lead
  from leads l
  where l.consumer_id = v_uid
    and l.property_id = p_property_id
    and l.deleted_at is null
  order by l.created_at desc
  limit 1;

  -- No lead means they have not actually asked this agency about this home.
  if v_lead.id is null then
    return query select false, array['contact']::text[], null::uuid;
    return;
  end if;

  -- Toju has to have qualified them first. new/contacted is an enquiry, not a
  -- buyer ready to take an agent out to a property.
  if v_lead.current_stage in ('new', 'contacted') then
    v_missing := v_missing || 'qualification';
  end if;

  -- A budget that reaches the asking price, with the same 15% stretch Toju
  -- already allows when matching, so "slightly over budget but worth it" does
  -- not get someone barred from viewing.
  if v_lead.budget_max is null then
    v_missing := v_missing || 'budget';
  elsif v_lead.budget_max < v_price * 0.85 then
    v_missing := v_missing || 'budget_fit';
  end if;

  -- Present-and-low blocks; absent does not.
  if v_lead.financial_readiness_score is not null
     and v_lead.financial_readiness_score < 40 then
    v_missing := v_missing || 'financial_readiness';
  end if;

  return query select (array_length(v_missing, 1) is null), v_missing, v_lead.id;
end;
$function$;

-- ── what times are on offer ────────────────────────────────────────────────
create or replace function public.open_inspection_slots(p_property_id uuid, p_days int default 14)
returns table (
  slot_id     uuid,
  starts_at   timestamptz,
  duration    smallint,
  capacity    smallint,
  taken       bigint,
  status      text,
  agent_id    uuid,
  agent_name  text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_agent   uuid;
  v_agency  uuid;
begin
  select p.listed_by_agent_id, p.agency_id into v_agent, v_agency
  from properties p where p.id = p_property_id;
  if v_agency is null then return; end if;

  return query
  with rules as (
    -- Narrowest wins: a rule for this exact property beats the agent's general
    -- calendar, which beats the agency-wide fallback.
    select a.*,
           case when a.property_id = p_property_id then 1
                when a.agent_id = v_agent then 2
                else 3 end as precedence
    from agent_availability a
    where a.deleted_at is null
      and a.agency_id = v_agency
      and (a.property_id = p_property_id or a.property_id is null)
      and (a.agent_id = v_agent or a.agent_id is null)
  ),
  best as (
    select * from rules where precedence = (select min(precedence) from rules)
  ),
  days as (
    select (current_date + i) as d from generate_series(0, greatest(p_days, 1)) as i
  ),
  candidates as (
    select
      ((d.d + b.start_time + (n * make_interval(mins => b.slot_minutes)))
        at time zone 'Africa/Lagos') as starts_at,
      b.slot_minutes, b.capacity
    from best b
    join days d
      on (b.specific_date is not null and b.specific_date = d.d)
      or (b.weekday is not null and b.weekday = extract(dow from d.d))
    -- one candidate per slot_minutes step that fits entirely inside the window
    cross join lateral generate_series(
      0,
      greatest(0, (extract(epoch from (b.end_time - b.start_time)) / 60 / b.slot_minutes)::int - 1)
    ) as n
  )
  select
    s.id,
    c.starts_at,
    coalesce(s.duration_minutes, c.slot_minutes)::smallint,
    coalesce(s.capacity, c.capacity)::smallint,
    coalesce((select count(*) from viewings v
              where v.slot_id = s.id and v.status <> 'cancelled' and v.deleted_at is null), 0),
    coalesce(s.status, 'open'),
    v_agent,
    (select pr.full_name from profiles pr where pr.id = v_agent)
  from candidates c
  left join inspection_slots s
    on s.property_id = p_property_id
   and s.starts_at   = c.starts_at
   and s.status <> 'cancelled'
  where c.starts_at > now()
    and coalesce((select count(*) from viewings v
                  where v.slot_id = s.id and v.status <> 'cancelled' and v.deleted_at is null), 0)
        < coalesce(s.capacity, c.capacity)
  order by c.starts_at
  limit 24;
end;
$function$;

-- ── book a place ───────────────────────────────────────────────────────────
create or replace function public.book_inspection(p_property_id uuid, p_starts_at timestamptz)
returns table (ok boolean, reason text, slot_id uuid, taken bigint)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid     uuid := auth.uid();
  v_ready   record;
  v_offered boolean;
  v_slot    inspection_slots%rowtype;
  v_agent   uuid;
  v_agency  uuid;
  v_dur     smallint;
  v_cap     smallint;
  v_taken   bigint;
begin
  if v_uid is null then
    return query select false, 'sign_in', null::uuid, 0::bigint; return;
  end if;

  select * into v_ready from inspection_readiness(p_property_id);
  if not v_ready.ready then
    return query select false, coalesce(array_to_string(v_ready.missing, ','), 'not_ready'),
                        null::uuid, 0::bigint;
    return;
  end if;

  -- The offered list is the authority on which times exist. Re-deriving it here
  -- is what stops a crafted request booking a time the agent never cleared.
  select true, o.duration, o.capacity, o.agent_id
    into v_offered, v_dur, v_cap, v_agent
  from open_inspection_slots(p_property_id, 30) o
  where o.starts_at = p_starts_at
  limit 1;

  if v_offered is not true then
    return query select false, 'slot_unavailable', null::uuid, 0::bigint; return;
  end if;

  select agency_id into v_agency from properties where id = p_property_id;

  -- Materialise the group on first booking; everyone after joins this row.
  -- ON CONFLICT is what makes two simultaneous first-bookings converge on one
  -- slot instead of racing to create two.
  insert into inspection_slots (agency_id, agent_id, property_id, starts_at, duration_minutes, capacity)
  values (v_agency, v_agent, p_property_id, p_starts_at, v_dur, v_cap)
  on conflict (property_id, agent_id, starts_at) do update set updated_at = now()
  returning * into v_slot;

  -- Lock the slot before counting, so two buyers taking the last place cannot
  -- both read "one left".
  perform 1 from inspection_slots where id = v_slot.id for update;

  select count(*) into v_taken from viewings v
  where v.slot_id = v_slot.id and v.status <> 'cancelled' and v.deleted_at is null;

  -- Already booked in? Idempotent, not an error.
  if exists (select 1 from viewings v
             where v.slot_id = v_slot.id and v.consumer_id = v_uid
               and v.status <> 'cancelled' and v.deleted_at is null) then
    return query select true, 'already_booked', v_slot.id, v_taken; return;
  end if;

  if v_taken >= v_slot.capacity then
    return query select false, 'slot_full', v_slot.id, v_taken; return;
  end if;

  insert into viewings (property_id, consumer_id, agency_id, agent_id, lead_id,
                        slot_id, scheduled_at, duration_minutes, status)
  values (p_property_id, v_uid, v_agency, v_agent, v_ready.lead_id,
          v_slot.id, p_starts_at, v_slot.duration_minutes, 'requested');

  -- The pipeline should reflect that a viewing is on the books.
  update leads set current_stage = 'viewing_scheduled', last_activity_at = now()
  where id = v_ready.lead_id and current_stage not in ('closed', 'lost');

  return query select true, 'booked', v_slot.id, v_taken + 1;
end;
$function$;

revoke execute on function public.inspection_readiness(uuid) from public;
grant  execute on function public.inspection_readiness(uuid) to authenticated;

revoke execute on function public.open_inspection_slots(uuid, int) from public;
grant  execute on function public.open_inspection_slots(uuid, int) to anon, authenticated;

revoke execute on function public.book_inspection(uuid, timestamptz) from public;
grant  execute on function public.book_inspection(uuid, timestamptz) to authenticated;

-- ── amendment, same day ────────────────────────────────────────────────────
-- inspection_readiness originally read the NEWEST lead for a buyer+property.
-- Tapping "Contact agent" a second time creates a fresh `new` lead, which then
-- shadowed the qualified one they already had — so getting in touch again could
-- take a primed buyer backwards and refuse them a tour they had already earned.
-- It now reads the most ADVANCED lead: qualification is a high-water mark, not
-- a property of the latest row. Closed and lost are excluded so a dead lead
-- cannot qualify anyone either. See the ORDER BY in the live definition.
