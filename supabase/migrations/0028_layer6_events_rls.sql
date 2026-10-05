-- Layer 6 · event types + strictest-on-the-platform RLS
-- Financial data has the lowest tolerance for retroactive editing. Money
-- records are user-private or agency-private; no cross-user / cross-agency
-- visibility anywhere. Platform admins act via the service role in Edge
-- Functions only, and every admin access is itself logged (System 0).

-- ──────────────── extend the Layer 2 event_type enum ────────────────
alter type event_type add value if not exists 'escrow_funded';
alter type event_type add value if not exists 'escrow_milestone_approved';
alter type event_type add value if not exists 'escrow_released';
alter type event_type add value if not exists 'escrow_disputed';
alter type event_type add value if not exists 'rent_financing_submitted';
alter type event_type add value if not exists 'rent_financing_approved';
alter type event_type add value if not exists 'rent_financing_declined';
alter type event_type add value if not exists 'repayment_received';
alter type event_type add value if not exists 'repayment_missed';
alter type event_type add value if not exists 'mortgage_application_submitted';
alter type event_type add value if not exists 'mortgage_approved';
alter type event_type add value if not exists 'commission_calculated';
alter type event_type add value if not exists 'commission_paid';
alter type event_type add value if not exists 'unit_reserved';
alter type event_type add value if not exists 'unit_sold';
alter type event_type add value if not exists 'installment_paid';
alter type event_type add value if not exists 'installment_missed';
alter type event_type add value if not exists 'wallet_transaction_confirmed';
alter type event_type add value if not exists 'financial_identity_score_updated';

-- ──────────────── enable RLS everywhere ────────────────
alter table partner_institutions enable row level security;
alter table commission_structures enable row level security;
alter table commission_ledger enable row level security;
alter table performance_bonuses enable row level security;
alter table affordability_analyses enable row level security;
alter table financial_identities enable row level security;
alter table score_component_history enable row level security;
alter table financial_consent_grants enable row level security;
alter table escrow_accounts enable row level security;
alter table escrow_milestones enable row level security;
alter table escrow_events enable row level security;
alter table developments enable row level security;
alter table unit_inventory enable row level security;
alter table installment_plans enable row level security;
alter table installment_schedules enable row level security;
alter table rent_financing_applications enable row level security;
alter table rent_repayment_schedules enable row level security;
alter table rent_guarantors enable row level security;
alter table mortgage_providers enable row level security;
alter table mortgage_applications enable row level security;
alter table wallets enable row level security;
alter table savings_goals enable row level security;
alter table wallet_transactions enable row level security;

-- ──────────────── partner registry + mortgage providers (read-only catalog) ────────────────
create policy partner_institutions_select on partner_institutions
  for select using (auth.uid() is not null);
create policy mortgage_providers_select on mortgage_providers
  for select using (is_active and auth.uid() is not null);

-- ──────────────── System 5 — commission (agency-scoped; agent sees own) ────────────────
create policy commission_structures_rw on commission_structures
  for all using (agency_role(agency_id) in ('agency_admin','agency_owner'))
  with check (agency_role(agency_id) in ('agency_admin','agency_owner'));
create policy commission_ledger_select on commission_ledger
  for select using (
    agent_id = auth.uid() or agency_role(agency_id) in ('agency_admin','agency_owner')
  );
create policy performance_bonuses_select on performance_bonuses
  for select using (
    agent_id = auth.uid() or agency_role(agency_id) in ('agency_admin','agency_owner')
  );
-- ledger writes + payouts happen in the commission Edge Function (service role).

-- ──────────────── System 4 — affordability (user-owned) ────────────────
create policy affordability_select_own on affordability_analyses
  for select using (user_id = auth.uid());
create policy affordability_insert_own on affordability_analyses
  for insert with check (user_id = auth.uid());

-- ──────────────── System 8 — financial identity (strictest) ────────────────
create policy financial_identity_select on financial_identities
  for select using (can_read_financial_identity(user_id));
create policy score_history_select on score_component_history
  for select using (
    exists (select 1 from financial_identities fi
            where fi.id = financial_identity_id and can_read_financial_identity(fi.user_id))
  );
create policy consent_grants_select on financial_consent_grants
  for select using (user_id = auth.uid() or granted_to_id = auth.uid());
create policy consent_grants_insert on financial_consent_grants
  for insert with check (user_id = auth.uid());   -- only the user grants consent
create policy consent_grants_revoke on financial_consent_grants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ──────────────── System 1 — escrow (parties only) ────────────────
create policy escrow_accounts_select on escrow_accounts
  for select using (
    payer_id = auth.uid() or payee_id = auth.uid()
    or exists (select 1 from deal_rooms d where d.id = deal_room_id and is_agency_member(d.agency_id))
  );
create policy escrow_milestones_select on escrow_milestones
  for select using (
    exists (select 1 from escrow_accounts e where e.id = escrow_account_id
      and (e.payer_id = auth.uid() or e.payee_id = auth.uid()
           or exists (select 1 from deal_rooms d where d.id = e.deal_room_id and is_agency_member(d.agency_id))))
  );
create policy escrow_events_select on escrow_events
  for select using (
    exists (select 1 from escrow_accounts e where e.id = escrow_account_id
      and (e.payer_id = auth.uid() or e.payee_id = auth.uid()))
  );
-- escrow funding/release happen in the escrow Edge Function (partner webhooks).

-- ──────────────── System 6 — developer sales ────────────────
create policy developments_select on developments
  for select using (developer_id = auth.uid() or status in ('selling','sold_out'));
create policy developments_manage on developments
  for all using (developer_id = auth.uid()) with check (developer_id = auth.uid());
create policy unit_inventory_select on unit_inventory
  for select using (
    exists (select 1 from developments d where d.id = development_id
      and (d.developer_id = auth.uid() or d.status in ('selling','sold_out')))
    or allocated_to_buyer_id = auth.uid()
  );
create policy unit_inventory_manage on unit_inventory
  for all using (exists (select 1 from developments d where d.id = development_id and d.developer_id = auth.uid()))
  with check (exists (select 1 from developments d where d.id = development_id and d.developer_id = auth.uid()));
create policy installment_plans_select on installment_plans
  for select using (
    buyer_id = auth.uid()
    or exists (select 1 from unit_inventory u join developments d on d.id = u.development_id
               where u.id = unit_id and d.developer_id = auth.uid())
  );
create policy installment_schedules_select on installment_schedules
  for select using (
    exists (select 1 from installment_plans p where p.id = installment_plan_id and p.buyer_id = auth.uid())
  );

-- ──────────────── Systems 2 & 3 — applications (applicant-owned) ────────────────
create policy rent_financing_select on rent_financing_applications
  for select using (tenant_id = auth.uid());
create policy rent_financing_insert on rent_financing_applications
  for insert with check (tenant_id = auth.uid());
create policy rent_repayment_select on rent_repayment_schedules
  for select using (
    exists (select 1 from rent_financing_applications a where a.id = application_id and a.tenant_id = auth.uid())
  );
create policy rent_guarantors_select on rent_guarantors
  for select using (
    exists (select 1 from rent_financing_applications a where a.id = application_id and a.tenant_id = auth.uid())
  );
create policy mortgage_apps_select on mortgage_applications
  for select using (buyer_id = auth.uid());
create policy mortgage_apps_insert on mortgage_applications
  for insert with check (buyer_id = auth.uid());

-- ──────────────── System 7 — wallet (owner only; writes via partner webhook) ────────────────
create policy wallets_select_own on wallets
  for select using (user_id = auth.uid());
create policy savings_goals_rw on savings_goals
  for all using (exists (select 1 from wallets w where w.id = wallet_id and w.user_id = auth.uid()))
  with check (exists (select 1 from wallets w where w.id = wallet_id and w.user_id = auth.uid()));
create policy wallet_txns_select on wallet_transactions
  for select using (
    exists (select 1 from wallets w where w.id = wallet_id and w.user_id = auth.uid())
  );
-- wallet balance + transaction confirmation only via the wallet Edge Function
-- on a partner webhook (service role).
