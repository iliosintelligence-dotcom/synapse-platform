-- Layer 5 · row level security
-- Agencies own their content/campaigns/social/geofences. Consumers own their
-- discovery feed, referrals, and proximity history. Growth + marketplace +
-- viral-loop data are platform-admin only (RLS on, zero client policies =
-- deny; service role in Edge Functions bypasses). Reuses Layer 1 helpers.

alter table generated_content enable row level security;
alter table content_variants enable row level security;
alter table campaign_suggestions enable row level security;
alter table social_accounts enable row level security;
alter table social_posts enable row level security;
alter table social_post_metrics enable row level security;
alter table campaigns enable row level security;
alter table campaign_assets enable row level security;
alter table geofences enable row level security;
alter table proximity_events enable row level security;
alter table proximity_alert_outcomes enable row level security;
alter table discovery_feed_records enable row level security;
alter table referrals enable row level security;
alter table referral_rewards enable row level security;
alter table referral_reward_config enable row level security;
alter table growth_metrics enable row level security;
alter table marketplace_health enable row level security;
alter table viral_loop_events enable row level security;

-- ──────────────── content (agency-scoped) ────────────────
create policy generated_content_rw on generated_content
  for all using (is_agency_member(agency_id)) with check (is_agency_member(agency_id));
create policy content_variants_select on content_variants
  for select using (
    exists (select 1 from generated_content gc where gc.id = content_id and is_agency_member(gc.agency_id))
  );
create policy campaign_suggestions_select on campaign_suggestions
  for select using (is_agency_member(agency_id));
create policy campaign_suggestions_update on campaign_suggestions
  for update using (is_agency_member(agency_id)) with check (is_agency_member(agency_id));

-- ──────────────── social (read members; manage admins/owners) ────────────────
create policy social_accounts_select on social_accounts
  for select using (is_agency_member(agency_id));
create policy social_accounts_manage on social_accounts
  for all using (agency_role(agency_id) in ('agency_admin','agency_owner'))
  with check (agency_role(agency_id) in ('agency_admin','agency_owner'));
create policy social_posts_rw on social_posts
  for all using (is_agency_member(agency_id)) with check (is_agency_member(agency_id));
create policy social_metrics_select on social_post_metrics
  for select using (
    exists (select 1 from social_posts sp where sp.id = social_post_id and is_agency_member(sp.agency_id))
  );

-- ──────────────── campaigns ────────────────
create policy campaigns_select on campaigns
  for select using (is_agency_member(agency_id));
create policy campaigns_manage on campaigns
  for all using (agency_role(agency_id) in ('agency_admin','agency_owner'))
  with check (agency_role(agency_id) in ('agency_admin','agency_owner'));
create policy campaign_assets_select on campaign_assets
  for select using (
    exists (select 1 from campaigns c where c.id = campaign_id and is_agency_member(c.agency_id))
  );

-- ──────────────── geofences (agency-scoped; proximity_matches is definer) ────────────────
create policy geofences_rw on geofences
  for all using (is_agency_member(agency_id)) with check (is_agency_member(agency_id));

-- ──────────────── proximity (consumer owns their history) ────────────────
create policy proximity_events_select on proximity_events
  for select using (user_id = auth.uid());
create policy proximity_outcomes_select on proximity_alert_outcomes
  for select using (user_id = auth.uid());

-- ──────────────── discovery feed (consumer owns) ────────────────
create policy discovery_select on discovery_feed_records
  for select using (user_id = auth.uid());
create policy discovery_update on discovery_feed_records
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────── referrals (referrer + invitee) ────────────────
create policy referrals_select on referrals
  for select using (referrer_id = auth.uid() or invitee_id = auth.uid());
create policy referrals_insert on referrals
  for insert with check (referrer_id = auth.uid());
create policy referral_rewards_select on referral_rewards
  for select using (
    exists (select 1 from referrals r where r.id = referral_id and r.referrer_id = auth.uid())
  );
create policy referral_config_select on referral_reward_config
  for select using (auth.uid() is not null);

-- ──────────────── platform-admin-only (no client policy = deny) ────────────────
-- growth_metrics, marketplace_health, viral_loop_events: readable only via
-- the service role in Edge Functions. Marketplace insight reaches agencies
-- through a curated Edge-Function surface, never direct table access.
