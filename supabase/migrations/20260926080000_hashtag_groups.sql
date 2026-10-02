-- Hashtag groups: written once, reused.
--
-- A4 from docs/MARKETING_PAGE_FEATURE_MENU.md. An agency posting Lekki
-- listings types the same eight hashtags every time, slightly differently each
-- time -- #LekkiPhase1 today, #lekkiphase1 tomorrow, one of them missing on
-- Thursday. Mixpost calls these "hashtag groups" and they are the least
-- glamorous item on that menu and among the most used.
--
-- STORED WITHOUT THE HASH. '#Lekki' and 'Lekki' and '#lekki' are one tag, and
-- keeping the symbol would make them three. It goes back on at render, which
-- is also the only place it is needed.
--
-- LOWERCASED FOR UNIQUENESS, NOT FOR DISPLAY. Instagram treats #LekkiPhase1
-- and #lekkiphase1 as the same tag but shows what you typed, and an agency
-- that capitalises for readability should keep it. So the stored form is
-- whatever they wrote; only the duplicate check folds case.
--
-- THIRTY IS A REAL CEILING, not a style rule: Instagram refuses a post with
-- more than thirty hashtags outright rather than trimming. A group big enough
-- to break a post on its own is a trap, so it cannot be saved.
--
-- ANY MEMBER MANAGES THESE. Hashtags are content, not a credential -- the
-- same line drawn for connecting an account this morning, and the opposite of
-- the one drawn for comment auto-replies, which message strangers. An agent
-- who writes the captions should not need an admin to save eight words.

create table if not exists public.hashtag_groups (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 40),
  -- Without the leading '#', which is added at render.
  tags        text[] not null default '{}'
    check (cardinality(tags) between 1 and 30),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

comment on table public.hashtag_groups is
  'Named sets of hashtags an agency reuses. Stored without the leading #, '
  'which is added at render: #Lekki and Lekki are one tag and keeping the '
  'symbol would make them two.';
comment on column public.hashtag_groups.tags is
  'Capped at 30 because Instagram refuses a post over that outright rather '
  'than trimming -- a group that breaks a post on its own is a trap.';

-- One name per agency, case-folded: an agency with "Lekki" and "lekki" in the
-- picker is choosing between two things it cannot tell apart.
create unique index if not exists hashtag_groups_name
  on public.hashtag_groups (agency_id, lower(btrim(name)))
  where deleted_at is null;
create index if not exists hashtag_groups_agency
  on public.hashtag_groups (agency_id) where deleted_at is null;

create trigger hashtag_groups_updated_at before update on public.hashtag_groups
  for each row execute function set_updated_at();

alter table public.hashtag_groups enable row level security;

drop policy if exists hashtag_groups_rw on public.hashtag_groups;
create policy hashtag_groups_rw on public.hashtag_groups
  for all using (public.is_agency_member(agency_id))
  with check (public.is_agency_member(agency_id));

revoke all on public.hashtag_groups from public, anon;
grant select, insert, update on public.hashtag_groups to authenticated;
grant all on public.hashtag_groups to service_role;


-- ── saving one ───────────────────────────────────────────────────────────
--
-- A function rather than a plain insert, for the normalising. Doing it in the
-- browser would mean the rules live in one place and are enforced in none:
-- a second caller, or somebody with a REST client, writes '#Lekki' and the
-- picker quietly gains a duplicate nobody can distinguish.
create or replace function public.save_hashtag_group(
  p_name text,
  p_tags text[],
  p_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_agency uuid;
  v_tags   text[];
  v_id     uuid;
begin
  select agency_id into v_agency from agency_members
   where profile_id = auth.uid() and deleted_at is null limit 1;
  if v_agency is null then
    raise exception 'You are not a member of an agency' using errcode = 'insufficient_privilege';
  end if;

  /* Strip the hash, drop anything left empty, fold duplicates case-
     insensitively while keeping the first spelling the agency used. Also
     strips whatever a paste from a caption brings with it -- commas, stray
     punctuation -- because the common way to build one of these is to copy a
     line of tags that already worked. */
  select coalesce(array_agg(t order by ord), '{}') into v_tags
  from (
    select distinct on (lower(t)) t, ord
    from (
      select regexp_replace(btrim(x), '^#+', '') as t, ord
      from unnest(coalesce(p_tags, '{}')) with ordinality as u(x, ord)
    ) cleaned
    where t <> '' and t ~ '^[[:alnum:]_]+$'
    order by lower(t), ord
  ) uniq;

  if cardinality(v_tags) = 0 then
    raise exception 'No usable hashtags in that group'
      using errcode = 'invalid_parameter_value';
  end if;
  if cardinality(v_tags) > 30 then
    raise exception 'A group can hold 30 hashtags; that is %', cardinality(v_tags)
      using errcode = 'check_violation',
            hint = 'Instagram refuses a post with more than 30.';
  end if;

  if p_id is not null then
    update hashtag_groups
       set name = btrim(p_name), tags = v_tags
     where id = p_id and agency_id = v_agency and deleted_at is null
    returning id into v_id;
    if v_id is null then
      raise exception 'No such group' using errcode = 'no_data_found';
    end if;
    return v_id;
  end if;

  insert into hashtag_groups (agency_id, name, tags, created_by)
  values (v_agency, btrim(p_name), v_tags, auth.uid())
  /* Saving over a name that exists is what somebody means by saving a group
     twice -- they are updating it, not being told off. */
  on conflict (agency_id, lower(btrim(name))) where deleted_at is null
  do update set tags = excluded.tags, updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

comment on function public.save_hashtag_group(text, text[], uuid) is
  'Saves or updates a hashtag group, normalising the tags: strips the #, '
  'drops punctuation, folds duplicates case-insensitively keeping the first '
  'spelling. Normalising here rather than in the browser so a second caller '
  'cannot quietly add a duplicate nobody can tell apart.';

revoke all on function public.save_hashtag_group(text, text[], uuid) from public, anon;
grant execute on function public.save_hashtag_group(text, text[], uuid) to authenticated, service_role;
