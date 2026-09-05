-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill. This shipped to the live database ahead of the repo; written up
-- here so `supabase db reset` produces a database the app can actually use.
-- Without it agent_profiles carried a single public_read policy: readable by
-- the world, writable by nobody, so the profile editor failed silently.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.agent_profiles enable row level security;

drop policy if exists agent_profiles_insert_own on public.agent_profiles;
create policy agent_profiles_insert_own on public.agent_profiles
  for insert to authenticated with check (profile_id = auth.uid());

drop policy if exists agent_profiles_update_own on public.agent_profiles;
create policy agent_profiles_update_own on public.agent_profiles
  for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- A face for the person, in their own folder. Public-read on purpose: a
-- buyer sees an agent's photo before they are signed in to anything.
insert into storage.buckets (id, name, public) values ('avatars','avatars',true)
on conflict (id) do nothing;

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert with check (bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = auth.uid());

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update using (bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = auth.uid())
  with check (bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = auth.uid());

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete using (bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = auth.uid());
