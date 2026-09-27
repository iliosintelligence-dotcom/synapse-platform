-- An agent shares a listing with their own link.
--
-- THE SHARE KIT puts a listing, its photo and a caption into an agent's hands
-- for the places Synapse cannot post: their WhatsApp Status, the Facebook and
-- Telegram groups they are in, anywhere else they talk to buyers. Borrowed
-- audiences are where the reach is while no channel has followers of its own.
--
-- The link in that caption has to say WHO shared it, or the one question
-- worth asking afterwards -- whose shares produce leads? -- has no answer.
-- short_links already records created_by. What stopped it meaning anything
-- was the uniqueness rule: one manual link per (listing, channel, campaign),
-- so the first agent to share a listing on WhatsApp minted the link and every
-- colleague after them was handed the same token. Their visits were all
-- credited to whoever happened to be first.
--
-- So a manual link is now one per (listing, channel, campaign, PERSON).
-- Links minted by the system -- no signed-in caller, created_by NULL -- keep
-- exactly the old behaviour, since NULL coalesces to the same zero uuid on
-- both sides. Links bound to a social post are untouched: they key on the
-- post, not on anyone.

drop index if exists public.short_links_one_per_manual_share;
create unique index if not exists short_links_one_per_manual_share
  on public.short_links (property_id, channel,
                         coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
                         coalesce(created_by,  '00000000-0000-0000-0000-000000000000'::uuid))
  where social_post_id is null;

-- Reproduced from 0095 in full, because CREATE OR REPLACE takes the whole
-- body. One change, marked: the manual-share lookup also matches the caller,
-- so an agent is handed their own link and never a colleague's.
create or replace function public.create_short_link(
  p_property_id    uuid,
  p_channel        public.attribution_channel,
  p_social_post_id uuid default null,
  p_campaign_id    uuid default null
)
returns table (token text, url text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_agency uuid;
  v_token  text;
  v_base   text;
  v_target text;
  v_id     uuid;
begin
  select p.agency_id into v_agency
  from properties p
  where p.id = p_property_id and p.deleted_at is null;

  if v_agency is null then
    raise exception 'create_short_link: no such listing' using errcode = 'P0002';
  end if;

  -- The link speaks for the agency, so only the agency may mint it. Same test
  -- the social_posts policy uses, applied here because SECURITY DEFINER means
  -- RLS will not apply itself.
  if not (public.is_agency_member(v_agency) or public.is_platform_admin()) then
    raise exception 'create_short_link: not your listing' using errcode = '42501';
  end if;

  if p_social_post_id is not null then
    select sl.token, sl.target_url into v_token, v_target
    from short_links sl where sl.social_post_id = p_social_post_id;
  else
    select sl.token, sl.target_url into v_token, v_target
    from short_links sl
    where sl.social_post_id is null
      and sl.property_id = p_property_id
      and sl.channel = p_channel
      and coalesce(sl.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_campaign_id,  '00000000-0000-0000-0000-000000000000'::uuid)
      -- THE CHANGE: this caller's link, not the first one anybody minted.
      and coalesce(sl.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(auth.uid(),    '00000000-0000-0000-0000-000000000000'::uuid);
  end if;

  v_base := public.short_link_base();

  if v_token is not null then
    return query select v_token, v_base || '/s/' || v_token;
    return;
  end if;

  v_token := public.short_link_token(nextval('public.short_link_seq'));

  -- `post` carries OUR token rather than the platform's post id, which does
  -- not exist until after publishing and so cannot be baked into a link that
  -- has to be in the caption before it is sent. It also means click_events,
  -- channel_interactions and short_links all join on one key.
  v_target := v_base || '/app/property.html?id=' || p_property_id::text
              || '&ch=' || p_channel::text
              || '&post=' || v_token;

  insert into short_links (token, target_url, property_id, agency_id,
                           social_post_id, channel, campaign_id, created_by)
  values (v_token, v_target, p_property_id, v_agency,
          p_social_post_id, p_channel, p_campaign_id, auth.uid())
  returning id into v_id;

  return query select v_token, v_base || '/s/' || v_token;
end;
$function$;

revoke all on function public.create_short_link(uuid, public.attribution_channel, uuid, uuid)
  from public, anon;
grant execute on function public.create_short_link(uuid, public.attribution_channel, uuid, uuid)
  to authenticated;
