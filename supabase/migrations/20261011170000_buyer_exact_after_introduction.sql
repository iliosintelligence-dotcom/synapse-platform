-- EXACT ADDRESS AFTER INTRODUCTION (Eden, 2026-10-11): the public listing shows the street without
-- its house number and a pin rounded to about 100 m. A buyer who has actually been introduced to
-- the agency (they hold a lead on that property) gets the exact address and pin back, and only
-- they, and only for that property. Nothing is returned to anyone else.
create or replace function public.property_exact_for_me(p_property uuid)
returns table (address text, latitude double precision, longitude double precision)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then return; end if;
  return query
    select pp.address, pp.latitude, pp.longitude
      from property_private pp
     where pp.property_id = p_property
       and exists (select 1 from leads l
                    where l.property_id = p_property and l.consumer_id = auth.uid() and l.deleted_at is null);
end;
$$;
revoke all on function public.property_exact_for_me(uuid) from public, anon;
grant execute on function public.property_exact_for_me(uuid) to authenticated;
