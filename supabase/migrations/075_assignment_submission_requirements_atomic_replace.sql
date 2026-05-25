-- Atomically replace teacher-authored assignment submission requirements.

create or replace function public.replace_assignment_submission_requirements_atomic(
  p_assignment_id uuid,
  p_requirements jsonb
)
returns setof public.assignment_submission_requirements
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_requirement jsonb;
  v_requirement_id uuid;
  v_existing_id uuid;
  v_type text;
  v_label text;
  v_instructions text;
  v_required boolean;
  v_position integer;
  v_policy jsonb;
  v_preserved_ids uuid[] := array[]::uuid[];
  v_index integer := 0;
begin
  if p_requirements is null or jsonb_typeof(p_requirements) <> 'array' then
    raise exception 'p_requirements must be a JSON array';
  end if;

  for v_requirement in
    select value from jsonb_array_elements(p_requirements)
  loop
    v_type := v_requirement->>'type';
    if v_type not in ('repo_link', 'link', 'image') then
      raise exception 'Invalid assignment submission requirement type: %', coalesce(v_type, '<null>');
    end if;

    begin
      v_requirement_id := nullif(v_requirement->>'id', '')::uuid;
    exception when invalid_text_representation then
      v_requirement_id := null;
    end;

    v_label := nullif(btrim(coalesce(v_requirement->>'label', '')), '');
    if v_label is null then
      v_label := case v_type
        when 'repo_link' then 'Repo link'
        when 'image' then 'Screenshot'
        else 'Public link'
      end;
    end if;

    v_instructions := btrim(coalesce(v_requirement->>'instructions', ''));
    v_required := coalesce((v_requirement->>'required')::boolean, true);
    v_position := coalesce((v_requirement->>'position')::integer, v_index);
    v_policy := case
      when jsonb_typeof(v_requirement->'validation_policy_json') = 'object'
        then v_requirement->'validation_policy_json'
      else '{}'::jsonb
    end;

    v_existing_id := null;
    if v_requirement_id is not null then
      update public.assignment_submission_requirements
      set
        label = v_label,
        instructions = v_instructions,
        required = v_required,
        position = v_position,
        validation_policy_json = v_policy
      where id = v_requirement_id
        and assignment_id = p_assignment_id
        and type = v_type
      returning id into v_existing_id;
    end if;

    if v_existing_id is null then
      insert into public.assignment_submission_requirements (
        assignment_id,
        type,
        label,
        instructions,
        required,
        position,
        validation_policy_json
      )
      values (
        p_assignment_id,
        v_type,
        v_label,
        v_instructions,
        v_required,
        v_position,
        v_policy
      )
      returning id into v_existing_id;
    end if;

    v_preserved_ids := array_append(v_preserved_ids, v_existing_id);
    v_index := v_index + 1;
  end loop;

  delete from public.assignment_submission_requirements
  where assignment_id = p_assignment_id
    and not (id = any(v_preserved_ids));

  return query
  select *
  from public.assignment_submission_requirements
  where assignment_id = p_assignment_id
  order by position asc, created_at asc;
end;
$$;

revoke all on function public.replace_assignment_submission_requirements_atomic(uuid, jsonb) from public;
revoke all on function public.replace_assignment_submission_requirements_atomic(uuid, jsonb) from anon;
revoke all on function public.replace_assignment_submission_requirements_atomic(uuid, jsonb) from authenticated;
grant execute on function public.replace_assignment_submission_requirements_atomic(uuid, jsonb) to service_role;
