-- Add a dormant, service-only transactional boundary for Assignment creation.
-- Applying this migration changes no rows and activates no route; exact
-- user/Classroom API admission remains independently disabled.

begin;

create function public.create_assignment_for_owner_v1(
  p_actor_id uuid,
  p_classroom_id uuid,
  p_title text,
  p_description text,
  p_instructions_markdown text,
  p_rich_instructions jsonb,
  p_due_at timestamptz,
  p_requirements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment_id uuid := gen_random_uuid();
  v_assignment public.assignments%rowtype;
  v_archived_at timestamptz;
  v_next_position integer;
  v_owner_id uuid;
  v_requirements jsonb;
begin
  if p_actor_id is null
    or p_classroom_id is null
    or p_title is null
    or length(btrim(p_title)) < 1
    or length(p_title) > 500
    or p_description is null
    or p_instructions_markdown is null
    or length(p_instructions_markdown) > 200000
    or p_rich_instructions is null
    or p_due_at is null
    or p_requirements is null
    or jsonb_typeof(p_requirements) <> 'array'
    or jsonb_array_length(p_requirements) > 50
  then
    raise exception using errcode = '22023', message = 'Invalid assignment creation request';
  end if;

  -- Preserve the shared ordering used by existing Assignment mutations before
  -- entering the broader Classroom operation namespace.
  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || v_assignment_id::text, 0)
  );
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
    raise exception using errcode = '55000', message = 'Classroom is archived';
  end if;

  select coalesce(max(classwork.position), -1) + 1
  into v_next_position
  from (
    select assignment.position
    from public.assignments as assignment
    where assignment.classroom_id = p_classroom_id

    union all

    select material.position
    from public.classwork_materials as material
    where material.classroom_id = p_classroom_id

    union all

    select survey.position
    from public.surveys as survey
    where survey.classroom_id = p_classroom_id
  ) as classwork;

  insert into public.assignments (
    id,
    classroom_id,
    title,
    description,
    instructions_markdown,
    rich_instructions,
    due_at,
    created_by,
    track_authenticity,
    position
  ) values (
    v_assignment_id,
    p_classroom_id,
    btrim(p_title),
    p_description,
    p_instructions_markdown,
    p_rich_instructions,
    p_due_at,
    p_actor_id,
    true,
    v_next_position
  )
  returning * into v_assignment;

  select coalesce(
    jsonb_agg(to_jsonb(requirement) order by requirement.position, requirement.created_at),
    '[]'::jsonb
  )
  into v_requirements
  from public.replace_assignment_submission_requirements_atomic(
    v_assignment_id,
    p_requirements
  ) as requirement;

  return jsonb_build_object(
    'ok', true,
    'assignment', to_jsonb(v_assignment),
    'submission_requirements', v_requirements
  );
end;
$function$;

revoke all on function public.create_assignment_for_owner_v1(
  uuid, uuid, text, text, text, jsonb, timestamptz, jsonb
)
from public, anon, authenticated;

grant execute on function public.create_assignment_for_owner_v1(
  uuid, uuid, text, text, text, jsonb, timestamptz, jsonb
)
to service_role;

comment on function public.create_assignment_for_owner_v1(
  uuid, uuid, text, text, text, jsonb, timestamptz, jsonb
) is
  'Atomically authorizes the current active Classroom owner and creates one Assignment with normalized requirements.';

commit;
