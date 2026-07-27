#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml | head -n 1)"
DB_CONTAINER="${CLASSROOM_ARCHIVE_DB_CONTAINER:-supabase_db_${PROJECT_ID}}"
DB_NAME="${CLASSROOM_ARCHIVE_DATABASE_NAME:-postgres}"
if [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
  echo "Supabase database container is not running: $DB_CONTAINER" >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

do $compatibility$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.begin_classroom_archive_export(uuid,uuid,uuid,text,text,text,jsonb)',
    'public.stage_classroom_archive_object_upload(uuid,uuid,text,text,text,bigint)',
    'public.complete_classroom_archive_export(uuid,uuid,text,text,text,text,bigint,bigint,jsonb,jsonb,jsonb)',
    'public.begin_classroom_archive_restore(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,bigint)',
    'public.stage_classroom_archive_restore_rows(uuid,uuid,text,jsonb)',
    'public.complete_classroom_archive_restore(uuid,uuid,jsonb)'
  ]
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Deployed archive-v1 RPC signature is missing: %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'Service role lost archive-v1 RPC execution: %', v_signature;
    end if;
  end loop;
end;
$compatibility$;

create temporary table expected_archive_v2_rows (
  table_name text not null,
  row_id uuid not null,
  row_data jsonb not null,
  primary key (table_name, row_id)
) on commit drop;

insert into public.users (id, email, role)
values
  ('12000000-0000-4000-8000-000000000001', 'archive-v2-teacher@example.test', 'teacher'),
  ('12000000-0000-4000-8000-000000000002', 'archive-v2-student@example.test', 'student');

insert into public.classrooms (
  id, teacher_id, title, class_code, archived_at
) values (
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'Archive v2 contract classroom',
  'ARV201',
  clock_timestamp()
);

insert into public.quizzes (
  id, classroom_id, title, status, show_results, created_by, points_possible
) values (
  '32000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'Historical archive v2 quiz',
  'closed',
  true,
  '12000000-0000-4000-8000-000000000001',
  10
);

insert into public.quiz_questions (
  id, quiz_id, question_text, options, correct_option, position
) values (
  '32000000-0000-4000-8000-000000000002',
  '32000000-0000-4000-8000-000000000001',
  'Historical archive v2 question',
  '["First", "Second"]'::jsonb,
  1,
  0
);

insert into public.quiz_responses (
  id, quiz_id, question_id, student_id, selected_option
) values (
  '32000000-0000-4000-8000-000000000003',
  '32000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000002',
  '12000000-0000-4000-8000-000000000002',
  1
);

insert into public.quiz_student_scores (
  id, quiz_id, student_id, manual_override_score, graded_by
) values (
  '32000000-0000-4000-8000-000000000004',
  '32000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000002',
  9,
  'teacher'
);

insert into public.assessment_drafts (
  id, assessment_type, assessment_id, classroom_id, content, version,
  created_by, updated_by
) values (
  '32000000-0000-4000-8000-000000000005',
  'quiz',
  '32000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '{"title":"Historical archive v2 draft"}'::jsonb,
  1,
  '12000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001'
);

do $contract$
declare
  v_teacher_id constant uuid := '12000000-0000-4000-8000-000000000001';
  v_student_id constant uuid := '12000000-0000-4000-8000-000000000002';
  v_classroom_id constant uuid := '22000000-0000-4000-8000-000000000001';
  v_export_operation_id constant uuid := '42000000-0000-4000-8000-000000000001';
  v_fenced_operation_id constant uuid := '42000000-0000-4000-8000-000000000002';
  v_restore_operation_id constant uuid := '42000000-0000-4000-8000-000000000003';
  v_legacy_fenced_operation_id constant uuid := '42000000-0000-4000-8000-000000000004';
  v_archive_id uuid;
  v_source_revision bigint;
  v_source_counts jsonb;
  v_archive_counts jsonb;
  v_result jsonb;
  v_rows jsonb;
  v_resource record;
begin
  if (
    select count(*)
    from public.classroom_archive_resource_contract_versions
    where format_version = 1
  ) <> 42 then
    raise exception 'Archive-v1 version registry is incomplete';
  end if;
  if (
    select count(*)
    from public.classroom_archive_resource_contract_versions
    where format_version = 2
  ) <> 40 then
    raise exception 'Archive-v2 version registry is incomplete';
  end if;
  if exists (
    select 1
    from public.classroom_archive_resource_contract_versions
    where format_version = 2
      and table_name in (
        'quizzes',
        'quiz_questions',
        'quiz_responses',
        'quiz_student_scores'
      )
  ) then
    raise exception 'Archive-v2 registry contains Quiz tables';
  end if;

  v_result := public.begin_classroom_archive_export_v2(
    v_export_operation_id,
    v_teacher_id,
    v_classroom_id,
    repeat('1', 64),
    '105_classroom_archive_v2_contract',
    'abcdef1234567890',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb,
    1,
    2
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'snapshot_ready'
    or (v_result->>'source_contract_version')::integer <> 1
    or (v_result->>'archive_format_version')::integer <> 2
  then
    raise exception 'Archive-v2 export begin failed: %', v_result;
  end if;

  v_archive_id := (v_result->>'archive_id')::uuid;
  v_source_counts := v_result->'resource_counts';
  select jsonb_object_agg(
    contract.table_name,
    case contract.table_name
      when 'assessment_drafts' then '0'::jsonb
      when 'classroom_retired_assessment_records' then '5'::jsonb
      when 'classroom_retired_assessment_record_actors' then '5'::jsonb
      else coalesce(v_source_counts->contract.table_name, '0'::jsonb)
    end
    order by contract.export_position
  )
  into v_archive_counts
  from public.classroom_archive_resource_contract_versions contract
  where contract.format_version = 2;

  if not public.stage_classroom_archive_object_upload_v2(
    v_export_operation_id,
    v_teacher_id,
    'classroom-archives',
    format(
      '%s/%s/%s/classroom-v2.tar.gz',
      v_teacher_id,
      v_classroom_id,
      v_archive_id
    ),
    repeat('2', 64),
    1024,
    2
  ) then
    raise exception 'Archive-v2 upload intent was rejected';
  end if;

  v_result := public.complete_classroom_archive_export_v2(
    v_export_operation_id,
    v_teacher_id,
    'classroom-archives',
    format(
      '%s/%s/%s/classroom-v2.tar.gz',
      v_teacher_id,
      v_classroom_id,
      v_archive_id
    ),
    repeat('2', 64),
    repeat('3', 64),
    1024,
    4096,
    v_source_counts,
    2,
    v_archive_counts,
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
    raise exception 'Archive-v2 export finalization failed: %', v_result;
  end if;
  if not exists (
    select 1
    from public.classroom_archives
    where id = v_archive_id
      and format_version = 2
      and resource_counts = v_archive_counts
  ) then
    raise exception 'Archive-v2 metadata was not persisted';
  end if;

  insert into public.classroom_retired_assessment_records (
    id, classroom_id, source_contract, source_contract_version,
    source_resource, source_row_id, parent_source_resource,
    parent_source_row_id, payload, payload_sha256, checksum_algorithm
  )
  select
    '52000000-0000-4000-8000-000000000001',
    v_classroom_id,
    'pika.classroom-archive@1/legacy-quiz',
    1,
    'quizzes',
    quiz.id,
    null,
    null,
    to_jsonb(quiz),
    repeat('4', 64),
    'sha256-canonical-json-v1'
  from public.quizzes quiz
  where quiz.id = '32000000-0000-4000-8000-000000000001';

  insert into public.classroom_retired_assessment_records (
    id, classroom_id, source_contract, source_contract_version,
    source_resource, source_row_id, parent_source_resource,
    parent_source_row_id, payload, payload_sha256, checksum_algorithm
  )
  select
    '52000000-0000-4000-8000-000000000002',
    v_classroom_id,
    'pika.classroom-archive@1/legacy-quiz',
    1,
    'quiz_questions',
    question.id,
    'quizzes',
    question.quiz_id,
    to_jsonb(question),
    repeat('5', 64),
    'sha256-canonical-json-v1'
  from public.quiz_questions question
  where question.id = '32000000-0000-4000-8000-000000000002';

  insert into public.classroom_retired_assessment_records (
    id, classroom_id, source_contract, source_contract_version,
    source_resource, source_row_id, parent_source_resource,
    parent_source_row_id, payload, payload_sha256, checksum_algorithm
  )
  select
    '52000000-0000-4000-8000-000000000003',
    v_classroom_id,
    'pika.classroom-archive@1/legacy-quiz',
    1,
    'quiz_responses',
    response.id,
    'quiz_questions',
    response.question_id,
    to_jsonb(response),
    repeat('6', 64),
    'sha256-canonical-json-v1'
  from public.quiz_responses response
  where response.id = '32000000-0000-4000-8000-000000000003';

  insert into public.classroom_retired_assessment_records (
    id, classroom_id, source_contract, source_contract_version,
    source_resource, source_row_id, parent_source_resource,
    parent_source_row_id, payload, payload_sha256, checksum_algorithm
  )
  select
    '52000000-0000-4000-8000-000000000004',
    v_classroom_id,
    'pika.classroom-archive@1/legacy-quiz',
    1,
    'quiz_student_scores',
    score.id,
    'quizzes',
    score.quiz_id,
    to_jsonb(score),
    repeat('7', 64),
    'sha256-canonical-json-v1'
  from public.quiz_student_scores score
  where score.id = '32000000-0000-4000-8000-000000000004';

  insert into public.classroom_retired_assessment_records (
    id, classroom_id, source_contract, source_contract_version,
    source_resource, source_row_id, parent_source_resource,
    parent_source_row_id, payload, payload_sha256, checksum_algorithm
  )
  select
    '52000000-0000-4000-8000-000000000005',
    v_classroom_id,
    'pika.classroom-archive@1/legacy-quiz',
    1,
    'assessment_drafts',
    draft.id,
    'quizzes',
    draft.assessment_id,
    to_jsonb(draft),
    repeat('8', 64),
    'sha256-canonical-json-v1'
  from public.assessment_drafts draft
  where draft.id = '32000000-0000-4000-8000-000000000005';

  insert into public.classroom_retired_assessment_record_actors (
    id, record_id, actor_id, source_column
  ) values
    (
      '62000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      v_teacher_id,
      'created_by'
    ),
    (
      '62000000-0000-4000-8000-000000000002',
      '52000000-0000-4000-8000-000000000003',
      v_student_id,
      'student_id'
    ),
    (
      '62000000-0000-4000-8000-000000000003',
      '52000000-0000-4000-8000-000000000004',
      v_student_id,
      'student_id'
    ),
    (
      '62000000-0000-4000-8000-000000000004',
      '52000000-0000-4000-8000-000000000005',
      v_teacher_id,
      'created_by'
    ),
    (
      '62000000-0000-4000-8000-000000000005',
      '52000000-0000-4000-8000-000000000005',
      v_teacher_id,
      'updated_by'
    );

  v_result := public.begin_classroom_archive_export_v2(
    v_export_operation_id,
    v_teacher_id,
    v_classroom_id,
    repeat('1', 64),
    '105_classroom_archive_v2_contract',
    'abcdef1234567890',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb,
    1,
    2
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or coalesce((v_result->>'replayed')::boolean, false) is not true
    or v_result->>'operation_status' <> 'completed'
  then
    raise exception 'Completed archive-v2 export did not replay: %', v_result;
  end if;

  v_result := public.begin_classroom_archive_export_v2(
    v_fenced_operation_id,
    v_teacher_id,
    v_classroom_id,
    repeat('9', 64),
    '105_classroom_archive_v2_contract',
    'abcdef1234567890',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb,
    1,
    2
  );
  if v_result->>'error_code' <> 'archive_v2_envelope_source_not_supported' then
    raise exception 'Envelope-backed archive-v2 export did not fail closed: %', v_result;
  end if;

  v_result := public.begin_classroom_archive_export(
    v_legacy_fenced_operation_id,
    v_teacher_id,
    v_classroom_id,
    repeat('b', 64),
    '105_classroom_archive_v2_contract',
    'abcdef1234567890',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb
  );
  if v_result->>'error_code' <> 'archive_v2_envelope_source_not_supported'
    or exists (
      select 1
      from public.classroom_archive_snapshot_resources
      where operation_id = v_legacy_fenced_operation_id
    )
  then
    raise exception 'Legacy export did not fail closed before snapshotting envelopes: %',
      v_result;
  end if;

  insert into expected_archive_v2_rows (table_name, row_id, row_data)
  select 'classrooms', classroom.id, to_jsonb(classroom)
  from public.classrooms classroom
  where classroom.id = v_classroom_id;
  insert into expected_archive_v2_rows (table_name, row_id, row_data)
  select 'classroom_retired_assessment_records', record.id, to_jsonb(record)
  from public.classroom_retired_assessment_records record
  where record.classroom_id = v_classroom_id;
  insert into expected_archive_v2_rows (table_name, row_id, row_data)
  select 'classroom_retired_assessment_record_actors', actor.id, to_jsonb(actor)
  from public.classroom_retired_assessment_record_actors actor
  join public.classroom_retired_assessment_records record
    on record.id = actor.record_id
  where record.classroom_id = v_classroom_id;

  select source_revision
  into v_source_revision
  from public.classroom_archives
  where id = v_archive_id;

  insert into public.classroom_cold_tombstones (
    classroom_id, teacher_id, archive_id, title, archived_at, compacted_at,
    source_revision
  )
  select
    classroom.id,
    classroom.teacher_id,
    v_archive_id,
    classroom.title,
    classroom.archived_at,
    clock_timestamp(),
    v_source_revision
  from public.classrooms classroom
  where classroom.id = v_classroom_id;

  perform set_config('pika.classroom_archive_compaction', 'on', true);
  delete from public.classrooms where id = v_classroom_id;
  perform set_config('pika.classroom_archive_compaction', 'off', true);

  v_result := public.begin_classroom_archive_restore_v2(
    v_restore_operation_id,
    v_teacher_id,
    v_classroom_id,
    v_archive_id,
    repeat('a', 64),
    '105_classroom_archive_v2_contract',
    '[]'::jsonb,
    v_archive_counts,
    '[]'::jsonb,
    2147483648,
    2,
    2,
    v_archive_counts
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'snapshot_ready'
    or (v_result->>'source_contract_version')::integer <> 2
    or (v_result->>'restore_contract_version')::integer <> 2
  then
    raise exception 'Archive-v2 restore begin failed: %', v_result;
  end if;

  for v_resource in
    select table_name
    from public.classroom_archive_resource_contract_versions
    where format_version = 2
    order by export_position
  loop
    select jsonb_agg(row_data order by row_id)
    into v_rows
    from expected_archive_v2_rows
    where table_name = v_resource.table_name;
    if v_rows is not null then
      v_result := public.stage_classroom_archive_restore_rows_v2(
        v_restore_operation_id,
        v_teacher_id,
        v_resource.table_name,
        v_rows,
        2
      );
      if coalesce((v_result->>'ok')::boolean, false) is not true then
        raise exception 'Archive-v2 restore staging failed for %: %',
          v_resource.table_name,
          v_result;
      end if;
    end if;
  end loop;

  v_result := public.complete_classroom_archive_restore_v2(
    v_restore_operation_id,
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
    raise exception 'Archive-v2 restore finalization failed: %', v_result;
  end if;
  if (
    select count(*)
    from public.classroom_retired_assessment_records
    where classroom_id = v_classroom_id
  ) <> 5 then
    raise exception 'Archive-v2 restore did not preserve retired assessment records';
  end if;
  if exists (
    select 1 from public.quizzes where classroom_id = v_classroom_id
  ) then
    raise exception 'Archive-v2 restore recreated active Quiz rows';
  end if;
  if exists (
    select 1
    from public.classroom_cold_tombstones
    where classroom_id = v_classroom_id
  ) then
    raise exception 'Archive-v2 restore retained its cold tombstone';
  end if;
end;
$contract$;

rollback;
SQL

RACE_TEACHER_ID="12000000-0000-4000-8000-000000000011"
RACE_CLASSROOM_ID="22000000-0000-4000-8000-000000000011"
RACE_RECORD_ID="52000000-0000-4000-8000-000000000011"
RACE_SOURCE_ROW_ID="32000000-0000-4000-8000-000000000011"
RACE_OPERATION_ID="42000000-0000-4000-8000-000000000011"
RACE_OUTPUT="$(mktemp)"

cleanup_race() {
  rm -f "$RACE_OUTPUT"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -X -v ON_ERROR_STOP=1 \
    >/dev/null 2>&1 <<SQL || true
begin;
delete from public.classroom_archive_snapshot_actors
where operation_id = '$RACE_OPERATION_ID'::uuid;
delete from public.classroom_archive_snapshot_resources
where operation_id = '$RACE_OPERATION_ID'::uuid;
delete from public.classroom_archive_operations
where id = '$RACE_OPERATION_ID'::uuid;
delete from public.classroom_retired_assessment_records
where id = '$RACE_RECORD_ID'::uuid;
delete from public.classrooms where id = '$RACE_CLASSROOM_ID'::uuid;
delete from public.users where id = '$RACE_TEACHER_ID'::uuid;
commit;
SQL
}
trap cleanup_race EXIT

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -X -v ON_ERROR_STOP=1 <<SQL
insert into public.users (id, email, role)
values ('$RACE_TEACHER_ID', 'archive-v2-race@example.test', 'teacher');

insert into public.classrooms (
  id, teacher_id, title, class_code, archived_at
) values (
  '$RACE_CLASSROOM_ID',
  '$RACE_TEACHER_ID',
  'Archive v2 race classroom',
  'ARV211',
  clock_timestamp()
);
SQL

docker exec "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -X -v ON_ERROR_STOP=1 \
  -c "begin;
      select revision from public.classroom_archive_revisions
      where classroom_id = '$RACE_CLASSROOM_ID'::uuid for update;
      insert into public.classroom_retired_assessment_records (
        id, classroom_id, source_contract, source_contract_version,
        source_resource, source_row_id, payload, payload_sha256,
        checksum_algorithm
      ) values (
        '$RACE_RECORD_ID', '$RACE_CLASSROOM_ID',
        'pika.classroom-archive@1/legacy-quiz', 1, 'quizzes',
        '$RACE_SOURCE_ROW_ID',
        '{\"id\":\"$RACE_SOURCE_ROW_ID\",\"title\":\"Concurrent envelope\"}'::jsonb,
        repeat('c', 64), 'sha256-canonical-json-v1'
      );
      select pg_sleep(3);
      commit;" >"$RACE_OUTPUT" 2>&1 &
RACE_WRITER_PID=$!

RACE_READY=0
for _ in {1..40}; do
  RACE_READY="$(docker exec "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -X -Atc \
    "select count(*) from pg_stat_activity
     where pid <> pg_backend_pid()
       and state = 'active'
       and query like '%$RACE_RECORD_ID%pg_sleep(3)%';")"
  [[ "$RACE_READY" -gt 0 ]] && break
  sleep 0.1
done
if [[ "$RACE_READY" -eq 0 ]]; then
  wait "$RACE_WRITER_PID" || true
  cat "$RACE_OUTPUT" >&2
  echo "Envelope race writer did not acquire the revision lock." >&2
  exit 1
fi

RACE_RESULT="$(docker exec "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -X -Atc \
  "select public.begin_classroom_archive_export_v2(
    '$RACE_OPERATION_ID'::uuid,
    '$RACE_TEACHER_ID'::uuid,
    '$RACE_CLASSROOM_ID'::uuid,
    repeat('d', 64),
    '105_classroom_archive_v2_contract',
    'abcdef1234567890',
    '{\"mode\":\"teacher_managed\",\"delete_after\":null}'::jsonb,
    1,
    2
  );")"
wait "$RACE_WRITER_PID"

if [[ "$RACE_RESULT" != *'"error_code": "archive_v2_envelope_source_not_supported"'* ]]; then
  printf '%s\n' "$RACE_RESULT" >&2
  echo "Concurrent envelope insert crossed the archive-v2 snapshot fence." >&2
  exit 1
fi

RACE_SNAPSHOT_COUNT="$(docker exec "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -X -Atc \
  "select count(*) from public.classroom_archive_snapshot_resources
   where operation_id = '$RACE_OPERATION_ID'::uuid;")"
if [[ "$RACE_SNAPSHOT_COUNT" -ne 0 ]]; then
  echo "Concurrent envelope race created incomplete snapshot rows." >&2
  exit 1
fi

echo "Classroom archive-v2 database contract passes."
