-- An agency's website, from the moment it signs up (2026-10-02).
--
-- Eden: if an agency gives its website when it creates its account, a buyer
-- looking at its listings should be able to click through to it. The Brand
-- page already stores it (agencies.social ->> 'website') and the property
-- page's "Listed by" card now links it. Email sign-up creates the agency here,
-- in handle_new_user, from the sign-up metadata, so the website has to be read
-- here too (sign-ups through Google or a phone code create the agency through
-- provision_agency_for_current_user and save the website from the browser,
-- as the owner).
--
-- The website is the visitor's own typing, so it is checked: a bare domain
-- gets https://, and anything that is not a plain http(s) address of at most
-- 200 characters is DROPPED rather than refused -- a typo in an optional
-- field must never stop somebody signing up. They can fix it on the Brand
-- page.
--
-- Everything else is 0083's function unchanged.

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
  v_website     text;
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

    v_website := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'agency_website', '')), '');
    if v_website is not null then
      if v_website !~* '^[a-z][a-z0-9+.-]*:' then
        v_website := 'https://' || v_website;
      end if;
      if length(v_website) > 200 or v_website !~* '^https?://[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$' then
        v_website := null;
      end if;
    end if;

    insert into public.agencies (owner_id, name, city, social)
    values (
      new.id,
      -- Their own typed input only, never an invented brand:
      -- agency name → person's name → empty.
      coalesce(v_agency_name, nullif(trim(v_full_name), ''), ''),
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'city'), ''), ''),
      case when v_website is null then '{}'::jsonb
           else jsonb_build_object('website', v_website) end
    )
    returning id into v_agency_id;

    insert into public.agency_members (agency_id, profile_id, role)
    values (v_agency_id, new.id, 'agency_owner');
  end if;

  return new;
end;
$function$;
