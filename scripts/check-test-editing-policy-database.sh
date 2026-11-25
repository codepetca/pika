#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml | head -n 1)"
DB_CONTAINER="${TEST_EDITING_DB_CONTAINER:-supabase_db_${PROJECT_ID}}"
DB_NAME="${TEST_EDITING_DATABASE_NAME:-postgres}"
if [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
  echo "Supabase database container is not running: $DB_CONTAINER" >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.users (id, email, role) values
  ('14200000-0000-4000-8000-000000000001', 'test-policy-teacher@example.test', 'teacher'),
  ('14200000-0000-4000-8000-000000000002', 'test-policy-student@example.test', 'student');

insert into public.classrooms (id, teacher_id, title, class_code, archived_at)
values (
  '14200000-0000-4000-8000-000000000010',
  '14200000-0000-4000-8000-000000000001',
  'Test editing archive contract',
  'TST142',
  clock_timestamp()
);

insert into public.classroom_enrollments (classroom_id, student_id)
values (
  '14200000-0000-4000-8000-000000000010',
  '14200000-0000-4000-8000-000000000002'
);

insert into public.tests (
  id, classroom_id, title, status, points_possible, created_by
) values
  (
    '14200000-0000-4000-8000-000000000011',
    '14200000-0000-4000-8000-000000000010',
    'Current locked Test', 'active', 2,
    '14200000-0000-4000-8000-000000000001'
  ),
  (
    '14200000-0000-4000-8000-000000000012',
    '14200000-0000-4000-8000-000000000010',
    'Legacy started Test', 'active', 2,
    '14200000-0000-4000-8000-000000000001'
  ),
  (
    '14200000-0000-4000-8000-000000000013',
    '14200000-0000-4000-8000-000000000010',
    'Legacy untouched Test', 'active', 2,
    '14200000-0000-4000-8000-000000000001'
  );

insert into public.test_questions (
  id, test_id, question_type, question_text, options, correct_option,
  points, response_max_chars, position
) values
  (
    '14200000-0000-4000-8000-000000000021',
    '14200000-0000-4000-8000-000000000011',
    'multiple_choice', 'Current prompt', '["First","Second"]', 0, 2, 5000, 0
  ),
  (
    '14200000-0000-4000-8000-000000000022',
    '14200000-0000-4000-8000-000000000012',
    'multiple_choice', 'Legacy started prompt', '["First","Second"]', 0, 2, 5000, 0
  ),
  (
    '14200000-0000-4000-8000-000000000023',
    '14200000-0000-4000-8000-000000000013',
    'multiple_choice', 'Legacy untouched prompt', '["First","Second"]', 1, 2, 5000, 0
  );

insert into public.test_attempts (
  id, test_id, student_id, responses, is_submitted, created_at, updated_at
) values
  (
    '14200000-0000-4000-8000-000000000031',
    '14200000-0000-4000-8000-000000000011',
    '14200000-0000-4000-8000-000000000002',
    '{}'::jsonb, false, '2026-08-30T12:00:00Z', '2026-08-30T12:00:00Z'
  ),
  (
    '14200000-0000-4000-8000-000000000032',
    '14200000-0000-4000-8000-000000000012',
    '14200000-0000-4000-8000-000000000002',
    '{}'::jsonb, false, '2026-08-30T13:00:00Z', '2026-08-30T13:00:00Z'
  );

update public.tests
set questions_locked_at = case id
  when '14200000-0000-4000-8000-000000000011'::uuid
    then '2026-08-30T12:00:00Z'::timestamptz
  when '14200000-0000-4000-8000-000000000012'::uuid
    then '2026-08-30T13:00:00Z'::timestamptz
  else questions_locked_at
end
where id in (
  '14200000-0000-4000-8000-000000000011',
  '14200000-0000-4000-8000-000000000012'
);

create temporary table expected_test_policy_rows (
  table_name text not null,
  row_id uuid not null,
  row_data jsonb not null,
  primary key (table_name, row_id)
) on commit drop;

do $contract$
declare
  v_teacher_id constant uuid := '14200000-0000-4000-8000-000000000001';
  v_classroom_id constant uuid := '14200000-0000-4000-8000-000000000010';
  v_export_id constant uuid := '14200000-0000-4000-8000-000000000040';
  v_restore_id constant uuid := '14200000-0000-4000-8000-000000000041';
  v_archive_id uuid;
  v_source_revision bigint;
  v_counts jsonb;
  v_result jsonb;
  v_rows jsonb;
  v_resource record;
  v_mismatch_count integer;
  v_bad_choice jsonb;
begin
  v_result := public.begin_classroom_archive_export_v2(
    v_export_id,
    v_teacher_id,
    v_classroom_id,
    repeat('1', 64),
    '107_classroom_archive_v2_direct_source',
    'abcdef1234567890',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb,
    2,
    2
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'snapshot_ready'
  then
    raise exception 'Test editing archive export begin failed: %', v_result;
  end if;
  v_archive_id := (v_result->>'archive_id')::uuid;
  v_counts := v_result->'resource_counts';

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract_versions
    where format_version = 2
    order by export_position
  loop
    execute format(
      'insert into expected_test_policy_rows (table_name, row_id, row_data)
       select %L, source.%I, to_jsonb(source)
       from public.classroom_archive_snapshot_resources snapshot
       join public.%I source on source.%I = snapshot.row_id
       where snapshot.operation_id = $1 and snapshot.table_name = %L',
      v_resource.table_name,
      v_resource.primary_key_column,
      v_resource.table_name,
      v_resource.primary_key_column,
      v_resource.table_name
    ) using v_export_id;
  end loop;

  if not public.stage_classroom_archive_object_upload_v2(
    v_export_id,
    v_teacher_id,
    'classroom-archives',
    format('%s/%s/%s/classroom-v2.tar.gz', v_teacher_id, v_classroom_id, v_archive_id),
    repeat('2', 64),
    1024,
    2
  ) then
    raise exception 'Test editing archive upload intent was rejected';
  end if;

  v_result := public.complete_classroom_archive_export_v2(
    v_export_id,
    v_teacher_id,
    'classroom-archives',
    format('%s/%s/%s/classroom-v2.tar.gz', v_teacher_id, v_classroom_id, v_archive_id),
    repeat('2', 64),
    repeat('3', 64),
    1024,
    4096,
    v_counts,
    2,
    v_counts,
    '{"total_count":0,"total_bytes":0,"by_bucket":{}}'::jsonb,
    '{
      "read_back_verified": true,
      "artifact_checksum_verified": true,
      "manifest_verified": true,
      "resource_checksums_verified": true,
      "resource_counts_verified": true,
      "storage_objects_verified": true,
      "actor_snapshots_verified": true
    }'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'completed'
  then
    raise exception 'Test editing archive export finalization failed: %', v_result;
  end if;

  select source_revision into v_source_revision
  from public.classroom_archives where id = v_archive_id;

  insert into public.classroom_cold_tombstones (
    classroom_id, teacher_id, archive_id, title, archived_at, compacted_at,
    source_revision
  )
  select
    classroom.id, classroom.teacher_id, v_archive_id, classroom.title,
    classroom.archived_at, clock_timestamp(), v_source_revision
  from public.classrooms classroom
  where classroom.id = v_classroom_id;

  perform set_config('pika.classroom_archive_compaction', 'on', true);
  delete from public.classrooms where id = v_classroom_id;
  perform set_config('pika.classroom_archive_compaction', 'off', true);

  v_result := public.begin_classroom_archive_restore_v2(
    v_restore_id,
    v_teacher_id,
    v_classroom_id,
    v_archive_id,
    repeat('4', 64),
    '107_classroom_archive_v2_direct_source',
    '[]'::jsonb,
    v_counts,
    '[]'::jsonb,
    2147483648,
    2,
    2,
    v_counts
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'snapshot_ready'
  then
    raise exception 'Test editing archive restore begin failed: %', v_result;
  end if;

  for v_resource in
    select table_name
    from public.classroom_archive_resource_contract_versions
    where format_version = 2
    order by export_position
  loop
    select jsonb_agg(
      case
        when table_name = 'tests'
          and row_id in (
            '14200000-0000-4000-8000-000000000012',
            '14200000-0000-4000-8000-000000000013'
          )
          then row_data - 'questions_locked_at'
        -- Legacy archives omit244's write epoch. Restore must allocate a new
        -- revision while preserving every academic/lifecycle field below.
        when table_name = 'test_attempts' then row_data - 'draft_revision'
        else row_data
      end
      order by row_id
    )
    into v_rows
    from expected_test_policy_rows
    where table_name = v_resource.table_name;

    if v_rows is not null then
      v_result := public.stage_classroom_archive_restore_rows_v2(
        v_restore_id,
        v_teacher_id,
        v_resource.table_name,
        v_rows,
        2
      );
      if coalesce((v_result->>'ok')::boolean, false) is not true then
        raise exception 'Test editing restore staging failed for %: %',
          v_resource.table_name, v_result;
      end if;
    end if;
  end loop;

  v_result := public.complete_classroom_archive_restore_v2(
    v_restore_id,
    v_teacher_id,
    '{
      "archive_checksum_verified": true,
      "manifest_verified": true,
      "resource_checksums_verified": true,
      "resource_counts_verified": true,
      "storage_objects_verified": true,
      "actor_snapshots_verified": true,
      "schema_adapter_available": true,
      "restored_storage_objects_verified": true,
      "adapter_chain": []
    }'::jsonb,
    2
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'completed'
  then
    raise exception 'Test editing archive restore finalization failed: %', v_result;
  end if;

  if (
    select questions_locked_at from public.tests
    where id = '14200000-0000-4000-8000-000000000011'
  ) is distinct from '2026-08-30T12:00:00Z'::timestamptz then
    raise exception 'Current locked Test did not preserve its boundary';
  end if;
  if (
    select questions_locked_at from public.tests
    where id = '14200000-0000-4000-8000-000000000012'
  ) is distinct from '2026-08-30T13:00:00Z'::timestamptz then
    raise exception 'Legacy started Test did not reconstruct its boundary';
  end if;
  if (
    select questions_locked_at from public.tests
    where id = '14200000-0000-4000-8000-000000000013'
  ) is not null then
    raise exception 'Legacy untouched Test was unexpectedly locked';
  end if;

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract_versions
    where format_version = 2
    order by export_position
  loop
    execute format(
      'select count(*)
       from expected_test_policy_rows expected
       left join public.%I restored on restored.%I = expected.row_id
       where expected.table_name = $1
         and (restored.%I is null or
           (case when $1 = ''test_attempts'' then to_jsonb(restored) - ''draft_revision'' else to_jsonb(restored) end)
           is distinct from
           (case when $1 = ''test_attempts'' then expected.row_data - ''draft_revision'' else expected.row_data end))',
      v_resource.table_name,
      v_resource.primary_key_column,
      v_resource.primary_key_column
    ) into v_mismatch_count using v_resource.table_name;
    if v_mismatch_count <> 0 then
      raise exception 'Test editing restored rows differ for %', v_resource.table_name;
    end if;
  end loop;

  if exists (
    select 1 from expected_test_policy_rows expected
    join public.test_attempts restored on restored.id = expected.row_id
    where expected.table_name = 'test_attempts'
      and (restored.draft_revision <= (expected.row_data->>'draft_revision')::bigint
        or restored.draft_revision > 9007199254740991)
  ) then
    raise exception 'Restored Test attempt did not receive a fresh safe revision';
  end if;

  -- A started Test can correct one existing MC choice without rebinding the
  -- selected_option index to another position. Direct SQL must enforce the
  -- same boundary as the teacher editor and draft API.
  -- The shared trigger also handles availability rows, which have no options
  -- column. Their writes must not evaluate the question-only choice guard.
  insert into public.test_student_availability (
    id, test_id, student_id, state, updated_by
  ) values (
    '14200000-0000-4000-8000-000000000098',
    '14200000-0000-4000-8000-000000000011',
    '14200000-0000-4000-8000-000000000002',
    'closed', v_teacher_id
  );

  update public.test_questions
  set options = '["First corrected","Second"]'::jsonb
  where id = '14200000-0000-4000-8000-000000000021';
  if (
    select options from public.test_questions
    where id = '14200000-0000-4000-8000-000000000021'
  ) is distinct from '["First corrected","Second"]'::jsonb then
    raise exception 'Locked Test did not persist a single choice correction';
  end if;

  begin
    update public.test_questions
    set options = '["Second","First corrected"]'::jsonb
    where id = '14200000-0000-4000-8000-000000000021';
    raise exception 'Locked Test accepted a choice reorder';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.test_questions
    set options = '["One","Two"]'::jsonb
    where id = '14200000-0000-4000-8000-000000000021';
    raise exception 'Locked Test accepted two choice edits in one save';
  exception when sqlstate '55000' then null;
  end;
  for v_bad_choice in
    select value from jsonb_array_elements('[{"bad":true},42,null]'::jsonb)
  loop
    begin
      update public.test_questions
      set options = jsonb_build_array(v_bad_choice, 'Second')
      where id = '14200000-0000-4000-8000-000000000021';
      raise exception 'Locked Test accepted a non-text choice: %', v_bad_choice;
    exception when sqlstate '55000' then null;
    end;
  end loop;
  begin
    update public.test_questions
    set correct_option = 1
    where id = '14200000-0000-4000-8000-000000000021';
    raise exception 'Locked Test accepted a marked-answer change';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.test_questions
    set points = 3
    where id = '14200000-0000-4000-8000-000000000021';
    raise exception 'Locked Test accepted a point change';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.test_questions
    set response_max_chars = 100
    where id = '14200000-0000-4000-8000-000000000021';
    raise exception 'Locked Test accepted a response-setting change';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.test_questions
    set position = 1
    where id = '14200000-0000-4000-8000-000000000021';
    raise exception 'Locked Test accepted a question reorder';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.test_questions
    where id = '14200000-0000-4000-8000-000000000021';
    raise exception 'Locked Test accepted a question delete';
  exception when sqlstate '55000' then null;
  end;

  begin
    insert into public.test_questions (
      id, test_id, question_type, question_text, points, position
    ) values (
      '14200000-0000-4000-8000-000000000099',
      '14200000-0000-4000-8000-000000000011',
      'open_response', 'Outside maintenance', 1, 99
    );
    raise exception 'Locked Test accepted a structural insert';
  exception when sqlstate '55000' then null;
  end;
end;
$contract$;

do $title_contract$
declare
  v_teacher constant uuid := '14200000-0000-4000-8000-000000000001';
  v_classroom constant uuid := '14200000-0000-4000-8000-000000000100';
  v_test constant uuid := '14200000-0000-4000-8000-000000000101';
  v_question constant uuid := '14200000-0000-4000-8000-000000000102';
  v_deadline timestamptz := clock_timestamp() + interval '20 seconds';
  v_content jsonb;
  v_result jsonb;
  v_source jsonb;
begin
  insert into public.classrooms (id, teacher_id, title, class_code)
  values (v_classroom, v_teacher, 'Title correction contract', 'TST332');

  insert into public.tests (id, classroom_id, title, status, show_results, created_by)
  values (v_test, v_classroom, 'Original Test', 'closed', false, v_teacher);

  insert into public.test_questions (id, artifact_id, test_id, question_type, question_text,
    options, correct_option, points, response_max_chars, response_monospace, position)
  values (v_question, v_question, v_test, 'multiple_choice', 'Original prompt',
    '["First","Second"]', 0, 2, 5000, false, 0);

  v_content := jsonb_build_object(
    'title', 'Corrected Test', 'show_results', false, 'question_identity_version', 1,
    'questions', jsonb_build_array(jsonb_build_object(
      'id', v_question, 'question_type', 'multiple_choice', 'question_text', 'Corrected prompt',
      'options', '["First","Second"]'::jsonb, 'correct_option', 0, 'answer_key', null,
      'sample_solution', null, 'points', 2, 'response_max_chars', 5000, 'response_monospace', false
    ))
  );
  insert into public.assessment_drafts
    (assessment_type, assessment_id, classroom_id, content, version, created_by, updated_by)
  values ('test', v_test, v_classroom, jsonb_set(v_content, '{title}', '"Original Test"'), 1, v_teacher, v_teacher);

  update public.tests set questions_locked_at = transaction_timestamp() where id = v_test;
  v_source := public.snapshot_test_draft_save_for_owner_v1(v_teacher, v_test, v_deadline);
  v_result := public.finish_test_draft_save_for_owner_v1(
    v_teacher, v_test, v_classroom, v_source->>'source_sha256', 1, 'save', v_content, null, false, v_deadline
  );

  if v_result #>> '{test,title}' is distinct from 'Corrected Test'
    or v_result #>> '{draft,content,title}' is distinct from 'Corrected Test'
    or v_result #>> '{editingPolicy,structureLocked}' is distinct from 'true'
    or (select question_text from public.test_questions where id = v_question) is distinct from 'Corrected prompt'
  then
    raise exception 'Started Test title and prompt correction did not save together';
  end if;

  v_source := public.snapshot_test_draft_save_for_owner_v1(v_teacher, v_test, v_deadline);
  begin
    perform public.finish_test_draft_save_for_owner_v1(
      v_teacher, v_test, v_classroom, v_source->>'source_sha256', 2, 'save',
      jsonb_set(v_content, '{questions,0,points}', '3'), null, false, v_deadline
    );
    raise exception 'Started Test draft save accepted a points change';
  exception when sqlstate 'PT409' then null;
  end;

  begin
    perform public.finish_test_draft_save_for_owner_v1(
      v_teacher, v_test, v_classroom, v_source->>'source_sha256', 2, 'save',
      jsonb_set(v_content, '{show_results}', 'true'), null, false, v_deadline
    );
    raise exception 'Started Test draft save accepted a results visibility change';
  exception when sqlstate 'PT409' then null;
  end;
end;
$title_contract$;

rollback;
SQL

echo "Test editing policy database checks passed."
