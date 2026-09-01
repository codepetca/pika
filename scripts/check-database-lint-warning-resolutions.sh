#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${DATABASE_LINT_DB_CONTAINER:-supabase_db_pika}"
if [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
  echo "Supabase database container is not running: $DB_CONTAINER" >&2
  exit 2
fi

TMP_ARCHIVE="$(mktemp)"
TMP_OWNER="$(mktemp)"

cleanup() {
  rm -f "$TMP_ARCHIVE" "$TMP_OWNER"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
delete from public.classrooms where id = 'd1470000-0000-4000-8000-000000000010';
delete from public.users where id::text like 'd1470000-0000-4000-8000-00000000000%';
SQL
}
trap cleanup EXIT
cleanup

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
insert into public.users (id, email, role) values
  ('d1470000-0000-4000-8000-000000000001', 'lint-warning-owner@example.test', 'teacher'),
  ('d1470000-0000-4000-8000-000000000002', 'lint-warning-other@example.test', 'teacher'),
  ('d1470000-0000-4000-8000-000000000003', 'lint-warning-student@example.test', 'student');
insert into public.classrooms (id, teacher_id, title, class_code) values
  ('d1470000-0000-4000-8000-000000000010', 'd1470000-0000-4000-8000-000000000001', 'Lint warning contract', 'LINT147');
insert into public.classroom_enrollments (classroom_id, student_id) values
  ('d1470000-0000-4000-8000-000000000010', 'd1470000-0000-4000-8000-000000000003');
insert into public.tests (id, classroom_id, title, status, points_possible, created_by) values
  ('d1470000-0000-4000-8000-000000000011', 'd1470000-0000-4000-8000-000000000010', 'Lint warning Test', 'active', 1, 'd1470000-0000-4000-8000-000000000001');
insert into public.test_questions (
  id, test_id, question_type, question_text, options, correct_option, points, position
) values (
  'd1470000-0000-4000-8000-000000000012',
  'd1470000-0000-4000-8000-000000000011',
  'multiple_choice', 'Pick one', '["one","two"]'::jsonb, 0, 1, 0
);
insert into public.test_attempts (test_id, student_id, responses, is_submitted, submitted_at) values
  ('d1470000-0000-4000-8000-000000000011', 'd1470000-0000-4000-8000-000000000003', '{"answer":"kept"}', true, clock_timestamp());
insert into public.test_responses (
  test_id, question_id, student_id, selected_option, submitted_at
) values (
  'd1470000-0000-4000-8000-000000000011',
  'd1470000-0000-4000-8000-000000000012',
  'd1470000-0000-4000-8000-000000000003',
  0,
  clock_timestamp()
);

do $steady_state$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.unsubmit_test_attempts_atomic(
      'd1470000-0000-4000-8000-000000000011',
      array['d1470000-0000-4000-8000-000000000003'::uuid],
      'd1470000-0000-4000-8000-000000000002'
    );
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Non-owner Test unsubmit was accepted'; end if;

  v_rejected := false;
  begin
    perform public.unsubmit_test_attempts_atomic(
      'd1470000-0000-4000-8000-000000000011',
      array['d1470000-0000-4000-8000-000000000003'::uuid],
      null
    );
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Null Test-unsubmit actor was accepted'; end if;

  v_rejected := false;
  begin
    perform public.clear_test_open_response_grades_atomic(
      'd1470000-0000-4000-8000-000000000011',
      'd1470000-0000-4000-8000-000000000001',
      array['d1470000-0000-4000-8000-000000000003'::uuid],
      '[]'::jsonb,
      null
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Null grade-clear clock was accepted'; end if;
end;
$steady_state$;
SQL

wait_for_lock_waiter() {
  local application_name="$1"
  for _ in {1..100}; do
    if [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -qAtc \
      "select count(*) from pg_stat_activity where application_name = '$application_name' and wait_event_type = 'Lock'")" == "1" ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "Timed out waiting for $application_name to block on the Classroom lock" >&2
  return 1
}

wait_for_holder_sleep() {
  local application_name="$1"
  for _ in {1..100}; do
    if [[ "$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -qAtc \
      "select count(*) from pg_stat_activity where application_name = '$application_name' and wait_event = 'PgSleep'")" == "1" ]]; then
      return 0
    fi
    sleep 0.05
  done
  echo "Timed out waiting for $application_name to hold the Classroom lock" >&2
  return 1
}

assert_fixture_unchanged() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $unchanged$
begin
  if not exists (
    select 1 from public.test_attempts
    where test_id = 'd1470000-0000-4000-8000-000000000011'
      and student_id = 'd1470000-0000-4000-8000-000000000003'
      and is_submitted
  ) or not exists (
    select 1 from public.test_responses
    where test_id = 'd1470000-0000-4000-8000-000000000011'
      and student_id = 'd1470000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Rejected Test unsubmit changed the attempt or response';
  end if;
end;
$unchanged$;
SQL
}

docker exec -e PGAPPNAME=lint-warning-archive-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
update public.classrooms set archived_at = clock_timestamp()
where id = 'd1470000-0000-4000-8000-000000000010';
select pg_sleep(2);
commit;
SQL
ARCHIVE_HOLDER_PID=$!

wait_for_holder_sleep lint-warning-archive-holder
set +e
docker exec -e PGAPPNAME=lint-warning-archive-unsubmit -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
  -c "select public.unsubmit_test_attempts_atomic(
    'd1470000-0000-4000-8000-000000000011',
    array['d1470000-0000-4000-8000-000000000003'::uuid],
    'd1470000-0000-4000-8000-000000000001'
  )" >"$TMP_ARCHIVE" 2>&1 &
ARCHIVE_UNSUBMIT_PID=$!
set -e
wait_for_lock_waiter lint-warning-archive-unsubmit
wait "$ARCHIVE_HOLDER_PID"
set +e
wait "$ARCHIVE_UNSUBMIT_PID"
ARCHIVE_STATUS=$?
set -e
if [[ "$ARCHIVE_STATUS" -eq 0 ]] || ! grep -q '42501' "$TMP_ARCHIVE"; then
  cat "$TMP_ARCHIVE" >&2
  echo "Concurrent Classroom archive did not reject Test unsubmit" >&2
  exit 1
fi
assert_fixture_unchanged

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -c "update public.classrooms set archived_at = null where id = 'd1470000-0000-4000-8000-000000000010'" >/dev/null

docker exec -e PGAPPNAME=lint-warning-owner-holder -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL' &
begin;
update public.classrooms set teacher_id = 'd1470000-0000-4000-8000-000000000002'
where id = 'd1470000-0000-4000-8000-000000000010';
select pg_sleep(2);
commit;
SQL
OWNER_HOLDER_PID=$!

wait_for_holder_sleep lint-warning-owner-holder
set +e
docker exec -e PGAPPNAME=lint-warning-owner-unsubmit -i "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
  -c "select public.unsubmit_test_attempts_atomic(
    'd1470000-0000-4000-8000-000000000011',
    array['d1470000-0000-4000-8000-000000000003'::uuid],
    'd1470000-0000-4000-8000-000000000001'
  )" >"$TMP_OWNER" 2>&1 &
OWNER_UNSUBMIT_PID=$!
set -e
wait_for_lock_waiter lint-warning-owner-unsubmit
wait "$OWNER_HOLDER_PID"
set +e
wait "$OWNER_UNSUBMIT_PID"
OWNER_STATUS=$?
set -e
if [[ "$OWNER_STATUS" -eq 0 ]] || ! grep -q '42501' "$TMP_OWNER"; then
  cat "$TMP_OWNER" >&2
  echo "Concurrent Classroom ownership change did not reject Test unsubmit" >&2
  exit 1
fi
assert_fixture_unchanged

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
update public.classrooms set teacher_id = 'd1470000-0000-4000-8000-000000000001'
where id = 'd1470000-0000-4000-8000-000000000010';
do $owner_success$
declare v_result jsonb;
begin
  v_result := public.unsubmit_test_attempts_atomic(
    'd1470000-0000-4000-8000-000000000011',
    array['d1470000-0000-4000-8000-000000000003'::uuid],
    'd1470000-0000-4000-8000-000000000001'
  );
  if (v_result->>'unsubmitted_count')::integer is distinct from 1 then
    raise exception 'Owning teacher Test unsubmit failed: %', v_result;
  end if;
end;
$owner_success$;
SQL

echo "Database lint warning resolution runtime checks passed."
