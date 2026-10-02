-- A log of who arrives, and who goes on to register.
--
-- Eden: "I want to know every single time a user creates a new account [...]
-- That way we can keep a log of how many people actually come into the app
-- from social media or from other pages, and how many people are going on to
-- register on the platform."
--
-- Two things are being asked for and only one of them is the notification.
-- The durable half is the LOG: arrivals by source, registrations, and the rate
-- between them. Everything this product does upstream -- posts, short links,
-- comment replies, Telegram buttons -- is spent trying to move that one
-- number, and nothing has ever counted it.
--
-- ── what already existed and why it did not answer ───────────────────────
--
--   short_links / click_events   counts taps, per post. Says a link was
--                                followed, not that a person arrived and
--                                stayed.
--   channel_interactions         per PROPERTY and per AGENCY. It answers
--                                "how did this listing get found", which is
--                                the agency's question, not ours.
--   profiles.created_at          registrations, with no idea where anybody
--                                came from.
--
-- The funnel needs one row per PERSON at each of two moments, carrying where
-- they came from. That is what this table is, and it is deliberately not a
-- view over the three above: a view would inherit their agency scoping and
-- answer a different question convincingly.
--
-- ── this is analytics about people, so it is minimised ──────────────────
--
-- No name, no email, no IP, no user agent. A visitor id, a profile id once
-- there is one, and a source label. The join between the two is the whole
-- point -- it is what turns "400 arrivals and 12 signups" into "the Telegram
-- posts convert and the Instagram ones do not" -- and nothing beyond it is
-- needed for that.
--
-- Retention: 24 months. Long enough for a year-on-year comparison, and this
-- is the thinnest personal data in the system. The purge ships with it, like
-- social_comments; R-06 stays open for the older tables.

create table if not exists public.growth_events (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('arrived', 'registered')),
  -- The browser's own id, which is how somebody is recognised before they
  -- have an account. Text, matching the other visitor_id columns.
  visitor_id  text,
  profile_id  uuid references public.profiles (id) on delete set null,
  -- 'instagram', 'telegram', 'facebook', 'direct'... Free text rather than
  -- the attribution_channel enum: this records where a PERSON came from,
  -- which includes routes that are not advertising channels, and an enum
  -- would force every new one through a migration.
  source      text,
  -- The short link that carried them, when there was one. It is the join back
  -- to the exact post, so "which post produced a registration" is answerable
  -- rather than only "which platform did".
  link_token  text,
  landing     text,
  created_at  timestamptz not null default now(),
  -- Set once the alert has gone out. NULL means nobody has been told.
  notified_at timestamptz
);

comment on table public.growth_events is
  'One row per person per milestone: arrived, then registered. The funnel '
  'every post and every link is trying to move. Minimised deliberately -- a '
  'visitor id, a profile id, a source, and nothing that identifies anybody.';

-- Somebody is counted as arriving ONCE. A returning visitor is not a new
-- arrival, and a funnel that counts them again reports growth that did not
-- happen.
create unique index if not exists growth_events_one_arrival
  on public.growth_events (visitor_id) where kind = 'arrived' and visitor_id is not null;
create unique index if not exists growth_events_one_registration
  on public.growth_events (profile_id) where kind = 'registered' and profile_id is not null;
create index if not exists growth_events_unsent
  on public.growth_events (created_at) where notified_at is null;
create index if not exists growth_events_reporting
  on public.growth_events (kind, created_at desc);

alter table public.growth_events enable row level security;
-- No policy at all: this is ours, not an agency's, and nothing in either app
-- should be able to read the whole platform's funnel.
revoke all on public.growth_events from public, anon, authenticated;
grant all on public.growth_events to service_role;


-- ── recording an arrival ─────────────────────────────────────────────────
--
-- Called by the edge functions a first-time visitor actually touches. ON
-- CONFLICT DO NOTHING rather than a lookup first: two tabs opening at once is
-- ordinary, and a check-then-insert would let both through.
create or replace function public.record_arrival(
  p_visitor_id text,
  p_source     text default null,
  p_link_token text default null,
  p_landing    text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_visitor_id is null or btrim(p_visitor_id) = '' then
    return;   -- nothing to count, and not an error worth failing a chat over
  end if;
  insert into growth_events (kind, visitor_id, source, link_token, landing)
  values ('arrived', btrim(p_visitor_id),
          nullif(btrim(coalesce(p_source, '')), ''),
          nullif(btrim(coalesce(p_link_token, '')), ''),
          nullif(btrim(coalesce(p_landing, '')), ''))
  on conflict do nothing;
end;
$function$;

revoke all on function public.record_arrival(text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_arrival(text, text, text, text) to service_role;


-- ── recording a registration ─────────────────────────────────────────────
--
-- A TRIGGER, not a call from the sign-up screen. Registration happens in
-- Supabase Auth and lands in profiles by whatever route -- email, a social
-- login, an invite, a future passkey flow -- and a counter wired into one of
-- those screens would silently miss the others. The row appearing IS the
-- event.
create or replace function public.log_registration()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_visitor text;
  v_source  text;
begin
  /* CARRY THE ARRIVAL'S SOURCE ACROSS, which is the entire value of this
     table. Without it a registration is a number; with it, it is "somebody
     who came from the Telegram post three days ago just signed up".

     Matched on the visitor id the browser has been carrying since before
     there was an account. NULL when we never saw them arrive -- somebody who
     went straight to the sign-up page, or cleared their storage -- and NULL
     is the honest answer there rather than 'direct', which would be a guess
     dressed as a fact. */
  begin
    select ge.visitor_id, ge.source into v_visitor, v_source
      from growth_events ge
     where ge.kind = 'arrived'
       and ge.visitor_id is not null
       and ge.visitor_id = nullif(btrim(coalesce(new.visitor_id::text, '')), '')
     limit 1;
  exception when undefined_column then
    /* profiles has no visitor_id column today. The lookup is written so it
       starts working the moment one is added, and costs nothing until then. */
    v_visitor := null; v_source := null;
  end;

  insert into growth_events (kind, profile_id, visitor_id, source)
  values ('registered', new.id, v_visitor, v_source)
  on conflict do nothing;
  return new;
end;
$function$;

drop trigger if exists profiles_log_registration on public.profiles;
create trigger profiles_log_registration
  after insert on public.profiles
  for each row execute function public.log_registration();


-- ── the number all of this exists to move ────────────────────────────────
create or replace function public.growth_funnel(p_days integer default 30)
returns table (source text, arrivals bigint, registrations bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    coalesce(a.source, 'unknown') as source,
    count(*) filter (where a.kind = 'arrived')     as arrivals,
    count(*) filter (where a.kind = 'registered')  as registrations
  from growth_events a
  where a.created_at > now() - make_interval(days => greatest(1, coalesce(p_days, 30)))
  group by coalesce(a.source, 'unknown')
  order by 2 desc;
$function$;

comment on function public.growth_funnel(integer) is
  'Arrivals and registrations by source. The conversion this product exists '
  'to move: every post, short link and Telegram button is an attempt to '
  'change one row of this.';

revoke all on function public.growth_funnel(integer) from public, anon, authenticated;
grant execute on function public.growth_funnel(integer) to service_role;


-- ── telling somebody ─────────────────────────────────────────────────────
--
-- Through the Telegram bot built this afternoon, because it is the only
-- channel here that reaches a person reliably today: Twilio has never
-- delivered, there is no mail sender, and web push needs a subscription
-- nobody has made. The bot already exists and a chat id is one message to it.
--
-- OFF UNTIL A CHAT ID IS SET. No row, no alerts, and the drain costs nothing.
insert into platform_settings (key, value, note) values (
  'founder_telegram_chat_id',
  '{"id": ""}'::jsonb,
  'Where founder alerts go. Message the Synapse bot from the account that '
  'should receive them, then put that chat id here. Empty means no alerts are '
  'sent -- the events are still logged, which is the durable half.'
) on conflict (key) do nothing;

create or replace function public.drain_growth_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $function$
declare
  v_key text; v_url text; v_due integer; v_chat text;
begin
  select coalesce(value->>'id', '') into v_chat
    from platform_settings where key = 'founder_telegram_chat_id';
  if coalesce(v_chat, '') = '' then
    return 0;   -- nobody to tell; the events stay logged
  end if;

  select count(*) into v_due from growth_events where notified_at is null;
  if v_due = 0 then return 0; end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  if v_key is null or v_url is null then
    raise warning 'drain_growth_alerts: service_role_key or project_url missing from vault';
    return 0;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/founder-alert',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('limit', 25),
    timeout_milliseconds := 60000
  );
  return v_due;
end;
$function$;

revoke all on function public.drain_growth_alerts() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('drain-growth-alerts');
exception when others then null;
end $$;

-- Every two minutes. A signup is the most interesting thing that happens on
-- this platform and "somebody just joined" is worth knowing while it is still
-- true. It idles free: no chat id or no unsent rows and no request is made.
select cron.schedule(
  'drain-growth-alerts',
  '*/2 * * * *',
  $$select public.drain_growth_alerts()$$
);


-- ── retention ────────────────────────────────────────────────────────────
create or replace function public.purge_growth_events()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer;
begin
  delete from growth_events where created_at < now() - interval '24 months';
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.purge_growth_events() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('purge-growth-events');
exception when others then null;
end $$;

select cron.schedule('purge-growth-events', '40 3 * * *',
  $$select public.purge_growth_events()$$);
