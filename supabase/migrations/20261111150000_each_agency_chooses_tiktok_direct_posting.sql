-- Each agency chooses, per TikTok account, whether its posts go straight to the profile or to the TikTok inbox.
--
-- TikTok direct posting is behind TIKTOK_DIRECT_POST (the app-wide lock: TikTok must have granted Synapse's app Direct
-- Post). Underneath it, each connected TikTok account now has its own switch, OFF by default -- so turning the app-wide
-- lock on changes nothing for an agency until it turns its own switch on. Off: the inbox, as before. On: direct posts,
-- each one through TikTok's required panel and consent in the scheduler (the switch never skips those).
--
-- set_tiktok_direct_post is the only way to flip it: an Owner, Manager or Editor of the account's agency
-- (agency_can_edit; a Viewer cannot). Turning it on needs the account to have granted video.publish -- one connected
-- before direct posting existed has not -- and then answers 'needs_reconnect' without changing anything.

begin;

alter table public.social_accounts add column if not exists direct_post boolean not null default false;

comment on column public.social_accounts.direct_post is
  'TikTok: post straight to the profile (true) or to the TikTok inbox (false, default). Set with set_tiktok_direct_post.';

create or replace function public.set_tiktok_direct_post(p_account_id uuid, p_on boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency   uuid;
  v_platform text;
  v_scopes   text[];
begin
  select agency_id, platform::text, coalesce(scopes, '{}')
    into v_agency, v_platform, v_scopes
    from social_accounts
   where id = p_account_id and deleted_at is null and is_active;

  if v_agency is null then
    raise exception 'That account is not connected any more' using errcode = 'no_data_found';
  end if;
  if v_platform <> 'tiktok' then
    raise exception 'Only a TikTok account has this setting' using errcode = 'invalid_parameter_value';
  end if;
  if not agency_can_edit(v_agency) then
    raise exception 'You cannot change this agency''s channels' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(p_on, false) and not ('video.publish' = any (v_scopes)) then
    return 'needs_reconnect';
  end if;

  update social_accounts set direct_post = coalesce(p_on, false), updated_at = now() where id = p_account_id;
  return case when coalesce(p_on, false) then 'on' else 'off' end;
end;
$$;

comment on function public.set_tiktok_direct_post(uuid, boolean) is
  'Agency Owner / Manager / Editor: TikTok posts for this account go straight to the profile (on) or to the inbox (off). Needs video.publish to turn on.';

revoke all on function public.set_tiktok_direct_post(uuid, boolean) from public, anon;
grant execute on function public.set_tiktok_direct_post(uuid, boolean) to authenticated;

commit;
