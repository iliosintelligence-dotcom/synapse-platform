-- Audit history and channel routing logs (contract: "full audit history", "maintain channel routing logs").
--
-- 1. social_audit_log -- every create / change / cancel / removal of a post, and every connect / disconnect /
--    reconnect of a social account: who did it (auth.uid()), as what (browser, publisher, scheduled job), what changed.
--    Written by triggers, so it is recorded whichever path made the change (portal, edge function, cron, SQL) and
--    cannot be skipped by a caller. Tokens never enter it: accounts are logged from an allow-list of columns that
--    does not include the vault references.
-- 2. social_routing_log -- each time a listing's post is offered to Synapse's own channels, one row per channel:
--    queued (and as which post) or skipped, and why. Written by queue_synapse_twins, rewritten here from its current
--    version (md5 b40a4250... verified against the database on 2026-11-09) with ONLY the log writes added. Every log
--    write is wrapped so that a logging failure can never stop a post being queued.
--
-- Both tables: readable by Synapse staff and by members of the agency the row belongs to; nobody can write to them
-- through the API (no insert/update/delete policies, and the writers are SECURITY DEFINER).

begin;

-- ── 1. audit ──────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.social_audit_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  agency_id   uuid,
  entity      text not null check (entity in ('social_post', 'social_account')),
  entity_id   uuid not null,
  action      text not null,
  from_status text,
  to_status   text,
  changes     jsonb not null default '{}'::jsonb,
  actor_id    uuid,
  actor_kind  text not null
);

create index if not exists social_audit_log_entity_idx on public.social_audit_log (entity, entity_id, created_at desc);
create index if not exists social_audit_log_agency_idx on public.social_audit_log (agency_id, created_at desc);

alter table public.social_audit_log enable row level security;

drop policy if exists social_audit_log_read on public.social_audit_log;
create policy social_audit_log_read on public.social_audit_log
  for select to authenticated
  using (public.is_synapse_staff() or (agency_id is not null and public.is_agency_member(agency_id)));

revoke all on public.social_audit_log from anon;
revoke insert, update, delete, truncate on public.social_audit_log from authenticated;
grant select on public.social_audit_log to authenticated;

comment on table public.social_audit_log is
  'Who created, changed, cancelled, removed or published each social post, and who connected or disconnected each account. Trigger-written.';

/* Who is acting, in words the history can show. A browser request carries the JWT role 'authenticated'; the
   publisher and the edge functions use the service key; a scheduled job has no JWT at all. */
create or replace function public.social_audit_actor_kind()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case coalesce(auth.role(), '')
           when 'authenticated' then 'user'
           when 'service_role'  then 'system'
           when ''              then 'scheduled_job'
           else auth.role()
         end;
$$;

/* Only these columns are compared and recorded. Anything else on the row (metrics, attempts, payload, timestamps,
   vault references) is either noise or must never be copied into a log. */
create or replace function public.social_audit_diff(o jsonb, n jsonb, cols text[])
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('from', o -> k, 'to', n -> k)), '{}'::jsonb)
    from unnest(cols) k
   where (o -> k) is distinct from (n -> k);
$$;

create or replace function public.social_posts_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cols    text[] := array['status', 'scheduled_at', 'social_account_id', 'campaign_id', 'deleted_at',
                            'platform_post_id', 'published_at', 'failure_reason', 'platform'];
  v_changes jsonb;
  v_action  text;
begin
  begin
    if tg_op = 'INSERT' then
      insert into social_audit_log (agency_id, entity, entity_id, action, to_status, changes, actor_id, actor_kind)
      values (new.agency_id, 'social_post', new.id,
              case when new.leg = 'synapse' then 'routed_to_synapse_channel' else 'created' end,
              new.status::text,
              jsonb_build_object('platform', new.platform, 'leg', new.leg, 'scheduled_at', new.scheduled_at,
                                 'dry_run', new.dry_run, 'twin_of', new.twin_of, 'city_channel_id', new.city_channel_id),
              auth.uid(), social_audit_actor_kind());
      return new;
    end if;

    v_changes := social_audit_diff(to_jsonb(old), to_jsonb(new), v_cols);
    -- a caption edit is recorded as an edit, without copying the text
    if new.caption is distinct from old.caption then
      v_changes := v_changes || jsonb_build_object('caption', 'edited');
    end if;
    if v_changes = '{}'::jsonb then return new; end if;   -- metrics refresh, attempts, payload: not history

    v_action := case
      when new.deleted_at is not null and old.deleted_at is null      then 'removed'
      when new.status is distinct from old.status then
        case new.status::text
          when 'cancelled'  then 'cancelled'
          when 'published'  then 'published'
          when 'failed'     then 'failed'
          when 'publishing' then 'publishing'
          when 'scheduled'  then case when old.status::text = 'failed' then 'retried' else 'scheduled' end
          else 'status_changed'
        end
      when new.scheduled_at is distinct from old.scheduled_at         then 'rescheduled'
      else 'edited'
    end;

    insert into social_audit_log (agency_id, entity, entity_id, action, from_status, to_status, changes, actor_id, actor_kind)
    values (new.agency_id, 'social_post', new.id, v_action, old.status::text, new.status::text, v_changes,
            auth.uid(), social_audit_actor_kind());
  exception when others then
    raise warning 'social_posts_audit: not recorded for % (%)', coalesce(new.id, old.id), sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists social_posts_audit_trg on public.social_posts;
create trigger social_posts_audit_trg
  after insert or update on public.social_posts
  for each row execute function public.social_posts_audit();

create or replace function public.social_accounts_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cols    text[] := array['platform', 'platform_account_id', 'platform_username', 'is_active', 'deleted_at',
                            'token_expires_at', 'auth_source'];
  v_changes jsonb;
  v_action  text;
begin
  begin
    if tg_op = 'INSERT' then
      insert into social_audit_log (agency_id, entity, entity_id, action, changes, actor_id, actor_kind)
      values (new.agency_id, 'social_account', new.id, 'connected',
              jsonb_build_object('platform', new.platform, 'account', new.platform_username),
              auth.uid(), social_audit_actor_kind());
      return new;
    end if;

    v_changes := social_audit_diff(to_jsonb(old), to_jsonb(new), v_cols);
    if new.access_token_ref is distinct from old.access_token_ref then
      v_changes := v_changes || jsonb_build_object('token', 'replaced');   -- that it changed, never what to
    end if;
    if v_changes = '{}'::jsonb then return new; end if;

    v_action := case
      when new.deleted_at is not null and old.deleted_at is null           then 'disconnected'
      when new.is_active is false and old.is_active is not false           then 'disconnected'
      when new.is_active is true  and old.is_active is false               then 'reconnected'
      when new.access_token_ref is distinct from old.access_token_ref
       and new.token_expires_at is not distinct from old.token_expires_at then 'reconnected'
      when new.access_token_ref is distinct from old.access_token_ref      then 'token_renewed'
      else 'updated'
    end;

    insert into social_audit_log (agency_id, entity, entity_id, action, changes, actor_id, actor_kind)
    values (new.agency_id, 'social_account', new.id, v_action, v_changes, auth.uid(), social_audit_actor_kind());
  exception when others then
    raise warning 'social_accounts_audit: not recorded for % (%)', coalesce(new.id, old.id), sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists social_accounts_audit_trg on public.social_accounts;
create trigger social_accounts_audit_trg
  after insert or update on public.social_accounts
  for each row execute function public.social_accounts_audit();

revoke all on function public.social_posts_audit()    from public, anon, authenticated;
revoke all on function public.social_accounts_audit() from public, anon, authenticated;


-- ── 2. routing ────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.social_routing_log (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  agency_id       uuid,
  property_id     uuid,
  source_post_id  uuid,
  platform        text,
  channel_kind    text check (channel_kind in ('synapse_channel', 'city_channel')),
  city_channel_id uuid,
  twin_post_id    uuid,
  decision        text not null check (decision in ('queued', 'skipped')),
  reason          text not null
);

create index if not exists social_routing_log_property_idx on public.social_routing_log (property_id, created_at desc);
create index if not exists social_routing_log_agency_idx   on public.social_routing_log (agency_id, created_at desc);

alter table public.social_routing_log enable row level security;

drop policy if exists social_routing_log_read on public.social_routing_log;
create policy social_routing_log_read on public.social_routing_log
  for select to authenticated
  using (public.is_synapse_staff() or (agency_id is not null and public.is_agency_member(agency_id)));

revoke all on public.social_routing_log from anon;
revoke insert, update, delete, truncate on public.social_routing_log from authenticated;
grant select on public.social_routing_log to authenticated;

comment on table public.social_routing_log is
  'Each offer of a listing to Synapse''s own channels: queued (as which post) or skipped, and why. Written by queue_synapse_twins.';

/* One log row, never an error: the queueing it describes matters more than the description. */
create or replace function public.log_social_routing(
  p_agency uuid, p_property uuid, p_source uuid, p_platform text, p_kind text, p_city uuid,
  p_twin uuid, p_decision text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into social_routing_log (agency_id, property_id, source_post_id, platform, channel_kind, city_channel_id,
                                  twin_post_id, decision, reason)
  values (p_agency, p_property, p_source, p_platform, p_kind, p_city, p_twin, p_decision, p_reason);
exception when others then
  raise warning 'log_social_routing: not recorded (%)', sqlerrm;
end;
$$;

revoke all on function public.log_social_routing(uuid, uuid, uuid, text, text, uuid, uuid, text, text)
  from public, anon, authenticated;

create or replace function public.queue_synapse_twins(
  p_property_id  uuid,
  p_agency_id    uuid,
  p_caption      text,
  p_media_urls   text[],
  p_scheduled_at timestamptz,
  p_dry_run      boolean,
  p_source_post  uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_channel record;
  v_id      uuid;
  v_caption text;
  v_url     text;
  v_media   text[];
  v_city    text;
  v_prop    public.properties;
  v_src     text;
  v_at      timestamptz := coalesce(p_scheduled_at, now());
  v_n       integer := 0;
  v_kind    text;
begin
  /* OFF UNLESS SWITCHED ON. Since 2026-09-27 this is a switch in the Synapse
     studio (platform_settings.synapse_twins). */
  if coalesce((select (value->>'enabled')::boolean
                 from platform_settings where key = 'synapse_twins'), false) is not true then
    perform log_social_routing(p_agency_id, p_property_id, p_source_post, null, null, null, null,
                               'skipped', 'Synapse channel copies are switched off in the studio');
    return 0;
  end if;

  select platform::text into v_src from social_posts where id = p_source_post;
  select * into v_prop from properties where id = p_property_id;
  if not found then return 0; end if;
  v_city := v_prop.city;

  /* ROUTING LOG ONLY: the studio channels that would take this platform but whose rules (city, area, price,
     bedrooms, kind) this listing does not meet. Read-only; nothing is queued from here. */
  begin
    for v_channel in
      select c.platform, c.id
        from city_channels c
       where c.is_active and c.mirror_agency_posts
         and (v_src is null or c.platform::text = v_src)
         and (c.chat_id is not null or c.trypost_account_id is not null)
         and not public.city_channel_accepts(c, v_prop)
    loop
      perform log_social_routing(p_agency_id, p_property_id, p_source_post, v_channel.platform::text, 'city_channel',
                                 v_channel.id, null, 'skipped', 'Listing does not match this channel''s rules');
    end loop;
  exception when others then
    raise warning 'queue_synapse_twins: routing log of rejected channels failed (%)', sqlerrm;
  end;

  /* Both kinds of channel in one pass: the original per-platform channels
     (synapse_channels, city_channel_id null) and the studio's channels that
     asked to receive agencies' posts. */
  for v_channel in
    select platform, null::uuid as city_channel_id
      from synapse_channels where is_active
       and (v_src is null or platform::text = v_src)
    union all
    select c.platform, c.id
      from city_channels c
     where c.is_active and c.mirror_agency_posts
       and (v_src is null or c.platform::text = v_src)
       and (c.chat_id is not null or c.trypost_account_id is not null)
       and public.city_channel_accepts(c, v_prop)
    order by 1
  loop
    v_kind := case when v_channel.city_channel_id is null then 'synapse_channel' else 'city_channel' end;

    if exists (
      select 1 from social_posts
      where property_id = p_property_id
        and platform    = v_channel.platform
        and leg         = 'synapse'
        and deleted_at is null
        and city_channel_id is not distinct from v_channel.city_channel_id
        and scheduled_at between v_at - interval '1 hour' and v_at + interval '1 hour'
    ) then
      perform log_social_routing(p_agency_id, p_property_id, p_source_post, v_channel.platform::text, v_kind,
                                 v_channel.city_channel_id, null, 'skipped',
                                 'Already queued on this channel within an hour of this time');
      continue;
    end if;

    v_caption := 'Spotted on Synapse' || E'\n\n' || btrim(coalesce(p_caption, ''));
    v_media := (coalesce(p_media_urls, '{}'))[1:media_cap_for(v_channel.platform::text)];

    v_id := null;
    insert into social_posts (
      property_id, agency_id, platform, caption, media_urls,
      status, scheduled_at, dry_run, created_by, leg, twin_of, city_channel_id
    ) values (
      p_property_id, p_agency_id, v_channel.platform,
      v_caption, v_media,
      'scheduled', v_at, coalesce(p_dry_run, true),
      auth.uid(), 'synapse', p_source_post, v_channel.city_channel_id
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      perform log_social_routing(p_agency_id, p_property_id, p_source_post, v_channel.platform::text, v_kind,
                                 v_channel.city_channel_id, null, 'skipped',
                                 'This post already has a copy on this channel');
      continue;
    end if;

    begin
      select l.url into v_url
      from public.create_short_link(
        p_property_id,
        (case lower(v_channel.platform::text)
           when 'instagram' then 'instagram'
           when 'facebook'  then 'facebook'
           when 'tiktok'    then 'tiktok'
           when 'whatsapp'  then 'whatsapp_campaign'
           when 'telegram'  then 'telegram'
           else 'organic'
         end)::public.attribution_channel,
        v_id) l;

      update social_posts
         set caption = public.caption_with_link(v_channel.platform::text, v_caption, v_url)
       where id = v_id;
    exception when others then
      raise warning 'queue_synapse_twins: no short link for % (%)', v_id, sqlerrm;
    end;

    perform log_social_routing(p_agency_id, p_property_id, p_source_post, v_channel.platform::text, v_kind,
                               v_channel.city_channel_id, v_id, 'queued',
                               case when v_kind = 'city_channel' then 'Listing matches this channel''s rules'
                                    else 'Synapse''s own ' || v_channel.platform::text || ' channel' end);

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;

commit;
