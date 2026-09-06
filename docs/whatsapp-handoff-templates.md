# WhatsApp handoff templates

Everything Synapse sends on WhatsApp is a Toju-to-agent handoff. No buyer is
ever messaged (migration `0082` closed that path and `queue_lead_message` now
refuses).

A **business-initiated** WhatsApp message will not deliver as free text. It has
to be a template Meta approved in advance, unless the recipient messaged in
within the previous 24 hours — which an agent waiting on a lead has not. So
these four have to be submitted and approved before a single handoff arrives.

Live definitions are rows in `public.whatsapp_templates` (migration `0084`).
This file is generated from them; the table is the source of truth.

## Submitting

Via Twilio (the configured provider) → **Messaging → Content Template Builder**,
or in Meta Business Manager → **WhatsApp Manager → Message templates**.

For each one below: create it with the **exact** `key` as its name, pick
**UTILITY**, language **en**, paste the body verbatim, and give the sample
values — Meta rejects a submission with no samples.

When one is approved, write its id back so the sender can use it:

```sql
update whatsapp_templates
   set status = 'approved',
       provider_content_sid = 'HX…',   -- Twilio Content SID
       approved_at = now()
 where key = 'handoff_new_lead';
```

Until `provider_content_sid` is set the sender has nothing to send with. That
is deliberate: a template that has not been approved must fail loudly, not go
out as free text that silently never arrives.

## Why all four are UTILITY

Each reports something that has just happened to a person expecting to hear
about it. None of them sells anything. Filing one as MARKETING would cost more
per message **and** let a recipient switch it off at the WhatsApp level — a
handoff that silently stops arriving is worse than one that never worked.

## The rules that cause rejections

These are enforced as CHECK constraints on the table, because a rejection comes
back days later saying very little:

- a placeholder may not open or close the body
- two placeholders may not sit next to each other
- placeholders are positional — `{{1}}`, `{{2}}` — never named
- body at most 1024 characters
- the name is lowercase letters, digits and underscores only

---

### `handoff_lead_assigned`

**Sent automatically** when a lead changes hands — the
`leads_notify_assignment` trigger, on UPDATE of `assigned_agent_id` only. It
goes to the new owner and to nobody else: the agency owner is not a fallback
here, because "assigned to you" is untrue of somebody who was not assigned it.

- **Category:** UTILITY  
- **Language:** en  
- **Variables:** `{{1}}` buyer_name, `{{2}}` listing

**Body**

```
A lead has been assigned to you. {{1}} enquired about {{2}} and is yours to work now. The full conversation is on the lead in Synapse.
```

**Sample values for review**

- `{{1}}` = Chinaza Obi
- `{{2}}` = Bodija Park 3-Bedroom Flat

**Renders as**

> A lead has been assigned to you. Chinaza Obi enquired about Bodija Park 3-Bedroom Flat and is yours to work now. The full conversation is on the lead in Synapse.

### `handoff_negotiation_limit`

**Sent automatically** when a buyer offers below the floor the agency set — the
`negotiation_offers_notify` trigger (migrations `0089`, `0090`).

The floor lives in `listing_negotiation_authority`, one row per listing, set by
an owner or admin from the Negotiation section of the listing drawer. It is not
on `properties`, which is world-readable: a floor there would be one select
away from the buyer it is meant to be hidden from. This table has **no policy a
consumer can satisfy** — proven with a real buyer's JWT returning zero rows,
and an agency owner's returning theirs.

Tayo asks `offer_within_authority(property, amount)`, which answers **yes or
no** and never returns the figure, so a negotiator talked into repeating its own
context has nothing to repeat. No floor set means **no authority**, not
unlimited: the safe reading of "nobody said" is "not allowed".

Fires once per lead. A buyer working up from 2.5 to 2.6 to 2.65 is one
negotiation, not three, and an agent already told is already in the
conversation. A counter from the agency's own side notifies nobody.

- **Category:** UTILITY  
- **Language:** en  
- **Variables:** `{{1}}` buyer_name, `{{2}}` offer, `{{3}}` listing

**Body**

```
Tayo has stopped at the limit you set. {{1}} offered {{2}} on {{3}}, which is under your floor, so it needs you. Take it from here in Synapse.
```

**Sample values for review**

- `{{1}}` = Chinaza Obi
- `{{2}}` = ₦2.7M/yr
- `{{3}}` = Bodija Park 3-Bedroom Flat

**Renders as**

> Tayo has stopped at the limit you set. Chinaza Obi offered ₦2.7M/yr on Bodija Park 3-Bedroom Flat, which is under your floor, so it needs you. Take it from here in Synapse.

### `handoff_new_lead`

**Sent automatically** the moment a lead is created, by the `leads_notify_agent`
trigger (migration `0087`). The other three are queued by the product at the
point they describe; this one fires on its own.

- **Category:** UTILITY
- **Language:** en
- **Variables:** `{{1}}` buyer_name, `{{2}}` listing, `{{3}}` budget

**Body**

```
New lead from Tayo. {{1}} asked about {{2}} and their budget is {{3}}. Open Synapse to read the conversation and reply.
```

**Sample values for review**

- `{{1}}` = Chinaza Obi
- `{{2}}` = Bodija Park 3-Bedroom Flat
- `{{3}}` = ₦3.2M/yr

**Renders as**

> New lead from Tayo. Chinaza Obi asked about Bodija Park 3-Bedroom Flat and their budget is ₦3.2M/yr. Open Synapse to read the conversation and reply.

Every variable is something that can be missing, so each has a fallback that
still reads: *A buyer*, *one of your listings*, *not stated*. Reworded from a
draft that said "a budget around {{3}}" — fine with a figure, clumsy without
one. Free to change only because nothing has been submitted; after approval the
text is frozen and a reword means resubmitting.

### `handoff_viewing_booked`

**Sent automatically** when a viewing is created with status `requested`,
`scheduled` or `confirmed` — the `viewings_notify_agent` trigger. A viewing
logged after the fact (`completed`, `cancelled`, `no_show`) notifies nobody, so
an agency catching up on last month does not fire a month of messages. The time
is rendered in Africa/Lagos: a UTC timestamp would send somebody to a house an
hour early.

- **Category:** UTILITY  
- **Language:** en  
- **Variables:** `{{1}}` buyer_name, `{{2}}` listing, `{{3}}` when

**Body**

```
Viewing booked. {{1}} has asked to see {{2}} on {{3}}. Confirm it or move it in Synapse before they travel.
```

**Sample values for review**

- `{{1}}` = Chinaza Obi
- `{{2}}` = Bodija Park 3-Bedroom Flat
- `{{3}}` = Saturday 12 September, 11:00am

**Renders as**

> Viewing booked. Chinaza Obi has asked to see Bodija Park 3-Bedroom Flat on Saturday 12 September, 11:00am. Confirm it or move it in Synapse before they travel.

---

## Using one

`queue_agent_handoff_template(lead_id, key, vars)` renders the template and
queues it to the lead's assigned agent (or the agency owner):

```sql
select queue_agent_handoff_template(
  '…lead uuid…',
  'handoff_new_lead',
  jsonb_build_object(
    'buyer_name', 'Chinaza Obi',
    'listing',    'Bodija Park 3-Bedroom Flat',
    'budget',     '₦3.2M/yr'
  )
);
```

The outbox row keeps **both** the rendered text and the `template_key` +
`template_vars`. The text is so a person reading the queue sees the words and a
dry run shows them; the key and variables are what the provider is handed once
the template is approved.

A missing variable raises rather than rendering a gap — an agent should never
receive a sentence with a hole in it.

## Still needed before any of this delivers

1. These four submitted and approved, and their `provider_content_sid` written
   back. `handoff_new_lead` is already queued by the trigger, so the queue
   fills before any of it can deliver — which is the right way round: the
   messages accumulate and go out once approval lands, rather than leads
   passing unrecorded.
2. `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` set on the
   project. Until then `send-outbox` refuses to claim anything and says so.
3. **Phone numbers on agent profiles.** As of 2026-09-06 none of the 41 agency
   members had one, so every lead resolved to nobody reachable. Registration
   now asks agency staff for it (migration `0083`); existing members still need
   theirs filled in.
