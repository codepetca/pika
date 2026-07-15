#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

TMP_ONE="$(mktemp)"
TMP_TWO="$(mktemp)"

cleanup() {
  rm -f "$TMP_ONE" "$TMP_TWO"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
alter table public.test_ai_grading_run_items
  drop constraint if exists atomic_test_grading_forced_item_failure;
delete from public.classrooms
where id = 'a9000000-0000-4000-8000-000000000010';
delete from public.users
where id::text like 'a9000000-0000-4000-8000-00000000000%';
SQL
}
trap cleanup EXIT
cleanup

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.users (id, email, role) values
  ('a9000000-0000-4000-8000-000000000001', 'atomic-test-grading-teacher@example.test', 'teacher'),
  ('a9000000-0000-4000-8000-000000000002', 'atomic-test-grading-student-one@example.test', 'student'),
  ('a9000000-0000-4000-8000-000000000003', 'atomic-test-grading-student-two@example.test', 'student');

insert into public.classrooms (id, teacher_id, title, class_code) values (
  'a9000000-0000-4000-8000-000000000010',
  'a9000000-0000-4000-8000-000000000001',
  'Atomic test grading contract',
  'ATOMIC89'
);

insert into public.classroom_enrollments (classroom_id, student_id) values
  ('a9000000-0000-4000-8000-000000000010', 'a9000000-0000-4000-8000-000000000002'),
  ('a9000000-0000-4000-8000-000000000010', 'a9000000-0000-4000-8000-000000000003');

insert into public.tests (id, classroom_id, title, status, points_possible, created_by) values
  ('a9000000-0000-4000-8000-000000000011', 'a9000000-0000-4000-8000-000000000010', 'Manual grading', 'closed', 10, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000012', 'a9000000-0000-4000-8000-000000000010', 'AI saved and replayed', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000013', 'a9000000-0000-4000-8000-000000000010', 'AI stale source', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000014', 'a9000000-0000-4000-8000-000000000010', 'AI lease fencing', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000015', 'a9000000-0000-4000-8000-000000000010', 'AI atomic rollback', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000016', 'a9000000-0000-4000-8000-000000000010', 'Manual first ordering', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000017', 'a9000000-0000-4000-8000-000000000010', 'AI first ordering', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000018', 'a9000000-0000-4000-8000-000000000010', 'Question mutation fencing', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000019', 'a9000000-0000-4000-8000-000000000010', 'Atomic run creation', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000020', 'a9000000-0000-4000-8000-000000000010', 'Concurrent run creation', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000021', 'a9000000-0000-4000-8000-000000000010', 'Concurrent lease claim', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000022', 'a9000000-0000-4000-8000-000000000010', 'Submission preflight race', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000023', 'a9000000-0000-4000-8000-000000000010', 'Concurrent stale clear', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000024', 'a9000000-0000-4000-8000-000000000010', 'Question grading lock order', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000025', 'a9000000-0000-4000-8000-000000000010', 'Eligible cohort identity', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000026', 'a9000000-0000-4000-8000-000000000010', 'Eligible cohort phantom', 'closed', 5, 'a9000000-0000-4000-8000-000000000001'),
  ('a9000000-0000-4000-8000-000000000027', 'a9000000-0000-4000-8000-000000000010', 'Concurrent test deletion', 'closed', 5, 'a9000000-0000-4000-8000-000000000001');

insert into public.test_questions (
  id, test_id, question_type, question_text, options, correct_option, points,
  response_max_chars, position
) values
  ('a9000000-0000-4000-8000-000000000101', 'a9000000-0000-4000-8000-000000000011', 'open_response', 'Manual one', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000102', 'a9000000-0000-4000-8000-000000000011', 'open_response', 'Manual two', '[]', null, 5, 5000, 1),
  ('a9000000-0000-4000-8000-000000000103', 'a9000000-0000-4000-8000-000000000012', 'open_response', 'AI saved', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000104', 'a9000000-0000-4000-8000-000000000013', 'open_response', 'AI stale', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000105', 'a9000000-0000-4000-8000-000000000014', 'open_response', 'AI lease', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000106', 'a9000000-0000-4000-8000-000000000015', 'open_response', 'AI rollback', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000107', 'a9000000-0000-4000-8000-000000000016', 'open_response', 'Manual first', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000108', 'a9000000-0000-4000-8000-000000000017', 'open_response', 'AI first', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000109', 'a9000000-0000-4000-8000-000000000018', 'open_response', 'Question before edit', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000110', 'a9000000-0000-4000-8000-000000000019', 'open_response', 'Atomic run response', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000111', 'a9000000-0000-4000-8000-000000000019', 'open_response', 'Unanswered stale response', '[]', null, 5, 5000, 1),
  ('a9000000-0000-4000-8000-000000000112', 'a9000000-0000-4000-8000-000000000020', 'open_response', 'Concurrent run response', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000113', 'a9000000-0000-4000-8000-000000000019', 'open_response', 'Concurrent unanswered insert', '[]', null, 5, 5000, 2),
  ('a9000000-0000-4000-8000-000000000114', 'a9000000-0000-4000-8000-000000000020', 'open_response', 'Missing response manual race', '[]', null, 5, 5000, 1),
  ('a9000000-0000-4000-8000-000000000115', 'a9000000-0000-4000-8000-000000000023', 'open_response', 'Concurrent clear response', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000116', 'a9000000-0000-4000-8000-000000000024', 'open_response', 'Question lock order response', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000117', 'a9000000-0000-4000-8000-000000000025', 'open_response', 'Eligible cohort response', '[]', null, 5, 5000, 0),
  ('a9000000-0000-4000-8000-000000000119', 'a9000000-0000-4000-8000-000000000023', 'open_response', 'Concurrent inserted response', '[]', null, 5, 5000, 1),
  ('a9000000-0000-4000-8000-000000000120', 'a9000000-0000-4000-8000-000000000027', 'open_response', 'Concurrent deletion response', '[]', null, 5, 5000, 0);

insert into public.test_attempts (test_id, student_id, is_submitted, submitted_at) values
  ('a9000000-0000-4000-8000-000000000019', 'a9000000-0000-4000-8000-000000000002', true, now()),
  ('a9000000-0000-4000-8000-000000000020', 'a9000000-0000-4000-8000-000000000002', true, now()),
  ('a9000000-0000-4000-8000-000000000020', 'a9000000-0000-4000-8000-000000000003', true, now()),
  ('a9000000-0000-4000-8000-000000000022', 'a9000000-0000-4000-8000-000000000002', false, null),
  ('a9000000-0000-4000-8000-000000000025', 'a9000000-0000-4000-8000-000000000002', true, now()),
  ('a9000000-0000-4000-8000-000000000025', 'a9000000-0000-4000-8000-000000000003', false, null);

insert into public.test_responses (
  id, test_id, question_id, student_id, response_text, submitted_at, revision
) values
  ('a9000000-0000-4000-8000-000000000201', 'a9000000-0000-4000-8000-000000000011', 'a9000000-0000-4000-8000-000000000101', 'a9000000-0000-4000-8000-000000000002', 'Manual answer one', now(), 99),
  ('a9000000-0000-4000-8000-000000000202', 'a9000000-0000-4000-8000-000000000011', 'a9000000-0000-4000-8000-000000000102', 'a9000000-0000-4000-8000-000000000002', 'Manual answer two', now(), 99),
  ('a9000000-0000-4000-8000-000000000208', 'a9000000-0000-4000-8000-000000000011', 'a9000000-0000-4000-8000-000000000102', 'a9000000-0000-4000-8000-000000000003', 'Revision probe', now(), 99),
  ('a9000000-0000-4000-8000-000000000203', 'a9000000-0000-4000-8000-000000000012', 'a9000000-0000-4000-8000-000000000103', 'a9000000-0000-4000-8000-000000000002', 'AI save answer', now(), 99),
  ('a9000000-0000-4000-8000-000000000204', 'a9000000-0000-4000-8000-000000000013', 'a9000000-0000-4000-8000-000000000104', 'a9000000-0000-4000-8000-000000000002', 'AI stale answer', now(), 99),
  ('a9000000-0000-4000-8000-000000000205', 'a9000000-0000-4000-8000-000000000014', 'a9000000-0000-4000-8000-000000000105', 'a9000000-0000-4000-8000-000000000002', 'AI lease answer', now(), 99),
  ('a9000000-0000-4000-8000-000000000206', 'a9000000-0000-4000-8000-000000000015', 'a9000000-0000-4000-8000-000000000106', 'a9000000-0000-4000-8000-000000000002', 'AI rollback answer', now(), 99),
  ('a9000000-0000-4000-8000-000000000207', 'a9000000-0000-4000-8000-000000000016', 'a9000000-0000-4000-8000-000000000107', 'a9000000-0000-4000-8000-000000000002', 'Manual first answer', now(), 99),
  ('a9000000-0000-4000-8000-000000000209', 'a9000000-0000-4000-8000-000000000017', 'a9000000-0000-4000-8000-000000000108', 'a9000000-0000-4000-8000-000000000002', 'AI first answer', now(), 99),
  ('a9000000-0000-4000-8000-000000000210', 'a9000000-0000-4000-8000-000000000018', 'a9000000-0000-4000-8000-000000000109', 'a9000000-0000-4000-8000-000000000002', 'Question race answer', now(), 99),
  ('a9000000-0000-4000-8000-000000000211', 'a9000000-0000-4000-8000-000000000019', 'a9000000-0000-4000-8000-000000000110', 'a9000000-0000-4000-8000-000000000002', 'Atomic run answer', now(), 99),
  ('a9000000-0000-4000-8000-000000000212', 'a9000000-0000-4000-8000-000000000019', 'a9000000-0000-4000-8000-000000000111', 'a9000000-0000-4000-8000-000000000002', '', now(), 99),
  ('a9000000-0000-4000-8000-000000000213', 'a9000000-0000-4000-8000-000000000020', 'a9000000-0000-4000-8000-000000000112', 'a9000000-0000-4000-8000-000000000002', 'Concurrent run answer', now(), 99),
  ('a9000000-0000-4000-8000-000000000215', 'a9000000-0000-4000-8000-000000000023', 'a9000000-0000-4000-8000-000000000115', 'a9000000-0000-4000-8000-000000000002', 'Concurrent clear answer', now(), 99),
  ('a9000000-0000-4000-8000-000000000216', 'a9000000-0000-4000-8000-000000000024', 'a9000000-0000-4000-8000-000000000116', 'a9000000-0000-4000-8000-000000000002', 'Question lock answer', now(), 99),
  ('a9000000-0000-4000-8000-000000000218', 'a9000000-0000-4000-8000-000000000027', 'a9000000-0000-4000-8000-000000000120', 'a9000000-0000-4000-8000-000000000002', 'Concurrent deletion answer', now(), 99);

insert into public.test_ai_grading_runs (
  id, test_id, status, triggered_by, model, selection_hash, requested_count,
  eligible_student_count, queued_response_count, lease_token, lease_expires_at, started_at
) values
  ('a9000000-0000-4000-8000-000000000301', 'a9000000-0000-4000-8000-000000000012', 'running', 'a9000000-0000-4000-8000-000000000001', 'contract-model', 'saved', 1, 1, 1, 'a9000000-0000-4000-8000-000000000501', now() + interval '10 minutes', now()),
  ('a9000000-0000-4000-8000-000000000302', 'a9000000-0000-4000-8000-000000000013', 'running', 'a9000000-0000-4000-8000-000000000001', 'contract-model', 'stale', 1, 1, 1, 'a9000000-0000-4000-8000-000000000502', now() + interval '10 minutes', now()),
  ('a9000000-0000-4000-8000-000000000303', 'a9000000-0000-4000-8000-000000000014', 'running', 'a9000000-0000-4000-8000-000000000001', 'contract-model', 'lease', 1, 1, 1, 'a9000000-0000-4000-8000-000000000503', now() + interval '10 minutes', now()),
  ('a9000000-0000-4000-8000-000000000304', 'a9000000-0000-4000-8000-000000000015', 'running', 'a9000000-0000-4000-8000-000000000001', 'contract-model', 'rollback', 1, 1, 1, 'a9000000-0000-4000-8000-000000000504', now() + interval '10 minutes', now()),
  ('a9000000-0000-4000-8000-000000000305', 'a9000000-0000-4000-8000-000000000016', 'running', 'a9000000-0000-4000-8000-000000000001', 'contract-model', 'manual-first', 1, 1, 1, 'a9000000-0000-4000-8000-000000000505', now() + interval '10 minutes', now()),
  ('a9000000-0000-4000-8000-000000000306', 'a9000000-0000-4000-8000-000000000017', 'running', 'a9000000-0000-4000-8000-000000000001', 'contract-model', 'ai-first', 1, 1, 1, 'a9000000-0000-4000-8000-000000000506', now() + interval '10 minutes', now()),
  ('a9000000-0000-4000-8000-000000000307', 'a9000000-0000-4000-8000-000000000018', 'running', 'a9000000-0000-4000-8000-000000000001', 'contract-model', 'question-race', 1, 1, 1, 'a9000000-0000-4000-8000-000000000507', now() + interval '10 minutes', now()),
  ('a9000000-0000-4000-8000-000000000308', 'a9000000-0000-4000-8000-000000000021', 'queued', 'a9000000-0000-4000-8000-000000000001', 'contract-model', 'lease-race', 1, 1, 1, null, null, null);

insert into public.test_ai_grading_run_items (
  id, run_id, test_id, student_id, question_id, response_id, queue_position
) values
  ('a9000000-0000-4000-8000-000000000401', 'a9000000-0000-4000-8000-000000000301', 'a9000000-0000-4000-8000-000000000012', 'a9000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000103', 'a9000000-0000-4000-8000-000000000203', 0),
  ('a9000000-0000-4000-8000-000000000402', 'a9000000-0000-4000-8000-000000000302', 'a9000000-0000-4000-8000-000000000013', 'a9000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000104', 'a9000000-0000-4000-8000-000000000204', 0),
  ('a9000000-0000-4000-8000-000000000403', 'a9000000-0000-4000-8000-000000000303', 'a9000000-0000-4000-8000-000000000014', 'a9000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000105', 'a9000000-0000-4000-8000-000000000205', 0),
  ('a9000000-0000-4000-8000-000000000404', 'a9000000-0000-4000-8000-000000000304', 'a9000000-0000-4000-8000-000000000015', 'a9000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000106', 'a9000000-0000-4000-8000-000000000206', 0),
  ('a9000000-0000-4000-8000-000000000405', 'a9000000-0000-4000-8000-000000000305', 'a9000000-0000-4000-8000-000000000016', 'a9000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000107', 'a9000000-0000-4000-8000-000000000207', 0),
  ('a9000000-0000-4000-8000-000000000406', 'a9000000-0000-4000-8000-000000000306', 'a9000000-0000-4000-8000-000000000017', 'a9000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000108', 'a9000000-0000-4000-8000-000000000209', 0),
  ('a9000000-0000-4000-8000-000000000407', 'a9000000-0000-4000-8000-000000000307', 'a9000000-0000-4000-8000-000000000018', 'a9000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000109', 'a9000000-0000-4000-8000-000000000210', 0);

update public.test_ai_grading_run_items item
set question_grading_snapshot = jsonb_build_object(
  'test_title', test.title,
  'question_text', question.question_text,
  'points', question.points,
  'response_monospace', question.response_monospace,
  'answer_key', question.answer_key,
  'sample_solution', question.sample_solution
)
from public.test_questions question
join public.tests test on test.id = question.test_id
where question.id = item.question_id
  and item.id::text like 'a9000000-0000-4000-8000-0000000004%';

commit;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $contract$
declare
  v_signature text;
  v_result jsonb;
  v_rejected boolean;
  v_revision bigint;
  v_score numeric;
  v_feedback text;
  v_ai_suggested_score numeric;
  v_ai_suggested_feedback text;
  v_ai_basis text;
  v_ai_model text;
  v_status text;
begin
  perform set_config('pika.classroom_archive_restore', 'on', true);
  perform set_config('pika.classroom_archive_compaction', 'on', true);
  execute 'set local role authenticated';
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then
    raise exception 'Authenticated role forged classroom archive maintenance mode';
  end if;
  execute 'reset role';
  perform set_config('pika.classroom_archive_restore', 'off', true);
  perform set_config('pika.classroom_archive_compaction', 'off', true);

  foreach v_signature in array array[
    'public.save_test_response_grades_atomic(uuid,uuid,uuid,jsonb,timestamp with time zone)',
    'public.clear_test_open_response_grades_atomic(uuid,uuid,uuid[],jsonb,timestamp with time zone)',
    'public.save_test_unanswered_grades_atomic(uuid,uuid,jsonb,timestamp with time zone)',
    'public.create_test_ai_grading_run_atomic(uuid,uuid,text,uuid[],uuid[],text,integer,integer,integer,jsonb,jsonb,text)',
    'public.set_test_ai_grading_item_state_atomic(uuid,uuid,text,integer,timestamp with time zone,text,text,timestamp with time zone,timestamp with time zone,jsonb)',
    'public.finalize_test_ai_grading_item_atomic(uuid,uuid,uuid,numeric,text,text,jsonb,text,integer,timestamp with time zone)',
    'public.claim_test_ai_grading_run(uuid,uuid,integer)',
    'public.renew_test_ai_grading_run_lease(uuid,uuid,integer)',
    'public.delete_test_atomic(uuid,uuid)',
    'public.normalize_classroom_archive_restore_row(uuid,text,jsonb)'
  ]
  loop
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
    then
      raise exception 'Unexpected service-only privilege for %', v_signature;
    end if;
  end loop;

  if exists (
    select 1 from public.test_responses
    where id::text like 'a9000000-0000-4000-8000-0000000002%'
      and revision <> 1
  ) then
    raise exception 'Response insert did not force revision one';
  end if;

  update public.test_responses
  set feedback = 'Revision probe update', revision = 500
  where id = 'a9000000-0000-4000-8000-000000000208';
  select revision into v_revision
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000208';
  if v_revision <> 2 then
    raise exception 'Response update did not advance revision monotonically: %', v_revision;
  end if;

  v_result := public.clear_test_open_response_grades_atomic(
    'a9000000-0000-4000-8000-000000000011',
    'a9000000-0000-4000-8000-000000000001',
    array['a9000000-0000-4000-8000-000000000002'::uuid],
    jsonb_build_array(
      jsonb_build_object('response_id', 'a9000000-0000-4000-8000-000000000201', 'expected_response_revision', 1),
      jsonb_build_object('response_id', 'a9000000-0000-4000-8000-000000000202', 'expected_response_revision', 1)
    ),
    '2026-07-14T15:59:00Z'
  );
  if (v_result->>'cleared_responses')::integer <> 0
    or exists (
      select 1 from public.test_responses
      where id in (
        'a9000000-0000-4000-8000-000000000201',
        'a9000000-0000-4000-8000-000000000202'
      )
        and revision <> 1
    )
  then
    raise exception 'No-op clear advanced an ungraded response revision: %', v_result;
  end if;

  perform public.save_test_response_grades_atomic(
    'a9000000-0000-4000-8000-000000000019',
    'a9000000-0000-4000-8000-000000000002',
    'a9000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'response_id', 'a9000000-0000-4000-8000-000000000212',
      'question_id', 'a9000000-0000-4000-8000-000000000111',
      'expected_response_revision', 1,
      'clear_grade', false,
      'score', 3,
      'feedback', 'Concurrent teacher grade'
    )),
    '2026-07-14T15:59:15Z'
  );
  v_rejected := false;
  begin
    perform public.save_test_unanswered_grades_atomic(
      'a9000000-0000-4000-8000-000000000019',
      'a9000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'question_id', 'a9000000-0000-4000-8000-000000000111',
        'student_id', 'a9000000-0000-4000-8000-000000000002',
        'response_id', 'a9000000-0000-4000-8000-000000000212',
        'expected_response_revision', 1,
        'submitted_at', null
      )),
      '2026-07-14T15:59:30Z'
    );
  exception when serialization_failure then
    v_rejected := true;
  end;
  select revision, score, feedback into v_revision, v_score, v_feedback
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000212';
  if not v_rejected
    or v_revision <> 2
    or v_score <> 3
    or v_feedback <> 'Concurrent teacher grade'
  then
    raise exception 'Stale unanswered preflight overwrote a manual grade';
  end if;

  update public.test_attempts
  set is_submitted = true, submitted_at = clock_timestamp()
  where test_id = 'a9000000-0000-4000-8000-000000000022'
    and student_id = 'a9000000-0000-4000-8000-000000000002';
  v_rejected := false;
  begin
    perform public.create_test_ai_grading_run_atomic(
      'a9000000-0000-4000-8000-000000000022',
      'a9000000-0000-4000-8000-000000000001',
      'contract-model',
      array['a9000000-0000-4000-8000-000000000002'::uuid],
      array[]::uuid[],
      'stale-submission-preflight', 0, 0, 0,
      '[]'::jsonb,
      '[]'::jsonb,
      null
    );
  exception when serialization_failure then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Submission committed after preflight was omitted from grading';
  end if;

  update public.test_attempts
  set
    is_submitted = not is_submitted,
    submitted_at = case when is_submitted then null else clock_timestamp() end
  where test_id = 'a9000000-0000-4000-8000-000000000025';
  v_rejected := false;
  begin
    perform public.create_test_ai_grading_run_atomic(
      'a9000000-0000-4000-8000-000000000025',
      'a9000000-0000-4000-8000-000000000001',
      'contract-model',
      array[
        'a9000000-0000-4000-8000-000000000002'::uuid,
        'a9000000-0000-4000-8000-000000000003'::uuid
      ],
      array['a9000000-0000-4000-8000-000000000002'::uuid],
      'stale-eligible-cohort', 1, 0, 0,
      '[]'::jsonb,
      '[]'::jsonb,
      null
    );
  exception when serialization_failure then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Eligible student cohort changed without invalidating the preflight';
  end if;

  v_rejected := false;
  begin
    perform public.create_test_ai_grading_run_atomic(
      'a9000000-0000-4000-8000-000000000019',
      'a9000000-0000-4000-8000-000000000001',
      'contract-model',
      array['a9000000-0000-4000-8000-000000000002'::uuid],
      array['a9000000-0000-4000-8000-000000000002'::uuid],
      'atomic-create',
      1,
      0,
      0,
      jsonb_build_array(jsonb_build_object(
        'student_id', 'a9000000-0000-4000-8000-000000000002',
        'question_id', 'a9000000-0000-4000-8000-000000000110',
        'response_id', 'a9000000-0000-4000-8000-000000000211',
        'response_revision', 2,
        'queue_position', 0
      )),
      '[]'::jsonb,
      null
    );
  exception when serialization_failure then
    v_rejected := true;
  end;
  if not v_rejected or exists (
    select 1 from public.test_ai_grading_runs
    where test_id = 'a9000000-0000-4000-8000-000000000019'
  ) then
    raise exception 'Stale atomic run creation left an orphan run';
  end if;

  v_result := public.create_test_ai_grading_run_atomic(
    'a9000000-0000-4000-8000-000000000019',
    'a9000000-0000-4000-8000-000000000001',
    'contract-model',
    array['a9000000-0000-4000-8000-000000000002'::uuid],
    array['a9000000-0000-4000-8000-000000000002'::uuid],
    'atomic-create',
    1,
    0,
    0,
    jsonb_build_array(jsonb_build_object(
      'student_id', 'a9000000-0000-4000-8000-000000000002',
      'question_id', 'a9000000-0000-4000-8000-000000000110',
      'response_id', 'a9000000-0000-4000-8000-000000000211',
      'response_revision', 1,
      'queue_position', 0
    )),
    '[]'::jsonb,
    null
  );
  if v_result->>'outcome' <> 'created'
    or not exists (
      select 1
      from public.test_ai_grading_runs run
      join public.test_ai_grading_run_items item on item.run_id = run.id
      where run.id = (v_result->>'run_id')::uuid
        and item.response_id = 'a9000000-0000-4000-8000-000000000211'
        and item.response_revision = 1
    )
  then
    raise exception 'Atomic run creation did not commit run and item together: %', v_result;
  end if;
  v_result := public.create_test_ai_grading_run_atomic(
    'a9000000-0000-4000-8000-000000000019',
    'a9000000-0000-4000-8000-000000000001',
    'contract-model',
    array['a9000000-0000-4000-8000-000000000002'::uuid],
    array['a9000000-0000-4000-8000-000000000002'::uuid],
    'atomic-create', 1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'student_id', 'a9000000-0000-4000-8000-000000000002',
      'question_id', 'a9000000-0000-4000-8000-000000000110',
      'response_id', 'a9000000-0000-4000-8000-000000000211',
      'response_revision', 1,
      'queue_position', 0
    )),
    '[]'::jsonb,
    null
  );
  if v_result->>'outcome' <> 'existing' then
    raise exception 'Atomic run creation did not replay the active run: %', v_result;
  end if;

  if exists (
    select 1
    from public.test_ai_grading_run_items item
    join public.test_responses response on response.id = item.response_id
    where item.id::text like 'a9000000-0000-4000-8000-0000000004%'
      and item.response_revision <> response.revision
  ) then
    raise exception 'AI item did not snapshot its response revision';
  end if;

  v_rejected := false;
  begin
    insert into public.test_ai_grading_run_items (
      id, run_id, test_id, student_id, question_id, response_id,
      response_revision, queue_position
    ) values (
      'a9000000-0000-4000-8000-000000000499',
      'a9000000-0000-4000-8000-000000000303',
      'a9000000-0000-4000-8000-000000000014',
      'a9000000-0000-4000-8000-000000000002',
      'a9000000-0000-4000-8000-000000000105',
      'a9000000-0000-4000-8000-000000000205',
      99,
      1
    );
  exception when serialization_failure then
    v_rejected := true;
  end;
  if not v_rejected or exists (
    select 1 from public.test_ai_grading_run_items
    where id = 'a9000000-0000-4000-8000-000000000499'
  ) then
    raise exception 'Stale AI item response revision was accepted';
  end if;

  update public.test_responses
  set score = 1, feedback = 'Concurrent teacher grade'
  where id = 'a9000000-0000-4000-8000-000000000202';

  v_rejected := false;
  begin
    perform public.save_test_response_grades_atomic(
      'a9000000-0000-4000-8000-000000000011',
      'a9000000-0000-4000-8000-000000000002',
      'a9000000-0000-4000-8000-000000000001',
      jsonb_build_array(
        jsonb_build_object(
          'response_id', 'a9000000-0000-4000-8000-000000000201',
          'question_id', 'a9000000-0000-4000-8000-000000000101',
          'expected_response_revision', 1,
          'clear_grade', false,
          'score', 4,
          'feedback', 'Must roll back'
        ),
        jsonb_build_object(
          'response_id', 'a9000000-0000-4000-8000-000000000202',
          'question_id', 'a9000000-0000-4000-8000-000000000102',
          'expected_response_revision', 1,
          'clear_grade', false,
          'score', 4,
          'feedback', 'Stale member'
        )
      ),
      '2026-07-14T16:00:00Z'
    );
  exception when serialization_failure then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Stale grade batch was accepted';
  end if;
  select revision, score into v_revision, v_score
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000201';
  if v_revision <> 1 or v_score is not null then
    raise exception 'Stale grade batch partially committed';
  end if;

  v_result := public.save_test_response_grades_atomic(
    'a9000000-0000-4000-8000-000000000011',
    'a9000000-0000-4000-8000-000000000002',
    'a9000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'response_id', 'a9000000-0000-4000-8000-000000000201',
      'question_id', 'a9000000-0000-4000-8000-000000000101',
      'expected_response_revision', 1,
      'clear_grade', false,
      'score', 4,
      'feedback', 'Committed manual grade'
    )),
    '2026-07-14T16:01:00Z'
  );
  if (v_result->>'saved_count')::integer <> 1
    or (v_result->'responses'->0->>'revision')::bigint <> 2
    or (select count(*) from jsonb_object_keys(v_result->'responses'->0)) <> 4
    or not (v_result->'responses'->0 ?& array['id', 'revision', 'score', 'feedback'])
  then
    raise exception 'Successful manual grade returned unexpected state: %', v_result;
  end if;

  v_result := public.finalize_test_ai_grading_item_atomic(
    'a9000000-0000-4000-8000-000000000401',
    'a9000000-0000-4000-8000-000000000001',
    'a9000000-0000-4000-8000-000000000501',
    4.5, 'AI saved feedback', 'teacher_key', null, 'contract-model', 1,
    '2026-07-14T16:02:00Z'
  );
  if v_result->>'outcome' <> 'saved'
    or (v_result->'response'->>'revision')::bigint <> 2
  then
    raise exception 'AI finalization returned unexpected saved result: %', v_result;
  end if;
  select
    ai_suggested_score,
    ai_suggested_feedback
  into v_ai_suggested_score, v_ai_suggested_feedback
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000203';
  select status into v_status
  from public.test_ai_grading_run_items
  where id = 'a9000000-0000-4000-8000-000000000401';
  if v_status <> 'completed'
    or v_ai_suggested_score <> 4.5
    or v_ai_suggested_feedback <> 'AI saved feedback'
  then
    raise exception 'AI response and item were not finalized together';
  end if;

  v_result := public.finalize_test_ai_grading_item_atomic(
    'a9000000-0000-4000-8000-000000000401',
    'a9000000-0000-4000-8000-000000000001',
    'a9000000-0000-4000-8000-000000000599',
    1, 'Ignored replay payload', 'teacher_key', null, 'ignored-model', 9,
    '2026-07-14T16:03:00Z'
  );
  select revision, score, feedback, ai_suggested_score, ai_suggested_feedback
  into v_revision, v_score, v_feedback, v_ai_suggested_score, v_ai_suggested_feedback
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000203';
  if v_result->>'outcome' <> 'replayed'
    or v_revision <> 2
    or v_score <> 4.5
    or v_feedback <> 'AI saved feedback'
  then
    raise exception 'AI finalization replay was not idempotent: %', v_result;
  end if;

  v_result := public.save_test_response_grades_atomic(
    'a9000000-0000-4000-8000-000000000012',
    'a9000000-0000-4000-8000-000000000002',
    'a9000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'response_id', 'a9000000-0000-4000-8000-000000000203',
      'question_id', 'a9000000-0000-4000-8000-000000000103',
      'expected_response_revision', 2,
      'clear_grade', false,
      'score', 4,
      'feedback', 'Teacher adjusted AI feedback'
    )),
    '2026-07-14T16:03:15Z'
  );
  select
    revision,
    ai_grading_basis,
    ai_model,
    ai_suggested_score,
    ai_suggested_feedback
  into v_revision, v_ai_basis, v_ai_model, v_ai_suggested_score, v_ai_suggested_feedback
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000203';
  if (v_result->>'saved_count')::integer <> 1
    or v_revision <> 3
    or v_ai_basis <> 'teacher_key'
    or v_ai_model <> 'contract-model'
    or v_ai_suggested_score <> 4.5
    or v_ai_suggested_feedback <> 'AI saved feedback'
  then
    raise exception 'Manual edit erased AI provenance: %', v_result;
  end if;

  v_result := public.clear_test_open_response_grades_atomic(
    'a9000000-0000-4000-8000-000000000012',
    'a9000000-0000-4000-8000-000000000001',
    array['a9000000-0000-4000-8000-000000000002'::uuid],
    jsonb_build_array(jsonb_build_object(
      'response_id', 'a9000000-0000-4000-8000-000000000203',
      'expected_response_revision', 3
    )),
    '2026-07-14T16:03:30Z'
  );
  select revision, score, feedback, ai_suggested_score, ai_suggested_feedback
  into v_revision, v_score, v_feedback, v_ai_suggested_score, v_ai_suggested_feedback
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000203';
  select status into v_status
  from public.test_ai_grading_run_items
  where id = 'a9000000-0000-4000-8000-000000000401';
  if (v_result->>'cleared_responses')::integer <> 1
    or v_revision <> 4
    or v_ai_suggested_score is not null
    or v_ai_suggested_feedback is not null
    or v_score is not null
    or v_feedback is not null
    or v_status <> 'completed'
  then
    raise exception 'AI-first clear ordering left incoherent state: %', v_result;
  end if;

  update public.test_responses
  set score = 2, feedback = 'Teacher won before AI'
  where id = 'a9000000-0000-4000-8000-000000000204';
  v_result := public.finalize_test_ai_grading_item_atomic(
    'a9000000-0000-4000-8000-000000000402',
    'a9000000-0000-4000-8000-000000000001',
    'a9000000-0000-4000-8000-000000000502',
    5, 'Stale AI feedback', 'teacher_key', null, 'contract-model', 1,
    '2026-07-14T16:04:00Z'
  );
  select revision, score, feedback into v_revision, v_score, v_feedback
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000204';
  select status into v_status
  from public.test_ai_grading_run_items
  where id = 'a9000000-0000-4000-8000-000000000402'
    and last_error_code = 'source_revision_conflict';
  if v_result->>'outcome' <> 'stale'
    or v_revision <> 2
    or v_score <> 2
    or v_feedback <> 'Teacher won before AI'
    or v_status <> 'failed'
  then
    raise exception 'Stale AI finalization overwrote the teacher grade: %', v_result;
  end if;

  v_rejected := false;
  begin
    perform public.set_test_ai_grading_item_state_atomic(
      'a9000000-0000-4000-8000-000000000403',
      'a9000000-0000-4000-8000-000000000599',
      'processing', 1, null, null, null, '2026-07-14T16:05:00Z', null,
      jsonb_build_object(
        'question_text', 'AI lease',
        'points', 5,
        'response_monospace', false,
        'answer_key', null,
        'sample_solution', null
      )
    );
  exception when serialization_failure then
    v_rejected := true;
  end;
  select status into v_status
  from public.test_ai_grading_run_items
  where id = 'a9000000-0000-4000-8000-000000000403';
  if not v_rejected or v_status <> 'queued' then
    raise exception 'Lease-fenced item mutation changed state';
  end if;

  v_rejected := false;
  begin
    perform public.finalize_test_ai_grading_item_atomic(
      'a9000000-0000-4000-8000-000000000403',
      'a9000000-0000-4000-8000-000000000001',
      'a9000000-0000-4000-8000-000000000599',
      3, 'Wrong lease', 'teacher_key', null, 'contract-model', 1,
      '2026-07-14T16:06:00Z'
    );
  exception when serialization_failure then
    v_rejected := true;
  end;
  select revision, score into v_revision, v_score
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000205';
  if not v_rejected or v_revision <> 1 or v_score is not null then
    raise exception 'Lease-fenced finalization changed state';
  end if;

  update public.test_ai_grading_runs
  set lease_expires_at = clock_timestamp() + interval '50 milliseconds'
  where id = 'a9000000-0000-4000-8000-000000000303';
  perform pg_sleep(0.1);
  v_rejected := false;
  begin
    perform public.finalize_test_ai_grading_item_atomic(
      'a9000000-0000-4000-8000-000000000403',
      'a9000000-0000-4000-8000-000000000001',
      'a9000000-0000-4000-8000-000000000503',
      3, 'Lease expired after transaction start', 'teacher_key', null, 'contract-model', 1,
      '2026-07-14T16:06:10Z'
    );
  exception when serialization_failure then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Transaction-time lease check accepted an expired worker';
  end if;

  update public.test_ai_grading_runs
  set lease_expires_at = clock_timestamp() - interval '1 second'
  where id = 'a9000000-0000-4000-8000-000000000303';
  v_rejected := false;
  begin
    perform public.finalize_test_ai_grading_item_atomic(
      'a9000000-0000-4000-8000-000000000403',
      'a9000000-0000-4000-8000-000000000001',
      'a9000000-0000-4000-8000-000000000503',
      3, 'Expired lease', 'teacher_key', null, 'contract-model', 1,
      '2026-07-14T16:06:20Z'
    );
  exception when serialization_failure then
    v_rejected := true;
  end;
  select revision, score into v_revision, v_score
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000205';
  if not v_rejected or v_revision <> 1 or v_score is not null then
    raise exception 'Expired lease finalized an AI grade';
  end if;
  update public.test_ai_grading_runs
  set lease_expires_at = clock_timestamp() + interval '10 minutes'
  where id = 'a9000000-0000-4000-8000-000000000303';

  perform public.clear_test_open_response_grades_atomic(
    'a9000000-0000-4000-8000-000000000014',
    'a9000000-0000-4000-8000-000000000001',
    array['a9000000-0000-4000-8000-000000000002'::uuid],
    jsonb_build_array(jsonb_build_object(
      'response_id', 'a9000000-0000-4000-8000-000000000205',
      'expected_response_revision', 1
    )),
    '2026-07-14T16:06:40Z'
  );
  v_result := public.finalize_test_ai_grading_item_atomic(
    'a9000000-0000-4000-8000-000000000403',
    'a9000000-0000-4000-8000-000000000001',
    'a9000000-0000-4000-8000-000000000503',
    5, 'Late AI after clear', 'teacher_key', null, 'contract-model', 1,
    '2026-07-14T16:06:50Z'
  );
  select revision, score, feedback into v_revision, v_score, v_feedback
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000205';
  select status into v_status
  from public.test_ai_grading_run_items
  where id = 'a9000000-0000-4000-8000-000000000403';
  if v_result->>'outcome' <> 'saved'
    or v_revision <> 2
    or v_score <> 5
    or v_feedback <> 'Late AI after clear'
    or v_status <> 'completed'
  then
    raise exception 'No-op clear fenced an active AI item: %', v_result;
  end if;

  v_rejected := false;
  begin
    perform public.claim_test_ai_grading_run(
      'a9000000-0000-4000-8000-000000000307', null, 60
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Null lease token was accepted by run claim';
  end if;

  v_rejected := false;
  begin
    perform public.renew_test_ai_grading_run_lease(
      'a9000000-0000-4000-8000-000000000307',
      'a9000000-0000-4000-8000-000000000599',
      60
    );
  exception when serialization_failure then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Wrong lease token was accepted by run renewal';
  end if;

  v_rejected := false;
  begin
    perform public.finalize_test_ai_grading_item_atomic(
      'a9000000-0000-4000-8000-000000000407',
      'a9000000-0000-4000-8000-000000000001',
      'a9000000-0000-4000-8000-000000000507',
      4, 'Invalid provenance', null, null, 'contract-model', 1,
      '2026-07-14T16:06:55Z'
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Null AI grading basis was accepted';
  end if;

  update public.test_questions
  set answer_key = 'Question changed during the AI request'
  where id = 'a9000000-0000-4000-8000-000000000109';
  v_result := public.finalize_test_ai_grading_item_atomic(
    'a9000000-0000-4000-8000-000000000407',
    'a9000000-0000-4000-8000-000000000001',
    'a9000000-0000-4000-8000-000000000507',
    4, 'Stale question grade', 'teacher_key', null, 'contract-model', 1,
    '2026-07-14T16:06:58Z'
  );
  select revision, score into v_revision, v_score
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000210';
  select status into v_status
  from public.test_ai_grading_run_items
  where id = 'a9000000-0000-4000-8000-000000000407'
    and last_error_code = 'question_revision_conflict';
  if v_result->>'outcome' <> 'stale'
    or v_revision <> 1
    or v_score is not null
    or v_status <> 'failed'
  then
    raise exception 'Question mutation did not fence the stale AI grade: %', v_result;
  end if;
end;
$contract$;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
alter table public.test_ai_grading_run_items
  add constraint atomic_test_grading_forced_item_failure
  check (
    id <> 'a9000000-0000-4000-8000-000000000404'
    or status <> 'completed'
  ) not valid;

do $contract$
declare
  v_rejected boolean := false;
  v_revision bigint;
  v_score numeric;
  v_status text;
begin
  begin
    perform public.finalize_test_ai_grading_item_atomic(
      'a9000000-0000-4000-8000-000000000404',
      'a9000000-0000-4000-8000-000000000001',
      'a9000000-0000-4000-8000-000000000504',
      5, 'Must roll back', 'teacher_key', null, 'contract-model', 1,
      '2026-07-14T16:07:00Z'
    );
  exception when check_violation then
    v_rejected := true;
  end;
  select revision, score into v_revision, v_score
  from public.test_responses
  where id = 'a9000000-0000-4000-8000-000000000206';
  select status into v_status
  from public.test_ai_grading_run_items
  where id = 'a9000000-0000-4000-8000-000000000404';
  if not v_rejected or v_revision <> 1 or v_score is not null or v_status <> 'queued' then
    raise exception 'Forced item failure partially committed AI response';
  end if;
end;
$contract$;

alter table public.test_ai_grading_run_items
  drop constraint atomic_test_grading_forced_item_failure;

do $contract$
declare
  v_rejected boolean := false;
begin
  perform public.delete_student_test_attempt_atomic(
    'a9000000-0000-4000-8000-000000000015',
    'a9000000-0000-4000-8000-000000000002'
  );

  begin
    perform public.save_test_response_grades_atomic(
      'a9000000-0000-4000-8000-000000000015',
      'a9000000-0000-4000-8000-000000000002',
      'a9000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'response_id', 'a9000000-0000-4000-8000-000000000206',
        'question_id', 'a9000000-0000-4000-8000-000000000106',
        'expected_response_revision', 1,
        'clear_grade', false,
        'score', 5,
        'feedback', 'Must not resurrect'
      )),
      '2026-07-14T16:07:30Z'
    );
  exception when no_data_found then
    v_rejected := true;
  end;
  if not v_rejected
    or exists (
      select 1 from public.test_responses
      where id = 'a9000000-0000-4000-8000-000000000206'
    )
  then
    raise exception 'Attempt deletion allowed a delayed grade to resurrect a response';
  end if;
end;
$contract$;
SQL

wait_for_application_event() {
  local application_name="$1"
  local wait_event="$2"
  local attempts=0
  while (( attempts < 100 )); do
    if [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
      "select count(*) from pg_stat_activity where application_name = '$application_name' and wait_event = '$wait_event';")" == "1" ]]; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 0.05
  done
  echo "Timed out waiting for $application_name to enter $wait_event." >&2
  return 1
}

docker exec -e PGAPPNAME=atomic-test-grading-stale-clear-writer -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
update public.test_responses
set score = 2, feedback = 'Concurrent newer grade'
where id = 'a9000000-0000-4000-8000-000000000215';
select pg_sleep(1);
commit;
SQL
STALE_CLEAR_WRITER_PID=$!
wait_for_application_event atomic-test-grading-stale-clear-writer PgSleep

set +e
docker exec -e PGAPPNAME=atomic-test-grading-stale-clear-waiter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >/dev/null 2>"$TMP_ONE" <<'SQL'
select public.clear_test_open_response_grades_atomic(
  'a9000000-0000-4000-8000-000000000023',
  'a9000000-0000-4000-8000-000000000001',
  array['a9000000-0000-4000-8000-000000000002'::uuid],
  jsonb_build_array(jsonb_build_object(
    'response_id', 'a9000000-0000-4000-8000-000000000215',
    'expected_response_revision', 1
  )),
  '2026-07-14T16:07:40Z'
);
SQL
STALE_CLEAR_STATUS=$?
set -e
wait "$STALE_CLEAR_WRITER_PID"
STALE_CLEAR_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select revision || ':' || score || ':' || feedback
   from public.test_responses
   where id = 'a9000000-0000-4000-8000-000000000215';")"
if [[ "$STALE_CLEAR_STATUS" -eq 0 ]] \
  || ! grep -q '40001' "$TMP_ONE" \
  || [[ "$STALE_CLEAR_STATE" != "2:2.00:Concurrent newer grade" ]]
then
  echo "Stale bulk clear erased a newer grade: $(cat "$TMP_ONE") / $STALE_CLEAR_STATE" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-grading-clear-phantom-inserter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
insert into public.test_responses (
  id, test_id, question_id, student_id, response_text, score, feedback,
  graded_at, graded_by, submitted_at
) values (
  'a9000000-0000-4000-8000-000000000217',
  'a9000000-0000-4000-8000-000000000023',
  'a9000000-0000-4000-8000-000000000119',
  'a9000000-0000-4000-8000-000000000002',
  'Concurrent inserted answer', 4, 'Concurrent inserted grade', clock_timestamp(),
  'a9000000-0000-4000-8000-000000000001', clock_timestamp()
);
select pg_sleep(1);
commit;
SQL
CLEAR_PHANTOM_INSERTER_PID=$!
wait_for_application_event atomic-test-grading-clear-phantom-inserter PgSleep

set +e
docker exec -e PGAPPNAME=atomic-test-grading-clear-phantom-waiter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >/dev/null 2>"$TMP_ONE" <<'SQL'
select public.clear_test_open_response_grades_atomic(
  'a9000000-0000-4000-8000-000000000023',
  'a9000000-0000-4000-8000-000000000001',
  array['a9000000-0000-4000-8000-000000000002'::uuid],
  jsonb_build_array(jsonb_build_object(
    'response_id', 'a9000000-0000-4000-8000-000000000215',
    'expected_response_revision', 2
  )),
  '2026-07-14T16:07:45Z'
);
SQL
CLEAR_PHANTOM_STATUS=$?
set -e
wait "$CLEAR_PHANTOM_INSERTER_PID"
if [[ "$CLEAR_PHANTOM_STATUS" -eq 0 ]] \
  || ! grep -q '40001' "$TMP_ONE" \
  || [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
    "select score || ':' || feedback from public.test_responses where id = 'a9000000-0000-4000-8000-000000000217';")" != "4.00:Concurrent inserted grade" ]]
then
  echo "Concurrent response insert escaped bulk clear snapshot: $(cat "$TMP_ONE")" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-grading-attempt-inserter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
insert into public.test_attempts (test_id, student_id, is_submitted, submitted_at)
values (
  'a9000000-0000-4000-8000-000000000026',
  'a9000000-0000-4000-8000-000000000003',
  true,
  clock_timestamp()
);
select pg_sleep(1);
commit;
SQL
ATTEMPT_INSERTER_PID=$!
wait_for_application_event atomic-test-grading-attempt-inserter PgSleep

set +e
docker exec -e PGAPPNAME=atomic-test-grading-attempt-preflight -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >/dev/null 2>"$TMP_TWO" <<'SQL'
select public.create_test_ai_grading_run_atomic(
  'a9000000-0000-4000-8000-000000000026',
  'a9000000-0000-4000-8000-000000000001',
  'contract-model',
  array['a9000000-0000-4000-8000-000000000003'::uuid],
  array[]::uuid[],
  'attempt-phantom', 0, 0, 0,
  '[]'::jsonb,
  '[]'::jsonb,
  null
);
SQL
ATTEMPT_PREFLIGHT_STATUS=$?
set -e
wait "$ATTEMPT_INSERTER_PID"
if [[ "$ATTEMPT_PREFLIGHT_STATUS" -eq 0 ]] \
  || ! grep -q '40001' "$TMP_TWO" \
  || [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
    "select count(*) from public.test_ai_grading_runs where test_id = 'a9000000-0000-4000-8000-000000000026';")" != "0" ]]
then
  echo "Attempt inserted after preflight was omitted from eligible cohort: $(cat "$TMP_TWO")" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-grading-response-blocker -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select 1
from public.test_responses
where id = 'a9000000-0000-4000-8000-000000000216'
for update;
select pg_sleep(4);
commit;
SQL
QUESTION_RESPONSE_BLOCKER_PID=$!
wait_for_application_event atomic-test-grading-response-blocker PgSleep

docker exec -e PGAPPNAME=atomic-test-grading-question-grader -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
select public.save_test_response_grades_atomic(
  'a9000000-0000-4000-8000-000000000024',
  'a9000000-0000-4000-8000-000000000002',
  'a9000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'response_id', 'a9000000-0000-4000-8000-000000000216',
    'question_id', 'a9000000-0000-4000-8000-000000000116',
    'expected_response_revision', 1,
    'clear_grade', false,
    'score', 5,
    'feedback', 'Serialized after question edit'
  )),
  '2026-07-14T16:07:50Z'
);
SQL
QUESTION_GRADER_PID=$!
wait_for_application_event atomic-test-grading-question-grader transactionid

docker exec -e PGAPPNAME=atomic-test-grading-question-editor -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
update public.test_questions
set question_text = 'Question edited without a lock cycle'
where id = 'a9000000-0000-4000-8000-000000000116';
SQL
wait "$QUESTION_RESPONSE_BLOCKER_PID"
wait "$QUESTION_GRADER_PID"
QUESTION_LOCK_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select response.revision || ':' || response.score || ':' || question.question_text
   from public.test_responses response
   join public.test_questions question on question.id = response.question_id
   where response.id = 'a9000000-0000-4000-8000-000000000216';")"
if [[ "$QUESTION_LOCK_STATE" != "2:5.00:Question edited without a lock cycle" ]]; then
  echo "Question mutation deadlocked with grading: $QUESTION_LOCK_STATE" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-grading-delete-grader -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.save_test_response_grades_atomic(
  'a9000000-0000-4000-8000-000000000027',
  'a9000000-0000-4000-8000-000000000002',
  'a9000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'response_id', 'a9000000-0000-4000-8000-000000000218',
    'question_id', 'a9000000-0000-4000-8000-000000000120',
    'expected_response_revision', 1,
    'clear_grade', false,
    'score', 5,
    'feedback', 'Grade committed before deletion'
  )),
  '2026-07-14T16:07:55Z'
);
select pg_sleep(1);
commit;
SQL
DELETE_GRADER_PID=$!
wait_for_application_event atomic-test-grading-delete-grader PgSleep
DELETE_RESULT="$(docker exec -e PGAPPNAME=atomic-test-grading-delete-waiter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.delete_test_atomic(
    'a9000000-0000-4000-8000-000000000027',
    'a9000000-0000-4000-8000-000000000001'
  );")"
wait "$DELETE_GRADER_PID"
if [[ "$DELETE_RESULT" != *'"deleted": true'* ]] \
  || [[ "$DELETE_RESULT" != *'"responses_count": 1'* ]] \
  || [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
    "select count(*) from public.tests where id = 'a9000000-0000-4000-8000-000000000027';")" != "0" ]]
then
  echo "Concurrent test deletion deadlocked with grading: $DELETE_RESULT" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-grading-unanswered-inserter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.save_test_unanswered_grades_atomic(
  'a9000000-0000-4000-8000-000000000019',
  'a9000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'question_id', 'a9000000-0000-4000-8000-000000000113',
    'student_id', 'a9000000-0000-4000-8000-000000000002',
    'response_id', null,
    'expected_response_revision', null,
    'submitted_at', '2026-07-14T16:08:00Z'
  )),
  '2026-07-14T16:08:00Z'
);
select pg_sleep(1);
commit;
SQL
UNANSWERED_INSERT_PID=$!
wait_for_application_event atomic-test-grading-unanswered-inserter PgSleep

set +e
docker exec -e PGAPPNAME=atomic-test-grading-unanswered-waiter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.save_test_unanswered_grades_atomic(
    'a9000000-0000-4000-8000-000000000019',
    'a9000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'question_id', 'a9000000-0000-4000-8000-000000000113',
      'student_id', 'a9000000-0000-4000-8000-000000000002',
      'response_id', null,
      'expected_response_revision', null,
      'submitted_at', '2026-07-14T16:08:00Z'
    )),
    '2026-07-14T16:08:01Z'
  );" >"$TMP_ONE" 2>&1
UNANSWERED_WAITER_STATUS=$?
set -e
wait "$UNANSWERED_INSERT_PID"

UNANSWERED_INSERT_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) || ':' || min(revision) || ':' || min(score) || ':' || min(feedback)
   from public.test_responses
   where question_id = 'a9000000-0000-4000-8000-000000000113'
     and student_id = 'a9000000-0000-4000-8000-000000000002';")"
if [[ "$UNANSWERED_WAITER_STATUS" -eq 0 ]] \
  || ! grep -q 'Test response changed' "$TMP_ONE" \
  || [[ "$UNANSWERED_INSERT_STATE" != "1:1:0.00:Unanswered" ]]
then
  echo "Concurrent unanswered inserts were incoherent: $(cat "$TMP_ONE") / $UNANSWERED_INSERT_STATE" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-grading-manual-missing-inserter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
insert into public.test_responses (
  id, test_id, question_id, student_id, response_text, score, feedback,
  graded_at, graded_by, submitted_at
) values (
  'a9000000-0000-4000-8000-000000000214',
  'a9000000-0000-4000-8000-000000000020',
  'a9000000-0000-4000-8000-000000000114',
  'a9000000-0000-4000-8000-000000000002',
  '', 3, 'Concurrent manual grade', clock_timestamp(),
  'a9000000-0000-4000-8000-000000000001', clock_timestamp()
);
select pg_sleep(1);
commit;
SQL
MANUAL_MISSING_PID=$!
wait_for_application_event atomic-test-grading-manual-missing-inserter PgSleep

for _ in 1 2; do
  set +e
  docker exec -e PGAPPNAME=atomic-test-grading-missing-response-waiter -i "$DB_CONTAINER" \
    psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose >/dev/null 2>"$TMP_TWO" <<'SQL'
select public.create_test_ai_grading_run_atomic(
  'a9000000-0000-4000-8000-000000000020',
  'a9000000-0000-4000-8000-000000000001',
  'contract-model',
  array['a9000000-0000-4000-8000-000000000002'::uuid],
  array['a9000000-0000-4000-8000-000000000002'::uuid],
  'missing-response-race', 1, 1, 0,
  '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'question_id', 'a9000000-0000-4000-8000-000000000114',
    'student_id', 'a9000000-0000-4000-8000-000000000002',
    'response_id', null,
    'expected_response_revision', null,
    'submitted_at', '2026-07-14T16:08:10Z'
  )),
  null
);
SQL
  MISSING_RESPONSE_STATUS=$?
  set -e
  if [[ "$MISSING_RESPONSE_STATUS" -eq 0 ]] || ! grep -q '40001' "$TMP_TWO"; then
    echo "Missing-response run creation accepted stale preflight: $(cat "$TMP_TWO")" >&2
    exit 1
  fi
done
wait "$MANUAL_MISSING_PID"

MANUAL_MISSING_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select revision || ':' || score || ':' || feedback
   from public.test_responses
   where id = 'a9000000-0000-4000-8000-000000000214';")"
if [[ "$MANUAL_MISSING_STATE" != "1:3.00:Concurrent manual grade" ]] \
  || [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
    "select count(*) from public.test_ai_grading_runs where test_id = 'a9000000-0000-4000-8000-000000000020';")" != "0" ]]
then
  echo "Missing-response retry overwrote a concurrent manual grade: $MANUAL_MISSING_STATE" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-grading-run-creator -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.create_test_ai_grading_run_atomic(
  'a9000000-0000-4000-8000-000000000020',
  'a9000000-0000-4000-8000-000000000001',
  'contract-model',
  array['a9000000-0000-4000-8000-000000000002'::uuid],
  array['a9000000-0000-4000-8000-000000000002'::uuid],
  'concurrent-create', 1, 0, 0,
  jsonb_build_array(jsonb_build_object(
    'student_id', 'a9000000-0000-4000-8000-000000000002',
    'question_id', 'a9000000-0000-4000-8000-000000000112',
    'response_id', 'a9000000-0000-4000-8000-000000000213',
    'response_revision', 1,
    'queue_position', 0
  )),
  '[]'::jsonb,
  null
);
select pg_sleep(1);
commit;
SQL
RUN_CREATOR_PID=$!
wait_for_application_event atomic-test-grading-run-creator PgSleep

RUN_WAITER_OUTCOME="$(docker exec -e PGAPPNAME=atomic-test-grading-run-waiter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.create_test_ai_grading_run_atomic(
    'a9000000-0000-4000-8000-000000000020',
    'a9000000-0000-4000-8000-000000000001',
    'contract-model',
    array['a9000000-0000-4000-8000-000000000003'::uuid],
    array['a9000000-0000-4000-8000-000000000003'::uuid],
    'concurrent-loser', 1, 1, 0,
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'question_id', 'a9000000-0000-4000-8000-000000000112',
      'student_id', 'a9000000-0000-4000-8000-000000000003',
      'response_id', null,
      'expected_response_revision', null,
      'submitted_at', '2026-07-14T16:08:30Z'
    )),
    null
  )->>'outcome';")"
wait "$RUN_CREATOR_PID"

RUN_CREATE_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select count(distinct run.id) || ':' || count(item.id) || ':' || count(response.id)
   from public.test_ai_grading_runs run
   left join public.test_ai_grading_run_items item on item.run_id = run.id
   left join public.test_responses response
     on response.test_id = run.test_id
    and response.student_id = 'a9000000-0000-4000-8000-000000000003'
   where run.test_id = 'a9000000-0000-4000-8000-000000000020';")"
if [[ "$RUN_WAITER_OUTCOME" != "existing" ]] || [[ "$RUN_CREATE_STATE" != "1:1:0" ]]; then
  echo "Concurrent run creation was not atomic: $RUN_WAITER_OUTCOME / $RUN_CREATE_STATE" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-grading-lease-claimer -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select count(*) from public.claim_test_ai_grading_run(
  'a9000000-0000-4000-8000-000000000308',
  'a9000000-0000-4000-8000-000000000601',
  60
);
select pg_sleep(1);
commit;
SQL
LEASE_CLAIMER_PID=$!
wait_for_application_event atomic-test-grading-lease-claimer PgSleep

LEASE_WAITER_COUNT="$(docker exec -e PGAPPNAME=atomic-test-grading-lease-waiter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from public.claim_test_ai_grading_run(
    'a9000000-0000-4000-8000-000000000308',
    'a9000000-0000-4000-8000-000000000602',
    60
  );")"
wait "$LEASE_CLAIMER_PID"
LEASE_OWNER="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select lease_token from public.test_ai_grading_runs
   where id = 'a9000000-0000-4000-8000-000000000308';")"
if [[ "$LEASE_WAITER_COUNT" != "0" ]] \
  || [[ "$LEASE_OWNER" != "a9000000-0000-4000-8000-000000000601" ]]
then
  echo "Concurrent lease claim produced multiple owners: $LEASE_WAITER_COUNT / $LEASE_OWNER" >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
update public.test_ai_grading_runs
set lease_expires_at = clock_timestamp() + interval '1 second'
where id = 'a9000000-0000-4000-8000-000000000308';
SQL
docker exec -e PGAPPNAME=atomic-test-grading-lease-renewer -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.renew_test_ai_grading_run_lease(
  'a9000000-0000-4000-8000-000000000308',
  'a9000000-0000-4000-8000-000000000601',
  60
);
select pg_sleep(3);
commit;
SQL
LEASE_RENEWER_PID=$!
wait_for_application_event atomic-test-grading-lease-renewer PgSleep
sleep 1.1

LEASE_RECLAIM_COUNT="$(docker exec -e PGAPPNAME=atomic-test-grading-lease-reclaimer -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from public.claim_test_ai_grading_run(
    'a9000000-0000-4000-8000-000000000308',
    'a9000000-0000-4000-8000-000000000602',
    60
  );")"
wait "$LEASE_RENEWER_PID"
LEASE_OWNER="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select lease_token from public.test_ai_grading_runs
   where id = 'a9000000-0000-4000-8000-000000000308';")"
if [[ "$LEASE_RECLAIM_COUNT" != "0" ]] \
  || [[ "$LEASE_OWNER" != "a9000000-0000-4000-8000-000000000601" ]]
then
  echo "Lease renewal did not fence a concurrent reclaimer: $LEASE_RECLAIM_COUNT / $LEASE_OWNER" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-grading-manual-first -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.save_test_response_grades_atomic(
  'a9000000-0000-4000-8000-000000000016',
  'a9000000-0000-4000-8000-000000000002',
  'a9000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'response_id', 'a9000000-0000-4000-8000-000000000207',
    'question_id', 'a9000000-0000-4000-8000-000000000107',
    'expected_response_revision', 1,
    'clear_grade', false,
    'score', 2,
    'feedback', 'Manual first winner'
  )),
  '2026-07-14T16:08:00Z'
);
select pg_sleep(3);
commit;
SQL
MANUAL_FIRST_PID=$!
wait_for_application_event atomic-test-grading-manual-first PgSleep

MANUAL_FIRST_OUTCOME="$(docker exec -e PGAPPNAME=atomic-test-grading-ai-waiter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.finalize_test_ai_grading_item_atomic(
    'a9000000-0000-4000-8000-000000000405',
    'a9000000-0000-4000-8000-000000000001',
    'a9000000-0000-4000-8000-000000000505',
    5, 'Late AI grade', 'teacher_key', null, 'contract-model', 1,
    '2026-07-14T16:09:00Z'
  )->>'outcome';")"
wait "$MANUAL_FIRST_PID"

MANUAL_FIRST_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select response.revision || ':' || response.score || ':' || item.status || ':' || item.last_error_code
   from public.test_responses response
   join public.test_ai_grading_run_items item on item.response_id = response.id
   where response.id = 'a9000000-0000-4000-8000-000000000207';")"
if [[ "$MANUAL_FIRST_OUTCOME" != "stale" ]] \
  || [[ "$MANUAL_FIRST_STATE" != "2:2.00:failed:source_revision_conflict" ]]
then
  echo "Manual-first grading order was not serialized: $MANUAL_FIRST_OUTCOME / $MANUAL_FIRST_STATE" >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-test-grading-ai-first -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.finalize_test_ai_grading_item_atomic(
  'a9000000-0000-4000-8000-000000000406',
  'a9000000-0000-4000-8000-000000000001',
  'a9000000-0000-4000-8000-000000000506',
  4, 'AI first winner', 'teacher_key', null, 'contract-model', 1,
  '2026-07-14T16:10:00Z'
);
select pg_sleep(3);
commit;
SQL
AI_FIRST_PID=$!
wait_for_application_event atomic-test-grading-ai-first PgSleep

set +e
docker exec -e PGAPPNAME=atomic-test-grading-manual-waiter -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -Atc \
  "select public.save_test_response_grades_atomic(
    'a9000000-0000-4000-8000-000000000017',
    'a9000000-0000-4000-8000-000000000002',
    'a9000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'response_id', 'a9000000-0000-4000-8000-000000000209',
      'question_id', 'a9000000-0000-4000-8000-000000000108',
      'expected_response_revision', 1,
      'clear_grade', false,
      'score', 1,
      'feedback', 'Late manual grade'
    )),
    '2026-07-14T16:11:00Z'
  );" >"$TMP_ONE" 2>&1
AI_FIRST_MANUAL_STATUS=$?
set -e
wait "$AI_FIRST_PID"

if [[ "$AI_FIRST_MANUAL_STATUS" -eq 0 ]] \
  || ! grep -q '40001' "$TMP_ONE" \
  || ! grep -q 'Test response grade changed' "$TMP_ONE"
then
  echo "AI-first grading order did not reject the stale manual write: $(cat "$TMP_ONE")" >&2
  exit 1
fi

AI_FIRST_STATE="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select response.revision || ':' || response.score || ':' || response.feedback || ':' || item.status
   from public.test_responses response
   join public.test_ai_grading_run_items item on item.response_id = response.id
   where response.id = 'a9000000-0000-4000-8000-000000000209';")"
if [[ "$AI_FIRST_STATE" != "2:4.00:AI first winner:completed" ]]; then
  echo "AI-first grading order left incoherent state: $AI_FIRST_STATE" >&2
  exit 1
fi

echo "Atomic test grading database checks passed."
