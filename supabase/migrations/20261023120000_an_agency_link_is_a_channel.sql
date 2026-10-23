-- AN AGENCY'S OWN LINK IS A CHANNEL (Eden, 2026-10-23).
--
-- Agencies put a link in their WhatsApp, Instagram and Facebook auto-replies. It opens Tayo, focused on that agency's homes, and
-- the arrival is recorded so a lead that follows is credited to the agency and the channel, the same way a tap on a post's short
-- link is. The link is  https://www.synapsecore.dev/t/<the agency's code>?ch=whatsapp  (instagram, facebook). The code is the
-- agency's existing unique referral_code, so nothing new has to be issued or kept in step.
--
-- 1. An arrival can belong to an agency without a particular home: channel_interactions.property_id may be null.
--    attribute_lead already copes (lead_attribution.property_id is nullable).
-- 2. agency_link(code): what the page needs to open the conversation (the agency's id and name). Public, read-only.
-- 3. record_agency_touch(agency, channel, visitor): the arrival, with the same 30-minute flood guard as record_channel_touch.
-- 4. my_agency_link(): the signed-in member's own agency code and name, for the portal's copy buttons.

alter table public.channel_interactions alter column property_id drop not null;

create or replace function public.agency_link(p_code text)
returns table (agency_id uuid, name text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select a.id, a.name
  from agencies a
  where a.deleted_at is null
    and p_code is not null
    and length(p_code) between 3 and 40
    and upper(a.referral_code) = upper(btrim(p_code))
  limit 1;
$function$;

create or replace function public.record_agency_touch(
  p_agency_id  uuid,
  p_channel    attribution_channel,
  p_session_id uuid,
  p_kind       text default 'autoreply'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id     uuid;
  v_recent int;
begin
  if p_session_id is null or p_agency_id is null then
    return null;
  end if;
  if not exists (select 1 from agencies where id = p_agency_id and deleted_at is null) then
    return null;
  end if;

  -- A visitor opening the same link twice in half an hour is one arrival, not two.
  select count(*) into v_recent
  from channel_interactions
  where session_id = p_session_id and agency_id = p_agency_id and property_id is null
    and channel = p_channel and occurred_at > now() - interval '30 minutes';
  if v_recent > 0 then
    return null;
  end if;

  insert into channel_interactions (property_id, agency_id, channel, post_id, session_id, kind)
  values (null, p_agency_id, p_channel, null, p_session_id, left(coalesce(p_kind, 'autoreply'), 40))
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.my_agency_link()
returns table (code text, name text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select a.referral_code, a.name
  from agency_members m
  join agencies a on a.id = m.agency_id and a.deleted_at is null
  where m.profile_id = auth.uid() and m.deleted_at is null
  order by m.created_at
  limit 1;
$function$;

-- Postgres grants EXECUTE to PUBLIC by default and anon inherits it, so PUBLIC is revoked first and each grant is deliberate.
revoke all on function public.agency_link(text) from public;
revoke all on function public.record_agency_touch(uuid, attribution_channel, uuid, text) from public;
revoke all on function public.my_agency_link() from public;
grant execute on function public.agency_link(text) to anon, authenticated;
grant execute on function public.record_agency_touch(uuid, attribution_channel, uuid, text) to anon, authenticated;
grant execute on function public.my_agency_link() to authenticated;
