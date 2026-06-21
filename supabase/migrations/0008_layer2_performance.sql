-- Layer 2 · performance snapshots
-- Dashboards read ONLY from these pre-aggregated tables, never from raw
-- rows at query time. A nightly pg_cron job fills yesterday's snapshots.

create extension if not exists pg_cron;

-- ──────────────────────── agency daily snapshot ────────────────────────
create table agency_daily_snapshots (
  agency_id                     uuid not null references agencies (id) on delete cascade,
  date                          date not null,
  new_leads                     integer not null default 0,
  leads_contacted               integer not null default 0,
  viewings_scheduled            integer not null default 0,
  viewings_completed            integer not null default 0,
  deals_closed                  integer not null default 0,
  revenue_generated             numeric(16,2) not null default 0,
  average_response_time_seconds bigint,
  pipeline_velocity_days        numeric(8,2),
  created_at                    timestamptz not null default now(),
  primary key (agency_id, date)
);

-- ──────────────────────── agent daily snapshot ────────────────────────
create table agent_daily_snapshots (
  agent_id                      uuid not null references profiles (id) on delete cascade,
  agency_id                     uuid not null references agencies (id) on delete cascade,
  date                          date not null,
  assigned_leads                integer not null default 0,
  leads_contacted               integer not null default 0,
  viewings_scheduled            integer not null default 0,
  viewings_completed            integer not null default 0,
  deals_closed                  integer not null default 0,
  revenue_generated             numeric(16,2) not null default 0,
  average_response_time_seconds bigint,
  created_at                    timestamptz not null default now(),
  primary key (agent_id, date)
);

-- ──────────────────────── property performance (rolling) ────────────────────────
create table property_performance (
  property_id              uuid primary key references properties (id) on delete cascade,
  total_leads              integer not null default 0,
  total_viewings           integer not null default 0,
  conversion_rate          numeric(5,2),
  average_days_to_close    numeric(8,2),
  total_revenue_generated  numeric(16,2) not null default 0,
  top_source_channel       attribution_channel,
  updated_at               timestamptz not null default now()
);

-- ──────────────── nightly aggregation ────────────────
-- Aggregates a single day. Idempotent: upserts, so re-runs are safe.
create or replace function aggregate_daily_snapshots(p_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- agency snapshot
  insert into agency_daily_snapshots as s (
    agency_id, date, new_leads, leads_contacted, viewings_scheduled,
    viewings_completed, deals_closed, revenue_generated, average_response_time_seconds
  )
  select
    a.id, p_date,
    count(distinct l.id) filter (where l.created_at::date = p_date),
    count(distinct c.lead_id) filter (where c.direction = 'outbound' and c.occurred_at::date = p_date),
    count(distinct v.id) filter (where v.created_at::date = p_date),
    count(distinct v.id) filter (where v.completed_at::date = p_date),
    count(distinct dr.id) filter (where dr.status = 'closed' and dr.closed_at::date = p_date),
    coalesce(sum(dr.closing_price) filter (where dr.status = 'closed' and dr.closed_at::date = p_date), 0),
    avg(c.response_time_seconds) filter (where c.occurred_at::date = p_date)::bigint
  from agencies a
    left join leads l on l.agency_id = a.id
    left join communications c on c.lead_id = l.id
    left join viewings v on v.agency_id = a.id
    left join deal_rooms dr on dr.agency_id = a.id
  group by a.id
  on conflict (agency_id, date) do update set
    new_leads = excluded.new_leads,
    leads_contacted = excluded.leads_contacted,
    viewings_scheduled = excluded.viewings_scheduled,
    viewings_completed = excluded.viewings_completed,
    deals_closed = excluded.deals_closed,
    revenue_generated = excluded.revenue_generated,
    average_response_time_seconds = excluded.average_response_time_seconds;

  -- agent snapshot
  insert into agent_daily_snapshots as s (
    agent_id, agency_id, date, assigned_leads, leads_contacted,
    viewings_scheduled, viewings_completed, deals_closed, revenue_generated,
    average_response_time_seconds
  )
  select
    am.profile_id, am.agency_id, p_date,
    count(distinct l.id) filter (where l.assigned_agent_id = am.profile_id),
    count(distinct c.lead_id) filter (where c.agent_id = am.profile_id and c.direction = 'outbound' and c.occurred_at::date = p_date),
    count(distinct v.id) filter (where v.agent_id = am.profile_id and v.created_at::date = p_date),
    count(distinct v.id) filter (where v.agent_id = am.profile_id and v.completed_at::date = p_date),
    count(distinct dr.id) filter (where dr.agent_id = am.profile_id and dr.status = 'closed' and dr.closed_at::date = p_date),
    coalesce(sum(dr.closing_price) filter (where dr.agent_id = am.profile_id and dr.status = 'closed' and dr.closed_at::date = p_date), 0),
    avg(c.response_time_seconds) filter (where c.agent_id = am.profile_id and c.occurred_at::date = p_date)::bigint
  from agency_members am
    left join leads l on l.agency_id = am.agency_id
    left join communications c on c.lead_id = l.id
    left join viewings v on v.agency_id = am.agency_id
    left join deal_rooms dr on dr.agency_id = am.agency_id
  where am.deleted_at is null
  group by am.profile_id, am.agency_id
  on conflict (agent_id, date) do update set
    assigned_leads = excluded.assigned_leads,
    leads_contacted = excluded.leads_contacted,
    viewings_scheduled = excluded.viewings_scheduled,
    viewings_completed = excluded.viewings_completed,
    deals_closed = excluded.deals_closed,
    revenue_generated = excluded.revenue_generated,
    average_response_time_seconds = excluded.average_response_time_seconds;

  -- rolling property performance
  insert into property_performance as pp (
    property_id, total_leads, total_viewings, total_revenue_generated, top_source_channel, updated_at
  )
  select
    p.id,
    count(distinct l.id),
    count(distinct v.id),
    coalesce(sum(dr.closing_price) filter (where dr.status = 'closed'), 0),
    (select channel from lead_attribution la
       join leads l2 on l2.id = la.lead_id
       where l2.property_id = p.id
       group by channel order by count(*) desc limit 1),
    now()
  from properties p
    left join leads l on l.property_id = p.id
    left join viewings v on v.property_id = p.id
    left join deal_rooms dr on dr.property_id = p.id
  group by p.id
  on conflict (property_id) do update set
    total_leads = excluded.total_leads,
    total_viewings = excluded.total_viewings,
    total_revenue_generated = excluded.total_revenue_generated,
    top_source_channel = excluded.top_source_channel,
    conversion_rate = case when excluded.total_leads > 0
      then round(100.0 * (select count(*) from deal_rooms d where d.property_id = pp.property_id and d.status = 'closed') / excluded.total_leads, 2)
      else 0 end,
    updated_at = now();
end;
$$;

-- Run every night at 01:30 for the day that just ended.
select cron.schedule(
  'synapse-daily-snapshots',
  '30 1 * * *',
  $$select aggregate_daily_snapshots((now() - interval '1 day')::date)$$
);
