-- 0046_message_outbox.sql
-- A durable outbox for messages to leads.
--
-- The CRM's bulk "Message" action had nothing behind it. This gives it a real
-- queue: rows are persisted first and delivered later by the send-outbox edge
-- function, so a Twilio outage -- or Twilio simply not being configured, which
-- is the case today -- costs the send attempt and never the intent to send.

create table if not exists public.message_outbox (
  id                  uuid primary key default uuid_generate_v4(),
  agency_id           uuid not null references public.agencies(id) on delete cascade,
  lead_id             uuid not null references public.leads(id) on delete cascade,
  to_phone            text not null,
  body                text not null,
  channel             text not null default 'whatsapp' check (channel in ('whatsapp')),
  status              text not null default 'queued'
                      check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts            integer not null default 0,
  max_attempts        integer not null default 3,
  last_error          text,
  provider_message_id text,
  created_by          uuid references public.profiles(id),
  scheduled_for       timestamptz not null default now(),
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists message_outbox_due_idx
  on public.message_outbox (status, scheduled_for)
  where deleted_at is null and status in ('queued', 'sending');

create index if not exists message_outbox_agency_idx
  on public.message_outbox (agency_id, created_at desc)
  where deleted_at is null;

alter table public.message_outbox enable row level security;

drop policy if exists message_outbox_select on public.message_outbox;
create policy message_outbox_select
  on public.message_outbox for select to authenticated
  using (deleted_at is null and is_agency_member(agency_id));

drop policy if exists message_outbox_cancel on public.message_outbox;
create policy message_outbox_cancel
  on public.message_outbox for update to authenticated
  using (deleted_at is null and is_agency_member(agency_id))
  with check (is_agency_member(agency_id));

-- No client INSERT, by design: a table that accepts an arbitrary phone number
-- plus arbitrary text is an open SMS gateway running on our own Twilio
-- account. Rows arrive only through queue_lead_message(), which derives the
-- recipient from a lead -- so the platform can only message someone who
-- actually enquired.
revoke all on public.message_outbox from authenticated, anon;
grant select on public.message_outbox to authenticated;
grant update (status) on public.message_outbox to authenticated;

-- ── the only way in ─────────────────────────────────────────────────────────
create or replace function public.queue_lead_message(p_lead_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agency uuid;
  v_phone  text;
  v_role   text;
  v_id     uuid;
begin
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'Message body is empty' using errcode = 'invalid_parameter_value';
  end if;
  if length(p_body) > 1000 then
    raise exception 'Message is too long (max 1000 characters)' using errcode = 'invalid_parameter_value';
  end if;

  select agency_id, consumer_phone into v_agency, v_phone
  from leads
  where id = p_lead_id and deleted_at is null;

  if v_agency is null then
    raise exception 'Lead not found' using errcode = 'no_data_found';
  end if;

  -- coalesce: agency_role() is NULL for a non-member, and a NULL comparison is
  -- NULL rather than true, which would skip a negative guard entirely.
  v_role := coalesce(agency_role(v_agency)::text, '');
  if v_role not in ('agent', 'agency_admin', 'agency_owner') then
    raise exception 'You cannot message this agency''s leads'
      using errcode = 'insufficient_privilege';
  end if;

  if v_phone is null or btrim(v_phone) = '' then
    raise exception 'That lead has no phone number' using errcode = 'invalid_parameter_value';
  end if;

  insert into message_outbox (agency_id, lead_id, to_phone, body, created_by)
  values (v_agency, p_lead_id, v_phone, btrim(p_body), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.queue_lead_message(uuid, text) from public, anon;
grant execute on function public.queue_lead_message(uuid, text) to authenticated;

-- ── claiming work ───────────────────────────────────────────────────────────
-- Two drains running at once must never pick up the same row: these are real
-- WhatsApp messages to real buyers, and a double send is not a cosmetic bug.
-- FOR UPDATE SKIP LOCKED plus the queued -> sending flip in one statement makes
-- the claim atomic, so a second caller sees nothing to take.
--
-- Scoped to a single agency. The drain runs as the service role and is invoked
-- from the dashboard with the caller's own JWT, so without this scoping any
-- signed-in account could trigger outbound messaging for every agency on the
-- platform. send-outbox checks the caller's membership before calling this.
create or replace function public.claim_outbox_batch(p_agency_id uuid, p_limit integer default 20)
returns setof public.message_outbox
language sql
security definer
set search_path to 'public'
as $$
  update message_outbox o
     set status   = 'sending',
         attempts = o.attempts + 1
   where o.id in (
     select id from message_outbox
      where agency_id = p_agency_id
        and deleted_at is null
        and attempts < max_attempts
        and (
          (status = 'queued' and scheduled_for <= now())
          -- a drain that died mid-flight: reclaim rather than strand the row
          or (status = 'sending' and updated_at < now() - interval '5 minutes')
        )
      order by scheduled_for
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 20), 100))
     )
  returning o.*;
$$;

revoke all on function public.claim_outbox_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_outbox_batch(uuid, integer) to service_role;

-- ── clients may cancel, and nothing else ────────────────────────────────────
-- SECURITY INVOKER matters here and is not an oversight. Inside a SECURITY
-- DEFINER function current_user is the function's owner, never the caller, so
-- a definer version of this guard never fires for anyone -- a client could set
-- a queued message straight to 'sent' and the outbox status would mean
-- nothing. As invoker, current_user is the caller's role for a client write and
-- the owner's role when the write comes from claim_outbox_batch. That is
-- exactly the line this guard needs to draw.
create or replace function public.message_outbox_guard()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if not (old.status = 'queued' and new.status = 'cancelled') then
      raise exception 'You can only cancel a message that has not been sent'
        using errcode = 'insufficient_privilege';
    end if;
    -- status is the only column granted, but pin the rest so a future grant
    -- cannot quietly turn this into an arbitrary-recipient rewrite.
    if new.to_phone is distinct from old.to_phone
       or new.body is distinct from old.body
       or new.lead_id is distinct from old.lead_id
       or new.agency_id is distinct from old.agency_id then
      raise exception 'A queued message cannot be rewritten'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists message_outbox_guard_trg on public.message_outbox;
create trigger message_outbox_guard_trg
  before update on public.message_outbox
  for each row execute function public.message_outbox_guard();

drop trigger if exists message_outbox_updated_at on public.message_outbox;
create trigger message_outbox_updated_at
  before update on public.message_outbox
  for each row execute function public.set_updated_at();

-- Same correction applied to the lead soft-delete guard from 0045, which had
-- the identical SECURITY DEFINER / current_user contradiction.
create or replace function public.leads_guard_soft_delete()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_role text;
begin
  if new.deleted_at is not null and old.deleted_at is null
     and current_user in ('authenticated', 'anon') then
    v_role := coalesce(agency_role(new.agency_id)::text, '');
    if v_role not in ('agency_admin', 'agency_owner') then
      raise exception 'Only an agency admin or owner can delete leads'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
