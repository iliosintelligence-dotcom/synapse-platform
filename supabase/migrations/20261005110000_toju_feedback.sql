-- Thumbs up and thumbs down on Tayo's replies.
--
-- A rating that goes nowhere teaches nothing, so each one is kept: which reply
-- (the page's own id for it), up or down, and the first 300 characters of
-- TAYO's reply so a person reading the ratings can tell what was rated. The
-- visitor's own words are never sent. Nothing here identifies a visitor who
-- is not signed in; a signed-in one is recorded by id so one person's second
-- thought replaces their first instead of counting twice.
--
-- No policy and no grant: the table is written only through the function
-- below and read by the team from the database.

create table if not exists toju_feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reply_id   text not null check (char_length(reply_id) between 1 and 80),
  rating     text not null check (rating in ('up', 'down')),
  excerpt    text check (excerpt is null or char_length(excerpt) <= 300),
  user_id    uuid references auth.users (id) on delete set null
);
alter table toju_feedback enable row level security;
revoke all on toju_feedback from public, anon, authenticated;
create index if not exists idx_toju_feedback_created on toju_feedback (created_at desc);
create unique index if not exists uq_toju_feedback_user_reply
  on toju_feedback (user_id, reply_id) where user_id is not null;

create or replace function record_toju_feedback(p_reply_id text, p_rating text, p_excerpt text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_rating not in ('up', 'down') or coalesce(char_length(p_reply_id), 0) not between 1 and 80 then
    return false;
  end if;
  if auth.uid() is not null then
    insert into toju_feedback (reply_id, rating, excerpt, user_id)
    values (p_reply_id, p_rating, left(p_excerpt, 300), auth.uid())
    on conflict (user_id, reply_id) where user_id is not null
    do update set rating = excluded.rating, created_at = now();
  else
    insert into toju_feedback (reply_id, rating, excerpt)
    values (p_reply_id, p_rating, left(p_excerpt, 300));
  end if;
  return true;
end;
$$;
revoke all on function record_toju_feedback(text, text, text) from public, anon, authenticated;
grant execute on function record_toju_feedback(text, text, text) to anon, authenticated;
