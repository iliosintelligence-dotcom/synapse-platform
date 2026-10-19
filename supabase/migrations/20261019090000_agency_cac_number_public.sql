-- AN AGENCY'S CAC NUMBER IS SHOWN ON ITS PROPERTY CARDS (Eden, 2026-10-19).
-- The number a company is registered under at the Corporate Affairs Commission is a public record (anyone can search it at
-- the CAC registry), and showing it is how a buyer can check an agency for themselves. It had been withdrawn from the public
-- role in the 2026-10-11 privacy pass; this gives back that one column and no other. The CAC certificate FILE and everything
-- else the agency uploaded stay private.
grant select (cac_number) on public.agencies to anon, authenticated;
