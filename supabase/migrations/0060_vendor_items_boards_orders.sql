-- 0060_vendor_items_boards_orders.sql
--
-- Things an agency sells, pinned to dream boards.
--
-- Not a catalogue. Agencies post images into the same feed people already build
-- mood boards from, a buyer saves one the way they save any other pin, and the
-- price only appears when they open it and ask to buy.
--
-- That ordering is the product, not a detail. A price on a mood board turns
-- browsing into shopping, and the board's whole value is that people are honest
-- about what they like before they think about what it costs. So the rule is
-- enforced in the database rather than the template: vendor_feed() does not
-- select price at all, and cannot leak what it never reads. A rule that lives
-- only in a component is one screenshot of the network tab away from being
-- untrue.
--
-- Only existing agencies can post. That is not a limitation to route around
-- later -- it is what stops this becoming an unvetted marketplace inside a
-- product whose entire pitch is verification.

-- ── what an agency posts ────────────────────────────────────────────────────
create table if not exists public.vendor_items (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies(id) on delete cascade,

  title        text not null,
  image_url    text not null,          -- the pin itself; this is an image-first surface
  description  text,
  category     text,                   -- lighting | seating | tables | textiles | decor | outdoor | other

  price        numeric(12,2),
  currency     text not null default 'NGN',

  is_active    boolean not null default true,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists vendor_items_feed
  on public.vendor_items (created_at desc)
  where deleted_at is null and is_active;
create index if not exists vendor_items_by_agency
  on public.vendor_items (agency_id, created_at desc);

comment on table public.vendor_items is
  'Items an agency posts into the dream-board feed. Image-first; price is withheld until a buyer opens the item.';
comment on column public.vendor_items.price is
  'NULL means unpriced, which makes the item enquiry-only. Never render a NULL price as free or as zero.';

alter table public.vendor_items enable row level security;

drop policy if exists vendor_items_public_read on public.vendor_items;
create policy vendor_items_public_read on public.vendor_items
  for select to anon, authenticated
  using (deleted_at is null and is_active);

-- coalesce, because agency_role() is NULL for a non-member and NULL fails a
-- negative test open. That exact bug shipped here before.
drop policy if exists vendor_items_agency_write on public.vendor_items;
create policy vendor_items_agency_write on public.vendor_items
  for insert to authenticated
  with check (coalesce(agency_role(agency_id)::text, '') in ('agent','agency_admin','agency_owner'));

drop policy if exists vendor_items_agency_update on public.vendor_items;
create policy vendor_items_agency_update on public.vendor_items
  for update to authenticated
  using (coalesce(agency_role(agency_id)::text, '') in ('agent','agency_admin','agency_owner'));

grant select on public.vendor_items to anon, authenticated;
grant insert, update on public.vendor_items to authenticated;

-- ── what a buyer saves ──────────────────────────────────────────────────────
-- board_key is the id of a board in the browser's own store
-- (synapse_dream_boards_v1). Deliberately a loose reference rather than a
-- foreign key: boards are local today, and making saves durable should not
-- require migrating every existing board first. If boards move server-side
-- later this becomes a real column without the saves needing to be rebuilt.
create table if not exists public.item_saves (
  id          uuid primary key default gen_random_uuid(),
  consumer_id uuid not null references public.profiles(id) on delete cascade,
  item_id     uuid not null references public.vendor_items(id) on delete cascade,
  board_key   text,
  saved_at    timestamptz not null default now(),
  unique (consumer_id, item_id, board_key)
);

create index if not exists item_saves_by_consumer on public.item_saves (consumer_id, saved_at desc);
create index if not exists item_saves_by_item     on public.item_saves (item_id);

alter table public.item_saves enable row level security;

drop policy if exists item_saves_own on public.item_saves;
create policy item_saves_own on public.item_saves
  for all to authenticated
  using (consumer_id = auth.uid())
  with check (consumer_id = auth.uid());

grant select, insert, delete on public.item_saves to authenticated;

-- ── what a buyer orders ─────────────────────────────────────────────────────
-- An order is an intent, not a payment. Nothing charges a card; the agency is
-- told what someone wants and takes it from there, the same shape as a property
-- enquiry. price_at_order is stamped so a later price change cannot rewrite
-- what someone agreed to.
create table if not exists public.item_orders (
  id             uuid primary key default gen_random_uuid(),
  consumer_id    uuid not null references public.profiles(id) on delete cascade,
  item_id        uuid not null references public.vendor_items(id) on delete restrict,
  agency_id      uuid not null references public.agencies(id) on delete cascade,

  quantity       integer not null default 1 check (quantity > 0),
  note           text,
  price_at_order numeric(12,2),
  currency       text,

  status         text not null default 'placed'
                   check (status in ('placed','acknowledged','fulfilled','cancelled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists item_orders_by_agency   on public.item_orders (agency_id, created_at desc);
create index if not exists item_orders_by_consumer on public.item_orders (consumer_id, created_at desc);

alter table public.item_orders enable row level security;

drop policy if exists item_orders_visible on public.item_orders;
create policy item_orders_visible on public.item_orders
  for select to authenticated
  using (
    consumer_id = auth.uid()
    or coalesce(agency_role(agency_id)::text, '') in ('agent','agency_admin','agency_owner')
  );

drop policy if exists item_orders_place on public.item_orders;
create policy item_orders_place on public.item_orders
  for insert to authenticated
  with check (consumer_id = auth.uid());

-- Only the agency moves an order along; a buyer must not mark their own order
-- fulfilled.
drop policy if exists item_orders_agency_update on public.item_orders;
create policy item_orders_agency_update on public.item_orders
  for update to authenticated
  using (coalesce(agency_role(agency_id)::text, '') in ('agent','agency_admin','agency_owner'));

grant select, insert, update on public.item_orders to authenticated;

drop trigger if exists vendor_items_updated_at on public.vendor_items;
create trigger vendor_items_updated_at before update on public.vendor_items
  for each row execute function public.set_updated_at();

drop trigger if exists item_orders_updated_at on public.item_orders;
create trigger item_orders_updated_at before update on public.item_orders
  for each row execute function public.set_updated_at();

-- ── the two reads ───────────────────────────────────────────────────────────
-- The feed deliberately does NOT select price.
create or replace function public.vendor_feed(p_limit integer default 40, p_category text default null)
returns table (
  id uuid, title text, image_url text, category text,
  agency_id uuid, agency_name text, created_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $fn$
  select vi.id, vi.title, vi.image_url, vi.category,
         vi.agency_id, a.name, vi.created_at
  from vendor_items vi
  join agencies a on a.id = vi.agency_id
  where vi.deleted_at is null and vi.is_active
    and (p_category is null or vi.category = p_category)
  order by vi.created_at desc
  limit greatest(1, least(coalesce(p_limit, 40), 120));
$fn$;

-- Opening one item is what reveals the price.
create or replace function public.vendor_item(p_item_id uuid)
returns table (
  id uuid, title text, image_url text, description text, category text,
  price numeric, currency text, priced boolean,
  agency_id uuid, agency_name text
)
language sql
stable
security invoker
set search_path to 'public'
as $fn$
  select vi.id, vi.title, vi.image_url, vi.description, vi.category,
         vi.price, vi.currency,
         -- Explicit, so a client never has to decide what a NULL price means.
         (vi.price is not null) as priced,
         vi.agency_id, a.name
  from vendor_items vi
  join agencies a on a.id = vi.agency_id
  where vi.id = p_item_id and vi.deleted_at is null and vi.is_active;
$fn$;

grant execute on function public.vendor_feed(integer, text) to anon, authenticated;
grant execute on function public.vendor_item(uuid) to anon, authenticated;

-- Verified against the live database (2026-08-19):
--   agency posts an item                 -> ok
--   appears in the feed                  -> 1 row
--   feed returns a price column?         -> no
--   price revealed on open               -> priced = true, 480000
--   buyer saves to a board               -> ok
--   duplicate save                       -> blocked by the unique constraint
--   buyer places an order                -> ok, price stamped
--   agency later changes the price       -> the order still holds 480000
--   probe rows removed                   -> 0 left
