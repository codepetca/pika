#!/usr/bin/env bash

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
DB_CONTAINER="${STUDENT_PURGE_DB_CONTAINER:-supabase_db_pika}"
EXPECTED_PROJECT_LABEL="${STUDENT_PURGE_DB_PROJECT_LABEL:-pika}"
EXPECTED_DB_PORT="${STUDENT_PURGE_DB_PORT:-54322}"
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "Local Pika Supabase database container is not running." >&2
  exit 2
fi

PROJECT_LABEL="$(docker inspect "$DB_CONTAINER" \
  --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
DB_BINDING="$(docker port "$DB_CONTAINER" 5432/tcp 2>/dev/null || true)"
if [[ "$PROJECT_LABEL" != "$EXPECTED_PROJECT_LABEL" ]] \
  || ! grep -q ":${EXPECTED_DB_PORT}$" <<<"$DB_BINDING"; then
  echo "Refusing non-local or unexpected Supabase database target." >&2
  exit 2
fi

TMP_DB="${STUDENT_PURGE_CONCURRENCY_DATABASE_NAME:-pika_student_purge_concurrency_${RANDOM}_$$}"
if [[ ! "$TMP_DB" =~ ^pika_student_purge_concurrency_[A-Za-z0-9_]+$ ]]; then
  echo "Refusing unsafe disposable student-purge database name." >&2
  exit 2
fi

DB_CREATED=false
WORK_DIR="$(mktemp -d)"
CLAIMER_PID=""
FAILURE_PID=""
cleanup() {
  if [[ -n "$CLAIMER_PID" ]]; then
    kill "$CLAIMER_PID" >/dev/null 2>&1 || true
    wait "$CLAIMER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$FAILURE_PID" ]]; then
    kill "$FAILURE_PID" >/dev/null 2>&1 || true
    wait "$FAILURE_PID" >/dev/null 2>&1 || true
  fi
  if [[ "$DB_CREATED" == "true" ]]; then
    if [[ "${KEEP_STUDENT_PURGE_CONCURRENCY_DATABASE:-false}" == "true" ]]; then
      echo "Kept disposable student-purge database: $TMP_DB"
    else
      docker exec "$DB_CONTAINER" dropdb -U postgres --if-exists --force "$TMP_DB" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

wait_for_claimer_lock() {
  local observed=""
  for _ in {1..100}; do
    observed="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc "
      select exists (
        select 1 from pg_stat_activity
        where datname = '$TMP_DB'
          and application_name = 'student_purge_expired_claimer'
          and state = 'active'
          and wait_event = 'PgSleep'
      );
    ")"
    if [[ "$observed" == "t" ]]; then
      return
    fi
    sleep 0.05
  done
  echo "Expired-lease claimer did not acquire the operation lock." >&2
  return 1
}

wait_for_failure_contention() {
  local observed=""
  for _ in {1..100}; do
    observed="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc "
      select exists (
        select 1 from pg_stat_activity
        where datname = '$TMP_DB'
          and application_name = 'student_purge_expired_failure'
          and state = 'active'
          and wait_event_type = 'Lock'
      );
    ")"
    if [[ "$observed" == "t" ]]; then
      return
    fi
    sleep 0.05
  done
  echo "Expired failure did not wait behind the operation-first claim lock." >&2
  return 1
}

docker exec "$DB_CONTAINER" createdb -U postgres "$TMP_DB"
DB_CREATED=true
docker exec "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 -c '
  drop schema public;
  create schema extensions;
  create extension "uuid-ossp" with schema extensions;
  create extension pgcrypto with schema extensions;
  create extension pg_stat_statements with schema extensions;
  create schema vault;
  create extension supabase_vault with schema vault;
  create extension pg_net with schema extensions;
' >/dev/null

docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges \
  --schema=public --schema=private --schema=auth --schema=storage \
  | sed '/^SET log_min_messages =/d; /^CREATE SCHEMA extensions;/d; /^CREATE SCHEMA vault;/d' \
  | docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
set client_min_messages = warning;
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'storage'
  loop
    execute format(
      'drop policy %I on %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  end loop;
end;
$$;
drop schema public cascade;
drop schema private cascade;
create schema public;
SQL

for migration in "$ROOT"/supabase/migrations/*.sql; do
  docker exec -e PGOPTIONS='-c client_min_messages=warning' -i "$DB_CONTAINER" \
    psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 \
    < "$migration" >/dev/null
done

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.users (id, email, role) values
  ('d1350000-0000-4000-8000-000000000001', 'student-purge-concurrency-teacher@example.test', 'teacher'),
  ('d1350000-0000-4000-8000-000000000002', 'student-purge-concurrency-student@example.test', 'student');

insert into public.classrooms (id, teacher_id, title, class_code) values (
  'd1350000-0000-4000-8000-000000000010',
  'd1350000-0000-4000-8000-000000000001',
  'Student purge failure concurrency',
  'SP135C'
);

insert into public.student_purge_operations (
  id, teacher_id, classroom_id, student_id, student_email,
  student_binding_sha256, request_sha256, status, source_revision,
  attempt_count, retryable, error_code
) values (
  'd1350000-0000-4000-8000-000000000020',
  'd1350000-0000-4000-8000-000000000001',
  'd1350000-0000-4000-8000-000000000010',
  'd1350000-0000-4000-8000-000000000002',
  'student-purge-concurrency-student@example.test',
  repeat('a', 64), repeat('b', 64), 'deleting_objects', 1, 1, true, null
);

insert into public.student_purge_objects (
  id, operation_id, storage_bucket, storage_path, storage_path_sha256,
  status, attempt_count, next_attempt_at, lease_token, lease_expires_at,
  last_error_code
) values (
  'd1350000-0000-4000-8000-000000000030',
  'd1350000-0000-4000-8000-000000000020',
  'submission-images', 'student-purge-concurrency/object.png', repeat('c', 64),
  'processing', 1, clock_timestamp() - interval '1 minute',
  'd1350000-0000-4000-8000-000000000040',
  clock_timestamp() - interval '1 second', null
);
SQL

# The claimer holds the operation row before reclaiming the expired object.
# The stale failure reporter must wait for that lock, then lose its old lease
# without mutating the newly issued lease or the operation's retry state.
docker exec -e PGAPPNAME=student_purge_expired_claimer -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 \
  >"$WORK_DIR/claimer.out" 2>"$WORK_DIR/claimer.err" <<'SQL' &
set lock_timeout = '5s';
set statement_timeout = '10s';
begin;
select 1
from public.student_purge_operations
where id = 'd1350000-0000-4000-8000-000000000020'
for update;
select pg_sleep(3);
select public.claim_student_purge_object(
  'd1350000-0000-4000-8000-000000000020',
  'd1350000-0000-4000-8000-000000000001',
  60
);
commit;
SQL
CLAIMER_PID=$!
wait_for_claimer_lock

docker exec -e PGAPPNAME=student_purge_expired_failure -i "$DB_CONTAINER" \
  psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 -At \
  >"$WORK_DIR/failure.out" 2>"$WORK_DIR/failure.err" <<'SQL' &
set deadlock_timeout = '200ms';
set lock_timeout = '5s';
set statement_timeout = '10s';
select public.fail_student_purge_object(
  'd1350000-0000-4000-8000-000000000020',
  'd1350000-0000-4000-8000-000000000001',
  'd1350000-0000-4000-8000-000000000030',
  'd1350000-0000-4000-8000-000000000040',
  'stale_storage_delete_failed'
);
SQL
FAILURE_PID=$!
wait_for_failure_contention

wait "$CLAIMER_PID"
CLAIMER_PID=""
wait "$FAILURE_PID"
FAILURE_PID=""

if ! grep -q 'student_purge_object_lease_lost' "$WORK_DIR/failure.out" \
  || ! grep -q '"retryable": true' "$WORK_DIR/failure.out"; then
  echo "Expired failure did not return the retryable lease-lost contract." >&2
  sed -n '1,120p' "$WORK_DIR/failure.out" >&2
  sed -n '1,120p' "$WORK_DIR/failure.err" >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d "$TMP_DB" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $verify$
declare
  v_operation public.student_purge_operations;
  v_object public.student_purge_objects;
begin
  select * into strict v_operation
  from public.student_purge_operations
  where id = 'd1350000-0000-4000-8000-000000000020';

  select * into strict v_object
  from public.student_purge_objects
  where id = 'd1350000-0000-4000-8000-000000000030';

  if v_operation.status <> 'deleting_objects'
    or v_operation.attempt_count <> 2
    or v_operation.retryable is distinct from true
    or v_operation.error_code is not null
  then
    raise exception 'Stale failure mutated operation retry state after reclaim';
  end if;

  if v_object.status <> 'processing'
    or v_object.attempt_count <> 2
    or v_object.lease_token is null
    or v_object.lease_token = 'd1350000-0000-4000-8000-000000000040'
    or v_object.lease_expires_at <= clock_timestamp()
    or v_object.last_error_code is not null
  then
    raise exception 'Stale failure mutated the replacement object lease';
  end if;
end;
$verify$;
SQL

echo "Individual-student purge failure concurrency check passed."
