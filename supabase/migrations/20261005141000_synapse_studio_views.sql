-- What the Synapse studio reads. Service role only: the page never reads a
-- table directly, it asks the synapse-studio function, which has already
-- checked that the caller is Synapse staff.

create or replace function synapse_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'label', coalesce(nullif(btrim(c.label), ''), nullif(btrim(c.title), ''), c.handle),
        'platform', c.platform,
        'handle', c.handle,
        'city', c.city,
        'trypost_account_id', c.trypost_account_id,
        'telegram', c.chat_id is not null,
        'is_active', c.is_active,
        'autopilot', c.autopilot,
        'mirror', c.mirror_agency_posts,
        'daily_cap', c.daily_cap,
        'min_gap_minutes', (extract(epoch from c.min_gap) / 60)::int,
        'window_start', c.window_start,
        'window_end', c.window_end,
        'repost_days', (extract(epoch from c.repost_after) / 86400)::int,
        'posts_today',
          (select count(*) from social_posts sp
            where sp.city_channel_id = c.id and sp.deleted_at is null
              and (sp.scheduled_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)
          + (select count(*) from synapse_posts x
              where x.channel_id = c.id and x.status <> 'cancelled'
                and (x.scheduled_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)
      ) order by c.created_at)
      from city_channels c), '[]'::jsonb),
    'legacy', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'platform', s.platform, 'handle', s.handle, 'is_active', s.is_active)
                       order by s.platform)
        from synapse_channels s), '[]'::jsonb),
    'twins_enabled', coalesce((select (value->>'enabled')::boolean from platform_settings where key = 'synapse_twins'), false),
    'live_listings', (select count(*) from properties where deleted_at is null and status = 'live' and is_active)
  );
$$;
revoke all on function synapse_overview() from public, anon, authenticated;
grant execute on function synapse_overview() to service_role;

-- The latest things Synapse's channels did, from both sources: the listing
-- posts (autopilot and mirrored) and the studio's own posts.
create or replace function synapse_activity(p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_lim integer := greatest(1, least(coalesce(p_limit, 40), 100));
  v_listing jsonb;
  v_studio jsonb;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_listing from (
    select jsonb_build_object(
      'kind', case when sp.twin_of is not null then 'mirrored' else 'autopilot' end,
      'id', sp.id,
      'platform', sp.platform,
      'channel', coalesce(nullif(btrim(c.label), ''), c.handle, c.title),
      'text', left(coalesce(pr.title, sp.caption), 140),
      'status', sp.status,
      'delivery', sp.payload->>'delivery',
      'failure', sp.failure_reason,
      'at', coalesce(sp.published_at, sp.scheduled_at)) as x
    from social_posts sp
    left join city_channels c on c.id = sp.city_channel_id
    left join properties pr on pr.id = sp.property_id
    where sp.leg = 'synapse' and sp.deleted_at is null
    order by coalesce(sp.published_at, sp.scheduled_at) desc
    limit v_lim
  ) a;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_studio from (
    select jsonb_build_object(
      'kind', 'studio',
      'id', y.id,
      'platform', y.platform,
      'channel', coalesce(nullif(btrim(c.label), ''), c.handle, c.title),
      'text', left(y.caption, 140),
      'status', y.status,
      'delivery', y.payload->>'delivery',
      'failure', y.failure_reason,
      'at', coalesce(y.published_at, y.scheduled_at)) as x
    from synapse_posts y
    left join city_channels c on c.id = y.channel_id
    order by coalesce(y.published_at, y.scheduled_at) desc
    limit v_lim
  ) b;

  return (select coalesce(jsonb_agg(e order by (e->>'at') desc), '[]'::jsonb)
            from jsonb_array_elements(v_listing || v_studio) e);
end;
$$;
revoke all on function synapse_activity(integer) from public, anon, authenticated;
grant execute on function synapse_activity(integer) to service_role;
