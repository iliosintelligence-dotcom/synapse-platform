-- A 14-day free trial, then read-only until the agency pays.
--
-- DECISION (the client, 2026-11-18): "make it available for 14 days but after 14 days, make it unavailable and the paid
-- would be available instead of the free plan". Confirmed:
--   * during the trial an agency gets EVERYTHING (the paywall does not apply to it at all);
--   * after it, unpaid = READ-ONLY: it can sign in and see everything and its listings stay live, but it cannot add
--     listings, add team members, queue posts, or use paid features until it pays;
--   * the agencies already here get 14 days from today, not from their sign-up.
--
-- HOW. Nothing new is built: paywall_applies() has always been "paywall on, and the agency's free period over", and
-- agency_free_until() is that free period. It returned null since 20261003220000 (no grace). It now returns the later of
-- the agency's sign-up and the trial's start, plus trial_days (14), both kept in platform_settings 'paywall_enabled'.
-- An agency inside its 14 days is therefore not under the paywall at all, which is "everything".
--
-- After the trial an unpaid agency's effective tier is 'free', and Free now means read-only: the limit triggers refuse
-- new listings and seats outright (listing packs do not apply to it), and a new trigger refuses new social posts.
-- Paid plans are unchanged. A paid plan that lapses is read-only from that moment (no grace, as before). Synapse's
-- feature grants still count: an agency granted syndication may still post.
--
-- Undo:
--   create or replace function agency_free_until(p_agency_id uuid) returns timestamptz language sql stable
--     security definer set search_path = public as $$ select null::timestamptz; $$;
--   drop trigger if exists social_posts_trial_ended on social_posts; drop function if exists enforce_trial_posting();
--   (and restore enforce_listing_limit / enforce_seat_limit from 20261003120000 / 20261003140000)

update platform_settings
   set value = value || jsonb_build_object('trial_days', 14, 'trial_from', now()), updated_at = now()
 where key = 'paywall_enabled' and jsonb_typeof(value) = 'object';

create or replace function agency_free_until(p_agency_id uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select greatest(a.created_at, (s.value->>'trial_from')::timestamptz)
         + make_interval(days => coalesce((s.value->>'trial_days')::int, 14))
    from agencies a, platform_settings s
   where a.id = p_agency_id and s.key = 'paywall_enabled' and s.value ? 'trial_from';
$$;

/* The message every refusal after the trial shares; the portal's plan gate matches "free trial has ended". */
create or replace function trial_ended_message(p_what text)
returns text language sql immutable as $$
  select 'Your free trial has ended. Choose a plan to ' || p_what || '. Your listings stay live.';
$$;

create or replace function enforce_listing_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tier subscription_tier; v_max integer; v_used integer;
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.is_active is not true then return new; end if;
  if not paywall_applies(new.agency_id) then return new; end if;

  v_tier := agency_effective_tier(new.agency_id);
  if v_tier is null then return new; end if;
  /* Free is the trial run out: read-only, whatever packs it holds. */
  if v_tier = 'free' then
    raise exception '%', trial_ended_message('add listings')
      using errcode = 'check_violation', hint = 'Subscription in the portal shows each plan.';
  end if;
  v_max := agency_listings_max(new.agency_id);
  if v_max is null then return new; end if;

  select count(*) into v_used from properties
   where agency_id = new.agency_id and deleted_at is null and is_active and id <> new.id;

  if v_used >= v_max then
    raise exception
      'Your % plan includes % active listings and you have %. Upgrade, add a listing pack, or archive one to make room.',
      v_tier, v_max, v_used
      using errcode = 'check_violation',
            hint = 'Billing in the portal sells listing packs; Subscription shows what each plan includes.';
  end if;
  return new;
end;
$$;

create or replace function enforce_seat_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tier subscription_tier; v_max integer; v_used integer;
begin
  if auth.role() = 'service_role' then return new; end if;
  if not paywall_applies(new.agency_id) then return new; end if;

  v_tier := agency_effective_tier(new.agency_id);
  if v_tier is null then return new; end if;
  if v_tier = 'free' then
    raise exception '%', trial_ended_message('add team members')
      using errcode = 'check_violation', hint = 'Subscription in the portal shows each plan.';
  end if;
  select max_seats into v_max from plan_limits(v_tier);
  if v_max is null then return new; end if;

  select count(*) into v_used from agency_members
   where agency_id = new.agency_id and deleted_at is null and profile_id <> new.profile_id;

  if v_used >= v_max then
    raise exception
      'Your % plan includes % team seats and you have %. Upgrade to add more.',
      v_tier, v_max, v_used
      using errcode = 'check_violation',
            hint = 'Subscription in the portal shows what each plan includes.';
  end if;
  return new;
end;
$$;

/* New posts of any kind, on Synapse's channels or the agency's own, need a plan once the trial is over. Posts already
   queued are left to go out; editing or cancelling one is not refused. */
create or replace function enforce_trial_posting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.agency_id is null then return new; end if;
  if not paywall_applies(new.agency_id) then return new; end if;
  if agency_effective_tier(new.agency_id) = 'free' and not agency_can(new.agency_id, 'syndication') then
    raise exception '%', trial_ended_message('keep posting')
      using errcode = 'check_violation', hint = 'Subscription in the portal shows each plan.';
  end if;
  return new;
end;
$$;

drop trigger if exists social_posts_trial_ended on social_posts;
create trigger social_posts_trial_ended before insert on social_posts
  for each row execute function enforce_trial_posting();

revoke all on function agency_free_until(uuid) from public, anon, authenticated;
grant execute on function agency_free_until(uuid) to service_role;
revoke all on function enforce_trial_posting() from public, anon, authenticated;
