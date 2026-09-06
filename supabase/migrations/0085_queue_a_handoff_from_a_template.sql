-- Renders a template and queues it, so the templates are the thing the
-- handoff is actually made of rather than a catalogue nobody reads.
--
-- The outbox keeps BOTH: the rendered text in body, because a person reading
-- the queue should see the words and a dry run should show them too; and the
-- key plus the variables, because that pair is what the provider is handed
-- once the template is approved. Free text will not deliver as a
-- business-initiated WhatsApp message, so body alone is not enough to send.

create or replace function public.render_whatsapp_template(p_key text, p_vars jsonb)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_body text;
  v_vars jsonb;
  v_name text;
  v_val  text;
  i      int := 0;
begin
  select body, variables into v_body, v_vars
  from whatsapp_templates
  where key = p_key and deleted_at is null;

  if v_body is null then
    raise exception 'No WhatsApp template called %', p_key
      using errcode = 'no_data_found';
  end if;

  -- Positional by declaration order: variables[0] fills {{1}}. The names are
  -- for the person writing the call; Meta only ever sees positions.
  for v_name in select jsonb_array_elements(v_vars) ->> 'name' loop
    i := i + 1;
    v_val := coalesce(p_vars ->> v_name, '');
    if btrim(v_val) = '' then
      raise exception 'Template % needs a value for "%"', p_key, v_name
        using errcode = 'invalid_parameter_value';
    end if;
    v_body := replace(v_body, '{{' || i || '}}', v_val);
  end loop;

  -- A leftover placeholder means the template gained a variable that the
  -- caller does not know about. Sending "{{3}}" to an agent is worse than
  -- failing here.
  if v_body ~ '\{\{[0-9]+\}\}' then
    raise exception 'Template % still has an unfilled placeholder', p_key
      using errcode = 'invalid_parameter_value';
  end if;

  return v_body;
end;
$function$;

create or replace function public.queue_agent_handoff_template(
  p_lead_id uuid, p_key text, p_vars jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
begin
  -- queue_agent_handoff owns the recipient rules and the permission check;
  -- this only decides what the message says. Two functions, one of each job.
  v_id := public.queue_agent_handoff(
    p_lead_id, public.render_whatsapp_template(p_key, p_vars)
  );

  update message_outbox
     set template_key = p_key, template_vars = p_vars
   where id = v_id;

  return v_id;
end;
$function$;
