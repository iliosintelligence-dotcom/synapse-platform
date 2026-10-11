-- LISTING DRAFTS (Eden, 2026-10-11): the new-listing form is a step-by-step wizard, and an agent
-- who leaves before finishing keeps what they typed, on any device.
--
-- Until now the one unsaved listing lived in the browser only, on purpose: a half-written
-- listing is not a listing, and the properties table requires the fields that make one complete,
-- so an incomplete row must never sit where buyers' searches run. That still holds. A draft is
-- NOT a property: it is a private JSON note in its own table, visible only to the agency's own
-- members, and it becomes a property only when the agent finishes the wizard and the normal
-- create runs (with all its checks, including the CAC rule).
--
-- It is also what lets a brand-new agency start a listing before its CAC paper is uploaded:
-- the draft is kept, and publishing waits for the paper.
create table if not exists public.listing_drafts (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  created_by  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title       text,
  step        smallint not null default 1 check (step between 1 and 12),
  data        jsonb not null default '{}'::jsonb,
  floor       jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- a draft is a list of fields and photo links, never a place to store files
  constraint listing_drafts_small check (octet_length(data::text) < 200000)
);
create index if not exists listing_drafts_agency_idx on public.listing_drafts (agency_id, updated_at desc);

alter table public.listing_drafts enable row level security;
revoke all on public.listing_drafts from anon;
drop policy if exists listing_drafts_member_all on public.listing_drafts;
create policy listing_drafts_member_all on public.listing_drafts
  for all to authenticated
  using (public.is_agency_member(agency_id))
  with check (public.is_agency_member(agency_id) and created_by = auth.uid());

create or replace function public.listing_drafts_touch()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  new.updated_at := now();
  new.title := nullif(btrim(coalesce(new.data->>'title', '')), '');
  return new;
end;
$$;
drop trigger if exists listing_drafts_touch_trg on public.listing_drafts;
create trigger listing_drafts_touch_trg before insert or update on public.listing_drafts
  for each row execute function public.listing_drafts_touch();
