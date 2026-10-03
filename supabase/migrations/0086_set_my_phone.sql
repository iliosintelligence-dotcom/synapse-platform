-- Lets a person put their own number on file from the portal.
--
-- profiles_update_own already allows the write, so this is not about
-- permission -- it is about the number being normalised by the SAME rule
-- everywhere. Registration normalises in handle_new_user (0083); doing it in
-- the browser only would mean a number typed at signup and a number typed in
-- the portal could be stored in two different shapes, and send-outbox would
-- treat them as two different people.
--
-- Exists because registration cannot fix the accounts that already exist: as
-- of 2026-09-06 none of the 41 agency members had a number, so every lead
-- resolved to nobody reachable.
create or replace function public.set_my_phone(p_phone text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_phone text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  v_phone := public.normalise_ng_phone(p_phone);

  -- Clearing it is allowed and is a real choice; a wrong number is worse
  -- than none, because a handoff sent to it looks delivered.
  if v_phone is null then
    update profiles set phone = null where id = auth.uid();
    return null;
  end if;

  -- E.164: a plus and 10-15 digits. Catches a half-typed number here rather
  -- than at the provider, days later, as an undelivered handoff.
  if v_phone !~ '^\+[0-9]{10,15}$' then
    raise exception 'That does not look like a complete phone number'
      using errcode = 'invalid_parameter_value';
  end if;

  update profiles set phone = v_phone where id = auth.uid();
  return v_phone;
end;
$function$;

revoke all on function public.set_my_phone(text) from public;
revoke all on function public.set_my_phone(text) from anon;
grant execute on function public.set_my_phone(text) to authenticated;
