-- 0073_templates_carry_a_stable_angle_key.sql
--
-- Making angles data broke the archive, and it broke silently.
--
-- buildVariant stamps `angle: a.id` on every variant. While angles were code
-- that was 'trust' | 'value' | 'life' | 'scarcity' | 'question' -- exactly the
-- narrative_angle enum. As rows, a.id is a uuid, which is not an enum value,
-- so saveGeneration skipped every variant and wrote nothing. Twenty captions
-- generated, zero kept, and no error anywhere: the count in the database was
-- the only thing that said so.
--
-- Two additions fix it and make the next case work too:
--
--   angle_key on the template -- a stable, human name that survives becoming
--   data. The five seeds keep the keys they always had, so rows written before
--   and after this change describe the same thing. An agency's own template
--   has no enum value it could honestly claim, so it files as 'custom'.
--
--   template_id on the row -- which template actually wrote this. angle_key
--   says what kind of angle it was; template_id says which one. Without it two
--   agency templates are indistinguishable forever.

alter type narrative_angle add value if not exists 'custom';

alter table public.content_templates
  add column if not exists angle_key text not null default 'custom';

update public.content_templates set angle_key = case name
    when 'Verified-first'  then 'trust'
    when 'Price context'   then 'value'
    when 'Lifestyle'       then 'life'
    when 'Freshness'       then 'scarcity'
    when 'Direct question' then 'question'
    else angle_key
  end
where agency_id is null;

alter table public.generated_content
  add column if not exists template_id uuid references public.content_templates (id) on delete set null;

create index if not exists generated_content_template_idx
  on public.generated_content (template_id) where deleted_at is null;

comment on column public.content_templates.angle_key is
  'Stable name for the KIND of angle, used as narrative_angle when a generation is filed. The five seeds keep their original keys; anything an agency writes is custom.';
comment on column public.generated_content.template_id is
  'Which template produced this. narrative_angle says what kind; this says which one.';
