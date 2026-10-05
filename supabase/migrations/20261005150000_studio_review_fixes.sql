-- Greptile's review of the Synapse studio (PR 22), the real findings.
--
-- 1. A post stuck in 'publishing' was reclaimed after ten minutes, which
--    creates a SECOND draft in TryPost and a duplicate public post if the
--    first one did go out. A stuck post is now never sent again: it is marked
--    failed with a plain "not confirmed" reason, and staff check TryPost
--    before sending it again. The same sweep closes a post a worker kept
--    dying on, which used to sit in 'publishing' forever once its attempts
--    ran out.
-- 2. The delivery check always asked after the same oldest 25 posts and gave
--    up after three days. It now asks after the one checked longest ago
--    first, and keeps asking for 30 days, as the listing posts' checker does.
-- 3. An account already registered as one of the original Synapse channels
--    could also be added as a studio channel, so a mirrored listing went out
--    twice on the same TryPost account. The database now refuses it.

alter table synapse_posts add column if not exists checked_at timestamptz;

create or replace function claim_synapse_posts(p_limit integer default 10)
returns setof synapse_posts language plpgsql security definer set search_path = public as $$
begin
  /* Anything that has been 'publishing' for ten minutes is of unknown
     outcome. Not resent: asked about, by a person. */
  update synapse_posts
     set status = 'failed',
         failure_reason = 'Not confirmed: the studio stopped while sending this. It may have gone out. Check TryPost before sending it again.',
         updated_at = now()
   where status = 'publishing' and updated_at < now() - interval '10 minutes';

  return query
  update synapse_posts o
     set status = 'publishing', attempts = o.attempts + 1, updated_at = now()
   where o.id in (
     select id from synapse_posts
      where status = 'scheduled' and scheduled_at <= now() and attempts < 3
      order by scheduled_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 10), 25)))
  returning o.*;
end;
$$;
revoke all on function claim_synapse_posts(integer) from public, anon, authenticated;
grant execute on function claim_synapse_posts(integer) to service_role;

create or replace function drain_synapse_posts()
returns integer language plpgsql security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp' as $$
declare v_key text; v_url text; v_due integer;
begin
  select count(*) into v_due from synapse_posts
   where (status = 'scheduled' and scheduled_at <= now() and attempts < 3)
      or (status = 'publishing' and updated_at < now() - interval '10 minutes');
  if v_due = 0 then return 0; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if v_key is null or v_url is null then
    raise warning 'drain_synapse_posts: service_role_key or project_url missing from vault';
    return 0;
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/synapse-studio',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('action', 'publish_due'),
    timeout_milliseconds := 120000);
  return v_due;
end;
$$;
revoke all on function drain_synapse_posts() from public, anon, authenticated;

create or replace function confirm_synapse_posts()
returns integer language plpgsql security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp' as $$
declare v_key text; v_url text; v_n integer;
begin
  select count(*) into v_n from synapse_posts
   where status = 'sent' and sent_at > now() - interval '30 days';
  if v_n = 0 then return 0; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if v_key is null or v_url is null then return 0; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/synapse-studio',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('action', 'confirm_delivery'),
    timeout_milliseconds := 60000);
  return v_n;
end;
$$;
revoke all on function confirm_synapse_posts() from public, anon, authenticated;

-- ── 3 ─────────────────────────────────────────────────────────────────────
create or replace function city_channels_not_legacy()
returns trigger language plpgsql as $$
begin
  if new.trypost_account_id is not null
     and exists (select 1 from synapse_channels s where s.trypost_account_id = new.trypost_account_id) then
    raise exception 'That account is already one of the original Synapse channels.' using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists city_channels_not_legacy on city_channels;
create trigger city_channels_not_legacy
  before insert or update of trypost_account_id on city_channels
  for each row execute function city_channels_not_legacy();
