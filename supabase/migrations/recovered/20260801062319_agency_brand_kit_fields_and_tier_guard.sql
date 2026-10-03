-- Brand kit. `logo_url`, `brand_color`, `description`, `specialties` and
-- `social` already existed; these are the rest of what a campaign generator
-- needs to render an agency's identity consistently.
alter table public.agencies
  add column if not exists brand_color_secondary text,
  add column if not exists brand_font            text,
  add column if not exists tagline               text,
  add column if not exists brand_voice           text,
  add column if not exists logo_dark_url         text;

comment on column public.agencies.brand_voice is
  'How this agency wants to sound in generated copy (e.g. "warm and plain-spoken"). Fed to the campaign generator.';

-- An agency could previously set its own verification_tier: the UPDATE policy
-- specified only USING, so Postgres reused it as the WITH CHECK, and nothing
-- stopped an owner writing 'gold' to their own row. That is the same
-- self-certification hole closed on properties — an agency may describe itself
-- freely, but may not award itself a trust tier.
create or replace function public.agencies_guard_tier()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or public.is_platform_admin() then
    return new;
  end if;
  if new.verification_tier is distinct from old.verification_tier then
    raise exception 'verification_tier is platform-owned and cannot be set by an agency'
      using errcode = '42501';
  end if;
  -- rating and closed_deals are computed from real activity, not self-reported
  new.rating       := old.rating;
  new.closed_deals := old.closed_deals;
  return new;
end;
$$;

drop trigger if exists agencies_guard_tier_trg on public.agencies;
create trigger agencies_guard_tier_trg
  before update on public.agencies
  for each row execute function public.agencies_guard_tier();
