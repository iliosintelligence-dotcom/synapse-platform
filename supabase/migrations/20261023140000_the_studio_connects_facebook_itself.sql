-- THE STUDIO CONNECTS FACEBOOK ITSELF (Eden, 2026-10-23: "Add Channels still shows me open TryPost when it should be using our
-- direct connection to Facebook, that's already been built").
--
-- TryPost is disconnected. Synapse's own Facebook Pages now connect through the same Meta login agencies use (social-connect),
-- started from the studio by a Synapse staff member. What Facebook shares is held for fifteen minutes exactly as an agency's is
-- (social_connect_picks, tokens in the vault) and the staff member ticks which Pages are Synapse's; nothing is attached unasked.
--
-- 1. A pick can belong to the studio instead of an agency: agency_id may be null, for_studio says so.
-- 2. A studio channel can be a Facebook Page: city_channels.meta_page_id, its Page token in the vault (token_ref).
-- 3. connect_studio_page: the chosen Page becomes (or refreshes) a channel. It starts quiet, like every new channel.
-- 4. city_channel_token: the one way that token leaves the vault, service role only.
-- 5. Removing a channel's row takes its vault secret with it.

alter table public.social_connect_picks alter column agency_id drop not null;
alter table public.social_connect_picks add column if not exists for_studio boolean not null default false;
alter table public.social_connect_picks drop constraint if exists social_connect_picks_owner;
alter table public.social_connect_picks add constraint social_connect_picks_owner
  check (for_studio or agency_id is not null);

alter table public.city_channels
  add column if not exists meta_page_id text,
  add column if not exists token_ref uuid;
create unique index if not exists city_channels_one_meta_page
  on public.city_channels (meta_page_id) where meta_page_id is not null;
comment on column public.city_channels.meta_page_id is
  'A Facebook Page Synapse posts to directly (Graph API). Its Page token is in the vault at token_ref.';

-- synapse_staff_role() for a named person: the functions below run as the service role, where auth.uid() is nobody.
create or replace function public.synapse_staff_role_of(p_profile_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_profile_id is null then null
    when exists (select 1 from profiles p where p.id = p_profile_id and p.role = 'platform_admin') then 'platform_admin'
    else (select s.role from synapse_staff s where s.profile_id = p_profile_id)
  end;
$$;
revoke all on function public.synapse_staff_role_of(uuid) from public, anon, authenticated;
grant execute on function public.synapse_staff_role_of(uuid) to service_role;

create or replace function public.stash_studio_pick(
  p_profile_id uuid,
  p_pages      jsonb,
  p_tokens     jsonb,
  p_scopes     text[]
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'vault', 'pg_temp'
as $function$
declare
  v_ref uuid;
  v_id  uuid;
begin
  if public.synapse_staff_role_of(p_profile_id) is null then
    raise exception 'Only Synapse staff can connect the studio''s Pages';
  end if;
  v_ref := vault.create_secret(p_tokens::text, 'connect_pick_' || gen_random_uuid()::text,
                               'Page tokens awaiting a choice for the Synapse studio');
  insert into social_connect_picks (agency_id, for_studio, profile_id, pages, granted_scopes, token_ref)
  values (null, true, p_profile_id, coalesce(p_pages, '[]'::jsonb), coalesce(p_scopes, '{}'), v_ref)
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.connect_studio_page(
  p_page_id  text,
  p_name     text,
  p_token    text,
  p_added_by uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'vault', 'pg_temp'
as $function$
declare
  v_id  uuid;
  v_ref uuid;
  v_name text := nullif(left(btrim(coalesce(p_name, '')), 80), '');
begin
  if p_page_id is null or p_token is null or p_token = '' then
    raise exception 'A Page id and its token are both needed';
  end if;
  if public.synapse_staff_role_of(p_added_by) is null then
    raise exception 'Only Synapse staff can connect the studio''s Pages';
  end if;

  select id, token_ref into v_id, v_ref from city_channels where meta_page_id = p_page_id for update;
  if v_id is not null then
    -- Connected again: the fresh token replaces the old one, and the channel is on again. Its settings are kept.
    if v_ref is not null then
      perform vault.update_secret(v_ref, p_token);
    else
      v_ref := vault.create_secret(p_token, 'studio_page_' || p_page_id, 'Synapse studio Facebook Page token');
    end if;
    update city_channels
       set token_ref = v_ref, is_active = true, label = coalesce(label, v_name), title = coalesce(title, v_name),
           handle = coalesce(v_name, handle), updated_at = now()
     where id = v_id;
    return v_id;
  end if;

  v_ref := vault.create_secret(p_token, 'studio_page_' || p_page_id || '_' || gen_random_uuid()::text,
                               'Synapse studio Facebook Page token');
  -- A new channel starts quiet: connected, but neither posting on its own nor taking agencies' posts until switched on.
  insert into city_channels (platform, meta_page_id, token_ref, label, handle, title, city,
                             is_active, autopilot, mirror_agency_posts, added_by,
                             daily_cap, min_gap, window_start, window_end)
  values ('facebook', p_page_id, v_ref, v_name, v_name, v_name, null,
          true, false, false, p_added_by,
          3, interval '3 hours', 9, 20)
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.city_channel_token(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'vault', 'pg_temp'
as $function$
declare
  v_ref uuid;
  v_tok text;
begin
  select token_ref into v_ref from city_channels where id = p_id and is_active;
  if v_ref is null then
    return null;
  end if;
  select decrypted_secret into v_tok from vault.decrypted_secrets where id = v_ref;
  return v_tok;
end;
$function$;

-- A deleted channel must not leave a live Page token behind.
create or replace function public.city_channel_drop_token()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'vault', 'pg_temp'
as $function$
begin
  if old.token_ref is not null then
    delete from vault.secrets where id = old.token_ref;
  end if;
  return old;
end;
$function$;
drop trigger if exists city_channel_drop_token on public.city_channels;
create trigger city_channel_drop_token after delete on public.city_channels
  for each row execute function public.city_channel_drop_token();

revoke all on function public.stash_studio_pick(uuid, jsonb, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.connect_studio_page(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.city_channel_token(uuid) from public, anon, authenticated;
revoke all on function public.city_channel_drop_token() from public, anon, authenticated;
grant execute on function public.stash_studio_pick(uuid, jsonb, jsonb, text[]) to service_role;
grant execute on function public.connect_studio_page(text, text, text, uuid) to service_role;
grant execute on function public.city_channel_token(uuid) to service_role;
