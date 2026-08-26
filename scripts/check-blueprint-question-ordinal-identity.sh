#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${BLUEPRINT_ORDINAL_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_pika' --format '{{.Names}}' | head -n 1)}"
if [[ -z "$DB_CONTAINER" ]]; then
  DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi
DATABASE_NAME="${BLUEPRINT_ORDINAL_DATABASE_NAME:-postgres}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql \
  -U postgres -d "$DATABASE_NAME" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.users (id, email, role) values (
  'b1340000-0000-4000-8000-000000000001',
  'blueprint-question-ordinal@example.test',
  'teacher'
);

insert into public.classrooms (
  id, teacher_id, title, class_code, archived_at
) values
  (
    'b1340000-0000-4000-8000-000000000010',
    'b1340000-0000-4000-8000-000000000001',
    'Active ordinal capture',
    'B134A1',
    null
  ),
  (
    'b1340000-0000-4000-8000-000000000020',
    'b1340000-0000-4000-8000-000000000001',
    'Archived ordinal reuse',
    'B134R1',
    clock_timestamp()
  );

insert into public.tests (
  id, classroom_id, artifact_id, title, status, show_results,
  points_possible, created_by, position
) values
  (
    'b1340000-0000-4000-8000-000000000011',
    'b1340000-0000-4000-8000-000000000010',
    'b1340000-0000-4000-8000-000000000111',
    'Active multi-question Test',
    'draft',
    false,
    2,
    'b1340000-0000-4000-8000-000000000001',
    0
  ),
  (
    'b1340000-0000-4000-8000-000000000021',
    'b1340000-0000-4000-8000-000000000020',
    'b1340000-0000-4000-8000-000000000211',
    'Archived multi-question Test',
    'draft',
    false,
    2,
    'b1340000-0000-4000-8000-000000000001',
    0
  );

insert into public.test_questions (
  id, test_id, artifact_id, question_type, question_text, options,
  correct_option, points, response_max_chars, response_monospace, position
) values
  -- Position gaps are valid after question deletion. The Blueprint JSON array
  -- remains canonical and must map to rows ordered by (position, id).
  (
    'b1340000-0000-4000-8000-000000000012',
    'b1340000-0000-4000-8000-000000000011',
    'b1340000-0000-4000-8000-000000000112',
    'multiple_choice',
    'Active question one',
    '["A","B"]'::jsonb,
    0,
    1,
    5000,
    false,
    0
  ),
  (
    'b1340000-0000-4000-8000-000000000013',
    'b1340000-0000-4000-8000-000000000011',
    'b1340000-0000-4000-8000-000000000113',
    'open_response',
    'Active question two',
    '[]'::jsonb,
    null,
    1,
    5000,
    false,
    2
  ),
  (
    'b1340000-0000-4000-8000-000000000022',
    'b1340000-0000-4000-8000-000000000021',
    'b1340000-0000-4000-8000-000000000212',
    'multiple_choice',
    'Archived question one',
    '["A","B"]'::jsonb,
    0,
    1,
    5000,
    false,
    0
  ),
  (
    'b1340000-0000-4000-8000-000000000023',
    'b1340000-0000-4000-8000-000000000021',
    'b1340000-0000-4000-8000-000000000213',
    'open_response',
    'Archived question two',
    '[]'::jsonb,
    null,
    1,
    5000,
    false,
    2
  );

do $contract$
declare
  v_teacher_id constant uuid := 'b1340000-0000-4000-8000-000000000001';
  v_active_classroom_id constant uuid := 'b1340000-0000-4000-8000-000000000010';
  v_archived_classroom_id constant uuid := 'b1340000-0000-4000-8000-000000000020';
  v_active_failed_operation_id constant uuid := 'b1340000-0000-4000-8000-000000000200';
  v_active_operation_id constant uuid := 'b1340000-0000-4000-8000-000000000210';
  v_archived_failed_operation_id constant uuid := 'b1340000-0000-4000-8000-000000000220';
  v_archived_operation_id constant uuid := 'b1340000-0000-4000-8000-000000000230';
  v_active_test_artifact_id constant uuid := 'b1340000-0000-4000-8000-000000000111';
  v_active_question_one_id constant uuid := 'b1340000-0000-4000-8000-000000000112';
  v_active_question_two_id constant uuid := 'b1340000-0000-4000-8000-000000000113';
  v_active_draft_only_question_id constant uuid := 'b1340000-0000-4000-8000-000000000114';
  v_active_question_one_row_id constant uuid := 'b1340000-0000-4000-8000-000000000012';
  v_active_question_two_row_id constant uuid := 'b1340000-0000-4000-8000-000000000013';
  v_archived_test_artifact_id constant uuid := 'b1340000-0000-4000-8000-000000000211';
  v_archived_question_one_id constant uuid := 'b1340000-0000-4000-8000-000000000212';
  v_archived_question_two_id constant uuid := 'b1340000-0000-4000-8000-000000000213';
  v_archived_draft_only_question_id constant uuid := 'b1340000-0000-4000-8000-000000000214';
  v_archived_question_one_row_id constant uuid := 'b1340000-0000-4000-8000-000000000022';
  v_archived_question_two_row_id constant uuid := 'b1340000-0000-4000-8000-000000000023';
  v_active_revision bigint;
  v_archived_revision bigint;
  v_active_plan jsonb;
  v_active_failure_plan jsonb;
  v_archived_plan jsonb;
  v_archived_failure_plan jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_blueprint_id uuid;
  v_artifact_ids uuid[];
  v_source_artifact_ids uuid[];
  v_blueprint_question_ids uuid[];
  v_content jsonb;
  v_count integer;
  v_error_message text;
begin
  v_active_plan := jsonb_build_object(
    'blueprint', jsonb_build_object(
      'title', 'Active ordinal Blueprint',
      'subject', '',
      'grade_level', '',
      'course_code', '',
      'term_template', '',
      'overview_markdown', '',
      'outline_markdown', '',
      'resources_markdown', '',
      'gradebook_use_weights', false,
      'gradebook_assignments_weight', 70,
      'gradebook_tests_weight', 30,
      'planned_site_slug', null,
      'planned_site_published', false,
      'planned_site_config', '{}'::jsonb
    ),
    'assignments', '[]'::jsonb,
    'assessments', jsonb_build_array(jsonb_build_object(
      'artifact_id', v_active_test_artifact_id,
      'assessment_type', 'test',
      'title', 'Active multi-question Test',
      'content', jsonb_build_object(
        'title', 'Active multi-question Test',
        'show_results', false,
        'questions', jsonb_build_array(
          jsonb_build_object(
            'id', v_active_question_two_id,
            'question_type', 'open_response',
            'question_text', 'Active question two',
            'options', '[]'::jsonb,
            'correct_option', null,
            'answer_key', 'A concise explanation',
            'sample_solution', null,
            'points', 1,
            'response_max_chars', 5000,
            'response_monospace', false
          ),
          jsonb_build_object(
            'id', v_active_draft_only_question_id,
            'question_type', 'open_response',
            'question_text', 'Active draft-only question',
            'options', '[]'::jsonb,
            'correct_option', null,
            'answer_key', null,
            'sample_solution', null,
            'points', 1,
            'response_max_chars', 5000,
            'response_monospace', false
          )
        )
      ),
      'documents', '[]'::jsonb,
      'points_possible', 2,
      'gradebook_weight', 10,
      'include_in_final', true,
      'position', 0
    )),
    'lesson_templates', '[]'::jsonb,
    'materials', '[]'::jsonb,
    'surveys', '[]'::jsonb,
    'manifest_version', '3',
    'source_package_exported_at', null
  );

  v_active_failure_plan := jsonb_set(
    jsonb_set(
      v_active_plan,
      '{blueprint,title}',
      to_jsonb('Active identity rollback'::text)
    ),
    '{assessments,0,content,questions,1,id}',
    to_jsonb(v_active_question_two_row_id)
  );

  -- The second planned identity now matches row one by artifact_id and row two
  -- by physical id. The first question maps uniquely before the ambiguity, so
  -- the exception must also roll back that earlier source_artifact_id write.
  update public.test_questions
  set artifact_id = v_active_question_two_row_id
  where id = v_active_question_one_row_id;

  select blueprint_source_revision
  into v_active_revision
  from public.classrooms
  where id = v_active_classroom_id;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin
    perform public.create_course_blueprint_atomic_v2(
      v_active_failed_operation_id,
      v_teacher_id,
      'capture',
      repeat('0', 64),
      v_active_classroom_id,
      v_active_revision,
      v_active_failure_plan
    );
    raise exception 'Active ambiguous identity unexpectedly succeeded';
  exception when sqlstate '22023' then
    get stacked diagnostics v_error_message = message_text;
    if v_error_message is distinct from
      'Captured Test question identity mapping is ambiguous'
    then
      raise exception 'Active ambiguity raised unexpected message: %',
        v_error_message;
    end if;
  end;
  if exists (
    select 1
    from public.course_blueprint_operations
    where id = v_active_failed_operation_id
  ) or exists (
    select 1
    from public.course_blueprints
    where teacher_id = v_teacher_id
      and title = 'Active identity rollback'
  ) or exists (
    select 1
    from public.classrooms
    where id = v_active_classroom_id
      and (
        source_blueprint_id is not null
        or source_blueprint_origin is not null
      )
  ) or exists (
    select 1
    from public.test_questions
    where test_id = 'b1340000-0000-4000-8000-000000000011'
      and source_artifact_id is not null
  ) then
    raise exception 'Active ambiguous identity was not rolled back atomically';
  end if;

  update public.test_questions
  set artifact_id = v_active_question_one_id
  where id = v_active_question_one_row_id;
  select blueprint_source_revision
  into v_active_revision
  from public.classrooms
  where id = v_active_classroom_id;

  v_result := public.create_course_blueprint_atomic_v2(
    v_active_operation_id,
    v_teacher_id,
    'capture',
    repeat('a', 64),
    v_active_classroom_id,
    v_active_revision,
    v_active_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Active ordinal Blueprint capture failed: %', v_result;
  end if;
  v_blueprint_id := (v_result->>'blueprint_id')::uuid;

  select
    array_agg(artifact_id order by position),
    array_agg(source_artifact_id order by position)
  into v_artifact_ids, v_source_artifact_ids
  from public.test_questions
  where test_id = 'b1340000-0000-4000-8000-000000000011';
  if v_artifact_ids is distinct from array[
    v_active_question_one_id,
    v_active_question_two_id
  ] or v_source_artifact_ids[1] is not null
    or v_source_artifact_ids[2] is distinct from v_active_question_two_id
  then
    raise exception 'Active capture did not map persisted questions by identity';
  end if;

  select content
  into v_content
  from public.course_blueprint_assessments
  where course_blueprint_id = v_blueprint_id
    and position = 0;
  if exists (
    select 1
    from jsonb_array_elements(v_content->'questions') as question(value)
    where question.value ? 'position'
  ) then
    raise exception 'Active capture persisted a redundant Test question position';
  end if;
  select array_agg(
    (question.value->>'id')::uuid
    order by question.ordinality
  )
  into v_blueprint_question_ids
  from jsonb_array_elements(v_content->'questions')
    with ordinality as question(value, ordinality);
  if v_blueprint_question_ids is distinct from array[
    v_active_question_two_id,
    v_active_draft_only_question_id
  ] then
    raise exception 'Active capture did not preserve reordered and draft-only questions';
  end if;

  v_replay := public.create_course_blueprint_atomic_v2(
    v_active_operation_id,
    v_teacher_id,
    'capture',
    repeat('a', 64),
    v_active_classroom_id,
    v_active_revision,
    v_active_plan
  );
  if not coalesce((v_replay->>'replayed')::boolean, false)
    or v_replay->>'blueprint_id' <> v_blueprint_id::text
  then
    raise exception 'Active ordinal Blueprint capture did not replay';
  end if;
  select count(*)
  into v_count
  from public.course_blueprints
  where teacher_id = v_teacher_id
    and title = 'Active ordinal Blueprint';
  if v_count <> 1 then
    raise exception 'Active ordinal replay created duplicate Blueprints';
  end if;

  v_archived_plan := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          v_active_plan,
          '{blueprint,title}',
          to_jsonb('Archived ordinal Blueprint'::text)
        ),
        '{assessments,0,artifact_id}',
        to_jsonb(v_archived_test_artifact_id)
      ),
      '{assessments,0,title}',
      to_jsonb('Archived multi-question Test'::text)
    ),
    '{assessments,0,content}',
    jsonb_build_object(
      'title', 'Archived multi-question Test',
      'show_results', false,
      'questions', jsonb_build_array(
        jsonb_build_object(
          'id', v_archived_question_two_id,
          'question_type', 'open_response',
          'question_text', 'Archived question two',
          'options', '[]'::jsonb,
          'correct_option', null,
          'answer_key', 'A concise explanation',
          'sample_solution', null,
          'points', 1,
          'response_max_chars', 5000,
          'response_monospace', false
        ),
        jsonb_build_object(
          'id', v_archived_draft_only_question_id,
          'question_type', 'open_response',
          'question_text', 'Archived draft-only question',
          'options', '[]'::jsonb,
          'correct_option', null,
          'answer_key', null,
          'sample_solution', null,
          'points', 1,
          'response_max_chars', 5000,
          'response_monospace', false
        )
      )
    )
  );

  v_archived_failure_plan := jsonb_set(
    jsonb_set(
      v_archived_plan,
      '{blueprint,title}',
      to_jsonb('Archived ordinal rollback'::text)
    ),
    '{assessments,0,content,questions,1,id}',
    to_jsonb(v_archived_question_two_row_id)
  );

  update public.test_questions
  set artifact_id = v_archived_question_two_row_id
  where id = v_archived_question_one_row_id;

  select blueprint_source_revision
  into v_archived_revision
  from public.classrooms
  where id = v_archived_classroom_id;

  begin
    perform public.create_archived_classroom_blueprint_atomic(
      v_archived_failed_operation_id,
      v_teacher_id,
      repeat('b', 64),
      v_archived_classroom_id,
      v_archived_revision,
      v_archived_failure_plan
    );
    raise exception 'Archived ambiguous identity unexpectedly succeeded';
  exception when sqlstate '22023' then
    get stacked diagnostics v_error_message = message_text;
    if v_error_message is distinct from
      'Archived Test question identity mapping is ambiguous'
    then
      raise exception 'Archived ambiguity raised unexpected message: %',
        v_error_message;
    end if;
  end;
  if exists (
    select 1
    from public.course_blueprint_operations
    where id = v_archived_failed_operation_id
  ) or exists (
    select 1
    from public.course_blueprints
    where teacher_id = v_teacher_id
      and title = 'Archived ordinal rollback'
  ) or exists (
    select 1
    from public.classrooms
    where id = v_archived_classroom_id
      and source_blueprint_id is not null
  ) or exists (
    select 1
    from public.test_questions
    where test_id = 'b1340000-0000-4000-8000-000000000021'
      and source_artifact_id is not null
  ) then
    raise exception 'Archived ambiguous identity was not rolled back atomically';
  end if;

  update public.test_questions
  set artifact_id = v_archived_question_one_id
  where id = v_archived_question_one_row_id;
  select blueprint_source_revision
  into v_archived_revision
  from public.classrooms
  where id = v_archived_classroom_id;

  v_result := public.create_archived_classroom_blueprint_atomic(
    v_archived_operation_id,
    v_teacher_id,
    repeat('c', 64),
    v_archived_classroom_id,
    v_archived_revision,
    v_archived_plan
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Archived ordinal Blueprint reuse failed: %', v_result;
  end if;
  v_blueprint_id := (v_result->>'blueprint_id')::uuid;

  select
    array_agg(artifact_id order by position),
    array_agg(source_artifact_id order by position)
  into v_artifact_ids, v_source_artifact_ids
  from public.test_questions
  where test_id = 'b1340000-0000-4000-8000-000000000021';
  if v_artifact_ids is distinct from array[
    v_archived_question_one_id,
    v_archived_question_two_id
  ] or v_source_artifact_ids[1] is not null
    or v_source_artifact_ids[2] is distinct from v_archived_question_two_id
  then
    raise exception 'Archived reuse did not map persisted questions by identity';
  end if;

  select content
  into v_content
  from public.course_blueprint_assessments
  where course_blueprint_id = v_blueprint_id
    and position = 0;
  if exists (
    select 1
    from jsonb_array_elements(v_content->'questions') as question(value)
    where question.value ? 'position'
  ) then
    raise exception 'Archived reuse persisted a redundant Test question position';
  end if;
  select array_agg(
    (question.value->>'id')::uuid
    order by question.ordinality
  )
  into v_blueprint_question_ids
  from jsonb_array_elements(v_content->'questions')
    with ordinality as question(value, ordinality);
  if v_blueprint_question_ids is distinct from array[
    v_archived_question_two_id,
    v_archived_draft_only_question_id
  ] then
    raise exception 'Archived reuse did not preserve reordered and draft-only questions';
  end if;

  v_replay := public.create_archived_classroom_blueprint_atomic(
    v_archived_operation_id,
    v_teacher_id,
    repeat('c', 64),
    v_archived_classroom_id,
    v_archived_revision,
    v_archived_plan
  );
  if not coalesce((v_replay->>'replayed')::boolean, false)
    or v_replay->>'blueprint_id' <> v_blueprint_id::text
  then
    raise exception 'Archived ordinal Blueprint reuse did not replay';
  end if;
  select count(*)
  into v_count
  from public.course_blueprints
  where teacher_id = v_teacher_id
    and title = 'Archived ordinal Blueprint';
  if v_count <> 1 then
    raise exception 'Archived ordinal replay created duplicate Blueprints';
  end if;
end;
$contract$;

rollback;
SQL

echo "Blueprint test-question stable identity database contract passed."
