-- notifications.recipient_id was NOT NULL, which assumes every notification has
-- a signed-in owner. Proximity watches can begin before signup (a visitor talks
-- to Toju anonymously), so allow either a user OR a visitor id — but never
-- neither, which would orphan the row and break the dedupe key.
alter table public.notifications alter column recipient_id drop not null;

alter table public.notifications
  drop constraint if exists notifications_has_recipient;
alter table public.notifications
  add constraint notifications_has_recipient
  check (recipient_id is not null or visitor_id is not null);
