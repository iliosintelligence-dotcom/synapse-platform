-- anon cannot call erase_personal_data.
--
-- The previous migration said:
--
--   revoke all on function erase_personal_data(uuid, text) from public;
--   grant execute on function erase_personal_data(uuid, text) to authenticated;
--
-- and after applying it, the grants read:
--
--   postgres:EXECUTE, anon:EXECUTE, authenticated:EXECUTE, service_role:EXECUTE
--
-- Revoking from PUBLIC does not remove an EXPLICIT grant to a role, and
-- Supabase's default privileges hand anon and authenticated EXECUTE on every
-- new function in the public schema at the moment it is created. So the
-- revoke removed an inherited grant that was never the one doing the work,
-- and the explicit one it was aimed at survived untouched.
--
-- This is the same trap as revoking table privileges from anon and finding
-- they still have them through PUBLIC, run in the opposite direction: there,
-- the inherited grant is the one you miss; here, the explicit one is.
--
-- NOTHING WAS EXPLOITABLE. erase_personal_data checks auth.uid() against the
-- subject and otherwise requires service_role, and an anon caller has no
-- auth.uid() at all, so every anon call raised before touching a row. The
-- guard held. But this is a security definer function that bypasses RLS by
-- design, and the set of roles able to enter it should be the set intended
-- to enter it -- not a wider set that happens to be stopped one line later.
-- Depth, not a second lock on the same door.
--
-- forget_visitor KEEPS its anon grant, deliberately. A visitor with no
-- account is exactly who it exists for, and they call it without ever
-- signing in. Its authorisation is possession of the visitor id, which is
-- the whole design and is documented on the function itself.

revoke execute on function erase_personal_data(uuid, text) from anon;

-- Stated so the next reader does not "tidy up" the asymmetry between the two
-- functions by making them match.
comment on function forget_visitor(uuid) is
  'Erases everything held against an anonymous visitor id. Authorisation is '
  'possession of the id, which is a random uuid in that person''s browser: '
  'there is no session to check it against, because having no account is the '
  'condition this exists to serve. anon MUST keep execute on this one -- '
  'unlike erase_personal_data, which anon is deliberately barred from.';
