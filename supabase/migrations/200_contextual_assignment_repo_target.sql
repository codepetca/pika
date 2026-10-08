-- Add a dormant, service-only contextual boundary for an Assignment owner to
-- select or reset one enrolled student's repository target. Applying this
-- migration changes no rows and activates no route.

begin;

create function public.save_assignment_repo_target_for_owner_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_student_id uuid,
  p_target jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_initial_classroom_id uuid;
  v_assignment_classroom_id uuid;
  v_owner_id uuid;
  v_archived_at timestamptz;
  v_blueprint_archived_at timestamptz;
  v_target public.assignment_repo_targets%rowtype;
begin
  if p_actor_id is null
    or p_assignment_id is null
    or p_student_id is null
    or p_now is null
  then
    raise exception using errcode = '22023', message = 'Invalid assignment repo target request';
  end if;

  if p_target is not null and (
    jsonb_typeof(p_target) <> 'object'
    or not (p_target ?& array[
      'selected_repo_url',
      'override_github_username',
      'repo_owner',
      'repo_name',
      'selection_mode',
      'validation_status',
      'validation_message'
    ])
    or exists (
      select 1
      from jsonb_object_keys(p_target) as key(name)
      where key.name <> all (array[
        'selected_repo_url',
        'override_github_username',
        'repo_owner',
        'repo_name',
        'selection_mode',
        'validation_status',
        'validation_message'
      ]::text[])
    )
    or jsonb_typeof(p_target -> 'selected_repo_url') not in ('string', 'null')
    or jsonb_typeof(p_target -> 'override_github_username') not in ('string', 'null')
    or jsonb_typeof(p_target -> 'repo_owner') not in ('string', 'null')
    or jsonb_typeof(p_target -> 'repo_name') not in ('string', 'null')
    or jsonb_typeof(p_target -> 'validation_message') not in ('string', 'null')
    or p_target ->> 'selection_mode' not in ('auto', 'teacher_override')
    or p_target ->> 'validation_status' not in (
      'missing', 'ambiguous', 'valid', 'invalid', 'private', 'inaccessible'
    )
  ) then
    raise exception using errcode = '22023', message = 'Invalid assignment repo target payload';
  end if;

  -- Match learner artifact and owner Assignment mutations before taking the
  -- broader Classroom-operation and learner-purge fences.
  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );

  select assignment.classroom_id
  into v_initial_classroom_id
  from public.assignments as assignment
  where assignment.id = p_assignment_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  perform private.try_lock_classroom_membership_change(
    v_initial_classroom_id,
    p_student_id
  );

  select
    assignment.classroom_id,
    assignment.blueprint_archived_at,
    classroom.teacher_id,
    classroom.archived_at
  into
    v_assignment_classroom_id,
    v_blueprint_archived_at,
    v_owner_id,
    v_archived_at
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for update of classroom, assignment;

  if not found
    or v_assignment_classroom_id is distinct from v_initial_classroom_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;
  if v_owner_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_archived_at is not null or v_blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'assignment_repo_target_archived';
  end if;

  perform 1
  from public.classroom_enrollments as enrollment
  where enrollment.classroom_id = v_assignment_classroom_id
    and enrollment.student_id = p_student_id
  for share;

  if not found then
    raise exception using errcode = '22023', message = 'Student is not enrolled in this classroom';
  end if;

  if p_target is null then
    delete from public.assignment_repo_targets as target
    where target.assignment_id = p_assignment_id
      and target.student_id = p_student_id;

    return jsonb_build_object(
      'ok', true,
      'actor_id', p_actor_id,
      'assignment_id', p_assignment_id,
      'student_id', p_student_id,
      'repo_target', null
    );
  end if;

  insert into public.assignment_repo_targets (
    assignment_id,
    student_id,
    selected_repo_url,
    override_github_username,
    repo_owner,
    repo_name,
    selection_mode,
    validation_status,
    validation_message,
    validated_at
  ) values (
    p_assignment_id,
    p_student_id,
    p_target ->> 'selected_repo_url',
    p_target ->> 'override_github_username',
    p_target ->> 'repo_owner',
    p_target ->> 'repo_name',
    p_target ->> 'selection_mode',
    p_target ->> 'validation_status',
    p_target ->> 'validation_message',
    p_now
  )
  on conflict (assignment_id, student_id) do update set
    selected_repo_url = excluded.selected_repo_url,
    override_github_username = excluded.override_github_username,
    repo_owner = excluded.repo_owner,
    repo_name = excluded.repo_name,
    selection_mode = excluded.selection_mode,
    validation_status = excluded.validation_status,
    validation_message = excluded.validation_message,
    validated_at = excluded.validated_at
  returning * into v_target;

  return jsonb_build_object(
    'ok', true,
    'actor_id', p_actor_id,
    'assignment_id', p_assignment_id,
    'student_id', p_student_id,
    'repo_target', to_jsonb(v_target)
  );
end;
$function$;

revoke all on function public.save_assignment_repo_target_for_owner_v1(
  uuid, uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.save_assignment_repo_target_for_owner_v1(
  uuid, uuid, uuid, jsonb, timestamptz
) to service_role;

comment on function public.save_assignment_repo_target_for_owner_v1(
  uuid, uuid, uuid, jsonb, timestamptz
) is
  'Service-only dormant boundary for an exact current Assignment owner to save or reset one enrolled learner repository target under shared lifecycle fences.';

commit;
