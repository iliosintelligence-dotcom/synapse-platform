-- An agent brings their own account, and a post says which one it goes to.
--
-- DECISION (Eden, 2026-09-25): "Allow agents to be able to add their own
-- social accounts as well. So the user profile can have multiple accounts from
-- the same social media platform, it simply allows the agent to pick which of
-- the accounts the post will be made to."
--
-- This reverses a rule that was deliberate, so it is worth saying what changes
-- and what does not. Connecting was owner/admin only because a social account
-- is a credential and the agency carries what is published with it. That
-- reasoning held when there was ONE account per platform and connecting it
-- meant speaking for the whole agency. It does not hold for an agent adding
-- the account they already run: refusing them does not protect the agency, it
-- just means the agent posts from their phone and nothing Synapse does is
-- measured.
--
-- ── the part that was already true ───────────────────────────────────────
--
-- Two accounts on one platform have always been STORABLE. connect_social_account
-- keys its soft-delete on (agency, platform, platform_account_id), so a second
-- Instagram account was never overwritten by the first.
--
-- What could not happen is CHOOSING between them. Every reader picked one and
-- had no way to be told which:
--
--   social-publish   built a Record keyed by PLATFORM, so a second account
--                    silently overwrote the first and whichever the database
--                    returned last won
--   post-metrics     asked for the account with `platform=eq.x ... limit 1`
--   the portal       offered platforms, never accounts
--
-- So the column below is the substance of this migration. Without somewhere to
-- record the answer, "pick which account" has nowhere to be written down.
--
-- NULLABLE, AND NULL HAS A MEANING. Every existing row predates the choice,
-- and Synapse's own twin posts do not have an agency account at all -- they go
-- out through trypost on our channels. NULL means "whatever this agency has
-- connected for that platform", which is exactly the old behaviour, so nothing
-- already queued changes its mind about where it is going.

alter table public.social_posts
  add column if not exists social_account_id uuid
    references public.social_accounts (id) on delete set null;

comment on column public.social_posts.social_account_id is
  'Which connected account this post is for. NULL means the agency''s account '
  'for that platform, whichever it is -- the behaviour before an agency could '
  'have two. Synapse twin posts are always NULL: they publish on our channels, '
  'not the agency''s.';

-- on delete set null, not cascade: disconnecting an account must not delete
-- the record that something was published through it. The post happened.
create index if not exists social_posts_account
  on public.social_posts (social_account_id)
  where social_account_id is not null;


-- ── an agent may see the accounts ────────────────────────────────────────
--
-- social_accounts_manage is `for all using (agency_role in admin/owner)`, and
-- `for all` includes SELECT -- so an ordinary agent could not see that their
-- agency had any accounts at all. A picker they cannot read is an empty picker,
-- and this would have been the first thing to fail.
--
-- Permissive policies OR together, so this widens reading without touching
-- what manage governs. The token refs are already revoked at COLUMN level
-- (0053) from authenticated, so "see the accounts" cannot become "see the
-- credentials" however the row is selected.
drop policy if exists social_accounts_read on public.social_accounts;
create policy social_accounts_read on public.social_accounts
  for select using (public.is_agency_member(agency_id));


-- ── connecting is a member's job now ─────────────────────────────────────
--
-- The body is 20260919190000's, reproduced in full because CREATE OR REPLACE
-- takes a whole function. Everything load-bearing is unchanged and is listed
-- here so a future reader can check rather than assume:
--
--   · the token still goes to vault.create_secret and only a REF is stored
--   · reconnecting still soft-deletes the previous row for that same account
--   · auth_source still records which OAuth flow issued the token
--
-- ONE LINE IS DIFFERENT: the role check. It was owner/admin; it is now any
-- member of the agency, which is the same set queue_social_post already trusts
-- to publish. An agent who could always post through the agency's account can
-- now also add their own.
create or replace function public.connect_social_account(
  p_agency_id       uuid,
  p_platform        social_platform,
  p_account_id      text,
  p_username        text,
  p_access_token    text,
  p_refresh_token   text default null,
  p_expires_at      timestamptz default null,
  p_scopes          text[] default '{}',
  p_connected_by    uuid default null,
  p_auth_source     text default 'instagram_login'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare
  v_access_ref uuid; v_refresh_ref uuid; v_id uuid; v_actor uuid; v_role text; v_tag text;
begin
  if p_access_token is null or length(btrim(p_access_token)) = 0 then
    raise exception 'No access token supplied' using errcode = 'invalid_parameter_value';
  end if;

  if p_auth_source not in ('instagram_login', 'facebook_login') then
    raise exception 'Unknown auth source: %', p_auth_source
      using errcode = 'invalid_parameter_value';
  end if;

  -- A signed-in caller speaks for themselves; a service-role caller must say
  -- who it acted for.
  v_actor := coalesce(auth.uid(), p_connected_by);
  if v_actor is null then
    raise exception 'No connecting user: pass p_connected_by when calling as the service role'
      using errcode = 'invalid_parameter_value';
  end if;

  select role::text into v_role from agency_members
  where profile_id = v_actor and agency_id = p_agency_id and deleted_at is null limit 1;

  -- coalesce, because NULL not in (...) is NULL, and a NULL guard never fires.
  -- Widened from owner/admin to any member: the same three roles
  -- queue_social_post accepts to publish. connected_by records who did it, and
  -- disconnect_social_account has always accepted any member, so an agent
  -- could already remove an account they cannot add -- which was the wrong way
  -- round.
  if coalesce(v_role, '') not in ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot connect an account for this agency'
      using errcode = 'insufficient_privilege';
  end if;

  v_tag := 'social:' || p_platform::text || ':' || p_agency_id::text || ':';

  v_access_ref := vault.create_secret(
    p_access_token, v_tag || 'access:' || gen_random_uuid()::text, 'Social access token');

  if p_refresh_token is not null and length(btrim(p_refresh_token)) > 0 then
    v_refresh_ref := vault.create_secret(
      p_refresh_token, v_tag || 'refresh:' || gen_random_uuid()::text, 'Social refresh token');
  end if;

  -- Reconnecting must not leave a second row holding a live token. Keyed on
  -- platform_account_id, which is why a SECOND account has always been able to
  -- sit beside the first rather than replacing it.
  update social_accounts
     set is_active = false, deleted_at = now(), access_token_ref = null, refresh_token_ref = null
   where agency_id = p_agency_id and platform = p_platform
     and platform_account_id = p_account_id and deleted_at is null;

  insert into social_accounts (
    agency_id, platform, platform_account_id, platform_username,
    access_token_ref, refresh_token_ref, token_expires_at, scopes,
    is_active, connected_at, connected_by, auth_source)
  values (
    p_agency_id, p_platform, p_account_id, p_username,
    v_access_ref, v_refresh_ref, p_expires_at, coalesce(p_scopes, '{}'), true, now(), v_actor,
    p_auth_source)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[], uuid, text) from public, anon, authenticated;
grant execute on function public.connect_social_account(uuid, social_platform, text, text, text, text, timestamptz, text[], uuid, text) to service_role;


-- ── a post names its account ─────────────────────────────────────────────
--
-- Same body as 20260918174500 with one new trailing argument and the check
-- that makes it mean something. A trailing DEFAULT does not replace the old
-- function -- it creates a second one beside it -- so the seven-argument
-- version is dropped at the end. Two live signatures is how a caller keeps
-- reaching the one that ignores the new column.
create or replace function public.queue_social_post(
  p_property_id uuid,
  p_platform social_platform,
  p_caption text,
  p_media_urls text[] default '{}'::text[],
  p_scheduled_at timestamptz default now(),
  p_dry_run boolean default true,
  p_payload jsonb default null,
  p_social_account_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_agency  uuid;
  v_role    text;
  v_id      uuid;
  v_caption text;
  v_channel public.attribution_channel;
  v_url     text;
  v_media   text[];
  v_acct_platform social_platform;
  v_acct_agency   uuid;
begin
  if p_caption is null or length(btrim(p_caption)) = 0 then
    raise exception 'Caption is empty' using errcode = 'invalid_parameter_value';
  end if;

  select agency_id into v_agency
  from properties
  where id = p_property_id and deleted_at is null;

  if v_agency is null then
    raise exception 'Listing not found' using errcode = 'no_data_found';
  end if;

  v_role := coalesce(agency_role(v_agency)::text, '');
  if v_role not in ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot post for this agency'
      using errcode = 'insufficient_privilege';
  end if;

  /* THE CHOSEN ACCOUNT, CHECKED RATHER THAN TRUSTED. The id arrives from a
     browser, so all three of these are real possibilities and only one of
     them is an accident:

       · an account belonging to ANOTHER agency -- the whole point of the
         check, and the one that must never be a publish
       · an account for a different platform than the row says, which would
         send an Instagram caption to a Facebook Page
       · an account disconnected between the picker rendering and the post
         being queued, which is nobody's mistake and still cannot publish

     Named separately because "that account cannot be used" sends somebody
     looking in the wrong place for two of the three. */
  if p_social_account_id is not null then
    select platform, agency_id into v_acct_platform, v_acct_agency
      from social_accounts
     where id = p_social_account_id and is_active and deleted_at is null;

    if v_acct_agency is null then
      raise exception 'That account is not connected any more'
        using errcode = 'no_data_found';
    end if;
    if v_acct_agency <> v_agency then
      raise exception 'That account belongs to a different agency'
        using errcode = 'insufficient_privilege';
    end if;
    if v_acct_platform <> p_platform then
      raise exception 'That account is % , not %', v_acct_platform, p_platform
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  v_caption := btrim(p_caption);

  -- The listing's gallery when the caller named none, in display order.
  v_media := coalesce(p_media_urls, '{}');
  if cardinality(v_media) = 0 then
    select coalesce(array_agg(m.url order by m.display_order), '{}')
      into v_media
    from (
      select url, display_order
      from property_media
      where property_id = p_property_id
        and url is not null
        and btrim(url) <> ''
        and url like 'https://%'
      order by display_order
      limit 10
    ) m;
  end if;

  /* THE TWIN GETS THE UNTRIMMED SET. Each platform trims to its own ceiling,
     so handing the twins an array already cut to four -- because this post
     happened to be for X -- would cost Instagram six photographs. */
  insert into social_posts (
    property_id, agency_id, platform, caption, media_urls,
    status, scheduled_at, dry_run, created_by, payload, social_account_id
  ) values (
    p_property_id, v_agency, p_platform, v_caption,
    v_media[1:media_cap_for(p_platform::text)],
    'scheduled', coalesce(p_scheduled_at, now()), coalesce(p_dry_run, true),
    auth.uid(), p_payload, p_social_account_id
  )
  returning id into v_id;

  if position('/s/' in v_caption) = 0
     and position('synapsecore.dev' in lower(v_caption)) = 0 then

    v_channel := (case lower(p_platform::text)
                    when 'instagram' then 'instagram'
                    when 'facebook'  then 'facebook'
                    when 'tiktok'    then 'tiktok'
                    when 'whatsapp'  then 'whatsapp_campaign'
                    else 'organic'
                  end)::public.attribution_channel;

    select l.url into v_url
    from public.create_short_link(p_property_id, v_channel, v_id) l;

    update social_posts
       set caption = v_caption || E'\n\n'
                     || public.caption_link_tail(p_platform::text, v_url)
     where id = v_id;
  end if;

  /* The twins are deliberately NOT given the account. They publish on
     Synapse's own channels through trypost; an agency account id on one of
     them would be a claim about where it went that is simply untrue. */
  begin
    perform public.queue_synapse_twins(
      p_property_id, v_agency, v_caption, v_media,
      coalesce(p_scheduled_at, now()), coalesce(p_dry_run, true), v_id);
  exception when others then
    raise warning 'queue_social_post: could not queue Synapse twins for % (%)', v_id, sqlerrm;
  end;

  return v_id;
end;
$function$;

drop function if exists public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean, jsonb);

revoke all on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean, jsonb, uuid) from public, anon;
grant execute on function public.queue_social_post(uuid, social_platform, text, text[], timestamptz, boolean, jsonb, uuid) to authenticated, service_role;
