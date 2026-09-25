-- A Page records the button that competes with the listing.
--
-- Phase 2 of docs/SOCIAL_TO_PLATFORM_ROUTING.md was going to SET the Page's
-- action button to point at the agency's /go/ page. It cannot: Meta's own
-- reference says of the write endpoint, in as many words, "This endpoint is
-- deprecated and can no longer be used", and the /{page-id}/call_to_actions
-- edge answers GET and refuses POST, PUT and DELETE.
--
-- I recommended that phase first and it is not buildable. What remains is the
-- half that still works, and it turns out to be the half that would have
-- prevented the incident anyway.
--
-- ── the incident, restated ───────────────────────────────────────────────
--
-- A buyer saw a Greenlight listing on Facebook and ended up in Eden's personal
-- WhatsApp. The caption's link was real and tappable. It lost to the Page's
-- own action button, which Meta renders directly under the post at thumb
-- height in high contrast.
--
-- NOBODY KNEW THAT BUTTON WAS THERE. It is set once, in Page settings, often
-- years earlier, and never appears in any screen an agency looks at while
-- posting. The route that beat us was invisible to us. That is the actual
-- failure, and reading the button fixes it even though we cannot write it.
--
-- So: read it at connect time, keep it, and let the portal say plainly "your
-- Page button sends people to WhatsApp; here is the link to point it at
-- instead". Changing it is four taps in Meta Business Suite -- but only for
-- somebody who has been told it is there.
--
-- NULL MEANS NOT KNOWN, NOT ABSENT. The read needs a token with a role on the
-- Page and may be refused for reasons that have nothing to do with the Page
-- having no button. A card that says "no button set" on the strength of a
-- failed request would be the third time today this codebase asserted
-- something it had not read.

alter table public.social_accounts
  add column if not exists page_cta_type    text,
  add column if not exists page_cta_url     text,
  add column if not exists page_cta_read_at timestamptz;

comment on column public.social_accounts.page_cta_type is
  'The Page action button Meta renders under every post, e.g. WHATSAPP_MESSAGE '
  'or CALL_NOW or LEARN_MORE. Read-only: Meta deprecated the write endpoint, so '
  'this is reported to the agency to change by hand. NULL means we have not '
  'read it, which is NOT the same as the Page having no button.';
comment on column public.social_accounts.page_cta_url is
  'Where that button goes, when it goes to a web address. NULL for the contact '
  'types, which is exactly the case worth warning about -- they leave the '
  'platform entirely and we never see the lead.';
comment on column public.social_accounts.page_cta_read_at is
  'When the button was last read. NULL means never.';

-- ── which buttons take the buyer away from us ────────────────────────────
--
-- Not a value judgement about phone calls. Eden's point stands: a phone number
-- breeds trust, and an agency that wants to be called should be callable. The
-- objection is to it being the DESTINATION -- the buyer arrives in a DM with no
-- listing attached, the agency cannot tell which home it was about, and the
-- enquiry is attributed to nothing.
--
-- These are the types that end the journey somewhere we cannot follow.
create or replace function public.page_cta_diverts(p_type text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(upper(btrim(p_type)), '') in (
    'CALL_NOW',
    'WHATSAPP_MESSAGE',
    'MESSAGE_PAGE',
    'CONTACT_US',
    'EMAIL',
    'SEND_MESSAGE'
  );
$$;

comment on function public.page_cta_diverts(text) is
  'True when a Page button ends the buyer journey off-platform with no listing '
  'attached. Used to decide whether the portal warns. Not a judgement about '
  'phone calls -- a number on the LANDING page is trust; a number as the '
  'destination is an untraceable lead.';

revoke all on function public.page_cta_diverts(text) from public, anon;
grant execute on function public.page_cta_diverts(text) to authenticated, service_role;
