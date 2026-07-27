#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${ATOMIC_BLUEPRINT_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)}"
DATABASE_NAME="${ATOMIC_BLUEPRINT_DATABASE_NAME:-postgres}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.users (id, email, role)
values ('10000000-0000-4000-8000-000000000001', 'blueprint-contract@example.test', 'teacher');

do $contract$
declare
  v_teacher_id constant uuid := '10000000-0000-4000-8000-000000000001';
  v_failed_create_operation constant uuid := '20000000-0000-4000-8000-000000000001';
  v_create_operation constant uuid := '20000000-0000-4000-8000-000000000002';
  v_failed_instantiate_operation constant uuid := '20000000-0000-4000-8000-000000000003';
  v_instantiate_operation constant uuid := '20000000-0000-4000-8000-000000000004';
  v_stale_capture_operation constant uuid := '20000000-0000-4000-8000-000000000005';
  v_malformed_operation constant uuid := '20000000-0000-4000-8000-000000000006';
  v_source_classroom_id constant uuid := '30000000-0000-4000-8000-000000000005';
  v_result jsonb;
  v_replay jsonb;
  v_blueprint_id uuid;
  v_blueprint_revision bigint;
  v_source_revision bigint;
  v_changed_source_revision bigint;
  v_classroom_id uuid;
  v_count integer;
  v_create_plan jsonb;
  v_instantiation_plan jsonb;
begin
  v_result := public.create_course_blueprint_atomic(
    v_malformed_operation,
    v_teacher_id,
    'import',
    repeat('f', 64),
    null,
    null,
    '{}'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, true)
    or v_result->>'error_code' <> 'invalid_blueprint_plan'
  then
    raise exception 'Expected malformed plan to fail through the operation contract: %', v_result;
  end if;
  if not exists (
    select 1 from public.course_blueprint_operations
    where id = v_malformed_operation
      and status = 'failed'
      and error_code = 'invalid_blueprint_plan'
  ) then
    raise exception 'Malformed-plan failure was not retained in the ledger';
  end if;

  v_create_plan := jsonb_build_object(
    'blueprint', jsonb_build_object(
      'title', 'Rollback blueprint',
      'subject', '',
      'grade_level', '',
      'course_code', '',
      'term_template', '',
      'overview_markdown', '',
      'outline_markdown', '',
      'resources_markdown', '',
      'planned_site_slug', null,
      'planned_site_published', false,
      'planned_site_config', jsonb_build_object(
        'overview', true,
        'outline', true,
        'resources', true,
        'assignments', true,
        'tests', true,
        'lesson_plans', true
      )
    ),
    'assignments', jsonb_build_array(jsonb_build_object(
      'title', 'Invalid weight',
      'instructions_markdown', '',
      'submission_requirements_json', '[]'::jsonb,
      'default_due_days', 1,
      'default_due_time', '23:59',
      'points_possible', 10,
      'gradebook_weight', 0,
      'include_in_final', true,
      'is_draft', true,
      'position', 0
    )),
    'assessments', '[]'::jsonb,
    'lesson_templates', '[]'::jsonb,
    'manifest_version', '3',
    'source_package_exported_at', null
  );

  v_result := public.create_course_blueprint_atomic(
    v_failed_create_operation,
    v_teacher_id,
    'import',
    repeat('a', 64),
    null,
    null,
    v_create_plan
  );

  if coalesce((v_result->>'ok')::boolean, true) then
    raise exception 'Expected invalid blueprint child row to fail';
  end if;
  select count(*) into v_count
  from public.course_blueprints
  where teacher_id = v_teacher_id and title = 'Rollback blueprint';
  if v_count <> 0 then
    raise exception 'Failed blueprint operation left domain rows behind';
  end if;
  if not exists (
    select 1 from public.course_blueprint_operations
    where id = v_failed_create_operation
      and status = 'failed'
      and error_code = 'create_blueprint_assignments_failed'
  ) then
    raise exception 'Failed blueprint operation was not retained in the ledger';
  end if;

  v_create_plan := jsonb_set(v_create_plan, '{blueprint,title}', '"Atomic blueprint"'::jsonb);
  v_create_plan := jsonb_set(v_create_plan, '{assignments,0,gradebook_weight}', '25'::jsonb);
  v_result := public.create_course_blueprint_atomic(
    v_create_operation,
    v_teacher_id,
    'import',
    repeat('b', 64),
    null,
    null,
    v_create_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Expected valid blueprint operation to succeed: %', v_result;
  end if;
  v_blueprint_id := (v_result->>'blueprint_id')::uuid;
  select content_revision into v_blueprint_revision
  from public.course_blueprints where id = v_blueprint_id;

  v_replay := public.create_course_blueprint_atomic(
    v_create_operation,
    v_teacher_id,
    'import',
    repeat('b', 64),
    null,
    null,
    v_create_plan
  );
  if not coalesce((v_replay->>'replayed')::boolean, false)
    or v_replay->>'blueprint_id' <> v_result->>'blueprint_id'
  then
    raise exception 'Completed blueprint operation did not replay its original result';
  end if;
  select count(*) into v_count
  from public.course_blueprints
  where teacher_id = v_teacher_id and title = 'Atomic blueprint';
  if v_count <> 1 then
    raise exception 'Blueprint replay created duplicate rows';
  end if;

  insert into public.classrooms (id, teacher_id, title, class_code)
  values (v_source_classroom_id, v_teacher_id, 'Capture source', 'SRC001');
  select blueprint_source_revision into v_source_revision
  from public.classrooms where id = v_source_classroom_id;

  insert into public.assignments (
    classroom_id,
    title,
    description,
    due_at,
    created_by
  ) values (
    v_source_classroom_id,
    'Concurrent assignment',
    '',
    '2026-09-15T23:59:00-04:00'::timestamptz,
    v_teacher_id
  );
  select blueprint_source_revision into v_changed_source_revision
  from public.classrooms where id = v_source_classroom_id;
  if v_changed_source_revision <= v_source_revision then
    raise exception 'Assignment mutation did not advance source classroom revision';
  end if;

  v_create_plan := jsonb_set(
    v_create_plan,
    '{blueprint,title}',
    '"Stale capture blueprint"'::jsonb
  );
  v_result := public.create_course_blueprint_atomic(
    v_stale_capture_operation,
    v_teacher_id,
    'capture',
    repeat('e', 64),
    v_source_classroom_id,
    v_source_revision,
    v_create_plan
  );
  if coalesce((v_result->>'ok')::boolean, true)
    or v_result->>'error_code' <> 'source_classroom_changed'
  then
    raise exception 'Expected stale classroom capture to fail: %', v_result;
  end if;
  if exists (
    select 1 from public.course_blueprints
    where teacher_id = v_teacher_id and title = 'Stale capture blueprint'
  ) then
    raise exception 'Stale classroom capture left blueprint rows behind';
  end if;
  if not exists (
    select 1 from public.course_blueprint_operations
    where id = v_stale_capture_operation
      and status = 'failed'
      and error_code = 'source_classroom_changed'
  ) then
    raise exception 'Stale capture failure was not retained in the ledger';
  end if;

  v_instantiation_plan := jsonb_build_object(
    'expected_content_revision', v_blueprint_revision,
    'manifest_version', '3',
    'classroom', jsonb_build_object(
      'title', 'Rollback classroom',
      'class_code', 'ROLLBK',
      'term_label', null,
      'theme_color', 'blue',
      'start_date', '2026-09-08',
      'end_date', '2027-01-29',
      'course_overview_markdown', '',
      'course_outline_markdown', '',
      'actual_site_config', jsonb_build_object(
        'overview', true,
        'outline', true,
        'resources', true,
        'assignments', true,
        'tests', true,
        'lesson_plans', true,
        'announcements', true,
        'lesson_plan_scope', 'current_week'
      )
    ),
    'class_days', jsonb_build_array(jsonb_build_object('date', '2026-09-08')),
    'resources_content', null,
    'assignments', '[]'::jsonb,
    'tests', jsonb_build_array(jsonb_build_object(
      'title', 'Invalid test',
      'position', 0,
      'show_results', false,
      'documents', '[]'::jsonb,
      'points_possible', 10,
      'gradebook_weight', 10,
      'include_in_final', true,
      'questions', jsonb_build_array(jsonb_build_object(
        'question_type', 'invalid',
        'question_text', 'Invalid child row',
        'options', '[]'::jsonb,
        'correct_option', null,
        'answer_key', null,
        'sample_solution', null,
        'points', 1,
        'response_max_chars', 5000,
        'response_monospace', false,
        'position', 0
      )),
      'draft_content', jsonb_build_object(
        'title', 'Invalid test',
        'show_results', false,
        'questions', '[]'::jsonb
      )
    )),
    'lesson_plans', '[]'::jsonb,
    'overflow_lesson_templates', '[]'::jsonb
  );

  v_result := public.instantiate_course_blueprint_atomic(
    v_failed_instantiate_operation,
    v_teacher_id,
    v_blueprint_id,
    repeat('c', 64),
    v_blueprint_revision,
    v_instantiation_plan
  );
  if coalesce((v_result->>'ok')::boolean, true) then
    raise exception 'Expected invalid classroom child row to fail';
  end if;
  select count(*) into v_count
  from public.classrooms
  where teacher_id = v_teacher_id and title = 'Rollback classroom';
  if v_count <> 0 then
    raise exception 'Failed instantiation left classroom rows behind';
  end if;
  if not exists (
    select 1 from public.course_blueprint_operations
    where id = v_failed_instantiate_operation
      and status = 'failed'
      and error_code = 'create_tests_failed'
  ) then
    raise exception 'Failed instantiation was not retained in the ledger';
  end if;

  v_instantiation_plan := jsonb_set(v_instantiation_plan, '{classroom,title}', '"Atomic classroom"'::jsonb);
  v_instantiation_plan := jsonb_set(v_instantiation_plan, '{classroom,class_code}', '"ATOM01"'::jsonb);
  v_instantiation_plan := jsonb_set(v_instantiation_plan, '{tests}', '[]'::jsonb);
  v_result := public.instantiate_course_blueprint_atomic(
    v_instantiate_operation,
    v_teacher_id,
    v_blueprint_id,
    repeat('d', 64),
    v_blueprint_revision,
    v_instantiation_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Expected valid instantiation to succeed: %', v_result;
  end if;
  v_classroom_id := (v_result->>'classroom_id')::uuid;

  v_replay := public.instantiate_course_blueprint_atomic(
    v_instantiate_operation,
    v_teacher_id,
    v_blueprint_id,
    repeat('d', 64),
    v_blueprint_revision,
    v_instantiation_plan
  );
  if not coalesce((v_replay->>'replayed')::boolean, false)
    or v_replay->>'classroom_id' <> v_classroom_id::text
  then
    raise exception 'Completed instantiation did not replay its original result';
  end if;
  select count(*) into v_count
  from public.classrooms
  where teacher_id = v_teacher_id and title = 'Atomic classroom';
  if v_count <> 1 then
    raise exception 'Instantiation replay created duplicate classrooms';
  end if;
  select count(*) into v_count
  from public.class_days
  where classroom_id = v_classroom_id;
  if v_count <> 1 then
    raise exception 'Atomic classroom has unexpected class-day count';
  end if;
end;
$contract$;

rollback;
SQL

echo "Atomic blueprint database contract passes."
