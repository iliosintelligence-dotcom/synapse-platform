-- "THE AGENCY HAS UPLOADED ITS CAC CERTIFICATE" IS PUBLIC; THE FILE AND THE NUMBER-LESS CASE (Eden, 2026-10-19).
-- Agencies were uploading the CAC certificate without typing the number, so every card said "CAC not yet on file" although the
-- certificate was on file. The file stays private; this single yes/no flag is what buyers may see.
alter table public.agencies add column if not exists cac_certificate_on_file boolean not null default false;

create or replace function public.sync_cac_certificate_flag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.entity_type = 'agency' and new.document_type = 'cac_certificate' then
    update public.agencies set cac_certificate_on_file = true where id = new.entity_id and not cac_certificate_on_file;
  end if;
  return new;
end $$;
revoke all on function public.sync_cac_certificate_flag() from public, anon, authenticated;

drop trigger if exists trg_sync_cac_certificate_flag on public.documents;
create trigger trg_sync_cac_certificate_flag after insert on public.documents
  for each row execute function public.sync_cac_certificate_flag();

update public.agencies a set cac_certificate_on_file = true
 where exists (select 1 from public.documents d where d.entity_type = 'agency' and d.entity_id = a.id and d.document_type = 'cac_certificate');

grant select (cac_certificate_on_file) on public.agencies to anon, authenticated;
