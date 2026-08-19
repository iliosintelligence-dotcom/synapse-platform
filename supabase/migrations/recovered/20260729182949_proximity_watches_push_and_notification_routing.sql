-- ═══ Proximity marketing + notification routing ═══════════════════════════
-- `notifications` already exists as a delivery-log (recipient_id, channel,
-- template_id, payload, status, retry_count…). That is a good table, so this
-- EXTENDS it rather than replacing it: we add the few columns the product
-- needs — which side of the marketplace it is for, what kind of event it is,
-- and where tapping it should land — and leave delivery mechanics alone.

alter table public.notifications
  add column if not exists side        text,
  add column if not exists kind        text,
  add column if not exists route       text,
  add column if not exists property_id uuid references public.properties(id) on delete cascade,
  add column if not exists visitor_id  text;

create index if not exists notif_recipient_idx on public.notifications(recipient_id, created_at desc);
create index if not exists notif_kind_idx      on public.notifications(kind);

-- Dedupe in the DATABASE, not in application code: one proximity ping per
-- watcher per property, ever. This has to survive retries, double taps and two
-- workers racing — application-level checks do not.
create unique index if not exists notif_proximity_once
  on public.notifications (coalesce(recipient_id::text, visitor_id), property_id)
  where kind = 'proximity_match';

-- ── what a visitor is watching for (derived from their Toju conversation) ──
create table if not exists public.geofence_watches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade,
  visitor_id    text,
  city          text,
  deal_type     public.listing_type,
  max_price     numeric,
  min_bedrooms  int,
  radius_m      int not null default 1200 check (radius_m between 200 and 10000),
  quiet_from    time not null default '21:30',   -- nobody wants a 3am ping
  quiet_to      time not null default '08:00',
  daily_cap     int  not null default 3 check (daily_cap between 1 and 20),
  enabled       boolean not null default true,
  last_point    geography(Point,4326),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  constraint watch_has_owner check (user_id is not null or visitor_id is not null)
);
create index if not exists gw_user_idx    on public.geofence_watches(user_id);
create index if not exists gw_visitor_idx on public.geofence_watches(visitor_id);
create index if not exists gw_point_idx   on public.geofence_watches using gist(last_point);

-- ── push endpoints. Web Push today; FCM/APNs tokens land in the same table ──
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  visitor_id text,
  platform   text not null default 'web' check (platform in ('web','ios','android')),
  endpoint   text not null unique,
  p256dh     text,
  auth_key   text,
  side       text not null default 'customer' check (side in ('customer','agency')),
  agency_id  uuid,
  created_at timestamptz not null default now()
);
create index if not exists ps_user_idx   on public.push_subscriptions(user_id);
create index if not exists ps_agency_idx on public.push_subscriptions(agency_id);

-- ── RLS: your own rows only ────────────────────────────────────────────────
alter table public.geofence_watches   enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists gw_own on public.geofence_watches;
create policy gw_own on public.geofence_watches
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ps_own on public.push_subscriptions;
create policy ps_own on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
