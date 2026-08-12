#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${STUDENT_PURGE_DB_CONTAINER:-supabase_db_pika}"
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "Local Pika Supabase database container is not running." >&2
  exit 2
fi

PROJECT_LABEL="$(docker inspect "$DB_CONTAINER" \
  --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
DB_BINDING="$(docker port "$DB_CONTAINER" 5432/tcp 2>/dev/null || true)"
if [[ "$PROJECT_LABEL" != "pika" ]] || ! grep -q ':54322$' <<<"$DB_BINDING"; then
  echo "Refusing non-local or unexpected Supabase database target." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $migration$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '123')
    or to_regprocedure('public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text)') is null
  then raise exception 'Migration 123 is not applied to the local database'; end if;
end;
$migration$;

begin;

do $privileges$
declare v_table text;
begin
  if (select rollout_mode from public.student_purge_settings where singleton) <> 'disabled'
  then raise exception 'Student purge rollout was enabled by migration'; end if;
  if has_function_privilege('anon',
      'public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text)', 'execute')
    or has_function_privilege('authenticated',
      'public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text)', 'execute')
    or not has_function_privilege('service_role',
      'public.begin_student_purge(uuid,uuid,uuid,uuid,text,bigint,text,text)', 'execute')
  then raise exception 'Student purge entry-point privileges are unsafe'; end if;
  foreach v_table in array array[
    'classroom_roster_student_bindings',
    'student_purge_settings','student_purge_operations','student_purge_resources',
    'student_purge_objects','student_purge_fences'
  ] loop
    if has_table_privilege('service_role', 'public.' || v_table, 'INSERT')
      or has_table_privilege('service_role', 'public.' || v_table, 'UPDATE')
      or has_table_privilege('service_role', 'public.' || v_table, 'DELETE')
    then raise exception 'service_role can forge student purge authority through %', v_table; end if;
  end loop;
end;
$privileges$;

do $activate$
declare v_run public.managed_storage_readiness_runs;
begin
  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then raise exception 'Managed storage readiness blocked'; end if;
  perform public.activate_managed_storage_enforcement(v_run.generation, v_run.inventory_digest);
end;
$activate$;

insert into public.users (id, email, role) values
  ('d1230000-0000-4000-8000-000000000001', 'student-purge-teacher@example.test', 'teacher'),
  ('d1230000-0000-4000-8000-000000000002', 'student-purge-target@example.test', 'student'),
  ('d1230000-0000-4000-8000-000000000003', 'student-purge-classmate@example.test', 'student'),
  ('d1230000-0000-4000-8000-000000000004', 'student-purge-provider-blocked@example.test', 'student');

insert into public.classrooms (id, teacher_id, title, class_code) values
  ('d1230000-0000-4000-8000-000000000010', 'd1230000-0000-4000-8000-000000000001', 'Student purge target', 'SP123A'),
  ('d1230000-0000-4000-8000-000000000011', 'd1230000-0000-4000-8000-000000000001', 'Student purge preserved', 'SP123B');

insert into public.classroom_enrollments (classroom_id, student_id) values
  ('d1230000-0000-4000-8000-000000000010', 'd1230000-0000-4000-8000-000000000002'),
  ('d1230000-0000-4000-8000-000000000010', 'd1230000-0000-4000-8000-000000000003'),
  ('d1230000-0000-4000-8000-000000000010', 'd1230000-0000-4000-8000-000000000004'),
  ('d1230000-0000-4000-8000-000000000011', 'd1230000-0000-4000-8000-000000000002');
insert into public.classroom_roster (classroom_id, email) values
  ('d1230000-0000-4000-8000-000000000010', 'student-purge-target@example.test'),
  ('d1230000-0000-4000-8000-000000000010', 'student-purge-classmate@example.test'),
  ('d1230000-0000-4000-8000-000000000010', 'student-purge-provider-blocked@example.test'),
  ('d1230000-0000-4000-8000-000000000011', 'student-purge-target@example.test');
insert into public.entries (student_id, classroom_id, date, text, on_time) values
  ('d1230000-0000-4000-8000-000000000002', 'd1230000-0000-4000-8000-000000000010', '2026-08-11', 'target', true),
  ('d1230000-0000-4000-8000-000000000003', 'd1230000-0000-4000-8000-000000000010', '2026-08-11', 'classmate', true),
  ('d1230000-0000-4000-8000-000000000002', 'd1230000-0000-4000-8000-000000000011', '2026-08-11', 'other classroom', true);

select public.begin_managed_storage_upload(
  'd1230000-0000-4000-8000-000000000020', 'submission-images',
  'student-purge-fixture/target.png', 'd1230000-0000-4000-8000-000000000010',
  null, null, 'student_inline_image',
  'd1230000-0000-4000-8000-000000000002',
  'd1230000-0000-4000-8000-000000000002',
  'fixture', null, 'image/png', 1
);
insert into storage.objects (bucket_id, name) values (
  'submission-images', 'student-purge-fixture/target.png'
);
select public.verify_managed_storage_upload(
  'd1230000-0000-4000-8000-000000000020', repeat('a', 64)
);
select public.managed_storage_mark_ready('d1230000-0000-4000-8000-000000000020');

-- Exercise each major relational family with both target and classmate rows.
insert into public.announcements (id, classroom_id, content, created_by) values (
  'd1230000-0000-4000-8000-000000000030',
  'd1230000-0000-4000-8000-000000000010', 'fixture',
  'd1230000-0000-4000-8000-000000000001'
);
insert into public.announcement_reads (id, announcement_id, user_id) values
  ('d1230000-0000-4000-8000-000000000031', 'd1230000-0000-4000-8000-000000000030', 'd1230000-0000-4000-8000-000000000002'),
  ('d1230000-0000-4000-8000-000000000032', 'd1230000-0000-4000-8000-000000000030', 'd1230000-0000-4000-8000-000000000003');

insert into public.assignments (id, classroom_id, title, due_at, created_by) values (
  'd1230000-0000-4000-8000-000000000040',
  'd1230000-0000-4000-8000-000000000010', 'Shared assignment',
  clock_timestamp() + interval '1 day', 'd1230000-0000-4000-8000-000000000001'
);
insert into public.assignment_docs (id, assignment_id, student_id, content) values
  ('d1230000-0000-4000-8000-000000000041', 'd1230000-0000-4000-8000-000000000040', 'd1230000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}'::jsonb),
  ('d1230000-0000-4000-8000-000000000042', 'd1230000-0000-4000-8000-000000000040', 'd1230000-0000-4000-8000-000000000003', '{"type":"doc","content":[]}'::jsonb);
insert into public.assignment_doc_history (
  id, assignment_doc_id, snapshot, trigger, word_count, char_count
) values (
  'd1230000-0000-4000-8000-000000000043',
  'd1230000-0000-4000-8000-000000000041', '{"type":"doc","content":[]}'::jsonb,
  'manual_save', 0, 0
);
insert into public.assignment_doc_save_operations (
  id, assignment_doc_id, save_session_id, save_sequence, metric_session_id,
  paste_word_count, keystroke_count, content_sha256, document_updated_at
) values (
  'd1230000-0000-4000-8000-000000000044',
  'd1230000-0000-4000-8000-000000000041',
  'd1230000-0000-4000-8000-000000000045', 1,
  'd1230000-0000-4000-8000-000000000046', 0, 1, repeat('c', 64), clock_timestamp()
);
insert into public.assignment_feedback_entries (
  id, assignment_id, student_id, author_type, entry_kind, body, created_by
) values (
  'd1230000-0000-4000-8000-000000000047',
  'd1230000-0000-4000-8000-000000000040',
  'd1230000-0000-4000-8000-000000000002', 'teacher', 'comment', 'target feedback',
  'd1230000-0000-4000-8000-000000000001'
);
insert into public.assignment_ai_grading_runs (
  id, assignment_id, status, triggered_by, selection_hash,
  requested_student_ids_json, requested_count, gradable_count, processed_count, completed_count
) values (
  'd1230000-0000-4000-8000-000000000048',
  'd1230000-0000-4000-8000-000000000040', 'completed',
  'd1230000-0000-4000-8000-000000000001', 'student-purge-shared-assignment',
  '["d1230000-0000-4000-8000-000000000002","d1230000-0000-4000-8000-000000000003"]'::jsonb,
  2, 2, 2, 2
);
insert into public.assignment_ai_grading_run_items (
  id, run_id, assignment_id, student_id, assignment_doc_id, queue_position, status, completed_at
) values
  ('d1230000-0000-4000-8000-000000000049', 'd1230000-0000-4000-8000-000000000048', 'd1230000-0000-4000-8000-000000000040', 'd1230000-0000-4000-8000-000000000002', 'd1230000-0000-4000-8000-000000000041', 0, 'completed', clock_timestamp()),
  ('d1230000-0000-4000-8000-00000000004a', 'd1230000-0000-4000-8000-000000000048', 'd1230000-0000-4000-8000-000000000040', 'd1230000-0000-4000-8000-000000000003', 'd1230000-0000-4000-8000-000000000042', 1, 'completed', clock_timestamp());

insert into public.tests (id, classroom_id, title, status, created_by) values (
  'd1230000-0000-4000-8000-000000000050',
  'd1230000-0000-4000-8000-000000000010', 'Shared test', 'closed',
  'd1230000-0000-4000-8000-000000000001'
);
insert into public.test_questions (id, test_id, question_text) values (
  'd1230000-0000-4000-8000-000000000051',
  'd1230000-0000-4000-8000-000000000050', 'Explain'
);
insert into public.test_attempts (id, test_id, student_id, responses, is_submitted, submitted_at) values
  ('d1230000-0000-4000-8000-000000000052', 'd1230000-0000-4000-8000-000000000050', 'd1230000-0000-4000-8000-000000000002', '{}', true, clock_timestamp()),
  ('d1230000-0000-4000-8000-000000000053', 'd1230000-0000-4000-8000-000000000050', 'd1230000-0000-4000-8000-000000000003', '{}', true, clock_timestamp());
insert into public.test_attempt_history (id, test_attempt_id, snapshot, trigger) values (
  'd1230000-0000-4000-8000-000000000054',
  'd1230000-0000-4000-8000-000000000052', '{}', 'submit'
);
insert into public.test_responses (
  id, test_id, question_id, student_id, response_text, revision
) values
  ('d1230000-0000-4000-8000-000000000055', 'd1230000-0000-4000-8000-000000000050', 'd1230000-0000-4000-8000-000000000051', 'd1230000-0000-4000-8000-000000000002', 'target response', 1),
  ('d1230000-0000-4000-8000-000000000056', 'd1230000-0000-4000-8000-000000000050', 'd1230000-0000-4000-8000-000000000051', 'd1230000-0000-4000-8000-000000000003', 'classmate response', 1);
insert into public.test_focus_events (id, test_id, student_id, session_id, event_type) values (
  'd1230000-0000-4000-8000-000000000057',
  'd1230000-0000-4000-8000-000000000050',
  'd1230000-0000-4000-8000-000000000002',
  'd1230000-0000-4000-8000-000000000058', 'blur'
);
insert into public.test_student_availability (id, test_id, student_id, state, updated_by) values (
  'd1230000-0000-4000-8000-000000000059',
  'd1230000-0000-4000-8000-000000000050',
  'd1230000-0000-4000-8000-000000000002', 'closed',
  'd1230000-0000-4000-8000-000000000001'
);
insert into public.test_ai_grading_runs (
  id, test_id, status, triggered_by, selection_hash, requested_student_ids_json,
  requested_count, eligible_student_count, queued_response_count, processed_count, completed_count
) values (
  'd1230000-0000-4000-8000-00000000005a',
  'd1230000-0000-4000-8000-000000000050', 'completed',
  'd1230000-0000-4000-8000-000000000001', 'student-purge-shared-test',
  '["d1230000-0000-4000-8000-000000000002","d1230000-0000-4000-8000-000000000003"]'::jsonb,
  2, 2, 2, 2, 2
);
insert into public.test_ai_grading_run_items (
  id, run_id, test_id, student_id, question_id, response_id, response_revision,
  queue_position, status, completed_at
) values
  ('d1230000-0000-4000-8000-00000000005b', 'd1230000-0000-4000-8000-00000000005a', 'd1230000-0000-4000-8000-000000000050', 'd1230000-0000-4000-8000-000000000002', 'd1230000-0000-4000-8000-000000000051', 'd1230000-0000-4000-8000-000000000055', 1, 0, 'completed', clock_timestamp()),
  ('d1230000-0000-4000-8000-00000000005c', 'd1230000-0000-4000-8000-00000000005a', 'd1230000-0000-4000-8000-000000000050', 'd1230000-0000-4000-8000-000000000003', 'd1230000-0000-4000-8000-000000000051', 'd1230000-0000-4000-8000-000000000056', 1, 1, 'completed', clock_timestamp());

insert into public.surveys (id, classroom_id, title, position, created_by) values (
  'd1230000-0000-4000-8000-000000000060',
  'd1230000-0000-4000-8000-000000000010', 'Shared survey', 0,
  'd1230000-0000-4000-8000-000000000001'
);
insert into public.survey_questions (id, survey_id, question_text) values (
  'd1230000-0000-4000-8000-000000000061',
  'd1230000-0000-4000-8000-000000000060', 'Reflection'
);
insert into public.survey_responses (id, survey_id, question_id, student_id, response_text) values
  ('d1230000-0000-4000-8000-000000000062', 'd1230000-0000-4000-8000-000000000060', 'd1230000-0000-4000-8000-000000000061', 'd1230000-0000-4000-8000-000000000002', 'target survey'),
  ('d1230000-0000-4000-8000-000000000063', 'd1230000-0000-4000-8000-000000000060', 'd1230000-0000-4000-8000-000000000061', 'd1230000-0000-4000-8000-000000000003', 'classmate survey');
insert into public.report_cards (id, classroom_id, term, created_by) values (
  'd1230000-0000-4000-8000-000000000070',
  'd1230000-0000-4000-8000-000000000010', 'Fixture',
  'd1230000-0000-4000-8000-000000000001'
);
insert into public.report_card_rows (id, report_card_id, student_id, final_percent) values
  ('d1230000-0000-4000-8000-000000000071', 'd1230000-0000-4000-8000-000000000070', 'd1230000-0000-4000-8000-000000000002', 80),
  ('d1230000-0000-4000-8000-000000000072', 'd1230000-0000-4000-8000-000000000070', 'd1230000-0000-4000-8000-000000000003', 90);
insert into public.log_summaries (id, classroom_id, date, model) values (
  'd1230000-0000-4000-8000-000000000073',
  'd1230000-0000-4000-8000-000000000010', '2026-08-11', 'fixture'
);

-- Retained archive and Gradex artifacts are whole-Classroom copies and must be
-- removed because selective rewriting is not supported.
select public.begin_managed_storage_upload(
  'd1230000-0000-4000-8000-000000000021', 'classroom-archives',
  'student-purge-fixture/archive.tar.gz', 'd1230000-0000-4000-8000-000000000010',
  null, null, 'classroom_archive', 'd1230000-0000-4000-8000-000000000001', null,
  'classroom_archive_operation', 'd1230000-0000-4000-8000-000000000080',
  'application/gzip', 1
);
select public.begin_managed_storage_upload(
  'd1230000-0000-4000-8000-000000000022', 'gradex-analytics-extracts',
  'student-purge-fixture/gradex.tar.gz', 'd1230000-0000-4000-8000-000000000010',
  null, null, 'gradex_extract', 'd1230000-0000-4000-8000-000000000001', null,
  'classroom_archive_operation', 'd1230000-0000-4000-8000-000000000082',
  'application/gzip', 1
);
insert into storage.objects (bucket_id, name) values
  ('classroom-archives', 'student-purge-fixture/archive.tar.gz'),
  ('gradex-analytics-extracts', 'student-purge-fixture/gradex.tar.gz');
select public.verify_managed_storage_upload('d1230000-0000-4000-8000-000000000021', repeat('b', 64));
select public.managed_storage_mark_ready('d1230000-0000-4000-8000-000000000021');
select public.verify_managed_storage_upload('d1230000-0000-4000-8000-000000000022', repeat('c', 64));
select public.managed_storage_mark_ready('d1230000-0000-4000-8000-000000000022');
insert into public.classroom_archive_operations (
  id, teacher_id, classroom_id, operation_type, request_sha256, status,
  source_revision, source_schema_migration, source_app_commit, retention,
  archive_id, storage_bucket, storage_path, artifact_sha256, content_sha256,
  compressed_byte_size, uncompressed_byte_size, verification,
  snapshot_created_at, snapshot_expires_at, completed_at, managed_object_id
) values (
  'd1230000-0000-4000-8000-000000000080',
  'd1230000-0000-4000-8000-000000000001',
  'd1230000-0000-4000-8000-000000000010', 'export', repeat('d', 64), 'completed',
  1, '123_fixture', 'fixture', '{"mode":"teacher_managed","delete_after":null}'::jsonb,
  'd1230000-0000-4000-8000-000000000081', 'classroom-archives',
  'student-purge-fixture/archive.tar.gz', repeat('b', 64), repeat('e', 64), 1, 1,
  '{}', clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '1 minute',
  clock_timestamp(), 'd1230000-0000-4000-8000-000000000021'
);
insert into public.classroom_archives (
  id, operation_id, classroom_id, teacher_id, format, format_version,
  source_revision, source_schema_migration, source_app_commit, storage_bucket,
  storage_path, artifact_sha256, content_sha256, compressed_byte_size,
  uncompressed_byte_size, resource_counts, storage_object_counts, verification,
  retention, created_at, verified_at, managed_object_id
) values (
  'd1230000-0000-4000-8000-000000000081',
  'd1230000-0000-4000-8000-000000000080',
  'd1230000-0000-4000-8000-000000000010',
  'd1230000-0000-4000-8000-000000000001', 'pika.classroom-archive', 1, 1,
  '123_fixture', 'fixture', 'classroom-archives', 'student-purge-fixture/archive.tar.gz',
  repeat('b', 64), repeat('e', 64), 1, 1, '{}', '{}', '{}',
  '{"mode":"teacher_managed","delete_after":null}'::jsonb,
  clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '1 minute',
  'd1230000-0000-4000-8000-000000000021'
);
insert into public.classroom_archive_operations (
  id, teacher_id, classroom_id, operation_type, request_sha256, status,
  source_revision, source_schema_migration, source_app_commit, retention,
  archive_id, storage_bucket, storage_path, artifact_sha256, content_sha256,
  compressed_byte_size, uncompressed_byte_size, verification,
  snapshot_created_at, snapshot_expires_at, completed_at, managed_object_id
) values (
  'd1230000-0000-4000-8000-000000000082',
  'd1230000-0000-4000-8000-000000000001',
  'd1230000-0000-4000-8000-000000000010', 'gradex_extract', repeat('f', 64), 'completed',
  1, '123_fixture', 'fixture', '{"mode":"scheduled","delete_after":"2099-01-01T00:00:00Z"}'::jsonb,
  'd1230000-0000-4000-8000-000000000083', 'gradex-analytics-extracts',
  'student-purge-fixture/gradex.tar.gz', repeat('c', 64), repeat('a', 64), 1, 1,
  '{}', clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '1 minute',
  clock_timestamp(), 'd1230000-0000-4000-8000-000000000022'
);
insert into public.classroom_gradex_extracts (
  id, operation_id, source_archive_id, classroom_id, teacher_id, format, format_version,
  source_archive_sha256, storage_bucket, storage_path, artifact_sha256, content_sha256,
  compressed_byte_size, uncompressed_byte_size, resource_counts, verification,
  generated_at, verified_at, delete_after, managed_object_id
) values (
  'd1230000-0000-4000-8000-000000000083',
  'd1230000-0000-4000-8000-000000000082',
  'd1230000-0000-4000-8000-000000000081',
  'd1230000-0000-4000-8000-000000000010',
  'd1230000-0000-4000-8000-000000000001', 'pika.classroom-gradex', 1,
  repeat('b', 64), 'gradex-analytics-extracts', 'student-purge-fixture/gradex.tar.gz',
  repeat('c', 64), repeat('a', 64), 1, 1, '{}', '{}', clock_timestamp(),
  clock_timestamp(), '2099-01-01T00:00:00Z', 'd1230000-0000-4000-8000-000000000022'
);

do $storage_authority$
begin
  begin
    delete from storage.objects where bucket_id = 'submission-images'
      and name = 'student-purge-fixture/target.png';
    raise exception 'Managed object delete bypassed student purge lease authority';
  exception when sqlstate '55000' then null;
  end;
end;
$storage_authority$;

insert into public.pal_daily_log_week_configurations (
  student_id, period_key, config_version, period_status, eligible_days, configured_at
) values (
  'd1230000-0000-4000-8000-000000000004', '2026-W33', 1, 'open', 5, clock_timestamp()
);

update public.student_purge_settings set rollout_mode = 'enabled',
  canary_teacher_id = null, canary_classroom_id = null, canary_student_id = null,
  updated_at = clock_timestamp()
where singleton;

create temporary table fixture_student_purge_inventory on commit drop as
select public.get_student_purge_inventory(
  'd1230000-0000-4000-8000-000000000001',
  'd1230000-0000-4000-8000-000000000010',
  'd1230000-0000-4000-8000-000000000002'
) as payload;

do $provider_block$
declare v_inventory jsonb;
begin
  v_inventory := public.get_student_purge_inventory(
    'd1230000-0000-4000-8000-000000000001',
    'd1230000-0000-4000-8000-000000000010',
    'd1230000-0000-4000-8000-000000000004'
  );
  if v_inventory->>'unavailable_reason' <> 'student_purge_external_erasure_required'
  then raise exception 'Pal-backed student did not fail closed'; end if;
end;
$provider_block$;

do $begin_purge$
declare v_inventory jsonb; v_result jsonb;
begin
  select payload into v_inventory from fixture_student_purge_inventory;
  if not (v_inventory->>'deletion_available')::boolean
  then raise exception 'Canary student purge was not available: %', v_inventory; end if;
  v_result := public.begin_student_purge(
    'd1230000-0000-4000-8000-000000000100',
    'd1230000-0000-4000-8000-000000000001',
    'd1230000-0000-4000-8000-000000000010',
    'd1230000-0000-4000-8000-000000000002',
    'student-purge-target@example.test',
    (v_inventory->>'source_revision')::bigint,
    v_inventory->>'storage_inventory_sha256',
    v_inventory->>'relational_inventory_sha256'
  );
  if not (v_result->>'ok')::boolean then raise exception 'Student purge did not start: %', v_result; end if;
end;
$begin_purge$;

do $fence$
begin
  begin
    insert into public.entries (student_id, classroom_id, date, text, on_time) values (
      'd1230000-0000-4000-8000-000000000002',
      'd1230000-0000-4000-8000-000000000010', '2026-08-12', 'must be fenced', true
    );
    raise exception 'Target student write bypassed the purge fence';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.entries set student_id = 'd1230000-0000-4000-8000-000000000003'
    where student_id = 'd1230000-0000-4000-8000-000000000002'
      and classroom_id = 'd1230000-0000-4000-8000-000000000010';
    raise exception 'Target row reassignment bypassed the purge fence';
  exception when sqlstate '55000' then null;
  end;
  insert into public.entries (student_id, classroom_id, date, text, on_time) values (
    'd1230000-0000-4000-8000-000000000003',
    'd1230000-0000-4000-8000-000000000010', '2026-08-12', 'classmate allowed', true
  );
end;
$fence$;

do $storage_delete$
declare v_claim jsonb; v_object jsonb; v_result jsonb;
begin
  loop
    v_claim := public.claim_student_purge_object(
      'd1230000-0000-4000-8000-000000000100',
      'd1230000-0000-4000-8000-000000000001'
    );
    v_object := v_claim->'object';
    exit when v_object is null;
    begin
      perform public.complete_student_purge_object(
        'd1230000-0000-4000-8000-000000000100',
        'd1230000-0000-4000-8000-000000000001',
        (v_object->>'id')::uuid, (v_object->>'lease_token')::uuid
      );
      raise exception 'Student purge accepted storage completion while bytes remained';
    exception when sqlstate '55000' then null;
    end;
    delete from storage.objects where bucket_id = v_object->>'storage_bucket'
      and name = v_object->>'storage_path';
    v_result := public.complete_student_purge_object(
      'd1230000-0000-4000-8000-000000000100',
      'd1230000-0000-4000-8000-000000000001',
      (v_object->>'id')::uuid, (v_object->>'lease_token')::uuid
    );
    if not (v_result->>'ok')::boolean then raise exception 'Managed object completion failed: %', v_result; end if;
  end loop;
end;
$storage_delete$;

do $finalize$
declare v_result jsonb;
begin
  v_result := public.finalize_student_purge(
    'd1230000-0000-4000-8000-000000000100',
    'd1230000-0000-4000-8000-000000000001'
  );
  if v_result->>'operation_status' <> 'completed'
  then raise exception 'Student purge did not finalize: %', v_result; end if;
end;
$finalize$;

do $completed_replay$
declare v_inventory jsonb; v_result jsonb;
begin
  select payload into v_inventory from fixture_student_purge_inventory;
  v_result := public.begin_student_purge(
    'd1230000-0000-4000-8000-000000000100',
    'd1230000-0000-4000-8000-000000000001',
    'd1230000-0000-4000-8000-000000000010',
    'd1230000-0000-4000-8000-000000000002',
    'student-purge-target@example.test',
    (v_inventory->>'source_revision')::bigint,
    v_inventory->>'storage_inventory_sha256',
    v_inventory->>'relational_inventory_sha256'
  );
  if v_result->>'operation_status' <> 'completed' or not (v_result->>'replayed')::boolean
  then raise exception 'Completed student purge replay lost its target binding: %', v_result; end if;
end;
$completed_replay$;

do $path_reservation$
begin
  begin
    perform public.begin_managed_storage_upload(
      'd1230000-0000-4000-8000-000000000023', 'submission-images',
      'student-purge-fixture/target.png', 'd1230000-0000-4000-8000-000000000010',
      null, null, 'student_inline_image',
      'd1230000-0000-4000-8000-000000000002',
      'd1230000-0000-4000-8000-000000000002',
      'fixture', null, 'image/png', 1
    );
    raise exception 'Managed row recreated a permanently purged path';
  exception when sqlstate '55000' then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values (
      'submission-images', 'student-purge-fixture/target.png'
    );
    raise exception 'Storage bytes recreated a permanently purged path';
  exception when sqlstate '55000' then null;
  end;
end;
$path_reservation$;

do $preservation$
begin
  if not exists (select 1 from public.users where id = 'd1230000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.classroom_enrollments
      where classroom_id = 'd1230000-0000-4000-8000-000000000011'
        and student_id = 'd1230000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.entries
      where classroom_id = 'd1230000-0000-4000-8000-000000000011'
        and student_id = 'd1230000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.entries
      where classroom_id = 'd1230000-0000-4000-8000-000000000010'
        and student_id = 'd1230000-0000-4000-8000-000000000003')
  then raise exception 'User, other Classroom, or classmate data was removed'; end if;
  if exists (select 1 from public.entries
      where classroom_id = 'd1230000-0000-4000-8000-000000000010'
        and student_id = 'd1230000-0000-4000-8000-000000000002')
    or exists (select 1 from public.classroom_enrollments
      where classroom_id = 'd1230000-0000-4000-8000-000000000010'
        and student_id = 'd1230000-0000-4000-8000-000000000002')
    or exists (select 1 from public.classroom_roster_student_bindings
      where classroom_id = 'd1230000-0000-4000-8000-000000000010'
        and student_id = 'd1230000-0000-4000-8000-000000000002')
  then raise exception 'Target Classroom student data remained'; end if;
  if exists (select 1 from public.managed_storage_objects
      where id = 'd1230000-0000-4000-8000-000000000020')
    or exists (select 1 from storage.objects where bucket_id = 'submission-images'
      and name = 'student-purge-fixture/target.png')
  then raise exception 'Target managed storage object remained'; end if;
  if exists (select 1 from public.student_purge_fences
    where operation_id = 'd1230000-0000-4000-8000-000000000100')
  then raise exception 'Completed student purge left an active fence'; end if;
  if exists (select 1 from public.assignment_docs where id = 'd1230000-0000-4000-8000-000000000041')
    or not exists (select 1 from public.assignment_docs where id = 'd1230000-0000-4000-8000-000000000042')
    or exists (select 1 from public.test_responses where id = 'd1230000-0000-4000-8000-000000000055')
    or not exists (select 1 from public.test_responses where id = 'd1230000-0000-4000-8000-000000000056')
    or exists (select 1 from public.survey_responses where id = 'd1230000-0000-4000-8000-000000000062')
    or not exists (select 1 from public.survey_responses where id = 'd1230000-0000-4000-8000-000000000063')
    or exists (select 1 from public.report_card_rows where id = 'd1230000-0000-4000-8000-000000000071')
    or not exists (select 1 from public.report_card_rows where id = 'd1230000-0000-4000-8000-000000000072')
    or exists (select 1 from public.announcement_reads where id = 'd1230000-0000-4000-8000-000000000031')
    or not exists (select 1 from public.announcement_reads where id = 'd1230000-0000-4000-8000-000000000032')
  then raise exception 'Target/peer relational family isolation failed'; end if;
  if (select requested_student_ids_json from public.assignment_ai_grading_runs
      where id = 'd1230000-0000-4000-8000-000000000048')
      <> '["d1230000-0000-4000-8000-000000000003"]'::jsonb
    or (select gradable_count from public.assignment_ai_grading_runs
      where id = 'd1230000-0000-4000-8000-000000000048') <> 1
    or (select selection_hash from public.assignment_ai_grading_runs
      where id = 'd1230000-0000-4000-8000-000000000048') <>
      encode(extensions.digest(convert_to(
        'student-purge:d1230000-0000-4000-8000-000000000100:d1230000-0000-4000-8000-000000000048',
        'UTF8'), 'sha256'), 'hex')
    or exists (select 1 from public.assignment_ai_grading_run_items
      where id = 'd1230000-0000-4000-8000-000000000049')
    or not exists (select 1 from public.assignment_ai_grading_run_items
      where id = 'd1230000-0000-4000-8000-00000000004a')
    or (select requested_student_ids_json from public.test_ai_grading_runs
      where id = 'd1230000-0000-4000-8000-00000000005a')
      <> '["d1230000-0000-4000-8000-000000000003"]'::jsonb
    or (select eligible_student_count from public.test_ai_grading_runs
      where id = 'd1230000-0000-4000-8000-00000000005a') <> 1
    or (select selection_hash from public.test_ai_grading_runs
      where id = 'd1230000-0000-4000-8000-00000000005a') <>
      encode(extensions.digest(convert_to(
        'student-purge:d1230000-0000-4000-8000-000000000100:d1230000-0000-4000-8000-00000000005a',
        'UTF8'), 'sha256'), 'hex')
    or exists (select 1 from public.test_ai_grading_run_items
      where id = 'd1230000-0000-4000-8000-00000000005b')
    or not exists (select 1 from public.test_ai_grading_run_items
      where id = 'd1230000-0000-4000-8000-00000000005c')
  then raise exception 'Shared grading run redaction or peer preservation failed'; end if;
  if exists (select 1 from public.classroom_archives
      where id = 'd1230000-0000-4000-8000-000000000081')
    or exists (select 1 from public.classroom_gradex_extracts
      where id = 'd1230000-0000-4000-8000-000000000083')
    or exists (select 1 from public.classroom_archive_operations
      where classroom_id = 'd1230000-0000-4000-8000-000000000010')
  then raise exception 'Retained archive or Gradex ledger remained'; end if;
end;
$preservation$;

rollback;
SQL
