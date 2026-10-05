-- THE AGENCY CHOOSES WHICH PAGES.
--
-- social-connect connected EVERY Page Facebook shared, to whichever Synapse
-- agency started the connection. On 27 September that attached Iteriba Real
-- Estate's Page to the Greenlight Real estate agency; disconnecting it and
-- connecting again attached it again, because Facebook reuses the earlier
-- grant and skips its own Page list (auth_type=rerequest was already set and
-- did not stop it). Eden, who runs both Pages from one Facebook account:
-- "I might not want to pick all the accounts I picked previously ... I want
-- to connect this page to the Greenlight page."
--
-- So Synapse asks. The callback stashes what Facebook returned here for 15
-- minutes -- Page names and ids in the row, the Page tokens in the vault --
-- and sends the person to the portal, which asks which Pages belong to THIS
-- agency. Only the ticked ones are connected, through connect_social_account
-- as before. A stash is used once (take_connect_pick deletes it and its
-- secret) and purged when it expires.

create table if not exists public.social_connect_picks (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies (id) on delete cascade,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  platform       text not null default 'facebook',
  -- [{id, name, ig_id, ig_username}] -- names and ids only, never a token
  pages          jsonb not null,
  granted_scopes text[] not null default '{}',
  token_ref      uuid not null,           -- vault secret: {"<page id>": "<page token>"}
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '15 minutes'
);

comment on table public.social_connect_picks is
  'What Facebook shared on a connection, held for 15 minutes while the agency '
  'chooses which Pages are theirs. Tokens live in the vault (token_ref), never '
  'in this row. Service role only; used once by take_connect_pick.';

alter table public.social_connect_picks enable row level security;
revoke all on public.social_connect_picks from public;
revoke all on public.social_connect_picks from anon;
revoke all on public.social_connect_picks from authenticated;

create or replace function public.stash_connect_pick(
  p_agency_id  uuid,
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
  v_ref := vault.create_secret(p_tokens::text, 'connect_pick_' || gen_random_uuid()::text,
                               'Page tokens awaiting a choice (social_connect_picks)');
  insert into social_connect_picks (agency_id, profile_id, pages, granted_scopes, token_ref)
  values (p_agency_id, p_profile_id, coalesce(p_pages, '[]'::jsonb), coalesce(p_scopes, '{}'), v_ref)
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.take_connect_pick(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'vault', 'pg_temp'
as $function$
declare
  r        social_connect_picks%rowtype;
  v_tokens text;
begin
  select * into r from social_connect_picks where id = p_id and expires_at > now() for update;
  if not found then
    return null;
  end if;
  select decrypted_secret into v_tokens from vault.decrypted_secrets where id = r.token_ref;
  delete from vault.secrets where id = r.token_ref;
  delete from social_connect_picks where id = p_id;
  return jsonb_build_object(
    'agency_id',  r.agency_id,
    'profile_id', r.profile_id,
    'pages',      r.pages,
    'scopes',     to_jsonb(r.granted_scopes),
    'tokens',     coalesce(v_tokens::jsonb, '{}'::jsonb)
  );
end;
$function$;

create or replace function public.purge_connect_picks()
returns integer
language plpgsql
security definer
set search_path to 'public', 'vault', 'pg_temp'
as $function$
declare
  v_n integer;
begin
  with gone as (
    delete from social_connect_picks where expires_at < now() returning token_ref
  )
  delete from vault.secrets s using gone where s.id = gone.token_ref;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.stash_connect_pick(uuid, uuid, jsonb, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.take_connect_pick(uuid) from public, anon, authenticated;
revoke all on function public.purge_connect_picks() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('purge-connect-picks');
exception when others then
  null;
end $$;

select cron.schedule(
  'purge-connect-picks',
  '*/30 * * * *',
  $$select public.purge_connect_picks()$$
);

insert into public.cron_expectations (jobname, max_silence, note) values
  ('purge-connect-picks', interval '90 minutes', 'every 30 minutes')
on conflict (jobname) do update
  set max_silence = excluded.max_silence, note = excluded.note;
