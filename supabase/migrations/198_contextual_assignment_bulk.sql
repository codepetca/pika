-- Add a dormant, service-only transactional boundary for the markdown
-- Assignment bulk editor. Applying this migration changes no rows and
-- activates no route; exact user/Classroom admission remains disabled.

begin;

create function public.save_assignments_bulk_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_archived_at timestamptz;
  v_assignment public.assignments%rowtype;
  v_assignment_id uuid;
  v_created integer := 0;
  v_errors jsonb;
  v_existing public.assignments%rowtype;
  v_index integer;
  v_is_new boolean;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_next_position integer := 0;
  v_now timestamptz;
  v_owner_id uuid;
  v_positioned_items jsonb := '[]'::jsonb;
  v_result_assignments jsonb := '[]'::jsonb;
  v_updated integer := 0;
begin
  if p_actor_id is null
    or p_classroom_id is null
    or p_assignments is null
    or jsonb_typeof(p_assignments) <> 'array'
    or jsonb_array_length(p_assignments) > 50
  then
    raise exception using errcode = '22023', message = 'Invalid assignment bulk request';
  end if;

  -- Resolve new Assignment IDs before taking the established per-Assignment
  -- fences. Every bulk writer takes those fences in canonical UUID order and
  -- only then enters the broader Classroom-operation namespace.
  for v_item, v_index in
    select item.value, item.ordinality::integer - 1
    from jsonb_array_elements(p_assignments) with ordinality as item(value, ordinality)
    order by item.ordinality
  loop
    if jsonb_typeof(v_item) <> 'object'
      or v_item->>'title' is null
      or length(btrim(v_item->>'title')) < 1
      or v_item->>'due_at' is null
      or v_item->>'instructions_markdown' is null
      or v_item->>'description' is null
      or v_item->'rich_instructions' is null
      or jsonb_typeof(v_item->'rich_instructions') <> 'object'
      or v_item->'is_draft' is null
      or jsonb_typeof(v_item->'is_draft') <> 'boolean'
      or exists (
        select 1
        from jsonb_object_keys(v_item) as key(name)
        where key.name <> all (array[
          'id', 'title', 'due_at', 'instructions_markdown',
          'description', 'rich_instructions', 'is_draft'
        ]::text[])
      )
    then
      raise exception using errcode = '22023', message = 'Invalid assignment bulk request';
    end if;

    v_is_new := not (v_item ? 'id') or v_item->'id' = 'null'::jsonb;
    begin
      v_assignment_id := case
        when v_is_new then gen_random_uuid()
        else (v_item->>'id')::uuid
      end;
      perform (v_item->>'due_at')::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'Invalid assignment bulk request';
    end;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'assignment_id', v_assignment_id,
      'index', v_index,
      'is_new', v_is_new,
      'title', btrim(v_item->>'title'),
      'due_at', v_item->>'due_at',
      'instructions_markdown', v_item->>'instructions_markdown',
      'description', v_item->>'description',
      'rich_instructions', v_item->'rich_instructions',
      'is_draft', (v_item->>'is_draft')::boolean
    ));
  end loop;

  for v_assignment_id in
    select distinct (item.value->>'assignment_id')::uuid
    from jsonb_array_elements(v_items) as item(value)
    order by 1
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('assignment_submission:' || v_assignment_id::text, 0)
    );
  end loop;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || p_classroom_id::text, 0)
  );

  select classroom.teacher_id, classroom.archived_at
  into v_owner_id, v_archived_at
  from public.classrooms as classroom
  where classroom.id = p_classroom_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Classroom not found';
  end if;
  if v_owner_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_archived_at is not null then
    raise exception using errcode = '55000', message = 'assignment_bulk_archived';
  end if;

  -- Lock every referenced existing Assignment after the Classroom row. The
  -- advisory fences above keep this compatible with single-Assignment writes.
  perform 1
  from public.assignments as assignment
  where assignment.id in (
    select distinct (item.value->>'assignment_id')::uuid
    from jsonb_array_elements(v_items) as item(value)
    where not (item.value->>'is_new')::boolean
  )
  order by assignment.id
  for update;

  select jsonb_agg(
    to_jsonb(format('Assignment ID not found: %s', item.value->>'assignment_id'))
    order by (item.value->>'index')::integer
  )
  into v_errors
  from jsonb_array_elements(v_items) as item(value)
  where not (item.value->>'is_new')::boolean
    and not exists (
      select 1
      from public.assignments as assignment
      where assignment.id = (item.value->>'assignment_id')::uuid
        and assignment.classroom_id = p_classroom_id
    );

  if v_errors is not null then
    return jsonb_build_object('ok', false, 'status', 400, 'errors', v_errors);
  end if;

  if exists (
    select 1
    from public.assignments as assignment
    join jsonb_array_elements(v_items) as item(value)
      on assignment.id = (item.value->>'assignment_id')::uuid
    where not (item.value->>'is_new')::boolean
      and assignment.blueprint_archived_at is not null
  ) then
    raise exception using errcode = '55000', message = 'assignment_bulk_archived';
  end if;

  v_now := clock_timestamp();
  select jsonb_agg(
    to_jsonb(format('Cannot un-release assignment: %s', item.value->>'title'))
    order by (item.value->>'index')::integer
  )
  into v_errors
  from public.assignments as assignment
  join jsonb_array_elements(v_items) as item(value)
    on assignment.id = (item.value->>'assignment_id')::uuid
  where not (item.value->>'is_new')::boolean
    and not assignment.is_draft
    and (assignment.released_at is null or assignment.released_at <= v_now)
    and (item.value->>'is_draft')::boolean;

  if v_errors is not null then
    return jsonb_build_object('ok', false, 'status', 400, 'errors', v_errors);
  end if;

  -- Preserve material and survey slots while assigning positions in request
  -- order, matching the legacy markdown bulk editor.
  for v_item in
    select item.value
    from jsonb_array_elements(v_items) as item(value)
    order by (item.value->>'index')::integer
  loop
    while exists (
      select 1 from public.classwork_materials as material
      where material.classroom_id = p_classroom_id
        and material.position = v_next_position
      union all
      select 1 from public.surveys as survey
      where survey.classroom_id = p_classroom_id
        and survey.position = v_next_position
    ) loop
      v_next_position := v_next_position + 1;
    end loop;
    v_positioned_items := v_positioned_items || jsonb_build_array(
      v_item || jsonb_build_object('position', v_next_position)
    );
    v_next_position := v_next_position + 1;
  end loop;

  -- Legacy response ordering returns all created rows before updated rows.
  for v_item in
    select item.value
    from jsonb_array_elements(v_positioned_items) as item(value)
    where (item.value->>'is_new')::boolean
    order by (item.value->>'index')::integer
  loop
    insert into public.assignments (
      id, classroom_id, title, instructions_markdown, description,
      rich_instructions, due_at, position, is_draft, created_by
    ) values (
      (v_item->>'assignment_id')::uuid,
      p_classroom_id,
      v_item->>'title',
      v_item->>'instructions_markdown',
      v_item->>'description',
      v_item->'rich_instructions',
      (v_item->>'due_at')::timestamptz,
      (v_item->>'position')::integer,
      true,
      p_actor_id
    )
    returning * into v_assignment;

    v_result_assignments := v_result_assignments || jsonb_build_array(to_jsonb(v_assignment));
    v_created := v_created + 1;
  end loop;

  for v_item in
    select item.value
    from jsonb_array_elements(v_positioned_items) as item(value)
    where not (item.value->>'is_new')::boolean
    order by (item.value->>'index')::integer
  loop
    select * into strict v_existing
    from public.assignments as assignment
    where assignment.id = (v_item->>'assignment_id')::uuid;

    update public.assignments
    set title = v_item->>'title',
      instructions_markdown = v_item->>'instructions_markdown',
      description = v_item->>'description',
      rich_instructions = v_item->'rich_instructions',
      due_at = (v_item->>'due_at')::timestamptz,
      position = (v_item->>'position')::integer,
      is_draft = (v_item->>'is_draft')::boolean,
      released_at = case
        when (v_item->>'is_draft')::boolean then null
        when v_existing.is_draft then v_now
        else v_existing.released_at
      end
    where id = v_existing.id
    returning * into v_assignment;

    v_result_assignments := v_result_assignments || jsonb_build_array(to_jsonb(v_assignment));
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'actor_id', p_actor_id,
    'classroom_id', p_classroom_id,
    'created', v_created,
    'updated', v_updated,
    'assignments', v_result_assignments
  );
end;
$function$;

revoke all on function public.save_assignments_bulk_for_owner_v1(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.save_assignments_bulk_for_owner_v1(uuid, uuid, jsonb)
to service_role;

comment on function public.save_assignments_bulk_for_owner_v1(uuid, uuid, jsonb) is
  'Atomically authorizes an active Classroom owner and creates, updates, releases, and repositions one markdown Assignment batch.';

commit;
