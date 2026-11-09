-- Owner / Manager / Editor / Viewer (contract: team permissions).
--
-- The roles already exist under other names: agency_owner = Owner, agency_admin = Manager, agent = Editor. This adds
-- Viewer (agency_viewer): a member who can see everything their role's screens show and change nothing.
--
-- HOW: every database rule and function that allowed a WRITE to "any member of the agency" (is_agency_member) now
-- asks agency_can_edit, which is any member except a Viewer. Reads are untouched: a policy that covered all commands
-- is split into a read policy with its original condition and a write policy with the edit condition. The rules and
-- functions below are the exact definitions read from the database on 2026-11-09 with only that one call swapped.
-- Functions that already name the roles allowed to act (queue_social_post, cancel/retry/discard_social_post, ...)
-- already exclude a Viewer and are not touched.

begin;

alter table public.agency_members drop constraint if exists agency_members_role_check;
alter table public.agency_members add constraint agency_members_role_check
  check (role = any (array['agent'::user_role, 'agency_admin'::user_role, 'agency_owner'::user_role, 'agency_viewer'::user_role]));

create or replace function public.agency_can_edit(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from agency_members
     where agency_id = p_agency_id
       and profile_id = auth.uid()
       and deleted_at is null
       and role in ('agent', 'agency_admin', 'agency_owner')
  );
$$;

comment on function public.agency_can_edit(uuid) is
  'Signed-in user is a member of this agency who may change things: Owner, Manager (agency_admin) or Editor (agent). Not a Viewer.';

revoke all on function public.agency_can_edit(uuid) from public;
grant execute on function public.agency_can_edit(uuid) to anon, authenticated, service_role;

-- ── rules (row-level security) ────────────────────────────────────────────────────────────────────────────────

-- public.agent_availability: availability_agency (ALL)
drop policy if exists "availability_agency" on "public"."agent_availability";
create policy "availability_agency" on "public"."agent_availability" as PERMISSIVE for SELECT to public using (is_agency_member(agency_id));
drop policy if exists "availability_agency_write" on "public"."agent_availability";
create policy "availability_agency_insert" on "public"."agent_availability" as PERMISSIVE for INSERT to public with check (agency_can_edit(agency_id));
create policy "availability_agency_update" on "public"."agent_availability" as PERMISSIVE for UPDATE to public using (agency_can_edit(agency_id)) with check (agency_can_edit(agency_id));
create policy "availability_agency_delete" on "public"."agent_availability" as PERMISSIVE for DELETE to public using (agency_can_edit(agency_id));

-- public.campaign_suggestions: campaign_suggestions_update (UPDATE)
drop policy if exists "campaign_suggestions_update" on "public"."campaign_suggestions";
create policy "campaign_suggestions_update" on "public"."campaign_suggestions" as PERMISSIVE for UPDATE to public using (agency_can_edit(agency_id)) with check (agency_can_edit(agency_id));

-- public.content_templates: content_templates_write (ALL)
drop policy if exists "content_templates_write" on "public"."content_templates";
create policy "content_templates_write" on "public"."content_templates" as PERMISSIVE for SELECT to public using (((agency_id IS NOT NULL) AND is_agency_member(agency_id)));
drop policy if exists "content_templates_write_write" on "public"."content_templates";
create policy "content_templates_write_insert" on "public"."content_templates" as PERMISSIVE for INSERT to public with check (((agency_id IS NOT NULL) AND agency_can_edit(agency_id)));
create policy "content_templates_write_update" on "public"."content_templates" as PERMISSIVE for UPDATE to public using (((agency_id IS NOT NULL) AND agency_can_edit(agency_id))) with check (((agency_id IS NOT NULL) AND agency_can_edit(agency_id)));
create policy "content_templates_write_delete" on "public"."content_templates" as PERMISSIVE for DELETE to public using (((agency_id IS NOT NULL) AND agency_can_edit(agency_id)));

-- public.deal_rooms: deal_rooms_write_agency (ALL)
drop policy if exists "deal_rooms_write_agency" on "public"."deal_rooms";
create policy "deal_rooms_write_agency" on "public"."deal_rooms" as PERMISSIVE for SELECT to public using (((agent_id = auth.uid()) OR (agency_role(agency_id) = ANY (ARRAY['agency_admin'::user_role, 'agency_owner'::user_role]))));
drop policy if exists "deal_rooms_write_agency_write" on "public"."deal_rooms";
create policy "deal_rooms_write_agency_insert" on "public"."deal_rooms" as PERMISSIVE for INSERT to public with check (agency_can_edit(agency_id));
create policy "deal_rooms_write_agency_update" on "public"."deal_rooms" as PERMISSIVE for UPDATE to public using (((agent_id = auth.uid()) OR (agency_role(agency_id) = ANY (ARRAY['agency_admin'::user_role, 'agency_owner'::user_role])))) with check (agency_can_edit(agency_id));
create policy "deal_rooms_write_agency_delete" on "public"."deal_rooms" as PERMISSIVE for DELETE to public using (((agent_id = auth.uid()) OR (agency_role(agency_id) = ANY (ARRAY['agency_admin'::user_role, 'agency_owner'::user_role]))));

-- public.generated_content: generated_content_rw (ALL)
drop policy if exists "generated_content_rw" on "public"."generated_content";
create policy "generated_content_rw" on "public"."generated_content" as PERMISSIVE for SELECT to public using (is_agency_member(agency_id));
drop policy if exists "generated_content_rw_write" on "public"."generated_content";
create policy "generated_content_rw_insert" on "public"."generated_content" as PERMISSIVE for INSERT to public with check (agency_can_edit(agency_id));
create policy "generated_content_rw_update" on "public"."generated_content" as PERMISSIVE for UPDATE to public using (agency_can_edit(agency_id)) with check (agency_can_edit(agency_id));
create policy "generated_content_rw_delete" on "public"."generated_content" as PERMISSIVE for DELETE to public using (agency_can_edit(agency_id));

-- public.geofences: geofences_rw (ALL)
drop policy if exists "geofences_rw" on "public"."geofences";
create policy "geofences_rw" on "public"."geofences" as PERMISSIVE for SELECT to public using (is_agency_member(agency_id));
drop policy if exists "geofences_rw_write" on "public"."geofences";
create policy "geofences_rw_insert" on "public"."geofences" as PERMISSIVE for INSERT to public with check (agency_can_edit(agency_id));
create policy "geofences_rw_update" on "public"."geofences" as PERMISSIVE for UPDATE to public using (agency_can_edit(agency_id)) with check (agency_can_edit(agency_id));
create policy "geofences_rw_delete" on "public"."geofences" as PERMISSIVE for DELETE to public using (agency_can_edit(agency_id));

-- public.hashtag_groups: hashtag_groups_rw (ALL)
drop policy if exists "hashtag_groups_rw" on "public"."hashtag_groups";
create policy "hashtag_groups_rw" on "public"."hashtag_groups" as PERMISSIVE for SELECT to public using (is_agency_member(agency_id));
drop policy if exists "hashtag_groups_rw_write" on "public"."hashtag_groups";
create policy "hashtag_groups_rw_insert" on "public"."hashtag_groups" as PERMISSIVE for INSERT to public with check (agency_can_edit(agency_id));
create policy "hashtag_groups_rw_update" on "public"."hashtag_groups" as PERMISSIVE for UPDATE to public using (agency_can_edit(agency_id)) with check (agency_can_edit(agency_id));
create policy "hashtag_groups_rw_delete" on "public"."hashtag_groups" as PERMISSIVE for DELETE to public using (agency_can_edit(agency_id));

-- public.inspection_slots: slots_agency_manage (ALL)
drop policy if exists "slots_agency_manage" on "public"."inspection_slots";
create policy "slots_agency_manage" on "public"."inspection_slots" as PERMISSIVE for SELECT to public using (is_agency_member(agency_id));
drop policy if exists "slots_agency_manage_write" on "public"."inspection_slots";
create policy "slots_agency_manage_insert" on "public"."inspection_slots" as PERMISSIVE for INSERT to public with check (agency_can_edit(agency_id));
create policy "slots_agency_manage_update" on "public"."inspection_slots" as PERMISSIVE for UPDATE to public using (agency_can_edit(agency_id)) with check (agency_can_edit(agency_id));
create policy "slots_agency_manage_delete" on "public"."inspection_slots" as PERMISSIVE for DELETE to public using (agency_can_edit(agency_id));

-- public.leads: leads_update_agency (UPDATE)
drop policy if exists "leads_update_agency" on "public"."leads";
create policy "leads_update_agency" on "public"."leads" as PERMISSIVE for UPDATE to authenticated using (((deleted_at IS NULL) AND agency_can_edit(agency_id))) with check (agency_can_edit(agency_id));

-- public.listing_drafts: listing_drafts_member_all (ALL)
drop policy if exists "listing_drafts_member_all" on "public"."listing_drafts";
create policy "listing_drafts_member_all" on "public"."listing_drafts" as PERMISSIVE for SELECT to authenticated using (is_agency_member(agency_id));
drop policy if exists "listing_drafts_member_all_write" on "public"."listing_drafts";
create policy "listing_drafts_member_all_insert" on "public"."listing_drafts" as PERMISSIVE for INSERT to authenticated with check ((agency_can_edit(agency_id) AND (created_by = auth.uid())));
create policy "listing_drafts_member_all_update" on "public"."listing_drafts" as PERMISSIVE for UPDATE to authenticated using (agency_can_edit(agency_id)) with check ((agency_can_edit(agency_id) AND (created_by = auth.uid())));
create policy "listing_drafts_member_all_delete" on "public"."listing_drafts" as PERMISSIVE for DELETE to authenticated using (agency_can_edit(agency_id));

-- public.message_outbox: message_outbox_cancel (UPDATE)
drop policy if exists "message_outbox_cancel" on "public"."message_outbox";
create policy "message_outbox_cancel" on "public"."message_outbox" as PERMISSIVE for UPDATE to authenticated using (((deleted_at IS NULL) AND agency_can_edit(agency_id))) with check (agency_can_edit(agency_id));

-- public.properties: properties_insert_agency (INSERT)
drop policy if exists "properties_insert_agency" on "public"."properties";
create policy "properties_insert_agency" on "public"."properties" as PERMISSIVE for INSERT to public with check ((agency_can_edit(agency_id) AND (verification_status = 'unverified'::verification_status) AND (verification_nodes = '[]'::jsonb) AND (trust_score IS NULL) AND (verified_at IS NULL) AND (deleted_at IS NULL)));

-- public.properties: properties_update_agency (UPDATE)
drop policy if exists "properties_update_agency" on "public"."properties";
create policy "properties_update_agency" on "public"."properties" as PERMISSIVE for UPDATE to public using (((deleted_at IS NULL) AND agency_can_edit(agency_id))) with check (agency_can_edit(agency_id));

-- public.property_media: property_media_write_agency (ALL)
drop policy if exists "property_media_write_agency" on "public"."property_media";
create policy "property_media_write_agency" on "public"."property_media" as PERMISSIVE for SELECT to public using ((EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = property_media.property_id) AND is_agency_member(p.agency_id)))));
drop policy if exists "property_media_write_agency_write" on "public"."property_media";
create policy "property_media_write_agency_insert" on "public"."property_media" as PERMISSIVE for INSERT to public with check ((EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = property_media.property_id) AND agency_can_edit(p.agency_id)))));
create policy "property_media_write_agency_update" on "public"."property_media" as PERMISSIVE for UPDATE to public using ((EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = property_media.property_id) AND agency_can_edit(p.agency_id))))) with check ((EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = property_media.property_id) AND agency_can_edit(p.agency_id)))));
create policy "property_media_write_agency_delete" on "public"."property_media" as PERMISSIVE for DELETE to public using ((EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = property_media.property_id) AND agency_can_edit(p.agency_id)))));

-- public.short_links: short_links_rw (ALL)
drop policy if exists "short_links_rw" on "public"."short_links";
create policy "short_links_rw" on "public"."short_links" as PERMISSIVE for SELECT to public using (is_agency_member(agency_id));
drop policy if exists "short_links_rw_write" on "public"."short_links";
create policy "short_links_rw_insert" on "public"."short_links" as PERMISSIVE for INSERT to public with check (agency_can_edit(agency_id));
create policy "short_links_rw_update" on "public"."short_links" as PERMISSIVE for UPDATE to public using (agency_can_edit(agency_id)) with check (agency_can_edit(agency_id));
create policy "short_links_rw_delete" on "public"."short_links" as PERMISSIVE for DELETE to public using (agency_can_edit(agency_id));

-- public.social_posts: social_posts_rw (ALL)
drop policy if exists "social_posts_rw" on "public"."social_posts";
create policy "social_posts_rw" on "public"."social_posts" as PERMISSIVE for SELECT to public using (is_agency_member(agency_id));
drop policy if exists "social_posts_rw_write" on "public"."social_posts";
create policy "social_posts_rw_insert" on "public"."social_posts" as PERMISSIVE for INSERT to public with check (agency_can_edit(agency_id));
create policy "social_posts_rw_update" on "public"."social_posts" as PERMISSIVE for UPDATE to public using (agency_can_edit(agency_id)) with check (agency_can_edit(agency_id));
create policy "social_posts_rw_delete" on "public"."social_posts" as PERMISSIVE for DELETE to public using (agency_can_edit(agency_id));

-- public.tasks: tasks_write (ALL)
drop policy if exists "tasks_write" on "public"."tasks";
create policy "tasks_write" on "public"."tasks" as PERMISSIVE for SELECT to public using (is_agency_member(agency_id));
drop policy if exists "tasks_write_write" on "public"."tasks";
create policy "tasks_write_insert" on "public"."tasks" as PERMISSIVE for INSERT to public with check (agency_can_edit(agency_id));
create policy "tasks_write_update" on "public"."tasks" as PERMISSIVE for UPDATE to public using (agency_can_edit(agency_id)) with check (agency_can_edit(agency_id));
create policy "tasks_write_delete" on "public"."tasks" as PERMISSIVE for DELETE to public using (agency_can_edit(agency_id));

-- public.team_messages: team_messages_send (INSERT)
drop policy if exists "team_messages_send" on "public"."team_messages";
create policy "team_messages_send" on "public"."team_messages" as PERMISSIVE for INSERT to public with check (((sender_id = auth.uid()) AND agency_can_edit(agency_id) AND (EXISTS ( SELECT 1
   FROM agency_members m
  WHERE ((m.agency_id = team_messages.agency_id) AND (m.profile_id = team_messages.recipient_id) AND (m.deleted_at IS NULL))))));

-- public.viewings: viewings_update_parties (UPDATE)
drop policy if exists "viewings_update_parties" on "public"."viewings";
create policy "viewings_update_parties" on "public"."viewings" as PERMISSIVE for UPDATE to public using (((deleted_at IS NULL) AND ((consumer_id = auth.uid()) OR agency_can_edit(agency_id))));

-- storage.objects: brand_assets_delete (DELETE)
drop policy if exists "brand_assets_delete" on "storage"."objects";
create policy "brand_assets_delete" on "storage"."objects" as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'brand'::text) AND agency_can_edit(((storage.foldername(name))[1])::uuid)));

-- storage.objects: brand_assets_insert (INSERT)
drop policy if exists "brand_assets_insert" on "storage"."objects";
create policy "brand_assets_insert" on "storage"."objects" as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'brand'::text) AND agency_can_edit(((storage.foldername(name))[1])::uuid)));

-- storage.objects: brand_assets_update (UPDATE)
drop policy if exists "brand_assets_update" on "storage"."objects";
create policy "brand_assets_update" on "storage"."objects" as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'brand'::text) AND agency_can_edit(((storage.foldername(name))[1])::uuid))) with check (((bucket_id = 'brand'::text) AND agency_can_edit(((storage.foldername(name))[1])::uuid)));

-- storage.objects: property_photos_delete (DELETE)
drop policy if exists "property_photos_delete" on "storage"."objects";
create policy "property_photos_delete" on "storage"."objects" as PERMISSIVE for DELETE to authenticated using (((bucket_id = 'property-photos'::text) AND agency_can_edit(((storage.foldername(name))[1])::uuid)));

-- storage.objects: property_photos_insert (INSERT)
drop policy if exists "property_photos_insert" on "storage"."objects";
create policy "property_photos_insert" on "storage"."objects" as PERMISSIVE for INSERT to authenticated with check (((bucket_id = 'property-photos'::text) AND agency_can_edit(((storage.foldername(name))[1])::uuid)));

-- storage.objects: property_photos_update (UPDATE)
drop policy if exists "property_photos_update" on "storage"."objects";
create policy "property_photos_update" on "storage"."objects" as PERMISSIVE for UPDATE to authenticated using (((bucket_id = 'property-photos'::text) AND agency_can_edit(((storage.foldername(name))[1])::uuid)));

-- ── functions a member could call to write ─────────────────────────────────────────────────────────────────

-- assign_posts_to_campaign: the one membership check becomes the edit check
CREATE OR REPLACE FUNCTION public.assign_posts_to_campaign(p_campaign_id uuid, p_post_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agency uuid;
  v_n      integer;
begin
  select agency_id into v_agency from campaigns
   where id = p_campaign_id and deleted_at is null;
  if v_agency is null then
    raise exception 'No such campaign' using errcode = 'no_data_found';
  end if;
  if not agency_can_edit(v_agency) then
    raise exception 'That campaign is not yours' using errcode = 'insufficient_privilege';
  end if;

  /* Scoped to the campaign's OWN agency, not to the ids passed in. The array
     arrives from a browser, and without this line one agency could file
     another agency's posts under its campaign and read their click figures
     through campaign_performance(). */
  update social_posts
     set campaign_id = p_campaign_id
   where deleted_at is null
     and agency_id = v_agency
     and (id = any(p_post_ids) or twin_of = any(p_post_ids));

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- cancel_inspection_slot: the one membership check becomes the edit check
CREATE OR REPLACE FUNCTION public.cancel_inspection_slot(p_slot_id uuid)
 RETURNS TABLE(ok boolean, affected integer, leads_reset integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_agency   uuid;
  v_affected int := 0;
  v_reset    int := 0;
begin
  select agency_id into v_agency from inspection_slots where id = p_slot_id;
  if v_agency is null then
    return query select false, 0, 0; return;
  end if;
  -- SECURITY DEFINER means the caller's RLS is bypassed, so membership has to
  -- be checked explicitly rather than assumed from the policy.
  if not agency_can_edit(v_agency) then
    return query select false, 0, 0; return;
  end if;

  update inspection_slots
     set status = 'cancelled', updated_at = now()
   where id = p_slot_id;

  with done as (
    update viewings
       set status = 'cancelled', updated_at = now()
     where slot_id = p_slot_id
       and status <> 'cancelled'
       and deleted_at is null
    returning lead_id
  )
  select count(*) into v_affected from done;

  /* Only leads with nothing else on the books go back. A buyer who is also
     booked onto another visit is still, correctly, viewing_scheduled. */
  with touched as (
    select distinct v.lead_id
    from viewings v
    where v.slot_id = p_slot_id and v.lead_id is not null
  ),
  rolled as (
    update leads l
       set current_stage = 'qualified', last_activity_at = now()
     where l.id in (select lead_id from touched)
       and l.current_stage = 'viewing_scheduled'
       and not exists (
         select 1 from viewings v2
          where v2.lead_id = l.id
            and v2.status <> 'cancelled'
            and v2.deleted_at is null)
    returning l.id
  )
  select count(*) into v_reset from rolled;

  return query select true, v_affected, v_reset;
end;
$function$;

-- create_short_link: the one membership check becomes the edit check
CREATE OR REPLACE FUNCTION public.create_short_link(p_property_id uuid, p_channel attribution_channel, p_social_post_id uuid DEFAULT NULL::uuid, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(token text, url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if not (public.agency_can_edit(v_agency) or public.is_platform_admin()) then
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

-- disconnect_social_account: the one membership check becomes the edit check
CREATE OR REPLACE FUNCTION public.disconnect_social_account(p_account_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
declare
  v_agency uuid;
  v_a uuid;
  v_r uuid;
begin
  select agency_id, access_token_ref, refresh_token_ref
    into v_agency, v_a, v_r
  from social_accounts
  where id = p_account_id and deleted_at is null;

  if v_agency is null then
    raise exception 'Account not found' using errcode = 'no_data_found';
  end if;
  if not agency_can_edit(v_agency) then
    raise exception 'You cannot disconnect this account'
      using errcode = 'insufficient_privilege';
  end if;

  update social_accounts
     set is_active = false, deleted_at = now(),
         access_token_ref = null, refresh_token_ref = null
   where id = p_account_id;

  if v_a is not null then delete from vault.secrets where id = v_a; end if;
  if v_r is not null then delete from vault.secrets where id = v_r; end if;

  return true;
end;
$function$;

-- mark_comment_handled: the one membership check becomes the edit check
CREATE OR REPLACE FUNCTION public.mark_comment_handled(p_comment_id uuid, p_handled boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_agency uuid;
begin
  select agency_id into v_agency from social_comments
   where id = p_comment_id and deleted_at is null;
  if v_agency is null then
    raise exception 'No such comment' using errcode = 'no_data_found';
  end if;

  -- Membership, not owner/admin. Answering a comment is the job of whoever is
  -- working the board, and a permission narrower than the work is a permission
  -- somebody routes around.
  if not agency_can_edit(v_agency) then
    raise exception 'That comment is not yours'
      using errcode = 'insufficient_privilege';
  end if;

  update social_comments
     set handled_at = case when p_handled then now() else null end,
         handled_by = case when p_handled then auth.uid() else null end
   where id = p_comment_id;
end;
$function$;

-- move_lead_stage: the one membership check becomes the edit check
CREATE OR REPLACE FUNCTION public.move_lead_stage(p_lead_id uuid, p_to_stage lead_stage, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Same rule as the leads RLS select policy: lead's consumer or an agency member.
  if not exists (
    select 1 from leads l
    where l.id = p_lead_id
      and (l.consumer_id = auth.uid() or agency_can_edit(l.agency_id))
  ) then
    raise exception 'forbidden: not permitted to move lead %', p_lead_id
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('synapse.stage_reason', coalesce(left(p_reason, 200), ''), true);

  -- No history insert here: trg_lead_stage_moved records the move, and only
  -- when the stage actually changes. Moving a lead to the stage it is already
  -- in records nothing, where the old function wrote a row anyway.
  update leads set current_stage = p_to_stage where id = p_lead_id;

  perform set_config('synapse.stage_reason', '', true);
end;
$function$;

commit;
