-- 0044_campaign_creatives.sql
-- The marketing pane kept campaigns in localStorage, so they lived on one
-- browser and belonged to nobody: a colleague opening the dashboard saw
-- nothing, and clearing the cache destroyed the lot.
--
-- Moving them into `campaigns` needs two things the table did not have:
-- somewhere to put the ad creatives, which are the entire marketing UI, and
-- the two fields the campaign form actually collects.

alter table public.campaigns
  add column if not exists persona text,
  add column if not exists spend_naira numeric not null default 0;

comment on column public.campaigns.persona is
  'Audience preset key the campaign form was built from (family, investor, diaspora, firsthome).';
comment on column public.campaigns.budget_naira is
  'Daily budget in naira. The UI collects thousands and converts.';

create table if not exists public.campaign_creatives (
  id            uuid primary key default uuid_generate_v4(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  headline      text not null,
  image_url     text,
  channel       text not null,
  -- 'learning' on creation; the optimiser promotes to 'scaling' or retires to
  -- 'pausedai'. Text + check rather than an enum: these are our own labels and
  -- will change faster than a migration cycle.
  status        text not null default 'learning'
                check (status in ('learning', 'scaling', 'pausedai')),
  ctr           numeric not null default 0,
  leads_count   integer not null default 0,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists campaign_creatives_campaign_idx
  on public.campaign_creatives (campaign_id, display_order)
  where deleted_at is null;

alter table public.campaign_creatives enable row level security;

-- Access mirrors the parent campaign exactly: a creative is never more or less
-- visible than the campaign it belongs to. Reading is any agency member;
-- writing is admin/owner, matching campaigns_manage.
drop policy if exists campaign_creatives_select on public.campaign_creatives;
create policy campaign_creatives_select
  on public.campaign_creatives for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and is_agency_member(c.agency_id)
    )
  );

drop policy if exists campaign_creatives_manage on public.campaign_creatives;
create policy campaign_creatives_manage
  on public.campaign_creatives for all to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and agency_role(c.agency_id) = any (array['agency_admin'::user_role, 'agency_owner'::user_role])
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and agency_role(c.agency_id) = any (array['agency_admin'::user_role, 'agency_owner'::user_role])
    )
  );

grant select, insert, update, delete on public.campaign_creatives to authenticated;
