-- A Telegram channel is proved to be yours before it is connected.
--
-- THE GAP. social-connect checked that OUR bot was an administrator of the
-- channel it was given, and nothing about the person giving it. So once any
-- agency had added the bot to its channel, a member of any other agency who
-- knew the channel's @name could connect it and post into it. No channel was
-- connected when this was found, so nothing was exposed; it had to close
-- before the first one was.
--
-- THE PROOF. A Synapse account is linked, once, to the Telegram account of
-- the person using it: the portal hands out a one-time code inside a
-- t.me/<bot>?start=<code> link, the person presses Start, and Telegram
-- delivers "/start <code>" to our webhook FROM that Telegram account. After
-- that, connecting a channel asks Telegram whether THAT account is an
-- administrator of the channel. Telegram is the authority on both halves.
--
-- AND THE LIST. Telegram tells the bot whenever it is added to or removed
-- from a channel, and by whom. Kept, that is the list of channels a linked
-- person has just added the bot to -- so the portal can offer them to tap
-- rather than asking for an @name to be typed.
--
-- PERSONAL DATA, KEPT NARROWLY. A Telegram user id and handle per linked
-- profile, deleted with the profile. Channels are public objects; the only
-- personal field on them is who added the bot, kept because it is what the
-- list is filtered by. Link codes are gone within a day.

-- ── who a Synapse account is on Telegram ─────────────────────────────────
create table if not exists public.telegram_links (
  profile_id        uuid primary key references public.profiles (id) on delete cascade,
  telegram_user_id  bigint not null,
  telegram_username text,
  first_name        text,
  linked_at         timestamptz not null default now()
);
create index if not exists telegram_links_user on public.telegram_links (telegram_user_id);

comment on table public.telegram_links is
  'One Telegram account per Synapse profile, proved by the person pressing '
  'Start on a one-time link. Written only by telegram-webhook. Used by '
  'social-connect to ask Telegram whether this person administers a channel.';

alter table public.telegram_links enable row level security;
revoke all on public.telegram_links from public, anon, authenticated;
grant select on public.telegram_links to authenticated;
drop policy if exists telegram_links_own on public.telegram_links;
create policy telegram_links_own on public.telegram_links
  for select to authenticated using (profile_id = auth.uid());

-- ── the one-time codes ───────────────────────────────────────────────────
-- Random, single use, fifteen minutes. The code is what ties a Start press
-- in Telegram to a signed-in Synapse session; nothing else about it matters.
create table if not exists public.telegram_link_codes (
  code        text primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz
);
comment on table public.telegram_link_codes is
  'Single-use codes for t.me/<bot>?start=<code>. Service role only; purged daily.';
alter table public.telegram_link_codes enable row level security;
revoke all on public.telegram_link_codes from public, anon, authenticated;

-- ── channels the bot is in ───────────────────────────────────────────────
create table if not exists public.telegram_bot_chats (
  chat_id     bigint primary key,
  chat_type   text not null,
  title       text,
  username    text,
  bot_status  text not null,            -- administrator | member | left | kicked
  can_post    boolean not null default false,
  added_by    bigint,                   -- the Telegram user who last changed it
  updated_at  timestamptz not null default now()
);
create index if not exists telegram_bot_chats_added_by
  on public.telegram_bot_chats (added_by, updated_at desc);
comment on table public.telegram_bot_chats is
  'Every channel the bot has been added to or removed from, from Telegram''s '
  'my_chat_member updates. Service role only; social-connect reads it to offer '
  'a linked person the channels they added the bot to.';
alter table public.telegram_bot_chats enable row level security;
revoke all on public.telegram_bot_chats from public, anon, authenticated;

-- ── retention ────────────────────────────────────────────────────────────
create or replace function public.purge_telegram_link_codes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_gone integer;
begin
  delete from telegram_link_codes
   where coalesce(used_at, expires_at) < now() - interval '1 day';
  get diagnostics v_gone = row_count;
  return v_gone;
end;
$$;
comment on function public.purge_telegram_link_codes() is
  'Removes link codes a day after they were used or expired.';
revoke all on function public.purge_telegram_link_codes() from public, anon, authenticated;

select cron.unschedule('purge-telegram-link-codes')
 where exists (select 1 from cron.job where jobname = 'purge-telegram-link-codes');
select cron.schedule(
  'purge-telegram-link-codes',
  '35 3 * * *',
  $$select public.purge_telegram_link_codes()$$
);
