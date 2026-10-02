-- Nothing ever wrote profiles.phone.
--
-- handle_new_user inserted (id, role, full_name) and stopped there, so every
-- one of the 68 accounts on this project had phone = NULL -- including anyone
-- who signed up BY phone, where auth.users.phone was set and simply not
-- carried across. A Toju handoff goes to a person's WhatsApp, so with no
-- number on any profile there was nobody to hand a lead to: all five live
-- leads resolved to "nobody reachable".
--
-- Two sources, in order of trust: the number they verified a code on
-- (new.phone), then the one they typed at signup (metadata). Both are
-- normalised HERE as well as in the browser, because a value that arrives
-- from a client is a value someone can send by hand.

create or replace function public.normalise_ng_phone(raw text)
returns text
language sql
immutable
set search_path to 'pg_temp'
as $function$
  -- Same rules as auth.js and send-outbox, so the number that receives a
  -- handoff is the same number that could sign the person in.
  select case
    when d = '' then null
    when left(d, 1) = '+' then d
    when left(d, 3) = '234' then '+' || d
    when left(d, 1) = '0' then '+234' || substr(d, 2)
    when length(d) = 10 then '+234' || d
    else '+' || d
  end
  from (select regexp_replace(coalesce(raw, ''), '[^0-9+]', '', 'g') as d) t;
$function$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  claimed       text := new.raw_user_meta_data ->> 'role';
  v_role        user_role;
  v_full_name   text;
  v_phone       text;
  v_agency_name text;
  v_agency_id   uuid;
begin
  -- Total by construction: no cast that can raise, no value that can escalate.
  v_role := case claimed
    when 'agency_owner' then 'agency_owner'::user_role
    when 'consumer'     then 'consumer'::user_role
    else 'consumer'::user_role
  end;

  v_full_name := coalesce(new.raw_user_meta_data ->> 'full_name', '');

  -- The verified number first: a code was sent to it and answered.
  v_phone := public.normalise_ng_phone(
    coalesce(nullif(btrim(new.phone), ''),
             nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''))
  );

  insert into public.profiles (id, role, full_name, phone)
  values (new.id, v_role, v_full_name, v_phone);

  if v_role = 'agency_owner' then
    v_agency_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'agency_name', '')), '');

    insert into public.agencies (owner_id, name, city)
    values (
      new.id,
      -- Their own typed input only, never an invented brand:
      -- agency name → person's name → empty.
      coalesce(v_agency_name, nullif(trim(v_full_name), ''), ''),
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'city'), ''), '')
    )
    returning id into v_agency_id;

    insert into public.agency_members (agency_id, profile_id, role)
    values (v_agency_id, new.id, 'agency_owner');
  end if;

  return new;
end;
$function$;
