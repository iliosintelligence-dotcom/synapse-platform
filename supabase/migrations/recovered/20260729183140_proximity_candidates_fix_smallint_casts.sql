-- properties.bedrooms/trust_score are smallint; the declared OUT columns are
-- integer, and plpgsql will not widen implicitly on RETURN QUERY. Cast them.
create or replace function public.proximity_candidates(p_watch_id uuid)
returns table (
  property_id uuid,
  title       text,
  city        text,
  price       numeric,
  bedrooms    int,
  trust_score int,
  distance_m  double precision
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  w public.geofence_watches%rowtype;
  sent_today int;
  now_local time := (now() at time zone 'Africa/Lagos')::time;
  in_quiet boolean;
begin
  select * into w from public.geofence_watches where id = p_watch_id;
  if not found or not w.enabled or w.last_point is null then
    return;
  end if;

  in_quiet := case
    when w.quiet_from < w.quiet_to then now_local >= w.quiet_from and now_local < w.quiet_to
    else now_local >= w.quiet_from or now_local < w.quiet_to
  end;
  if in_quiet then return; end if;

  select count(*) into sent_today
  from public.notifications n
  where n.kind = 'proximity_match'
    and coalesce(n.recipient_id::text, n.visitor_id) = coalesce(w.user_id::text, w.visitor_id)
    and n.created_at >= date_trunc('day', now());
  if sent_today >= w.daily_cap then return; end if;

  return query
  select p.id, p.title::text, p.city::text, p.price,
         p.bedrooms::int, p.trust_score::int,
         st_distance(p.location, w.last_point)::double precision
  from public.properties p
  where p.status = 'live'
    and p.is_active
    and p.verification_status = 'verified'
    and p.listed_at >= now() - interval '14 days'
    and p.location is not null
    and st_dwithin(p.location, w.last_point, w.radius_m)
    and (w.city         is null or p.city = w.city)
    and (w.deal_type    is null or p.listing_type = w.deal_type)
    and (w.max_price    is null or p.price <= w.max_price)
    and (w.min_bedrooms is null or p.bedrooms >= w.min_bedrooms)
    and not exists (
      select 1 from public.notifications n
      where n.kind = 'proximity_match'
        and n.property_id = p.id
        and coalesce(n.recipient_id::text, n.visitor_id) = coalesce(w.user_id::text, w.visitor_id)
    )
  order by st_distance(p.location, w.last_point)
  limit greatest(0, w.daily_cap - sent_today);
end $$;

revoke all on function public.proximity_candidates(uuid) from public, anon;
grant execute on function public.proximity_candidates(uuid) to authenticated, service_role;
