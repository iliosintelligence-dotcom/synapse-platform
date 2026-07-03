-- Anonymous chat memory for the public Toju demo: one row per visitor
-- (localStorage uuid). Written only by the toju-demo edge function
-- (service role); no client policies on purpose.
create table if not exists demo_chat_sessions (
  visitor_id uuid primary key,
  messages jsonb not null default '[]'::jsonb,
  criteria jsonb,
  matches jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table demo_chat_sessions enable row level security;
