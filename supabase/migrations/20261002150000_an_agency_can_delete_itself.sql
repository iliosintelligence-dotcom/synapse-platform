-- An agency can delete itself (2026-10-02).
--
-- Eden: an agency must be able to delete its agency and its account
-- completely, from the agency portal. Until now there was no way to do it at
-- all -- not in the portal, and not by hand without disabling triggers --
-- because nineteen append-only tables refuse DELETE and several of them hang
-- off agencies, properties and leads by cascade.
--
-- These functions are the database half. The edge function delete-agency is
-- the other half, because two of the steps cannot be done from SQL: files in
-- Storage must be removed through the Storage API (deleting storage.objects
-- rows leaves the files behind), and the owner's login can only be deleted
-- through the Auth admin API. Every function here is SERVICE ROLE ONLY: the
-- edge function verifies the caller's session and passes their id as
-- p_actor, and each function checks that id against agencies.owner_id itself.
--
-- ── the order, and why it is this order ──────────────────────────────────
--
--   1 begin     checks the owner and the typed name, then takes every listing
--               off the public site (is_active false, soft-deleted), cancels
--               scheduled posts and queued messages, and opens the deletion
--               record. Nothing is destroyed yet, so a failure here costs
--               nothing.
--   2 files     (edge function) removes the agency's folders from Storage.
--               Done BEFORE the data, so that if it fails the agency still
--               exists and the owner can simply press the button again.
--   3 execute   deletes the data, in ONE transaction, then erases the
--               owner's own profile if nothing else needs it.
--   4 finish    (edge function deletes the owner's login first) closes the
--               record and drops the one pseudonymous value it held.
--
-- Every step is idempotent. If the owner's browser dies after step 3, the
-- agency row is gone, so the record carries a SHA-256 of the owner's id
-- (the same form erasure_log already uses) purely so the same person can
-- resume and finish. It is cleared when the deletion completes.
--
-- ── what goes ─────────────────────────────────────────────────────────────
--
-- Everything keyed on the agency: listings and their photos, leads and their
-- attribution, notes and history, social posts and short links, connected
-- social accounts AND their tokens in Vault, campaigns, tours, verification
-- records and documents, notifications, invites, the brand, the agency row.
--
-- Three things are deleted explicitly before the agency, because the cascade
-- would otherwise fail or leave them behind:
--
--   · activity_feed and lead_attribution are append-only, and both have a
--     property_id that is ON DELETE SET NULL. A SET NULL is an UPDATE, which
--     reject_mutation refuses even during an erasure -- so whichever cascade
--     Postgres happened to fire first decided whether the whole deletion
--     worked. They are deleted first instead, under the erasure flag.
--   · fees.agency_id is ON DELETE RESTRICT, and item_orders.item_id is
--     RESTRICT on vendor_items.
--   · documents, consumer_reviews, review_aggregates and reputation_timelines
--     point at the agency (or its listings) through entity_type/entity_id,
--     with no foreign key, so no cascade would ever reach them.
--
-- Vault secrets are matched by reference AND by name. connect_social_account
-- names every token 'social:<platform>:<agency>:...', and a reconnect nulls
-- the old reference without deleting the secret -- so matching only the
-- references still on the rows would leave every superseded token in Vault.
--
-- ── what stays, and why ──────────────────────────────────────────────────
--
--   · Team members other than the owner lose their membership and nothing
--     else. Their logins, their profiles and their own agent profile are
--     theirs, not the agency's: the owner asked to delete the agency and
--     their own account, not their colleagues'.
--   · fraud_flags, fraud_events and trust_audit_logs that name the agency
--     (by id only) are integrity records; deleting them would let an agency
--     wipe a fraud report by deleting itself. All three are empty today.
--   · The deletion record: agency id, timestamps, counts. No names.
--   · The owner's login, when it belongs to something else as well: another
--     agency they own (agencies.owner_id is RESTRICT, so it could not go
--     anyway), a membership elsewhere, a platform_admin account, or rows
--     elsewhere that would refuse the profile's deletion. The agency is still
--     deleted; the reason is recorded and shown.
--
-- ── paid plans ───────────────────────────────────────────────────────────
--
-- Deletion is ALLOWED while a paid plan is active, and the owner must
-- acknowledge it first (p_acknowledge_plan). Billing here is "pay once,
-- active for 30 days" (0040): there is no recurring charge to cancel and
-- nothing Paystack will take later, so deleting cannot cause a charge. There
-- is also no refund logic, and this does not invent one: the unused days are
-- simply lost, and the portal says so in those words before the button can be
-- pressed. Blocking deletion until the plan ran out would hold somebody's
-- data for up to thirty days against their wishes, for no protection.
-- subscription_payments rows go with the agency (they cascade); Paystack
-- keeps its own record of every charge.

-- ── 1. the record ────────────────────────────────────────────────────────
create table if not exists public.agency_deletions (
  agency_id                 uuid primary key,
  requested_at              timestamptz not null default now(),
  unlisted_at               timestamptz,
  data_deleted_at           timestamptz,
  completed_at              timestamptz,
  plan_at_deletion          text,
  paid_until                timestamptz,
  files_removed             integer not null default 0,
  counts                    jsonb not null default '{}'::jsonb,
  owner_login               text not null default 'pending'
                            check (owner_login in ('pending', 'removed', 'kept')),
  owner_login_kept_because  text
                            check (owner_login_kept_because in (
                              'owns_another_agency', 'member_of_another_agency',
                              'platform_staff', 'records_elsewhere')),
  /* SHA-256 of the owner's profile id, as erasure_log.subject_hash. Lets the
     same person resume after the agency row is gone; NULL once complete. */
  owner_hash                text
);

alter table public.agency_deletions enable row level security;
/* No policy. Evidence for us, reachable with the service role or at the SQL
   console -- never through the API. PUBLIC named explicitly: revoking from
   anon alone leaves the grant anon inherits from PUBLIC. */
revoke all on table public.agency_deletions from public, anon, authenticated;

comment on table public.agency_deletions is
  'One row per agency deletion, started from the portal. Holds no personal '
  'data: the agency id, when each step happened, and how many rows and files '
  'were removed. owner_hash (SHA-256 of the owner id) exists only while a '
  'deletion is unfinished and is cleared when it completes. A row with '
  'completed_at null is a deletion somebody started and did not finish.';

-- ── 2. small helpers ─────────────────────────────────────────────────────

/* What the owner must type. Their agency's name, compared after trimming,
   collapsing runs of spaces and straightening curly quotes -- a phone types
   ' where the name was saved with ', and that is not a different name.
   Letters and case must match exactly. The portal normalises the same way. */
create or replace function public.agency_confirm_key(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(
    translate(coalesce(p_text, ''), E'‘’“” ', E'''''"" '),
    '\s+', ' ', 'g'))
$$;

/* Why the owner's login has to stay, or NULL when it can go. */
create or replace function public.agency_deletion_owner_blocker(p_agency_id uuid, p_owner uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from agencies
                  where owner_id = p_owner and id <> p_agency_id)
      then 'owns_another_agency'
    when exists (select 1 from agency_members
                  where profile_id = p_owner and agency_id <> p_agency_id
                    and deleted_at is null)
      then 'member_of_another_agency'
    when exists (select 1 from profiles where id = p_owner and role = 'platform_admin')
      then 'platform_staff'
  end
$$;

/* What deleting the agency would remove, counted the same way for the
   portal's preview and for the record. */
create or replace function public.agency_deletion_counts(p_agency_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with props as (select id from properties where agency_id = p_agency_id)
  select jsonb_build_object(
    'listings',         (select count(*) from props),
    'listing_media',    (select count(*) from property_media
                          where property_id in (select id from props)),
    'leads',            (select count(*) from leads where agency_id = p_agency_id),
    'lead_attribution', (select count(*) from lead_attribution where agency_id = p_agency_id),
    'social_posts',     (select count(*) from social_posts
                          where agency_id = p_agency_id
                             or property_id in (select id from props)),
    'short_links',      (select count(*) from short_links where agency_id = p_agency_id),
    'social_accounts',  (select count(*) from social_accounts
                          where agency_id = p_agency_id and deleted_at is null),
    'campaigns',        (select count(*) from campaigns where agency_id = p_agency_id),
    'tours',            (select count(*) from viewings where agency_id = p_agency_id)
                      + (select count(*) from inspection_slots where agency_id = p_agency_id),
    'documents',        (select count(*) from documents
                          where (entity_type = 'agency' and entity_id = p_agency_id)
                             or (entity_type = 'property'
                                 and entity_id in (select id from props))),
    'team_members',     (select count(*) from agency_members m
                           join agencies a on a.id = m.agency_id
                          where m.agency_id = p_agency_id
                            and m.profile_id <> a.owner_id
                            and m.deleted_at is null)
  )
$$;

-- ── 3. preview: what the portal shows before anything happens ────────────
create or replace function public.agency_deletion_preview(p_agency_id uuid, p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  a        agencies%rowtype;
  d        agency_deletions%rowtype;
  v_hash   text := encode(sha256(p_actor::text::bytea), 'hex');
  v_block  text;
  v_paid   boolean;
begin
  if p_agency_id is null or p_actor is null then
    raise exception 'agency_and_actor_required' using errcode = '22023';
  end if;

  select * into a from agencies where id = p_agency_id;
  if not found then
    /* Gone already: an earlier attempt got past the data step. Only the
       person who started it may see that, and only until it completes. */
    select * into d from agency_deletions
     where agency_id = p_agency_id and owner_hash = v_hash and completed_at is null;
    if found then
      return jsonb_build_object(
        'state', 'data_deleted', 'agency_id', p_agency_id,
        'owner_login', d.owner_login, 'kept_because', d.owner_login_kept_because,
        'counts', d.counts);
    end if;
    raise exception 'agency_not_found' using errcode = 'P0002';
  end if;

  if a.owner_id is distinct from p_actor then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select * into d from agency_deletions where agency_id = a.id;
  v_block := agency_deletion_owner_blocker(a.id, a.owner_id);
  v_paid  := a.subscription_tier <> 'free'
             and a.subscription_current_period_end > now();

  return jsonb_build_object(
    'state', case when d.agency_id is null then 'ready' else 'begun' end,
    'agency_id', a.id,
    'name', a.name,
    'confirm_phrase', coalesce(nullif(agency_confirm_key(a.name), ''), 'delete my agency'),
    'counts', agency_deletion_counts(a.id),
    'paid_plan', case when v_paid then jsonb_build_object(
                   'tier', a.subscription_tier,
                   'until', a.subscription_current_period_end) end,
    'owner_login', jsonb_build_object(
                   'removable', v_block is null,
                   'kept_because', v_block));
end;
$$;

/* Which deletion this person left unfinished, if any. After the data step
   the agency row and the membership are both gone, so nothing the portal can
   read says there is still a login to delete -- a portal opened on another
   device, or after the browser forgot, would show an empty workspace and no
   way to finish. The deletion record still knows, by the same hash that lets
   its owner resume, and this hands back only the agency ids, only to that
   person. At most two: one is the answer, two means ask. */
create or replace function public.agency_deletion_unfinished(p_actor uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(u.agency_id), '[]'::jsonb)
    from (select agency_id from agency_deletions
           where p_actor is not null
             and owner_hash = encode(sha256(p_actor::text::bytea), 'hex')
             and completed_at is null
           order by requested_at desc
           limit 2) u
$$;

-- ── 4. begin: off the public site, nothing destroyed ─────────────────────
create or replace function public.agency_deletion_begin(
  p_agency_id         uuid,
  p_actor             uuid,
  p_confirm           text,
  p_acknowledge_plan  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a        agencies%rowtype;
  d        agency_deletions%rowtype;
  v_hash   text := encode(sha256(p_actor::text::bytea), 'hex');
  v_paid   boolean;
  v_expect text;
  n_props  integer := 0;
  n_posts  integer := 0;
  n_msgs   integer := 0;
begin
  if p_agency_id is null or p_actor is null then
    raise exception 'agency_and_actor_required' using errcode = '22023';
  end if;

  /* FOR UPDATE: two presses of the button, or two tabs, queue here rather
     than racing each other through the same rows. */
  select * into a from agencies where id = p_agency_id for update;
  if not found then
    select * into d from agency_deletions
     where agency_id = p_agency_id and owner_hash = v_hash and completed_at is null;
    if found then
      return jsonb_build_object(
        'state', 'data_deleted', 'agency_id', p_agency_id,
        'owner_login', d.owner_login, 'kept_because', d.owner_login_kept_because);
    end if;
    raise exception 'agency_not_found' using errcode = 'P0002';
  end if;

  if a.owner_id is distinct from p_actor then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  /* An agency whose name was never filled in (handle_new_user can leave it
     empty) would otherwise be confirmed by typing nothing at all. */
  v_expect := coalesce(nullif(agency_confirm_key(a.name), ''), 'delete my agency');
  if agency_confirm_key(p_confirm) is distinct from v_expect then
    raise exception 'name_mismatch' using errcode = '22023';
  end if;

  v_paid := a.subscription_tier <> 'free' and a.subscription_current_period_end > now();
  if v_paid and not coalesce(p_acknowledge_plan, false) then
    raise exception 'plan_not_acknowledged' using errcode = '22023',
      hint = 'A paid plan is active. The days left are not refunded; the owner must say they understand.';
  end if;

  insert into agency_deletions (agency_id, owner_hash, plan_at_deletion, paid_until)
  values (a.id, v_hash, a.subscription_tier::text,
          case when v_paid then a.subscription_current_period_end end)
  on conflict (agency_id) do nothing;

  /* Off the public site FIRST. is_active is what the public read policy
     checks; deleted_at is what every server-side reader (the city feed,
     proximity, the bio page, Tayo) filters on. Both, so no reader that
     checks only one of them can still show a listing that is going. */
  update properties
     set is_active = false, deleted_at = coalesce(deleted_at, now())
   where agency_id = a.id and (is_active or deleted_at is null);
  get diagnostics n_props = row_count;

  /* Nothing more goes out in the agency's name. A post already 'publishing'
     is mid-flight and cannot be caught; everything still waiting can. The
     twin trigger carries the soft delete to Synapse's amplification posts. */
  update social_posts
     set deleted_at = now()
   where deleted_at is null
     and status in ('draft', 'scheduled')
     and (agency_id = a.id
          or property_id in (select id from properties where agency_id = a.id));
  get diagnostics n_posts = row_count;

  update message_outbox
     set status = 'cancelled'
   where agency_id = a.id and status = 'queued';
  get diagnostics n_msgs = row_count;

  update agency_deletions
     set unlisted_at = coalesce(unlisted_at, now())
   where agency_id = a.id;

  return jsonb_build_object(
    'state', 'begun', 'agency_id', a.id,
    'listings_taken_down', n_props, 'posts_cancelled', n_posts,
    'messages_cancelled', n_msgs);
end;
$$;

-- ── 5. files: the edge function reports what it removed ──────────────────
create or replace function public.agency_deletion_files_removed(
  p_agency_id uuid, p_actor uuid, p_count integer
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update agency_deletions d
     set files_removed = d.files_removed + greatest(coalesce(p_count, 0), 0)
   where d.agency_id = p_agency_id
     and d.completed_at is null
     and (d.owner_hash = encode(sha256(p_actor::text::bytea), 'hex')
          or exists (select 1 from agencies a
                      where a.id = p_agency_id and a.owner_id = p_actor));
end;
$$;

-- ── 6. execute: the data, in one transaction ─────────────────────────────
create or replace function public.agency_deletion_execute(p_agency_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a          agencies%rowtype;
  d          agency_deletions%rowtype;
  v_hash     text := encode(sha256(p_actor::text::bytea), 'hex');
  v_counts   jsonb;
  v_block    text;
  v_login    text := 'kept';
  n_members  integer := 0;
  n_secrets  integer := 0;
begin
  if p_agency_id is null or p_actor is null then
    raise exception 'agency_and_actor_required' using errcode = '22023';
  end if;

  /* Step 9 hands the owner to erase_personal_data, which accepts only the
     subject or the service role and refuses anyone else with a plain RAISE
     -- the same error class step 9 treats as "something else holds on to this
     person". Checked here, first, so a wrong caller is a loud failure rather
     than an agency deleted with its owner's login quietly kept. */
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_only' using errcode = '42501';
  end if;

  select * into a from agencies where id = p_agency_id for update;
  if not found then
    -- Already done on an earlier call: report it rather than fail, so a retry
    -- after a lost response lands in the same place as the first attempt.
    select * into d from agency_deletions
     where agency_id = p_agency_id and owner_hash = v_hash and completed_at is null;
    if found then
      return jsonb_build_object(
        'state', 'data_deleted', 'agency_id', p_agency_id,
        'owner_login', d.owner_login, 'kept_because', d.owner_login_kept_because,
        'counts', d.counts);
    end if;
    raise exception 'agency_not_found' using errcode = 'P0002';
  end if;

  if a.owner_id is distinct from p_actor then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  /* The name check and the take-down live in begin. Refusing here without
     them means no caller can reach the destructive step by skipping the
     confirmation. */
  select * into d from agency_deletions where agency_id = a.id;
  if not found or d.unlisted_at is null then
    raise exception 'not_begun' using errcode = '55000',
      hint = 'agency_deletion_begin checks the typed name and takes the listings down first.';
  end if;

  -- Counted BEFORE: afterwards there is nothing left to count.
  v_counts := agency_deletion_counts(a.id);
  v_block  := agency_deletion_owner_blocker(a.id, a.owner_id);

  /* The same transaction-local switch erase_personal_data uses: append-only
     tables accept DELETE (never UPDATE) for the rest of this transaction and
     no longer. */
  perform set_config('synapse.erasure', 'on', true);

  -- 1. The tokens. By reference, and by the name connect_social_account gave
  --    them, which also finds the ones a reconnect orphaned.
  delete from vault.secrets s
   where s.id in (select access_token_ref  from social_accounts
                   where agency_id = a.id and access_token_ref is not null
                  union all
                  select refresh_token_ref from social_accounts
                   where agency_id = a.id and refresh_token_ref is not null
                  union all
                  select token_ref from social_connect_picks
                   where agency_id = a.id and token_ref is not null)
      or s.name like 'social:%:' || a.id::text || ':%';
  get diagnostics n_secrets = row_count;

  -- 2. Append-only rows a SET NULL would otherwise try to UPDATE (see top).
  delete from activity_feed
   where agency_id = a.id
      or property_id in (select id from properties where agency_id = a.id)
      or lead_id     in (select id from leads      where agency_id = a.id);
  delete from lead_attribution
   where agency_id = a.id
      or property_id in (select id from properties where agency_id = a.id)
      or lead_id     in (select id from leads      where agency_id = a.id);

  -- 3. RESTRICT edges.
  delete from fees where agency_id = a.id;
  delete from item_orders
   where item_id in (select id from vendor_items where agency_id = a.id);

  -- 4. Records that point at the agency without a foreign key.
  delete from documents
   where (entity_type = 'agency'    and entity_id = a.id)
      or (entity_type = 'property'  and entity_id in (select id from properties where agency_id = a.id))
      or (entity_type = 'deal_room' and entity_id in (select id from deal_rooms where agency_id = a.id));
  delete from consumer_reviews
   where reviewed_entity_type = 'agency' and reviewed_entity_id = a.id;
  delete from review_aggregates    where entity_type = 'agency' and entity_id = a.id;
  delete from reputation_timelines where entity_type = 'agency' and entity_id = a.id;
  delete from push_subscriptions   where agency_id = a.id;

  -- 5. The listings: media, the leads on them, posts, links, tours, checks.
  delete from properties where agency_id = a.id;
  -- 6. Leads that never had a listing.
  delete from leads where agency_id = a.id;

  -- 7. The team. Membership only: everything else about these people is
  --    theirs, and their logins keep working as plain accounts.
  select count(*) into n_members
    from agency_members
   where agency_id = a.id and profile_id <> a.owner_id and deleted_at is null;
  delete from agency_members where agency_id = a.id;

  -- 8. The agency. Its remaining children cascade.
  delete from agencies where id = a.id;

  /* 9. The owner, as a person -- only when nothing else needs the account.
     erase_personal_data in 'full' mode is the one path that deletes a profile
     through the append-only tables, and it writes its own erasure_log row.
     A savepoint, so that if something elsewhere still refuses the profile
     (an append-only row in another agency that would need a SET NULL, say)
     the agency stays deleted and the login is simply kept, with the reason.
     Only the two refusals that mean "something else holds on to this
     person" are caught; anything else is a bug and must fail loudly, which
     rolls the whole deletion back and leaves it safe to retry. */
  if v_block is null then
    begin
      delete from documents where entity_type = 'agent' and entity_id = a.owner_id;
      perform erase_personal_data(a.owner_id, 'agency deleted by its owner', 'full');
      v_login := 'pending';      -- the profile is gone; the login goes next, in Auth
    exception
      when foreign_key_violation or restrict_violation or raise_exception then
        v_block := 'records_elsewhere';
        v_login := 'kept';
    end;
  end if;

  update agency_deletions
     set data_deleted_at = now(),
         counts = v_counts || jsonb_build_object(
                    'team_members_released', n_members,
                    'vault_secrets', n_secrets),
         owner_login = v_login,
         owner_login_kept_because = case when v_login = 'kept' then v_block end
   where agency_id = a.id;

  return jsonb_build_object(
    'state', 'data_deleted', 'agency_id', a.id,
    'owner_login', v_login,
    'kept_because', case when v_login = 'kept' then v_block end,
    'counts', v_counts || jsonb_build_object(
                'team_members_released', n_members, 'vault_secrets', n_secrets));
end;
$$;

-- ── 7. finish: after the login, close the record ─────────────────────────
create or replace function public.agency_deletion_finish(
  p_agency_id uuid, p_actor uuid, p_login_removed boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d       agency_deletions%rowtype;
  v_hash  text := encode(sha256(p_actor::text::bytea), 'hex');
  v_done  boolean;
begin
  select * into d from agency_deletions
   where agency_id = p_agency_id and owner_hash = v_hash
   for update;
  if not found then
    -- A finished deletion has no hash left to match, by design.
    raise exception 'agency_not_found' using errcode = 'P0002';
  end if;
  if d.data_deleted_at is null then
    raise exception 'not_deleted_yet' using errcode = '55000';
  end if;

  /* Complete when there is nothing left to do for the login: it was kept on
     purpose, or it has now been removed. A login that should have gone and
     did not keeps the row open, and the hash, so the owner can retry. */
  v_done := d.owner_login = 'kept' or coalesce(p_login_removed, false);

  update agency_deletions
     set owner_login  = case when d.owner_login = 'pending' and coalesce(p_login_removed, false)
                             then 'removed' else d.owner_login end,
         completed_at = case when v_done then now() end,
         owner_hash   = case when v_done then null else owner_hash end
   where agency_id = p_agency_id
  returning * into d;

  return jsonb_build_object(
    'state', case when d.completed_at is not null then 'complete' else 'data_deleted' end,
    'agency_id', d.agency_id,
    'owner_login', d.owner_login,
    'kept_because', d.owner_login_kept_because,
    'counts', d.counts,
    'files_removed', d.files_removed);
end;
$$;

-- ── 8. who may call them: the service role, and nobody else ──────────────
/* PUBLIC, anon AND authenticated, each named. Revoking from PUBLIC does not
   remove the explicit grants Supabase's default privileges give anon and
   authenticated on every new function (20260919120000), and revoking from
   anon alone leaves what it inherits from PUBLIC. */
revoke all on function public.agency_confirm_key(text)                          from public, anon, authenticated;
revoke all on function public.agency_deletion_owner_blocker(uuid, uuid)         from public, anon, authenticated;
revoke all on function public.agency_deletion_counts(uuid)                      from public, anon, authenticated;
revoke all on function public.agency_deletion_preview(uuid, uuid)               from public, anon, authenticated;
revoke all on function public.agency_deletion_unfinished(uuid)                  from public, anon, authenticated;
revoke all on function public.agency_deletion_begin(uuid, uuid, text, boolean)  from public, anon, authenticated;
revoke all on function public.agency_deletion_files_removed(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.agency_deletion_execute(uuid, uuid)               from public, anon, authenticated;
revoke all on function public.agency_deletion_finish(uuid, uuid, boolean)       from public, anon, authenticated;

grant execute on function public.agency_deletion_preview(uuid, uuid)               to service_role;
grant execute on function public.agency_deletion_unfinished(uuid)                  to service_role;
grant execute on function public.agency_deletion_begin(uuid, uuid, text, boolean)  to service_role;
grant execute on function public.agency_deletion_files_removed(uuid, uuid, integer) to service_role;
grant execute on function public.agency_deletion_execute(uuid, uuid)               to service_role;
grant execute on function public.agency_deletion_finish(uuid, uuid, boolean)       to service_role;

comment on function public.agency_deletion_execute(uuid, uuid) is
  'Deletes an agency and everything keyed on it, in one transaction, after '
  'agency_deletion_begin has checked the typed name and taken the listings '
  'down. Team members keep their logins (membership only). The owner''s '
  'profile is erased through erase_personal_data unless something else still '
  'needs it. Service role only: called by the delete-agency edge function, '
  'which removes the Storage files before this and the Auth login after it.';
