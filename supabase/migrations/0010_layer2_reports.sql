-- Layer 2 · reporting RPCs
-- Attribution models are DERIVED from raw touchpoints, never pre-stored.
-- This first-touch revenue report answers: which channels generate closed
-- deals (not just leads). security definer + an explicit membership guard
-- so an agency only ever sees its own numbers.

create or replace function channel_first_touch_revenue(p_agency_id uuid)
returns table (channel attribution_channel, closed_deals bigint, revenue numeric)
language plpgsql security definer set search_path = public as $$
begin
  if not is_agency_member(p_agency_id) then
    raise exception 'forbidden';
  end if;

  return query
  select ft.channel,
         count(distinct dr.id) as closed_deals,
         coalesce(sum(dr.closing_price), 0) as revenue
  from deal_rooms dr
  join lateral (
    select la.channel
    from lead_attribution la
    where la.lead_id = dr.lead_id
    order by la.occurred_at asc
    limit 1
  ) ft on true
  where dr.agency_id = p_agency_id
    and dr.status = 'closed'
  group by ft.channel
  order by revenue desc;
end;
$$;
