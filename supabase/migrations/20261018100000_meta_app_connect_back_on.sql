-- The Meta developer app route is back ON for the social studio (Eden, 2026-10-18: "connect meta app back").
-- Reverses the setting from 20261018090000 only. The Facebook Page connection that was disconnected at that time is NOT
-- restored: its login token was removed from Vault and cannot be recovered, so the account has to connect again.
update public.platform_settings
   set value = jsonb_build_object('enabled', true, 'since', now(), 'reason', 'switched back on'), updated_at = now()
 where key = 'meta_direct_connect';
