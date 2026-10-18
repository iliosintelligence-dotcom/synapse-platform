-- THE FACEBOOK DEVELOPER APP IS DISCONNECTED FROM THE SOCIAL STUDIO (Eden, 2026-10-18).
-- A developer has built a connector that replaces the direct Meta developer app route. The Meta app itself is NOT touched
-- here or anywhere else: its keys stay in Supabase secrets, and nothing is deleted on Meta's side. What changes:
--   1. platform_settings.meta_direct_connect = {enabled:false}. social-connect reads it and refuses to START a Facebook or
--      Instagram connection through the Meta app (TikTok and Telegram are unaffected). Setting enabled to true brings the old
--      route back with no deploy.
--   2. Connections already made THROUGH that app are disconnected the same way the portal's Disconnect button does it: the
--      account is deactivated and soft-deleted and its tokens are removed from Vault. The agency can connect again once the
--      new connector is ready. Today that is one Facebook Page connection (auth_source facebook_login).
insert into public.platform_settings (key, value)
values ('meta_direct_connect', jsonb_build_object('enabled', false, 'since', now(), 'reason', 'moving to the new connector'))
on conflict (key) do update set value = excluded.value;

do $$
declare r record;
begin
  for r in
    select id, access_token_ref, refresh_token_ref from public.social_accounts
     where deleted_at is null
       and platform::text in ('facebook', 'instagram')
       and coalesce(auth_source, '') in ('facebook_login', 'instagram_login')
  loop
    update public.social_accounts
       set is_active = false, deleted_at = now(), access_token_ref = null, refresh_token_ref = null,
           last_error = 'Disconnected from the Meta developer app; moving to the new connector'
     where id = r.id;
    if r.access_token_ref is not null then delete from vault.secrets where id = r.access_token_ref; end if;
    if r.refresh_token_ref is not null then delete from vault.secrets where id = r.refresh_token_ref; end if;
  end loop;
end $$;
