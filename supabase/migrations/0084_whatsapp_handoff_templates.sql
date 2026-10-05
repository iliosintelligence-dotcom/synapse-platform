-- WhatsApp templates for the Toju-to-agent handoff.
--
-- WHY A TABLE AND NOT A STRING IN THE CODE
-- A business-initiated WhatsApp message will not deliver as free text. It has
-- to be a template Meta approved in advance, and approval is slow and opaque:
-- a rejection comes back days later saying very little. So the rules Meta
-- enforces are enforced HERE, at write time, where breaking one is a failed
-- insert with a message rather than a week of silence.
--
-- notification_templates already exists and is the wrong shape for this. It
-- has no category (Meta rejects a UTILITY message written like MARKETING), no
-- approval state, and nowhere to keep the provider's id for the approved
-- version -- which is the only thing you can actually send with.

create table if not exists public.whatsapp_templates (
  id          uuid primary key default uuid_generate_v4(),

  -- Meta's own naming rule: lowercase, digits and underscores, nothing else.
  key         text not null unique
              check (key ~ '^[a-z][a-z0-9_]{2,60}$'),

  -- UTILITY is a transactional notice about something that happened.
  -- MARKETING is promotion, costs more, and a user can switch it off -- a
  -- handoff filed as MARKETING is a handoff that silently stops arriving.
  category    text not null default 'UTILITY'
              check (category in ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  language    text not null default 'en',

  body        text not null check (length(body) between 1 and 1024),

  -- Ordered, one per {{n}}, each with the example Meta demands at review.
  -- [{ "name": "buyer_name", "example": "Chinaza" }, ...]
  variables   jsonb not null default '[]'::jsonb,

  status      text not null default 'draft'
              check (status in ('draft', 'submitted', 'approved', 'rejected', 'paused')),
  -- What you actually send with, once Meta says yes. Twilio calls it a
  -- Content SID; Meta has its own id. Null until then, and send-outbox must
  -- refuse to send a template that has no sid rather than sending free text
  -- that will not deliver.
  provider_content_sid text,
  meta_template_id     text,
  rejection_reason     text,
  submitted_at         timestamptz,
  approved_at          timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  -- ── Meta's body rules, as constraints ──────────────────────────────────
  -- These are the three that cause most rejections, and all three are
  -- invisible until Meta says no.
  --   * a placeholder may not open or close the body: with nothing around it
  --     there is no message, only a variable
  --   * two placeholders may not touch: "{{1}} {{2}}" reads as one blank
  --   * placeholders must be positional, {{1}} upward
  constraint body_not_placeholder_bounded
    check (btrim(body) !~ '^\{\{[0-9]+\}\}' and btrim(body) !~ '\{\{[0-9]+\}\}$'),
  constraint body_no_adjacent_placeholders
    check (body !~ '\{\{[0-9]+\}\}\s*\{\{[0-9]+\}\}'),
  constraint body_placeholders_are_numeric
    check (body !~ '\{\{\s*[^0-9}\s][^}]*\}\}')
);

create trigger whatsapp_templates_updated_at before update on public.whatsapp_templates
  for each row execute function set_updated_at();

alter table public.whatsapp_templates enable row level security;

-- Staff read them; nobody edits them from a browser. These are submitted to
-- Meta and their text is what was approved -- an edit in the portal would put
-- the row out of step with the thing that is actually allowed to send.
create policy whatsapp_templates_read_staff on public.whatsapp_templates
  for select using (
    exists (select 1 from agency_members m
             where m.profile_id = auth.uid() and m.deleted_at is null)
  );

-- ── the templates ────────────────────────────────────────────────────────
-- Every one is UTILITY: it reports something that has just happened to a
-- person who is expecting to hear about it. None of them sells anything.
insert into public.whatsapp_templates (key, category, language, body, variables)
values
  ('handoff_new_lead', 'UTILITY', 'en',
   'New lead from Tayo. {{1}} is looking in {{2}} with a budget around {{3}}, and asked about {{4}}. Open Synapse to read the conversation and reply.',
   '[{"name":"buyer_name","example":"Chinaza Obi"},
     {"name":"area","example":"Bodija, Ibadan"},
     {"name":"budget","example":"₦3.2M/yr"},
     {"name":"listing","example":"Bodija Park 3-Bedroom Flat"}]'::jsonb),

  ('handoff_viewing_booked', 'UTILITY', 'en',
   'Viewing booked. {{1}} has asked to see {{2}} on {{3}}. Confirm it or move it in Synapse before they travel.',
   '[{"name":"buyer_name","example":"Chinaza Obi"},
     {"name":"listing","example":"Bodija Park 3-Bedroom Flat"},
     {"name":"when","example":"Saturday 13 September, 11am"}]'::jsonb),

  ('handoff_negotiation_limit', 'UTILITY', 'en',
   'Tayo has stopped at the limit you set. {{1}} offered {{2}} on {{3}}, which is under your floor, so it needs you. Take it from here in Synapse.',
   '[{"name":"buyer_name","example":"Chinaza Obi"},
     {"name":"offer","example":"₦2.7M/yr"},
     {"name":"listing","example":"Bodija Park 3-Bedroom Flat"}]'::jsonb),

  ('handoff_lead_assigned', 'UTILITY', 'en',
   'A lead has been assigned to you. {{1}} enquired about {{2}} and is yours to work now. The full conversation is on the lead in Synapse.',
   '[{"name":"buyer_name","example":"Chinaza Obi"},
     {"name":"listing","example":"Bodija Park 3-Bedroom Flat"}]'::jsonb)
on conflict (key) do nothing;

-- ── what a queued message was made from ──────────────────────────────────
-- The outbox keeps the rendered text so a person can read the row and a dry
-- run shows the real words. These two say which approved template produced
-- it, which is what the provider is actually handed.
alter table public.message_outbox
  add column if not exists template_key text
    references public.whatsapp_templates (key) on delete set null,
  add column if not exists template_vars jsonb;
