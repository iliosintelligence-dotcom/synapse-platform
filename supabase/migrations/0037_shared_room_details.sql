-- Room-level facts for shared listings (property_type='shared') — real columns
-- instead of description text, so Toju can reason and filter on them.
create table if not exists shared_room_details (
  property_id uuid primary key references properties(id) on delete cascade,
  total_rooms smallint not null,
  housemates_in smallint not null default 0,   -- rooms currently occupied
  gender_preference text not null default 'any' check (gender_preference in ('any','male','female')),
  room_furnished boolean not null default false,
  ensuite boolean not null default false,
  bills_included boolean not null default false,
  house_vibe text,
  created_at timestamptz not null default now()
);
alter table shared_room_details enable row level security;
drop policy if exists "shared_room_details_public_read" on shared_room_details;
create policy "shared_room_details_public_read" on shared_room_details for select using (true);
