-- WHAT FACEBOOK GRANTED, NEXT TO WHAT IT SAID.
--
-- social_connect_failures kept the message the person was shown and nothing
-- else. On 2 October that message was "Facebook granted the permissions but
-- shared no Page", and from it alone nobody could tell "nothing was ticked"
-- from "the grant still names Pages that were deleted" -- two failures with
-- two different fixes, one of them on Facebook's side.
--
-- social-connect now writes what Facebook returned beside the message:
-- which permissions came back, how many Pages /me/accounts listed, how many
-- Pages the grant itself names (debug_token granular_scopes) and how many of
-- those could be read, and the Graph error codes for the ones that could not.
-- Counts, permission names and Meta's error codes only -- no token, no Page
-- or person id, no names.
--
-- The function is written to work before this runs: if the column is
-- missing it folds the same facts into `detail` instead, so whichever of the
-- deploy and this migration lands first, nothing is lost.

alter table public.social_connect_failures
  add column if not exists facts jsonb;

comment on column public.social_connect_failures.facts is
  'What the platform returned, as counts and names of permissions: granted / '
  'declined permissions, Pages listed by /me/accounts, Pages named in the grant '
  'and how many could be read, Graph error codes. Never a token, an id or a name.';

comment on table public.social_connect_failures is
  'Failed or cancelled social connections, as social-connect reported them to '
  'the person (backToPortal): the outcome, the platform''s words, and in facts '
  'what the platform returned (counts and permission names only). Service role '
  'only; purged after 30 days by purge-social-connect-failures.';
