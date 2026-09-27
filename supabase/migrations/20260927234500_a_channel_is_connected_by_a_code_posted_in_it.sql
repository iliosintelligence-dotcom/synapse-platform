-- A Telegram channel is connected by a code posted in it.
--
-- Compared with TryPost (2026-09-27): connecting took three steps here --
-- link your Telegram account by pressing Start, add the bot, tap the channel
-- -- where TryPost takes two: add the bot, post the code it shows into the
-- channel. Posting into a channel needs the right to post there, which is the
-- same proof of ownership the Start-link gave us, with one step fewer and no
-- detour through the bot's private chat.
--
-- So: the portal issues a short code to a signed-in agency member, the agency
-- posts "/connect CODE" in its channel, telegram-webhook receives that post
-- (channel_post), claims the code, checks the bot may post there, connects the
-- channel to the code's agency through connect_telegram_channel, and deletes
-- the code post so the channel's followers never see it. The portal watches the
-- code's row and says "connected" when it is.
--
-- Linking a Telegram account (telegram_links) stays, now optional: it is how
-- the Story kit knows whom to message.

create table if not exists public.telegram_connect_codes (
  code        text primary key,
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz,
  chat_id     bigint,
  channel     text,             -- what the portal shows once connected
  account_id  uuid,             -- the social_accounts row it produced
  code_post_deleted boolean,    -- false: the agency should delete the post itself
  error       text
);
comment on table public.telegram_connect_codes is
  'Single-use "/connect CODE" codes: issued by social-connect to a signed-in '
  'agency member, claimed by telegram-webhook when the code is posted in a '
  'channel. Service role only; purged a day after use or expiry.';
alter table public.telegram_connect_codes enable row level security;
revoke all on public.telegram_connect_codes from public, anon, authenticated;

-- The link-code purge (20260927110000), reproduced whole and now also
-- clearing these.
create or replace function public.purge_telegram_link_codes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_gone integer;
  v_more integer;
begin
  delete from telegram_link_codes
   where coalesce(used_at, expires_at) < now() - interval '1 day';
  get diagnostics v_gone = row_count;
  delete from telegram_connect_codes
   where coalesce(used_at, expires_at) < now() - interval '1 day';
  get diagnostics v_more = row_count;
  return v_gone + v_more;
end;
$$;
revoke all on function public.purge_telegram_link_codes() from public, anon, authenticated;
