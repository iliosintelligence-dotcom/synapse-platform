-- Layer 4 · row level security
-- Trust signals are public to consumers; the machinery (checks, fraud,
-- audit) is restricted. All scores are platform-calculated — no client
-- writes to trust tables except a consumer's own review/dispute.
-- Reuses is_agency_member()/agency_role() from Layer 1.

alter table agency_verifications enable row level security;
alter table agency_verification_checks enable row level security;
alter table agency_trust_scores enable row level security;
alter table agency_trust_score_snapshots enable row level security;
alter table agent_verifications enable row level security;
alter table agent_disciplinary_records enable row level security;
alter table agent_reputation_snapshots enable row level security;
alter table property_verifications enable row level security;
alter table property_verification_history enable row level security;
alter table property_verification_checks enable row level security;
alter table documents enable row level security;
alter table document_versions enable row level security;
alter table fraud_flags enable row level security;
alter table fraud_events enable row level security;
alter table disputes enable row level security;
alter table dispute_evidence enable row level security;
alter table dispute_comments enable row level security;
alter table consumer_reviews enable row level security;
alter table review_aggregates enable row level security;
alter table trust_audit_logs enable row level security;
alter table reputation_timelines enable row level security;

-- ──────────────── public trust signals (read to any authenticated user) ────────────────
create policy agency_verif_public on agency_verifications for select using (auth.uid() is not null);
create policy agency_trust_public on agency_trust_scores for select using (auth.uid() is not null);
create policy agency_trust_snap_public on agency_trust_score_snapshots for select using (auth.uid() is not null);
create policy agent_verif_public on agent_verifications for select using (auth.uid() is not null);
create policy agent_reputation_public on agent_reputation_snapshots for select using (auth.uid() is not null);
create policy property_verif_public on property_verifications for select using (auth.uid() is not null);
create policy review_aggregates_public on review_aggregates for select using (auth.uid() is not null);
create policy reputation_timeline_public on reputation_timelines for select using (auth.uid() is not null);

-- ──────────────── agency-scoped reads ────────────────
create policy agency_checks_select on agency_verification_checks
  for select using (is_agency_member(agency_id));

-- ──────────────── agent discipline — agent + agency admins ────────────────
create policy agent_discipline_select on agent_disciplinary_records
  for select using (
    agent_id = auth.uid() or agency_role(agency_id) in ('agency_admin','agency_owner')
  );

-- ──────────────── property checks — public except failed; agency sees all ────────────────
create policy property_history_select on property_verification_history
  for select using (
    exists (select 1 from properties p where p.id = property_id and is_agency_member(p.agency_id))
  );
create policy property_checks_select on property_verification_checks
  for select using (
    status <> 'failed'
    or exists (select 1 from properties p where p.id = property_id and is_agency_member(p.agency_id))
  );

-- ──────────────── documents — fine-grained access helper ────────────────
create or replace function can_access_document(p_entity_type document_entity_type, p_entity_id uuid)
returns boolean language plpgsql security definer stable set search_path = public as $$
begin
  if p_entity_type = 'deal_room' then
    return exists (select 1 from deal_rooms d where d.id = p_entity_id
      and (d.consumer_id = auth.uid() or d.agent_id = auth.uid() or is_agency_member(d.agency_id)));
  elsif p_entity_type = 'property' then
    return exists (select 1 from properties p where p.id = p_entity_id and is_agency_member(p.agency_id))
        or exists (select 1 from deal_rooms d where d.property_id = p_entity_id and d.consumer_id = auth.uid());
  elsif p_entity_type = 'agency' then
    -- credentials: agency owner only (platform admin uses service role)
    return exists (select 1 from agencies a where a.id = p_entity_id and a.owner_id = auth.uid());
  elsif p_entity_type = 'agent' then
    return p_entity_id = auth.uid()
        or exists (select 1 from agency_members m where m.profile_id = p_entity_id
             and agency_role(m.agency_id) in ('agency_admin','agency_owner'));
  end if;
  return false;
end;
$$;

create policy documents_select on documents
  for select using (deleted_at is null and can_access_document(entity_type, entity_id));
create policy documents_insert on documents
  for insert with check (can_access_document(entity_type, entity_id));
create policy document_versions_select on document_versions
  for select using (can_access_document(entity_type, entity_id));

-- ──────────────── fraud — platform admin only (no client policy = deny) ────────────────
-- RLS enabled with zero policies: clients cannot read or write. The fraud
-- service operates via the service role in Edge Functions.

-- ──────────────── disputes — parties only ────────────────
create policy disputes_select on disputes
  for select using (raised_by = auth.uid() or is_agency_member(raised_against));
create policy disputes_insert on disputes
  for insert with check (raised_by = auth.uid());

create policy dispute_evidence_select on dispute_evidence
  for select using (
    exists (select 1 from disputes d where d.id = dispute_id
      and (d.raised_by = auth.uid() or is_agency_member(d.raised_against)))
  );
create policy dispute_evidence_insert on dispute_evidence
  for insert with check (submitted_by = auth.uid());

create policy dispute_comments_select on dispute_comments
  for select using (
    not is_internal
    and exists (select 1 from disputes d where d.id = dispute_id
      and (d.raised_by = auth.uid() or is_agency_member(d.raised_against)))
  );
create policy dispute_comments_insert on dispute_comments
  for insert with check (author_id = auth.uid() and is_internal = false);

-- ──────────────── reviews — published public; own otherwise ────────────────
create policy reviews_select on consumer_reviews
  for select using (is_published or reviewer_id = auth.uid());
create policy reviews_insert on consumer_reviews
  for insert with check (reviewer_id = auth.uid());

-- ──────────────── trust audit — internal only (no client policy = deny) ────────────────
-- recalc + audit run via security-definer functions / service role.
