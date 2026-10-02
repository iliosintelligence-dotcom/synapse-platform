-- Synapse Ibadan is @synapse_ibadan.
--
-- The channel was created as @synapse_ibadan, not the seeded @SynapseIbadan,
-- so when the bot was made its admin (2026-09-27 17:08, with Post Messages)
-- claim_city_channel matched nothing and the channel stayed off. Telegram had
-- already told us everything needed: telegram_bot_chats holds the chat id and
-- the bot's rights. The handle is corrected, and the channel switched on from
-- that record -- only if the bot really is an admin there that may post.

update public.city_channels c
   set handle     = '@synapse_ibadan',
       chat_id    = b.chat_id::text,
       title      = coalesce(b.title, c.title),
       is_active  = (b.bot_status in ('administrator', 'creator') and b.can_post),
       updated_at = now()
  from public.telegram_bot_chats b
 where c.platform = 'telegram'
   and lower(c.city) = 'ibadan'
   and lower(b.username) = 'synapse_ibadan';

-- First post now rather than at the next half hour; the feed's own pacing
-- (window, daily cap, gap) still applies.
select public.feed_city_channels();
