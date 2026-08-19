-- PRIVILEGE ESCALATION FIX.
-- handle_new_user() cast raw_user_meta_data->>'role' straight into
-- profiles.role. Signup metadata is entirely attacker-controlled, so anyone
-- could register with role "platform_admin". That was inert until this session,
-- when is_platform_admin() began reading profiles.role to grant verification
-- authority — at which point self-registering as platform_admin would have let
-- a stranger mark any listing on the platform as verified, and strip or award
-- trust scores. Audited before applying: the only platform_admin is the account
-- the founder designated. No exploitation.
--
-- Self-serve signup may now assert ONLY the two roles a stranger is entitled
-- to. Elevated roles (agent, agency_admin, platform_admin) must be granted
-- server-side or by invite — never asserted by the person being granted them.
--
-- The cast is also made total: an unrecognised or malformed role string falls
-- back to 'consumer' instead of raising and aborting the signup transaction,
-- which is the failure documented in app/auth.js where every signup 500'd.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  claimed text := new.raw_user_meta_data ->> 'role';
  granted user_role;
begin
  granted := case claimed
    when 'agency_owner' then 'agency_owner'::user_role
    when 'consumer'     then 'consumer'::user_role
    else 'consumer'::user_role      -- includes NULL, junk, and any elevated role
  end;

  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    granted,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$function$;

comment on function public.handle_new_user() is
  'Provisions public.profiles on signup. Only consumer and agency_owner may be self-asserted; every other value falls back to consumer. Elevated roles are granted out-of-band.';
