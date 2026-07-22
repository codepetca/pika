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
delete from public.classrooms
where id = 'd0000000-0000-4000-8000-000000000010';
delete from public.users
where id::text like 'd0000000-0000-4000-8000-00000000000%';
SQL
}
trap cleanup EXIT
cleanup

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
insert into public.users (id, email, role) values
  ('d0000000-0000-4000-8000-000000000001', 'atomic-return-teacher@example.test', 'teacher'),
  ('d0000000-0000-4000-8000-000000000002', 'atomic-return-student-1@example.test', 'student'),
  ('d0000000-0000-4000-8000-000000000003', 'atomic-return-student-2@example.test', 'student'),
  ('d0000000-0000-4000-8000-000000000004', 'atomic-return-student-3@example.test', 'student'),
  ('d0000000-0000-4000-8000-000000000005', 'atomic-return-student-4@example.test', 'student'),
  ('d0000000-0000-4000-8000-000000000006', 'atomic-return-student-5@example.test', 'student'),
  ('d0000000-0000-4000-8000-000000000007', 'atomic-return-unavailable@example.test', 'student'),
  ('d0000000-0000-4000-8000-000000000009', 'atomic-return-student-6@example.test', 'student');

insert into public.classrooms (id, teacher_id, title, class_code) values
  ('d0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000001', 'Atomic return contract', 'ATOMIC87');

insert into public.classroom_enrollments (classroom_id, student_id) values
  ('d0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000003'),
  ('d0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000004'),
  ('d0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000005'),
  ('d0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000006'),
  ('d0000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000009');

insert into public.classroom_roster (id, classroom_id, email) values
  ('d0000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000010', 'atomic-return-student-5@example.test'),
  ('d0000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000010', 'atomic-return-student-6@example.test');

insert into public.assignments (id, classroom_id, title, due_at, created_by) values
  ('d0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000010', 'Single feedback', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000010', 'Batch feedback', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000010', 'Concurrent batch feedback', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000010', 'Cross-operation missing feedback', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000015', 'd0000000-0000-4000-8000-000000000010', 'Stale grade serialization', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000016', 'd0000000-0000-4000-8000-000000000010', 'AI run source revision', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000017', 'd0000000-0000-4000-8000-000000000010', 'AI grade batch transaction', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000018', 'd0000000-0000-4000-8000-000000000010', 'Roster serialization', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000019', 'd0000000-0000-4000-8000-000000000010', 'AI item finalization', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000010', 'Repo review completion', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000021', 'd0000000-0000-4000-8000-000000000010', 'Repo review rollback', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000023', 'd0000000-0000-4000-8000-000000000010', 'Repo review provenance', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000024', 'd0000000-0000-4000-8000-000000000010', 'Repo review provenance rollback', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000001');

insert into public.assignment_docs (
  assignment_id,
  student_id,
  content,
  is_submitted,
  submitted_at,
  score_completion,
  score_thinking,
  score_workflow,
  teacher_feedback_draft
) values
  ('d0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}', true, now(), 4, 4, 4, 'Single feedback'),
  ('d0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000003', '{"type":"doc","content":[]}', true, now(), 4, 4, 4, 'Batch feedback'),
  ('d0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000004', '{"type":"doc","content":[]}', true, now(), null, null, null, null),
  ('d0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000005', '{"type":"doc","content":[]}', true, now(), 2, 3, null, 'Partial feedback'),
  ('d0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000003', '{"type":"doc","content":[]}', true, now(), 4, 4, 4, 'Concurrent feedback'),
  ('d0000000-0000-4000-8000-000000000015', 'd0000000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}', true, now(), 4, 4, 4, 'Return this feedback'),
  ('d0000000-0000-4000-8000-000000000016', 'd0000000-0000-4000-8000-000000000005', '{"type":"doc","content":[]}', true, now(), null, null, null, null),
  ('d0000000-0000-4000-8000-000000000017', 'd0000000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}', true, now(), 1, 1, 1, null),
  ('d0000000-0000-4000-8000-000000000017', 'd0000000-0000-4000-8000-000000000003', '{"type":"doc","content":[]}', true, now(), 2, 2, 2, null),
  ('d0000000-0000-4000-8000-000000000019', 'd0000000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}', true, now(), 1, 1, 1, null),
  ('d0000000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000003', '{"type":"doc","content":[]}', true, now(), 2, 2, 2, null),
  ('d0000000-0000-4000-8000-000000000021', 'd0000000-0000-4000-8000-000000000004', '{"type":"doc","content":[]}', true, now(), 3, 3, 3, null),
  ('d0000000-0000-4000-8000-000000000021', 'd0000000-0000-4000-8000-000000000005', '{"type":"doc","content":[]}', true, now(), 4, 4, 4, null),
  ('d0000000-0000-4000-8000-000000000023', 'd0000000-0000-4000-8000-000000000006', '{"type":"doc","content":[]}', true, now(), 4, 4, 4, null),
  ('d0000000-0000-4000-8000-000000000024', 'd0000000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}', true, now(), 5, 5, 5, null);

commit;

do $contract$
declare
  v_teacher_id constant uuid := 'd0000000-0000-4000-8000-000000000001';
  v_single_assignment constant uuid := 'd0000000-0000-4000-8000-000000000011';
  v_batch_assignment constant uuid := 'd0000000-0000-4000-8000-000000000012';
  v_single_student constant uuid := 'd0000000-0000-4000-8000-000000000002';
  v_expected timestamptz;
  v_result jsonb;
  v_count integer;
begin
  if has_function_privilege(
    'anon',
    'public.save_assignment_grades_atomic(uuid,uuid[],uuid,jsonb,boolean,integer,integer,integer,boolean,boolean,text,timestamp with time zone)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.save_assignment_grades_atomic(uuid,uuid[],uuid,jsonb,boolean,integer,integer,integer,boolean,boolean,text,timestamp with time zone)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.save_assignment_grades_atomic(uuid,uuid[],uuid,jsonb,boolean,integer,integer,integer,boolean,boolean,text,timestamp with time zone)',
    'execute'
  ) then
    raise exception 'Unexpected assignment-grade RPC privileges';
  end if;

  if has_function_privilege(
    'anon',
    'public.save_assignment_ai_grade_atomic(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,text,boolean,boolean,text,text,text,timestamp with time zone)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.save_assignment_ai_grade_atomic(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,text,boolean,boolean,text,text,text,timestamp with time zone)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.save_assignment_ai_grade_atomic(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,text,boolean,boolean,text,text,text,timestamp with time zone)',
    'execute'
  ) then
    raise exception 'Unexpected assignment AI-grade RPC privileges';
  end if;

  if has_function_privilege(
    'anon',
    'public.save_assignment_ai_grade_with_provenance_atomic(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,text,boolean,boolean,text,text,jsonb,text,timestamp with time zone)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.save_assignment_ai_grade_with_provenance_atomic(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,text,boolean,boolean,text,text,jsonb,text,timestamp with time zone)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.save_assignment_ai_grade_with_provenance_atomic(uuid,uuid,uuid,timestamp with time zone,integer,integer,integer,text,boolean,boolean,text,text,jsonb,text,timestamp with time zone)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.finalize_assignment_ai_grading_item_with_provenance_atomic(uuid,uuid,integer,integer,integer,text,boolean,boolean,text,text,jsonb,text,integer,text,text,timestamp with time zone)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.finalize_assignment_ai_grading_item_with_provenance_atomic(uuid,uuid,integer,integer,integer,text,boolean,boolean,text,text,jsonb,text,integer,text,text,timestamp with time zone)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.finalize_assignment_ai_grading_item_with_provenance_atomic(uuid,uuid,integer,integer,integer,text,boolean,boolean,text,text,jsonb,text,integer,text,text,timestamp with time zone)',
    'execute'
  ) then
    raise exception 'Unexpected assignment AI provenance RPC privileges';
  end if;

  if has_function_privilege(
    'anon',
    'public.save_assignment_ai_grades_atomic(uuid,uuid,jsonb,timestamp with time zone)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.save_assignment_ai_grades_atomic(uuid,uuid,jsonb,timestamp with time zone)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.save_assignment_ai_grades_atomic(uuid,uuid,jsonb,timestamp with time zone)',
    'execute'
  ) then
    raise exception 'Unexpected assignment AI-grade batch RPC privileges';
  end if;

  if has_function_privilege(
    'anon',
    'public.return_assignment_feedback_atomic(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.return_assignment_feedback_atomic(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.return_assignment_feedback_atomic(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)',
    'execute'
  ) then
    raise exception 'Unexpected single-feedback RPC privileges';
  end if;

  if has_function_privilege(
    'anon',
    'public.return_assignment_docs_with_feedback_atomic(uuid,uuid[],uuid,timestamp with time zone)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.return_assignment_docs_with_feedback_atomic(uuid,uuid[],uuid,timestamp with time zone)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.return_assignment_docs_with_feedback_atomic(uuid,uuid[],uuid,timestamp with time zone)',
    'execute'
  ) then
    raise exception 'Unexpected batch-feedback RPC privileges';
  end if;

  select updated_at into v_expected
  from public.assignment_docs
  where assignment_id = v_single_assignment and student_id = v_single_student;

  v_result := public.return_assignment_feedback_atomic(
    v_single_assignment,
    v_single_student,
    v_teacher_id,
    'Single feedback',
    v_expected,
    '2026-07-14T18:40:00Z'
  );
  if not (v_result->>'applied')::boolean then
    raise exception 'Expected the first feedback return to apply: %', v_result;
  end if;

  select updated_at into v_expected
  from public.assignment_docs
  where assignment_id = v_single_assignment and student_id = v_single_student;
  v_result := public.return_assignment_feedback_atomic(
    v_single_assignment,
    v_single_student,
    v_teacher_id,
    'Single feedback',
    v_expected,
    '2026-07-14T18:41:00Z'
  );
  if (v_result->>'applied')::boolean then
    raise exception 'A replay without a new draft created duplicate feedback: %', v_result;
  end if;

  update public.assignment_docs
  set teacher_feedback_draft = 'Single feedback', teacher_feedback_draft_updated_at = now()
  where assignment_id = v_single_assignment and student_id = v_single_student;
  select updated_at into v_expected
  from public.assignment_docs
  where assignment_id = v_single_assignment and student_id = v_single_student;
  v_result := public.return_assignment_feedback_atomic(
    v_single_assignment,
    v_single_student,
    v_teacher_id,
    'Single feedback',
    v_expected,
    '2026-07-14T18:42:00Z'
  );
  if not (v_result->>'applied')::boolean then
    raise exception 'A new draft with repeated text should be returnable: %', v_result;
  end if;

  select count(*) into v_count
  from public.assignment_feedback_entries
  where assignment_id = v_single_assignment;
  if v_count <> 2 then
    raise exception 'Expected exactly two intentional single-feedback entries, found %', v_count;
  end if;

  v_result := public.return_assignment_docs_with_feedback_atomic(
    v_batch_assignment,
    array[
      'd0000000-0000-4000-8000-000000000003',
      'd0000000-0000-4000-8000-000000000004',
      'd0000000-0000-4000-8000-000000000005',
      'd0000000-0000-4000-8000-000000000006',
      'd0000000-0000-4000-8000-000000000007'
    ]::uuid[],
    v_teacher_id,
    '2026-07-14T18:43:00Z'
  );
  if (v_result->>'returned_count')::integer <> 3
    or (v_result->>'updated_count')::integer <> 2
    or (v_result->>'created_count')::integer <> 1
    or (v_result->>'blocked_count')::integer <> 1
    or (v_result->>'not_enrolled_count')::integer <> 1
  then
    raise exception 'Unexpected batch classification: %', v_result;
  end if;

  select count(*) into v_count
  from public.assignment_feedback_entries
  where assignment_id = v_batch_assignment;
  if v_count <> 1 then
    raise exception 'Expected one batch history entry, found %', v_count;
  end if;

  v_result := public.return_assignment_docs_with_feedback_atomic(
    v_batch_assignment,
    array[
      'd0000000-0000-4000-8000-000000000003',
      'd0000000-0000-4000-8000-000000000004',
      'd0000000-0000-4000-8000-000000000005',
      'd0000000-0000-4000-8000-000000000006',
      'd0000000-0000-4000-8000-000000000007'
    ]::uuid[],
    v_teacher_id,
    '2026-07-14T18:44:00Z'
  );
  if (v_result->>'returned_count')::integer <> 0
    or (v_result->>'already_returned_count')::integer <> 3
  then
    raise exception 'Expected a completed batch replay to skip returned work: %', v_result;
  end if;
end;
$contract$;
SQL

wait_for_application() {
  local application_name="$1"
  for _ in $(seq 1 80); do
    if [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
      "select count(*) from pg_stat_activity where application_name = '$application_name' and state = 'active';")" == "1" ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "Timed out waiting for PostgreSQL application $application_name." >&2
  return 1
}

wait_for_advisory_waiters() {
  local application_prefix="$1"
  local expected_count="$2"
  for _ in $(seq 1 80); do
    if [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
      "select count(*) from pg_stat_activity where application_name like '$application_prefix%' and wait_event = 'advisory';")" == "$expected_count" ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "Timed out waiting for $expected_count advisory-lock waiter(s) with prefix $application_prefix." >&2
  return 1
}

wait_for_application_event() {
  local application_name="$1"
  local wait_event="$2"
  for _ in $(seq 1 80); do
    if [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
      "select count(*) from pg_stat_activity where application_name = '$application_name' and wait_event = '$wait_event';")" == "1" ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "Timed out waiting for $application_name to enter $wait_event." >&2
  return 1
}

docker exec -e PGAPPNAME=atomic-batch-lock-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c \
  "begin; select pg_advisory_xact_lock(hashtextextended('d0000000-0000-4000-8000-000000000013', 0)); select pg_sleep(3); commit;" \
  >/dev/null &
LOCK_HOLDER_PID=$!
wait_for_application atomic-batch-lock-holder

run_concurrent_batch() {
  local application_name="$1"
  docker exec -e PGAPPNAME="$application_name" -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
    "select public.return_assignment_docs_with_feedback_atomic(
      'd0000000-0000-4000-8000-000000000013',
      array['d0000000-0000-4000-8000-000000000003']::uuid[],
      'd0000000-0000-4000-8000-000000000001',
      '2026-07-14T18:45:00Z'
    )->>'returned_count';"
}

run_concurrent_batch atomic-batch-worker-one >"$TMP_ONE" &
PID_ONE=$!
run_concurrent_batch atomic-batch-worker-two >"$TMP_TWO" &
PID_TWO=$!
wait_for_advisory_waiters atomic-batch-worker 2
wait "$LOCK_HOLDER_PID"
wait "$PID_ONE"
wait "$PID_TWO"

CONCURRENT_COUNTS="$(sort "$TMP_ONE" "$TMP_TWO" | tr '\n' ' ' | xargs)"
if [[ "$CONCURRENT_COUNTS" != "0 1" ]]; then
  echo "Expected concurrent batch return counts 0 and 1, got: $CONCURRENT_COUNTS" >&2
  exit 1
fi

HISTORY_COUNT="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from public.assignment_feedback_entries where assignment_id = 'd0000000-0000-4000-8000-000000000013';")"
if [[ "$HISTORY_COUNT" != "1" ]]; then
  echo "Expected one concurrent batch history row, got: $HISTORY_COUNT" >&2
  exit 1
fi

run_single_missing() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
    "select public.return_assignment_feedback_atomic(
      'd0000000-0000-4000-8000-000000000014',
      'd0000000-0000-4000-8000-000000000006',
      'd0000000-0000-4000-8000-000000000001',
      'Cross-operation feedback',
      null,
      '2026-07-14T18:46:00Z'
    )->>'applied';"
}

run_batch_missing() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
    "select public.return_assignment_docs_with_feedback_atomic(
      'd0000000-0000-4000-8000-000000000014',
      array['d0000000-0000-4000-8000-000000000006']::uuid[],
      'd0000000-0000-4000-8000-000000000001',
      '2026-07-14T18:46:00Z'
    )->>'returned_count';"
}

run_single_missing >"$TMP_ONE" &
PID_ONE=$!
run_batch_missing >"$TMP_TWO" &
PID_TWO=$!
wait "$PID_ONE"
wait "$PID_TWO"

if [[ "$(cat "$TMP_TWO")" != "1" ]]; then
  echo "Expected cross-operation batch return count 1, got: $(cat "$TMP_TWO")" >&2
  exit 1
fi
if [[ "$(cat "$TMP_ONE")" != "true" && "$(cat "$TMP_ONE")" != "false" ]]; then
  echo "Unexpected cross-operation single return result: $(cat "$TMP_ONE")" >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $contract$
declare
  v_doc_count integer;
  v_history_count integer;
begin
  select count(*) into v_doc_count
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000014'
    and student_id = 'd0000000-0000-4000-8000-000000000006'
    and returned_at is not null;
  select count(*) into v_history_count
  from public.assignment_feedback_entries
  where assignment_id = 'd0000000-0000-4000-8000-000000000014';

  if v_doc_count <> 1 or v_history_count > 1 then
    raise exception 'Cross-operation race was not serialized: docs %, history %', v_doc_count, v_history_count;
  end if;
end;
$contract$;
SQL

STALE_GRADE_EXPECTED="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select updated_at from public.assignment_docs where assignment_id = 'd0000000-0000-4000-8000-000000000015' and student_id = 'd0000000-0000-4000-8000-000000000002';")"

docker exec -e PGAPPNAME=atomic-return-lock-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select pg_advisory_xact_lock(hashtextextended('d0000000-0000-4000-8000-000000000015', 0));
select pg_sleep(3);
select public.return_assignment_docs_with_feedback_atomic(
  'd0000000-0000-4000-8000-000000000015',
  array['d0000000-0000-4000-8000-000000000002']::uuid[],
  'd0000000-0000-4000-8000-000000000001',
  '2026-07-14T18:47:00Z'
);
commit;
SQL
RETURN_HOLDER_PID=$!
wait_for_application atomic-return-lock-holder

docker exec -e PGAPPNAME=atomic-stale-grade-worker -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.save_assignment_grades_atomic(
    'd0000000-0000-4000-8000-000000000015',
    array['d0000000-0000-4000-8000-000000000002']::uuid[],
    'd0000000-0000-4000-8000-000000000001',
    jsonb_build_object('d0000000-0000-4000-8000-000000000002', '$STALE_GRADE_EXPECTED'),
    true, 9, 9, 9, true, true, 'Stale grade feedback',
    '2026-07-14T18:48:00Z'
  );" >"$TMP_ONE" 2>&1 &
STALE_GRADE_PID=$!

docker exec -e PGAPPNAME=atomic-stale-ai-worker -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.save_assignment_ai_grade_atomic(
    'd0000000-0000-4000-8000-000000000015',
    'd0000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000001',
    '$STALE_GRADE_EXPECTED',
    10, 10, 10,
    'Stale AI feedback',
    true,
    true,
    'Stale AI feedback',
    'test-ai-model',
    'd0000000-0000-4000-8000-000000000001',
    '2026-07-14T18:49:00Z'
  );" >"$TMP_TWO" 2>&1 &
STALE_AI_PID=$!

wait_for_advisory_waiters atomic-stale- 2
wait "$RETURN_HOLDER_PID"
set +e
wait "$STALE_GRADE_PID"
STALE_GRADE_STATUS=$?
wait "$STALE_AI_PID"
STALE_AI_STATUS=$?
set -e
if [[ "$STALE_GRADE_STATUS" -eq 0 ]]; then
  echo "Expected a stale grade save to conflict after return." >&2
  exit 1
fi
if [[ "$STALE_AI_STATUS" -eq 0 ]]; then
  echo "Expected a stale AI grade result to conflict after return." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $contract$
declare
  v_doc public.assignment_docs%rowtype;
  v_history_count integer;
begin
  select * into strict v_doc
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000015'
    and student_id = 'd0000000-0000-4000-8000-000000000002';
  select count(*) into v_history_count
  from public.assignment_feedback_entries
  where assignment_id = 'd0000000-0000-4000-8000-000000000015';

  if v_doc.teacher_feedback_draft is not null
    or v_doc.feedback <> 'Return this feedback'
    or v_doc.ai_feedback_model is not null
    or v_history_count <> 1
  then
    raise exception 'Stale grade save recreated feedback after return: %, history %', v_doc.teacher_feedback_draft, v_history_count;
  end if;
end;
$contract$;
SQL

AI_RUN_DOC_ID="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select id from public.assignment_docs where assignment_id = 'd0000000-0000-4000-8000-000000000016' and student_id = 'd0000000-0000-4000-8000-000000000005';")"
AI_RUN_EXPECTED="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select updated_at from public.assignment_docs where id = '$AI_RUN_DOC_ID';")"

docker exec -e PGAPPNAME=atomic-doc-revision-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
update public.assignment_docs
set teacher_feedback_draft = 'Concurrent revision'
where assignment_id = 'd0000000-0000-4000-8000-000000000016'
  and student_id = 'd0000000-0000-4000-8000-000000000005';
select pg_sleep(3);
commit;
SQL
STUDENT_UPDATE_PID=$!
wait_for_application_event atomic-doc-revision-holder PgSleep

set +e
docker exec -e PGAPPNAME=atomic-ai-run-create-worker -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.create_assignment_ai_grading_run_atomic(
    'd0000000-0000-4000-8000-000000000016',
    'd0000000-0000-4000-8000-000000000001',
    'test-ai-model',
    array['d0000000-0000-4000-8000-000000000005']::uuid[],
    'stale-source-revision',
    1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'student_id', 'd0000000-0000-4000-8000-000000000005',
      'assignment_doc_id', '$AI_RUN_DOC_ID',
      'assignment_doc_updated_at', '$AI_RUN_EXPECTED',
      'assignment_doc_revision_provided', true,
      'queue_position', 0,
      'status', 'queued',
      'attempt_count', 0
    )),
    '2026-07-14T18:50:00Z'
  );" >"$TMP_ONE" 2>&1 &
AI_RUN_CREATE_PID=$!
set -e

wait "$STUDENT_UPDATE_PID"
set +e
wait "$AI_RUN_CREATE_PID"
AI_RUN_CREATE_STATUS=$?
set -e
if [[ "$AI_RUN_CREATE_STATUS" -eq 0 ]]; then
  echo "Expected AI-run creation to reject a concurrent assignment document update." >&2
  exit 1
fi

AI_RUN_COUNT="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from public.assignment_ai_grading_runs where assignment_id = 'd0000000-0000-4000-8000-000000000016';")"
if [[ "$AI_RUN_COUNT" != "0" ]]; then
  echo "Expected stale AI-run creation to roll back, found $AI_RUN_COUNT run(s)." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "update public.assignment_docs
   set ai_feedback_model = 'old-model',
       ai_grading_provenance = '{\"schemaVersion\":\"assignment-grading-provenance-v1\",\"provider\":\"openai\",\"model\":\"old-model\",\"policyVersion\":\"old-policy\",\"promptVersion\":\"old-prompt\",\"gradingProfileVersion\":\"old-profile\",\"rubricVersion\":\"old-rubric\",\"providerRequestCount\":1,\"tokenUsage\":{\"inputTokens\":10,\"outputTokens\":5,\"totalTokens\":15}}'::jsonb
   where assignment_id = 'd0000000-0000-4000-8000-000000000016'
     and student_id = 'd0000000-0000-4000-8000-000000000005';" >/dev/null

UNGRADED_REVIEW_COUNT="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from public.assignment_docs
   where assignment_id = 'd0000000-0000-4000-8000-000000000016'
     and student_id = 'd0000000-0000-4000-8000-000000000005'
     and ai_grading_review is not null;")"
if [[ "$UNGRADED_REVIEW_COUNT" != "0" ]]; then
  echo "Expected provenance without completed scores to omit the grading review snapshot." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.create_assignment_ai_grading_run_atomic(
    'd0000000-0000-4000-8000-000000000016',
    'd0000000-0000-4000-8000-000000000001',
    'legacy-ai-model',
    array['d0000000-0000-4000-8000-000000000005']::uuid[],
    'legacy-payload',
    1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'student_id', 'd0000000-0000-4000-8000-000000000005',
      'assignment_doc_id', '$AI_RUN_DOC_ID',
      'queue_position', 0,
      'status', 'queued',
      'attempt_count', 0
    )),
    '2026-07-14T18:51:00Z'
  );" >/dev/null

LEGACY_REVISION_COUNT="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from public.assignment_ai_grading_run_items where assignment_id = 'd0000000-0000-4000-8000-000000000016' and assignment_doc_updated_at is not null;")"
if [[ "$LEGACY_REVISION_COUNT" != "1" ]]; then
  echo "Expected migration-first compatibility to snapshot one legacy AI-run revision." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $contract$
declare
  v_first_expected timestamptz;
  v_second_expected timestamptz;
  v_first_score integer;
begin
  select updated_at into v_first_expected
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000002';
  select updated_at into v_second_expected
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000003';

  update public.assignment_docs
  set teacher_feedback_draft = 'Concurrent grade revision'
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000003';

  begin
    perform public.save_assignment_ai_grades_atomic(
      'd0000000-0000-4000-8000-000000000017',
      'd0000000-0000-4000-8000-000000000001',
      jsonb_build_array(
        jsonb_build_object(
          'student_id', 'd0000000-0000-4000-8000-000000000002',
          'expected_doc_updated_at', v_first_expected,
          'score_completion', 9, 'score_thinking', 9, 'score_workflow', 9,
          'feedback', 'First result', 'apply_teacher_feedback_draft', false,
          'mark_graded', false, 'ai_feedback_suggestion', 'First result',
          'ai_feedback_model', 'repo-review-v2'
        ),
        jsonb_build_object(
          'student_id', 'd0000000-0000-4000-8000-000000000003',
          'expected_doc_updated_at', v_second_expected,
          'score_completion', 8, 'score_thinking', 8, 'score_workflow', 8,
          'feedback', 'Second result', 'apply_teacher_feedback_draft', false,
          'mark_graded', false, 'ai_feedback_suggestion', 'Second result',
          'ai_feedback_model', 'repo-review-v2'
        )
      ),
      '2026-07-14T18:52:00Z'
    );
    raise exception 'Expected stale AI grade batch to conflict';
  exception
    when serialization_failure then null;
  end;

  select score_completion into v_first_score
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000002';
  if v_first_score <> 1 then
    raise exception 'AI grade batch partially committed before conflict';
  end if;
end;
$contract$;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $contract$
declare
  v_expected timestamptz;
  v_score integer;
  v_run_id uuid;
  v_item_id uuid;
  v_legacy_item_id uuid;
  v_item_status text;
  v_provenance jsonb;
  v_review jsonb;
begin
  select updated_at into v_expected
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000003';

  perform public.save_assignment_ai_grade_with_provenance_atomic(
    'd0000000-0000-4000-8000-000000000017',
    'd0000000-0000-4000-8000-000000000003',
    'd0000000-0000-4000-8000-000000000001',
    v_expected,
    8, 7, 9, 'Direct provenance grade', true, true,
    'Direct provenance grade', 'test-model',
    '{"schemaVersion":"assignment-grading-provenance-v1","provider":"openai","model":"test-model","policyVersion":"policy-v1","promptVersion":"prompt-v1","gradingProfileVersion":"profile-v1","rubricVersion":"rubric-v1","providerRequestCount":1,"tokenUsage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}'::jsonb,
    'teacher', now()
  );

  select ai_grading_provenance, ai_grading_review into v_provenance, v_review
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000003';
  if v_provenance->>'gradingProfileVersion' <> 'profile-v1' then
    raise exception 'Direct AI grading provenance did not survive persistence: %', v_provenance;
  end if;

  select updated_at into v_expected
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000003';
  perform public.save_assignment_ai_grade_atomic(
    'd0000000-0000-4000-8000-000000000017',
    'd0000000-0000-4000-8000-000000000003',
    'd0000000-0000-4000-8000-000000000001',
    v_expected,
    7, 7, 7, 'Old direct writer', true, true,
    'Old direct writer', 'old-model', 'teacher', now()
  );
  select ai_grading_provenance, ai_grading_review into v_provenance, v_review
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000003';
  if v_provenance is not null then
    raise exception 'Old direct AI writer retained stale provenance: %', v_provenance;
  end if;
  if v_review is not null then
    raise exception 'Old direct AI writer retained a stale grading review: %', v_review;
  end if;

  select updated_at, score_completion into v_expected, v_score
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000002';

  begin
    perform public.save_assignment_grades_atomic(
      'd0000000-0000-4000-8000-000000000017',
      array['d0000000-0000-4000-8000-000000000002']::uuid[],
      'd0000000-0000-4000-8000-000000000001',
      jsonb_build_object('d0000000-0000-4000-8000-000000000002', v_expected),
      true, null, null, null, true, false, null, now()
    );
    raise exception 'Manual final grade accepted null scores';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.save_assignment_grades_atomic(
      'd0000000-0000-4000-8000-000000000017',
      array['d0000000-0000-4000-8000-000000000002']::uuid[],
      'd0000000-0000-4000-8000-000000000001',
      jsonb_build_object('d0000000-0000-4000-8000-000000000002', v_expected),
      true, 11, 8, 8, false, false, null, now()
    );
    raise exception 'Manual draft grade accepted an out-of-range score';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.save_assignment_ai_grade_atomic(
      'd0000000-0000-4000-8000-000000000017',
      'd0000000-0000-4000-8000-000000000002',
      'd0000000-0000-4000-8000-000000000001',
      v_expected,
      null, 8, 8, 'Invalid null score', true, true,
      'Invalid null score', 'test-model', 'teacher', now()
    );
    raise exception 'Single AI grade accepted a null score';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.save_assignment_ai_grades_atomic(
      'd0000000-0000-4000-8000-000000000017',
      'd0000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'student_id', 'd0000000-0000-4000-8000-000000000002',
        'expected_doc_updated_at', v_expected,
        'score_completion', 8,
        'score_thinking', null,
        'score_workflow', 8,
        'feedback', 'Invalid null score',
        'apply_teacher_feedback_draft', true,
        'mark_graded', true
      )),
      now()
    );
    raise exception 'Batch AI grade accepted a null score';
  exception
    when invalid_parameter_value then null;
  end;

  if (select score_completion from public.assignment_docs
      where assignment_id = 'd0000000-0000-4000-8000-000000000017'
        and student_id = 'd0000000-0000-4000-8000-000000000002') <> v_score then
    raise exception 'Null-score rejection mutated the assignment grade';
  end if;

  update public.assignment_docs
  set ai_feedback_model = 'old-model',
      ai_grading_provenance = '{"schemaVersion":"assignment-grading-provenance-v1","provider":"openai","model":"old-model","policyVersion":"old-policy","promptVersion":"old-prompt","gradingProfileVersion":"old-profile","rubricVersion":"old-rubric","providerRequestCount":1,"tokenUsage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}'::jsonb
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000002';
  select updated_at into v_expected
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000002';
  perform public.save_assignment_ai_grades_atomic(
    'd0000000-0000-4000-8000-000000000017',
    'd0000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'student_id', 'd0000000-0000-4000-8000-000000000002',
      'expected_doc_updated_at', v_expected,
      'score_completion', 6,
      'score_thinking', 6,
      'score_workflow', 6,
      'feedback', 'Old batch writer',
      'apply_teacher_feedback_draft', true,
      'mark_graded', true,
      'ai_feedback_suggestion', 'Old batch writer',
      'ai_feedback_model', 'old-model',
      'graded_by', 'teacher'
    )),
    now()
  );
  select ai_grading_provenance into v_provenance
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000017'
    and student_id = 'd0000000-0000-4000-8000-000000000002';
  if v_provenance is not null then
    raise exception 'Old batch AI writer retained stale provenance: %', v_provenance;
  end if;

  select item.id into v_legacy_item_id
  from public.assignment_ai_grading_run_items item
  where item.assignment_id = 'd0000000-0000-4000-8000-000000000016';
  update public.assignment_ai_grading_run_items
  set status = 'processing'
  where id = v_legacy_item_id;
  perform public.finalize_assignment_ai_grading_item_atomic(
    v_legacy_item_id,
    'd0000000-0000-4000-8000-000000000001',
    6, 7, 8, 'Old durable writer', true, true,
    'Old durable writer', 'old-model', 'teacher', 1, 'completed', null, now()
  );
  select doc.ai_grading_provenance into v_provenance
  from public.assignment_ai_grading_run_items item
  join public.assignment_docs doc on doc.id = item.assignment_doc_id
  where item.id = v_legacy_item_id;
  if v_provenance is not null then
    raise exception 'Old durable AI writer retained stale provenance: %', v_provenance;
  end if;

  select id into v_run_id
  from public.create_assignment_ai_grading_run_atomic(
    'd0000000-0000-4000-8000-000000000019',
    'd0000000-0000-4000-8000-000000000001',
    'test-model',
    array['d0000000-0000-4000-8000-000000000002']::uuid[],
    'finalize-item-contract',
    1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'student_id', 'd0000000-0000-4000-8000-000000000002',
      'assignment_doc_id', (
        select id from public.assignment_docs
        where assignment_id = 'd0000000-0000-4000-8000-000000000019'
          and student_id = 'd0000000-0000-4000-8000-000000000002'
      ),
      'assignment_doc_updated_at', (
        select updated_at from public.assignment_docs
        where assignment_id = 'd0000000-0000-4000-8000-000000000019'
          and student_id = 'd0000000-0000-4000-8000-000000000002'
      ),
      'assignment_doc_revision_provided', true,
      'queue_position', 0,
      'status', 'queued',
      'attempt_count', 0
    )),
    now()
  );

  select id into v_item_id
  from public.assignment_ai_grading_run_items
  where run_id = v_run_id;

  update public.assignment_ai_grading_run_items
  set status = 'processing'
  where id = v_item_id;

  begin
    perform public.finalize_assignment_ai_grading_item_atomic(
      v_item_id,
      'd0000000-0000-4000-8000-000000000001',
      null, 8, 8, 'Invalid finalization', true, true,
      'Invalid finalization', 'test-model', 'teacher', 1, 'completed', null, now()
    );
    raise exception 'AI item finalization accepted a null score';
  exception
    when invalid_parameter_value then null;
  end;

  select status into v_item_status
  from public.assignment_ai_grading_run_items
  where id = v_item_id;
  if v_item_status <> 'processing' then
    raise exception 'Failed AI item finalization changed item state';
  end if;

  perform public.finalize_assignment_ai_grading_item_with_provenance_atomic(
    v_item_id,
    'd0000000-0000-4000-8000-000000000001',
    8, 7, 9, 'Atomic item grade', true, true,
    'Atomic item grade', 'test-model',
    '{"schemaVersion":"assignment-grading-provenance-v1","provider":"openai","model":"test-model","policyVersion":"policy-v1","promptVersion":"prompt-v1","gradingProfileVersion":"profile-v1","rubricVersion":"rubric-v1","providerRequestCount":1,"tokenUsage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}'::jsonb,
    'teacher', 1, 'completed', null, now()
  );

  perform public.finalize_assignment_ai_grading_item_with_provenance_atomic(
    v_item_id,
    'd0000000-0000-4000-8000-000000000001',
    2, 2, 2, 'Replay must not overwrite', true, true,
    'Replay must not overwrite', 'test-model',
    '{"schemaVersion":"assignment-grading-provenance-v1","provider":"openai","model":"test-model","policyVersion":"policy-v2","promptVersion":"prompt-v2","gradingProfileVersion":"profile-v2","rubricVersion":"rubric-v2","providerRequestCount":2,"tokenUsage":{"inputTokens":20,"outputTokens":10,"totalTokens":30}}'::jsonb,
    'teacher', 2, 'completed', null, now()
  );

  select item.status, doc.score_completion, doc.ai_grading_provenance
  into v_item_status, v_score, v_provenance
  from public.assignment_ai_grading_run_items item
  join public.assignment_docs doc on doc.id = item.assignment_doc_id
  where item.id = v_item_id;
  if v_item_status <> 'completed' or v_score <> 8 then
    raise exception 'AI item finalization was not atomic and replay-safe';
  end if;
  if v_provenance->>'gradingProfileVersion' <> 'profile-v1' then
    raise exception 'AI item provenance replay overwrote the original audit: %', v_provenance;
  end if;

  update public.assignment_docs
  set ai_feedback_model = 'old-model',
      ai_grading_provenance = '{"schemaVersion":"assignment-grading-provenance-v1","provider":"openai","model":"old-model","policyVersion":"old-policy","promptVersion":"old-prompt","gradingProfileVersion":"old-profile","rubricVersion":"old-rubric","providerRequestCount":1,"tokenUsage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}'::jsonb
  where assignment_id = 'd0000000-0000-4000-8000-000000000012'
    and student_id = 'd0000000-0000-4000-8000-000000000003';
  perform public.create_assignment_ai_grading_run_atomic(
    'd0000000-0000-4000-8000-000000000012',
    'd0000000-0000-4000-8000-000000000001',
    'old-model',
    array['d0000000-0000-4000-8000-000000000003']::uuid[],
    'missing-provenance-clear',
    0, 0, 1,
    jsonb_build_array(jsonb_build_object(
      'student_id', 'd0000000-0000-4000-8000-000000000003',
      'assignment_doc_id', (
        select id from public.assignment_docs
        where assignment_id = 'd0000000-0000-4000-8000-000000000012'
          and student_id = 'd0000000-0000-4000-8000-000000000003'
      ),
      'queue_position', 0,
      'status', 'skipped',
      'skip_reason', 'empty_doc',
      'attempt_count', 0,
      'completed_at', now()
    )),
    now()
  );
  select ai_grading_provenance into v_provenance
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000012'
    and student_id = 'd0000000-0000-4000-8000-000000000003';
  if v_provenance is not null then
    raise exception 'Missing-work writer retained stale provenance: %', v_provenance;
  end if;
end;
$contract$;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $grading_review_contract$
declare
  v_expected timestamptz;
  v_review jsonb;
  v_result jsonb;
  v_rejected boolean := false;
begin
  select updated_at, ai_grading_review
  into v_expected, v_review
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000019'
    and student_id = 'd0000000-0000-4000-8000-000000000002';

  if v_review->>'reviewStatus' <> 'pending'
    or v_review->>'assessmentKind' <> 'assignment'
    or v_review->'criteria'->0->>'criterionId' <> 'completion'
    or (v_review->'criteria'->0->>'suggestedScore')::numeric <> 8
    or (v_review->'criteria'->0->>'finalScore')::numeric <> 8
    or v_review->'provenance'->>'gradingProfileVersion' <> 'profile-v1'
  then
    raise exception 'Assignment grading review did not preserve the AI suggestion: %', v_review;
  end if;
  if v_review ?| array[
    'studentId', 'assignmentId', 'submissionText', 'suggestedFeedback', 'finalFeedback'
  ] then
    raise exception 'Assignment grading review retained forbidden identity fields: %', v_review;
  end if;

  perform public.save_assignment_grades_atomic(
    'd0000000-0000-4000-8000-000000000019',
    array['d0000000-0000-4000-8000-000000000002']::uuid[],
    'd0000000-0000-4000-8000-000000000001',
    jsonb_build_object('d0000000-0000-4000-8000-000000000002', v_expected),
    true, 7, 7, 9, true, true, 'Teacher edited feedback', now()
  );

  select ai_grading_review into v_review
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000019'
    and student_id = 'd0000000-0000-4000-8000-000000000002';
  if (v_review->'criteria'->0->>'suggestedScore')::numeric <> 8
    or (v_review->'criteria'->0->>'finalScore')::numeric <> 7
    or v_review->>'feedbackDisposition' <> 'edited'
  then
    raise exception 'Assignment teacher correction was not captured: %', v_review;
  end if;

  v_result := public.return_assignment_docs_with_feedback_atomic(
    'd0000000-0000-4000-8000-000000000019',
    array['d0000000-0000-4000-8000-000000000002']::uuid[],
    'd0000000-0000-4000-8000-000000000001',
    now()
  );
  select ai_grading_review into v_review
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000019'
    and student_id = 'd0000000-0000-4000-8000-000000000002';
  if (v_result->>'returned_count')::integer <> 1
    or v_review->>'reviewStatus' <> 'reviewed'
    or v_review->>'reviewedAt' is null
  then
    raise exception 'Assignment grading review was not finalized on return: % / %',
      v_result, v_review;
  end if;

  begin
    update public.assignment_docs
    set ai_grading_review = ai_grading_review || '{"studentId":"forbidden"}'::jsonb
    where assignment_id = 'd0000000-0000-4000-8000-000000000019'
      and student_id = 'd0000000-0000-4000-8000-000000000002';
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Assignment grading review retained forbidden identity fields';
  end if;
end;
$grading_review_contract$;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $contract$
declare
  v_run_id uuid;
  v_stale_run_id uuid;
  v_expected timestamptz;
  v_first_expected timestamptz;
  v_second_expected timestamptz;
  v_result_count integer;
  v_score integer;
  v_status text;
begin
  insert into public.assignment_repo_review_runs (
    assignment_id, status, triggered_by, metrics_version, prompt_version
  ) values (
    'd0000000-0000-4000-8000-000000000020', 'running',
    'd0000000-0000-4000-8000-000000000001', 'metrics-v1', 'prompt-v1'
  ) returning id into v_run_id;

  select updated_at into v_expected
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000020'
    and student_id = 'd0000000-0000-4000-8000-000000000003';

  perform public.complete_assignment_repo_review_run_atomic(
    v_run_id,
    'd0000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'student_id', 'd0000000-0000-4000-8000-000000000003',
      'github_login', 'student-2',
      'commit_count', 4, 'active_days', 2, 'session_count', 2,
      'burst_ratio', 0.2, 'weighted_contribution', 4.5,
      'relative_contribution_share', 0.5, 'spread_score', 0.8,
      'iteration_score', 0.7, 'semantic_breakdown_json', '{}'::jsonb,
      'timeline_json', '[]'::jsonb, 'evidence_json', '[]'::jsonb,
      'draft_score_completion', 8, 'draft_score_thinking', 7,
      'draft_score_workflow', 9, 'draft_feedback', 'Atomic repo feedback',
      'confidence', 0.9
    )),
    jsonb_build_array(jsonb_build_object(
      'student_id', 'd0000000-0000-4000-8000-000000000003',
      'expected_doc_updated_at', v_expected,
      'score_completion', 8, 'score_thinking', 7, 'score_workflow', 9,
      'feedback', 'Atomic repo feedback', 'apply_teacher_feedback_draft', false,
      'mark_graded', false, 'ai_feedback_suggestion', 'Atomic repo feedback',
      'ai_feedback_model', 'repo-review-v2'
    )),
    'main', 'repo-review-v2', '[]'::jsonb, now()
  );

  select run.status, count(result.id), doc.score_completion
  into v_status, v_result_count, v_score
  from public.assignment_repo_review_runs run
  left join public.assignment_repo_review_results result on result.run_id = run.id
  join public.assignment_docs doc
    on doc.assignment_id = run.assignment_id
   and doc.student_id = 'd0000000-0000-4000-8000-000000000003'
  where run.id = v_run_id
  group by run.status, doc.score_completion;
  if v_status <> 'completed' or v_result_count <> 1 or v_score <> 8 then
    raise exception 'Repo review completion did not commit atomically';
  end if;

  insert into public.assignment_repo_review_runs (
    assignment_id, status, triggered_by, metrics_version, prompt_version
  ) values (
    'd0000000-0000-4000-8000-000000000021', 'running',
    'd0000000-0000-4000-8000-000000000001', 'metrics-v1', 'prompt-v1'
  ) returning id into v_stale_run_id;

  select updated_at into v_first_expected from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000021'
    and student_id = 'd0000000-0000-4000-8000-000000000004';
  select updated_at into v_second_expected from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000021'
    and student_id = 'd0000000-0000-4000-8000-000000000005';

  update public.assignment_docs set teacher_feedback_draft = 'Concurrent repo review revision'
  where assignment_id = 'd0000000-0000-4000-8000-000000000021'
    and student_id = 'd0000000-0000-4000-8000-000000000005';

  begin
    perform public.complete_assignment_repo_review_run_atomic(
      v_stale_run_id,
      'd0000000-0000-4000-8000-000000000001',
      jsonb_build_array(
        jsonb_build_object('student_id', 'd0000000-0000-4000-8000-000000000004', 'commit_count', 1, 'active_days', 1, 'session_count', 1, 'burst_ratio', 0, 'weighted_contribution', 1, 'relative_contribution_share', 0.5, 'spread_score', 0.5, 'iteration_score', 0.5, 'semantic_breakdown_json', '{}'::jsonb, 'timeline_json', '[]'::jsonb, 'evidence_json', '[]'::jsonb, 'draft_score_completion', 9, 'draft_score_thinking', 9, 'draft_score_workflow', 9, 'draft_feedback', 'First', 'confidence', 0.8),
        jsonb_build_object('student_id', 'd0000000-0000-4000-8000-000000000005', 'commit_count', 1, 'active_days', 1, 'session_count', 1, 'burst_ratio', 0, 'weighted_contribution', 1, 'relative_contribution_share', 0.5, 'spread_score', 0.5, 'iteration_score', 0.5, 'semantic_breakdown_json', '{}'::jsonb, 'timeline_json', '[]'::jsonb, 'evidence_json', '[]'::jsonb, 'draft_score_completion', 9, 'draft_score_thinking', 9, 'draft_score_workflow', 9, 'draft_feedback', 'Second', 'confidence', 0.8)
      ),
      jsonb_build_array(
        jsonb_build_object('student_id', 'd0000000-0000-4000-8000-000000000004', 'expected_doc_updated_at', v_first_expected, 'score_completion', 9, 'score_thinking', 9, 'score_workflow', 9, 'feedback', 'First', 'apply_teacher_feedback_draft', false, 'mark_graded', false),
        jsonb_build_object('student_id', 'd0000000-0000-4000-8000-000000000005', 'expected_doc_updated_at', v_second_expected, 'score_completion', 9, 'score_thinking', 9, 'score_workflow', 9, 'feedback', 'Second', 'apply_teacher_feedback_draft', false, 'mark_graded', false)
      ),
      'main', 'repo-review-v2', '[]'::jsonb, now()
    );
    raise exception 'Expected stale repo review completion to conflict';
  exception
    when serialization_failure then null;
  end;

  select status into v_status from public.assignment_repo_review_runs where id = v_stale_run_id;
  select count(*) into v_result_count from public.assignment_repo_review_results where run_id = v_stale_run_id;
  select score_completion into v_score from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000021'
    and student_id = 'd0000000-0000-4000-8000-000000000004';
  if v_status <> 'running' or v_result_count <> 0 or v_score <> 3 then
    raise exception 'Repo review conflict partially committed';
  end if;
end;
$contract$;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $contract$
declare
  v_run_id uuid;
  v_invalid_run_id uuid;
  v_expected timestamptz;
  v_status text;
  v_result_count integer;
  v_score integer;
  v_model text;
  v_doc_provenance jsonb;
  v_result_provenance jsonb;
  v_provenance constant jsonb := '{"schemaVersion":"assignment-grading-provenance-v1","provider":"pika-local","model":"repo-review-heuristic-v1","policyVersion":"pika-repo-review-feedback-policy-v1","promptVersion":"pika-repo-review-feedback-prompt-v1","gradingProfileVersion":"pika-repo-review-feedback-v1","rubricVersion":"pika-repo-review-rubric-v1","providerRequestCount":0,"tokenUsage":{"inputTokens":null,"outputTokens":null,"totalTokens":null}}'::jsonb;
  v_invalid_provenance constant jsonb := '{"schemaVersion":"assignment-grading-provenance-v1","provider":"pika-local","model":"repo-review-heuristic-v1","policyVersion":"pika-repo-review-feedback-policy-v1","promptVersion":"pika-repo-review-feedback-prompt-v1","gradingProfileVersion":"pika-repo-review-feedback-v1","rubricVersion":"pika-repo-review-rubric-v1","providerRequestCount":11,"tokenUsage":{"inputTokens":null,"outputTokens":null,"totalTokens":null}}'::jsonb;
begin
  if has_function_privilege(
    'anon',
    'public.complete_assignment_repo_review_run_with_provenance_atomic(uuid,uuid,jsonb,jsonb,text,text,jsonb,timestamp with time zone)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_assignment_repo_review_run_with_provenance_atomic(uuid,uuid,jsonb,jsonb,text,text,jsonb,timestamp with time zone)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.complete_assignment_repo_review_run_with_provenance_atomic(uuid,uuid,jsonb,jsonb,text,text,jsonb,timestamp with time zone)',
    'execute'
  ) then
    raise exception 'Unexpected repo-review provenance RPC privileges';
  end if;

  insert into public.assignment_repo_review_runs (
    assignment_id, status, triggered_by, metrics_version, prompt_version
  ) values (
    'd0000000-0000-4000-8000-000000000023', 'running',
    'd0000000-0000-4000-8000-000000000001', 'metrics-v1', 'prompt-v1'
  ) returning id into v_run_id;

  select updated_at into v_expected
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000023'
    and student_id = 'd0000000-0000-4000-8000-000000000006';

  perform public.complete_assignment_repo_review_run_with_provenance_atomic(
    v_run_id,
    'd0000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'student_id', 'd0000000-0000-4000-8000-000000000006',
      'github_login', 'student-5',
      'commit_count', 3, 'active_days', 2, 'session_count', 2,
      'burst_ratio', 0.2, 'weighted_contribution', 3.5,
      'relative_contribution_share', 1, 'spread_score', 0.8,
      'iteration_score', 0.7, 'semantic_breakdown_json', '{}'::jsonb,
      'timeline_json', '[]'::jsonb, 'evidence_json', '[]'::jsonb,
      'draft_score_completion', 8, 'draft_score_thinking', 7,
      'draft_score_workflow', 9, 'draft_feedback', 'Audited repo feedback',
      'confidence', 0.9, 'grading_model', 'repo-review-heuristic-v1',
      'grading_provenance', v_provenance
    )),
    jsonb_build_array(jsonb_build_object(
      'student_id', 'd0000000-0000-4000-8000-000000000006',
      'expected_doc_updated_at', v_expected,
      'score_completion', 8, 'score_thinking', 7, 'score_workflow', 9,
      'feedback', 'Audited repo feedback', 'apply_teacher_feedback_draft', false,
      'mark_graded', false, 'ai_feedback_suggestion', 'Audited repo feedback',
      'ai_feedback_model', 'repo-review-heuristic-v1',
      'ai_grading_provenance', v_provenance
    )),
    'main', 'repo-review-heuristic-v1', '[]'::jsonb, now()
  );

  select run.status, count(result.id), doc.score_completion, doc.ai_feedback_model,
         doc.ai_grading_provenance, result.grading_provenance
  into v_status, v_result_count, v_score, v_model, v_doc_provenance, v_result_provenance
  from public.assignment_repo_review_runs run
  left join public.assignment_repo_review_results result on result.run_id = run.id
  join public.assignment_docs doc
    on doc.assignment_id = run.assignment_id
   and doc.student_id = 'd0000000-0000-4000-8000-000000000006'
  where run.id = v_run_id
  group by run.status, doc.score_completion, doc.ai_feedback_model,
           doc.ai_grading_provenance, result.grading_provenance;

  if v_status <> 'completed' or v_result_count <> 1 or v_score <> 8
    or v_model <> 'repo-review-heuristic-v1'
    or v_doc_provenance is distinct from v_provenance
    or v_result_provenance is distinct from v_provenance
  then
    raise exception 'Repo-review provenance did not commit atomically';
  end if;

  perform public.complete_assignment_repo_review_run_with_provenance_atomic(
    v_run_id,
    'd0000000-0000-4000-8000-000000000001',
    '[]'::jsonb,
    '[]'::jsonb,
    'replay-must-not-overwrite',
    'replay-must-not-overwrite',
    '[]'::jsonb,
    now()
  );

  select grading_provenance into v_result_provenance
  from public.assignment_repo_review_results
  where run_id = v_run_id;
  if v_result_provenance is distinct from v_provenance then
    raise exception 'Repo-review replay overwrote provenance';
  end if;

  insert into public.assignment_repo_review_runs (
    assignment_id, status, triggered_by, metrics_version, prompt_version
  ) values (
    'd0000000-0000-4000-8000-000000000024', 'running',
    'd0000000-0000-4000-8000-000000000001', 'metrics-v1', 'prompt-v1'
  ) returning id into v_invalid_run_id;

  select updated_at into v_expected
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000024'
    and student_id = 'd0000000-0000-4000-8000-000000000002';

  begin
    perform public.complete_assignment_repo_review_run_with_provenance_atomic(
      v_invalid_run_id,
      'd0000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'student_id', 'd0000000-0000-4000-8000-000000000002',
        'commit_count', 1, 'active_days', 1, 'session_count', 1,
        'burst_ratio', 0, 'weighted_contribution', 1,
        'relative_contribution_share', 1, 'spread_score', 0.5,
        'iteration_score', 0.5, 'semantic_breakdown_json', '{}'::jsonb,
        'timeline_json', '[]'::jsonb, 'evidence_json', '[]'::jsonb,
        'draft_score_completion', 9, 'draft_score_thinking', 9,
        'draft_score_workflow', 9, 'draft_feedback', 'Invalid audit',
        'confidence', 0.8, 'grading_model', 'repo-review-heuristic-v1',
        'grading_provenance', v_invalid_provenance
      )),
      jsonb_build_array(jsonb_build_object(
        'student_id', 'd0000000-0000-4000-8000-000000000002',
        'expected_doc_updated_at', v_expected,
        'score_completion', 9, 'score_thinking', 9, 'score_workflow', 9,
        'feedback', 'Invalid audit', 'apply_teacher_feedback_draft', false,
        'mark_graded', false, 'ai_feedback_suggestion', 'Invalid audit',
        'ai_feedback_model', 'repo-review-heuristic-v1',
        'ai_grading_provenance', v_invalid_provenance
      )),
      'main', 'repo-review-heuristic-v1', '[]'::jsonb, now()
    );
    raise exception 'Repo-review completion accepted invalid provenance';
  exception
    when check_violation then null;
  end;

  select status into v_status
  from public.assignment_repo_review_runs
  where id = v_invalid_run_id;
  select count(*) into v_result_count
  from public.assignment_repo_review_results
  where run_id = v_invalid_run_id;
  select score_completion, ai_feedback_model, ai_grading_provenance
  into v_score, v_model, v_doc_provenance
  from public.assignment_docs
  where assignment_id = 'd0000000-0000-4000-8000-000000000024'
    and student_id = 'd0000000-0000-4000-8000-000000000002';

  if v_status <> 'running' or v_result_count <> 0 or v_score <> 5
    or v_model is not null or v_doc_provenance is not null
  then
    raise exception 'Invalid repo-review provenance partially committed';
  end if;
end;
$contract$;
SQL

docker exec -e PGAPPNAME=atomic-roster-removal-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.remove_classroom_roster_entries_atomic(
  'd0000000-0000-4000-8000-000000000010',
  array['d0000000-0000-4000-8000-000000000008']::uuid[]
);
select pg_sleep(3);
commit;
SQL
ROSTER_REMOVAL_PID=$!
wait_for_application_event atomic-roster-removal-holder PgSleep

set +e
ROSTER_RACE_OUTPUT="$(docker exec -e PGAPPNAME=atomic-roster-ai-run-worker -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.create_assignment_ai_grading_run_atomic(
    'd0000000-0000-4000-8000-000000000018',
    'd0000000-0000-4000-8000-000000000001',
    'test-model',
    array['d0000000-0000-4000-8000-000000000006']::uuid[],
    'roster-race', 1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'student_id', 'd0000000-0000-4000-8000-000000000006',
      'assignment_doc_updated_at', null,
      'assignment_doc_revision_provided', true,
      'queue_position', 0, 'status', 'queued', 'attempt_count', 0
    )), now()
  );" 2>&1)"
ROSTER_RACE_STATUS=$?
set -e
wait "$ROSTER_REMOVAL_PID"

if [[ "$ROSTER_RACE_STATUS" -eq 0 ]] || [[ "$ROSTER_RACE_OUTPUT" != *"Student is not enrolled"* ]]; then
  echo "AI-run creation was not serialized with roster removal: $ROSTER_RACE_OUTPUT" >&2
  exit 1
fi

ROSTER_RACE_WRITES="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select
    (select count(*) from public.assignment_ai_grading_runs where assignment_id = 'd0000000-0000-4000-8000-000000000018')
    +
    (select count(*) from public.assignment_docs where assignment_id = 'd0000000-0000-4000-8000-000000000018');")"
if [[ "$ROSTER_RACE_WRITES" != "0" ]]; then
  echo "Roster-removal race left orphaned AI-run data." >&2
  exit 1
fi

docker exec -e PGAPPNAME=atomic-roster-classroom-lock-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
select public.remove_classroom_roster_entries_atomic(
  'd0000000-0000-4000-8000-000000000010',
  array['d0000000-0000-4000-8000-000000000009']::uuid[]
);
select pg_sleep(3);
commit;
SQL
ROSTER_CLASSROOM_LOCK_PID=$!
wait_for_application_event atomic-roster-classroom-lock-holder PgSleep

ASSIGNMENT_INSERT_STARTED_AT="$(date +%s)"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "insert into public.assignments (id, classroom_id, title, due_at, created_by)
   values (
     'd0000000-0000-4000-8000-000000000022',
     'd0000000-0000-4000-8000-000000000010',
     'Assignment created during roster removal',
     now() + interval '1 day',
     'd0000000-0000-4000-8000-000000000001'
   );" >/dev/null
ASSIGNMENT_INSERT_ELAPSED="$(( $(date +%s) - ASSIGNMENT_INSERT_STARTED_AT ))"
wait "$ROSTER_CLASSROOM_LOCK_PID"

if (( ASSIGNMENT_INSERT_ELAPSED < 2 )); then
  echo "Assignment creation did not wait for the roster-removal classroom lock." >&2
  exit 1
fi

set +e
ASSIGNMENT_RACE_OUTPUT="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select public.create_assignment_ai_grading_run_atomic(
    'd0000000-0000-4000-8000-000000000022',
    'd0000000-0000-4000-8000-000000000001',
    'test-model',
    array['d0000000-0000-4000-8000-000000000009']::uuid[],
    'assignment-create-race', 1, 0, 0,
    jsonb_build_array(jsonb_build_object(
      'student_id', 'd0000000-0000-4000-8000-000000000009',
      'assignment_doc_updated_at', null,
      'assignment_doc_revision_provided', true,
      'queue_position', 0, 'status', 'queued', 'attempt_count', 0
    )), now()
  );" 2>&1)"
ASSIGNMENT_RACE_STATUS=$?
set -e

if [[ "$ASSIGNMENT_RACE_STATUS" -eq 0 ]] || [[ "$ASSIGNMENT_RACE_OUTPUT" != *"Student is not enrolled"* ]]; then
  echo "Assignment creation bypassed roster-removal enrollment cleanup: $ASSIGNMENT_RACE_OUTPUT" >&2
  exit 1
fi

ASSIGNMENT_RACE_WRITES="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "select
    (select count(*) from public.assignment_ai_grading_runs where assignment_id = 'd0000000-0000-4000-8000-000000000022')
    +
    (select count(*) from public.assignment_docs where assignment_id = 'd0000000-0000-4000-8000-000000000022');")"
if [[ "$ASSIGNMENT_RACE_WRITES" != "0" ]]; then
  echo "Concurrent assignment creation left orphaned grading data after roster removal." >&2
  exit 1
fi

echo "Atomic assignment feedback return database checks passed."
