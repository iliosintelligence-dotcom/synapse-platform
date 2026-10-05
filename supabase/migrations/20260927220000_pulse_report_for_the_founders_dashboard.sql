-- The founder's usage report: one function the local Pulse dashboard reads.
--
-- Eden: "show me any new accounts created, any new usage, any new
-- interactions with the app. Basically a usage log that the startup would use
-- to measure the usage and performance of the application", run locally.
--
-- ONE FUNCTION, ONE ROUND TRIP. The dashboard (synapse-platform/tools/pulse)
-- asks for a period and gets every figure, series, breakdown and the activity
-- log back as one document. The SQL that defines each number lives here,
-- versioned and reviewed, rather than in a page's JavaScript.
--
-- SERVICE ROLE ONLY. It reads auth.users (sign-ups, last sign-in) and the
-- first line of each Tayo conversation, so no browser may call it: the
-- dashboard's local server holds the service key and calls it server-side.
-- Personal data is kept to what a founder needs to see usage: account emails
-- are masked (a***@gmail.com), lead names and phone numbers are never read,
-- and a conversation contributes only its first line, cut to 90 characters.
--
-- Every "now" figure comes with the same measure for the period before it,
-- so the page can say whether things are growing rather than just how big
-- they are. Days are Lagos days.

create or replace function public.pulse_report(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
declare
  d        integer     := greatest(1, least(coalesce(p_days, 30), 365));
  v_now    timestamptz := now();
  v_since  timestamptz := now() - make_interval(days => d);
  v_prev   timestamptz := now() - make_interval(days => 2 * d);
  v_first  date        := ((now() at time zone 'Africa/Lagos')::date - (d - 1));
  v_kpis   jsonb;
  v_daily  jsonb;
  v_src    jsonb;
  v_top    jsonb;
  v_feed   jsonb;
  v_health jsonb;
  v_roles  jsonb;
begin
  -- ── headline figures, each against the period before ──────────────────
  select jsonb_build_object(
    'accounts', (select jsonb_build_object(
        'now',  count(*) filter (where created_at >= v_since),
        'prev', count(*) filter (where created_at >= v_prev and created_at < v_since),
        'total', count(*)) from auth.users),
    'active_users', (select jsonb_build_object(
        'now',  count(*) filter (where last_sign_in_at >= v_since),
        'prev', count(*) filter (where last_sign_in_at >= v_prev and last_sign_in_at < v_since)) from auth.users),
    'agencies', (select jsonb_build_object(
        'now',  count(*) filter (where created_at >= v_since),
        'prev', count(*) filter (where created_at >= v_prev and created_at < v_since),
        'total', count(*)) from agencies where deleted_at is null),
    'listings', (select jsonb_build_object(
        'now',  count(*) filter (where created_at >= v_since),
        'prev', count(*) filter (where created_at >= v_prev and created_at < v_since),
        'live', count(*) filter (where status::text = 'live' and is_active)) from properties where deleted_at is null),
    'tayo_chats', (select jsonb_build_object(
        'now',  count(*) filter (where created_at >= v_since),
        'prev', count(*) filter (where created_at >= v_prev and created_at < v_since),
        'total', count(*)) from demo_chat_sessions),
    'tayo_messages', (select jsonb_build_object(
        'now',  coalesce(sum(n) filter (where created_at >= v_since), 0),
        'prev', coalesce(sum(n) filter (where created_at >= v_prev and created_at < v_since), 0))
      from (select s.created_at,
                   (select count(*) from jsonb_array_elements((case when jsonb_typeof(s.messages) = 'array' then s.messages else '[]'::jsonb end)) m
                     where m->>'role' = 'user' and left(coalesce(m->>'content', ''), 1) <> '[') as n
              from demo_chat_sessions s where s.created_at >= v_prev) t),
    'searches', (select jsonb_build_object(
        'now',  count(*) filter (where searched_at >= v_since),
        'prev', count(*) filter (where searched_at >= v_prev and searched_at < v_since)) from property_searches),
    'visits', (select jsonb_build_object(
        'now',  count(*) filter (where occurred_at >= v_since),
        'prev', count(*) filter (where occurred_at >= v_prev and occurred_at < v_since)) from channel_interactions),
    'clicks', (select jsonb_build_object(
        'now',  count(*) filter (where occurred_at >= v_since),
        'prev', count(*) filter (where occurred_at >= v_prev and occurred_at < v_since)) from click_events where ua_class = 'human'),
    'leads', (select jsonb_build_object(
        'now',  count(*) filter (where created_at >= v_since),
        'prev', count(*) filter (where created_at >= v_prev and created_at < v_since),
        'total', count(*)) from leads where deleted_at is null),
    'inspections', (select jsonb_build_object(
        'now',  count(*) filter (where created_at >= v_since),
        'prev', count(*) filter (where created_at >= v_prev and created_at < v_since)) from viewings where deleted_at is null),
    'posts', (select jsonb_build_object(
        'now',  count(*) filter (where status::text = 'published' and published_at >= v_since),
        'prev', count(*) filter (where status::text = 'published' and published_at >= v_prev and published_at < v_since),
        'failed', count(*) filter (where status::text = 'failed' and updated_at >= v_since)) from social_posts where deleted_at is null),
    'arrivals', (select jsonb_build_object(
        'now',  count(*) filter (where kind = 'arrived' and created_at >= v_since),
        'prev', count(*) filter (where kind = 'arrived' and created_at >= v_prev and created_at < v_since)) from growth_events),
    'registrations', (select jsonb_build_object(
        'now',  count(*) filter (where kind = 'registered' and created_at >= v_since),
        'prev', count(*) filter (where kind = 'registered' and created_at >= v_prev and created_at < v_since)) from growth_events)
  ) into v_kpis;

  -- ── who the new accounts are, by role ─────────────────────────────────
  select coalesce(jsonb_object_agg(role, n), '{}'::jsonb) into v_roles
    from (select coalesce(p.role::text, 'unknown') as role, count(*) as n
            from auth.users u left join profiles p on p.id = u.id
           where u.created_at >= v_since group by 1) r;

  -- ── day by day ────────────────────────────────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', g.day,
           'accounts', (select count(*) from auth.users u where (u.created_at at time zone 'Africa/Lagos')::date = g.day),
           'tayo',     (select count(*) from demo_chat_sessions s where (s.created_at at time zone 'Africa/Lagos')::date = g.day),
           'searches', (select count(*) from property_searches x where (x.searched_at at time zone 'Africa/Lagos')::date = g.day),
           'clicks',   (select count(*) from click_events c where c.ua_class = 'human' and (c.occurred_at at time zone 'Africa/Lagos')::date = g.day),
           'visits',   (select count(*) from channel_interactions ci where (ci.occurred_at at time zone 'Africa/Lagos')::date = g.day),
           'leads',    (select count(*) from leads l where l.deleted_at is null and (l.created_at at time zone 'Africa/Lagos')::date = g.day),
           'posts',    (select count(*) from social_posts sp where sp.deleted_at is null and sp.status::text = 'published' and (sp.published_at at time zone 'Africa/Lagos')::date = g.day)
         ) order by g.day), '[]'::jsonb)
    into v_daily
    from (select generate_series(v_first, (now() at time zone 'Africa/Lagos')::date, interval '1 day')::date as day) g;

  -- ── where people came from ────────────────────────────────────────────
  select jsonb_build_object(
    'clicks_by_channel', (select coalesce(jsonb_agg(jsonb_build_object('channel', ch, 'n', n) order by n desc), '[]'::jsonb)
        from (select channel::text as ch, count(*) as n from click_events
               where ua_class = 'human' and occurred_at >= v_since group by 1) a),
    'visits_by_channel', (select coalesce(jsonb_agg(jsonb_build_object('channel', ch, 'n', n) order by n desc), '[]'::jsonb)
        from (select channel::text as ch, count(*) as n from channel_interactions
               where occurred_at >= v_since group by 1) b),
    'arrivals_by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', src, 'n', n) order by n desc), '[]'::jsonb)
        from (select coalesce(nullif(source, ''), 'direct') as src, count(*) as n from growth_events
               where kind = 'arrived' and created_at >= v_since group by 1) c),
    'leads_by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', src, 'n', n) order by n desc), '[]'::jsonb)
        from (select source::text as src, count(*) as n from leads
               where deleted_at is null and created_at >= v_since group by 1) e),
    'posts_by_platform', (select coalesce(jsonb_agg(jsonb_build_object('platform', pl, 'published', pub, 'failed', fl) order by pub desc), '[]'::jsonb)
        from (select platform::text as pl,
                     count(*) filter (where status::text = 'published' and published_at >= v_since) as pub,
                     count(*) filter (where status::text = 'failed' and updated_at >= v_since) as fl
                from social_posts where deleted_at is null group by 1) f
       where pub > 0 or fl > 0)
  ) into v_src;

  -- ── the listings people actually looked at ────────────────────────────
  select coalesce(jsonb_agg(t order by (t->>'visits')::int + (t->>'clicks')::int desc), '[]'::jsonb) into v_top
    from (select jsonb_build_object(
                   'title', p.title, 'city', p.city,
                   'agency', (select name from agencies a where a.id = p.agency_id),
                   'visits', (select count(*) from channel_interactions ci where ci.property_id = p.id and ci.occurred_at >= v_since),
                   'clicks', (select count(*) from click_events c where c.property_id = p.id and c.ua_class = 'human' and c.occurred_at >= v_since),
                   'leads',  (select count(*) from leads l where l.property_id = p.id and l.deleted_at is null and l.created_at >= v_since)) as t
            from properties p
           where p.deleted_at is null
             and (exists (select 1 from channel_interactions ci where ci.property_id = p.id and ci.occurred_at >= v_since)
               or exists (select 1 from click_events c where c.property_id = p.id and c.ua_class = 'human' and c.occurred_at >= v_since))) x
   where (t->>'visits')::int + (t->>'clicks')::int > 0;
  v_top := coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(v_top) e limit 8) z), '[]'::jsonb);

  -- ── the activity log ──────────────────────────────────────────────────
  select coalesce(jsonb_agg(ev order by (ev->>'at') desc), '[]'::jsonb) into v_feed
    from (
      select * from (
        select jsonb_build_object('at', u.created_at, 'type', 'account',
                 'text', coalesce(nullif(btrim(p.full_name), ''), 'New account')
                   || ' · ' || coalesce(p.role::text, 'account')
                   || coalesce(' · ' || left(u.email, 1) || '***@' || split_part(u.email, '@', 2), '')) as ev
          from auth.users u left join profiles p on p.id = u.id
         where u.created_at >= v_since
        union all
        select jsonb_build_object('at', a.created_at, 'type', 'agency', 'text', a.name)
          from agencies a where a.deleted_at is null and a.created_at >= v_since
        union all
        select jsonb_build_object('at', p.created_at, 'type', 'listing',
                 'text', coalesce(p.title, 'Listing') || coalesce(' · ' || p.city, '')
                   || coalesce(' · ' || (select name from agencies a where a.id = p.agency_id), ''))
          from properties p where p.deleted_at is null and p.created_at >= v_since
        union all
        select jsonb_build_object('at', s.created_at, 'type', 'tayo',
                 'text', coalesce(left((select m->>'content' from jsonb_array_elements((case when jsonb_typeof(s.messages) = 'array' then s.messages else '[]'::jsonb end)) m
                                         where m->>'role' = 'user' and left(coalesce(m->>'content', ''), 1) <> '['
                                         limit 1), 90), 'Opened Tayo, said nothing yet'))
          from demo_chat_sessions s where s.created_at >= v_since
        union all
        select jsonb_build_object('at', x.searched_at, 'type', 'search',
                 'text', coalesce(nullif(left(x.query, 70), ''), 'Filtered search')
                   || coalesce(' · ' || x.results_count || ' results', ''))
          from property_searches x where x.searched_at >= v_since
        union all
        select jsonb_build_object('at', l.created_at, 'type', 'lead',
                 'text', 'Lead on ' || coalesce((select title from properties p where p.id = l.property_id), 'a listing')
                   || ' · ' || coalesce(l.source::text, 'unknown source'))
          from leads l where l.deleted_at is null and l.created_at >= v_since
        union all
        select jsonb_build_object('at', v.created_at, 'type', 'inspection',
                 'text', 'Inspection booked · ' || coalesce((select title from properties p where p.id = v.property_id), 'a listing'))
          from viewings v where v.deleted_at is null and v.created_at >= v_since
        union all
        select jsonb_build_object('at', coalesce(sp.published_at, sp.updated_at), 'type',
                 case when sp.status::text = 'failed' then 'post_failed' else 'post' end,
                 'text', sp.platform::text
                   || case when sp.city_channel_id is not null then ' (city channel)'
                           when sp.leg = 'synapse' then ' (Synapse)' else '' end
                   || ' · ' || coalesce((select name from agencies a where a.id = sp.agency_id), '')
                   || case when sp.status::text = 'failed' then ' · ' || left(coalesce(sp.failure_reason, 'failed'), 80) else '' end)
          from social_posts sp
         where sp.deleted_at is null
           and ((sp.status::text = 'published' and sp.published_at >= v_since)
             or (sp.status::text = 'failed' and sp.updated_at >= v_since))
      ) all_events
      order by (ev->>'at') desc
      limit 80
    ) f;

  -- ── is the machinery healthy ──────────────────────────────────────────
  select jsonb_build_object(
    'open_alerts', (select coalesce(jsonb_agg(jsonb_build_object(
                       'job', jobname, 'kind', kind, 'detail', left(detail, 160),
                       'times', occurrences, 'last', last_seen_at) order by last_seen_at desc), '[]'::jsonb)
                     from (select * from cron_alerts where resolved_at is null order by last_seen_at desc limit 12) z),
    'failed_posts_24h', (select count(*) from social_posts where deleted_at is null and status::text = 'failed' and updated_at >= v_now - interval '24 hours'),
    'queued_posts', (select count(*) from social_posts where deleted_at is null and status::text = 'scheduled')
  ) into v_health;

  return jsonb_build_object(
    'generated_at', v_now,
    'days', d,
    'since', v_since,
    'kpis', v_kpis,
    'new_accounts_by_role', v_roles,
    'daily', v_daily,
    'sources', v_src,
    'top_listings', v_top,
    'feed', v_feed,
    'health', v_health
  );
end;
$$;

comment on function public.pulse_report(integer) is
  'Everything the local Pulse dashboard shows for the last p_days days, with the '
  'period before for comparison, as one jsonb document. Service role only: reads '
  'auth.users and conversation first lines. Emails masked; lead contact details never read.';

revoke all on function public.pulse_report(integer) from public, anon, authenticated;
grant execute on function public.pulse_report(integer) to service_role;
