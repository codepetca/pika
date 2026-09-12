#!/usr/bin/env bash
set -euo pipefail

# Local-only database contracts. This harness never applies migrations and
# refuses hosted or unexpected targets.
CREATION_DB_CONTAINER="${CREATION_DB_CONTAINER:-supabase_db_pika}"
if [[ "$CREATION_DB_CONTAINER" != 'supabase_db_pika' ]] \
  || [[ "$(docker inspect "$CREATION_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != 'pika' ]] \
  || ! docker port "$CREATION_DB_CONTAINER" 5432/tcp | grep -q ':54322$'; then
  echo 'Refusing unexpected classroom-creation entitlement test target.' >&2
  exit 2
fi

psql_local() {
  docker exec -i "$CREATION_DB_CONTAINER" psql -U postgres -d postgres -X \
    -v ON_ERROR_STOP=1 "$@"
}

if [[ "$(psql_local -Atc "select exists(select 1 from supabase_migrations.schema_migrations where version='166')")" != 't' ]]; then
  echo 'Migration 166 is required; this harness never applies it.' >&2
  exit 2
fi

psql_local < scripts/check-classroom-creation-entitlements-database.sql

race_dir="$(mktemp -d)"
race_user='f1660000-0000-4000-8000-000000000001'
race_operation='f1660000-0000-4000-8000-000000000002'
coordinator_app="pika_creation_166_gate_$$"
first_app="pika_creation_166_first_$$"
second_app="pika_creation_166_second_$$"

cleanup() {
  psql_local >/dev/null 2>&1 <<SQL || true
select pg_terminate_backend(pid)
from pg_stat_activity
where application_name in ('$coordinator_app', '$first_app', '$second_app')
  and pid <> pg_backend_pid();
delete from public.classrooms where teacher_id = '$race_user'::uuid;
delete from public.effective_feature_entitlement_audit
where subject_user_id = '$race_user'::uuid;
delete from public.users where id = '$race_user'::uuid;
SQL
  rm -rf "$race_dir"
}
trap cleanup EXIT
cleanup
race_dir="$(mktemp -d)"
trap cleanup EXIT

psql_local >/dev/null <<SQL
insert into public.users (id, email, role) values (
  '$race_user', 'race-166@example.invalid', 'teacher'
);
set role service_role;
select public.set_effective_feature_entitlement_v1(
  '$race_operation', '$race_user', 'classrooms.create', 'manual', true,
  '2026-09-01T00:00:00Z', null, 1,
  'test:migration-166', 'concurrency_fixture', 0
);
SQL

docker exec -e PGAPPNAME="$coordinator_app" "$CREATION_DB_CONTAINER" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -c "select pg_advisory_lock(hashtextextended('$race_user:classrooms.create',16620260912)); select pg_sleep(30);" \
  >"$race_dir/coordinator.out" 2>&1 &
coordinator_pid=$!

coordinator_ready=f
for _ in {1..100}; do
  coordinator_ready="$(psql_local -Atc "select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name='$coordinator_app' and l.locktype='advisory' and l.granted)")"
  [[ "$coordinator_ready" == t ]] && break
  sleep 0.05
done
if [[ "$coordinator_ready" != t ]]; then
  echo 'Classroom creation race coordinator did not acquire its lock.' >&2
  exit 1
fi

for contender in first second; do
  if [[ "$contender" == first ]]; then
    contender_id='011'
    contender_code='F166FIRST'
    contender_app="$first_app"
  else
    contender_id='012'
    contender_code='F166SECOND'
    contender_app="$second_app"
  fi
  docker exec -e PGAPPNAME="$contender_app" "$CREATION_DB_CONTAINER" \
    psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
    -c "insert into public.classrooms (id,teacher_id,title,class_code) values ('f1660000-0000-4000-8000-000000000${contender_id}','$race_user','Race $contender','$contender_code');" \
    >"$race_dir/$contender.out" 2>&1 &
  if [[ "$contender" == first ]]; then first_pid=$!; else second_pid=$!; fi
done

contenders_ready=f
for _ in {1..100}; do
  waiter_count="$(psql_local -Atc "select count(distinct a.application_name) from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name in ('$first_app','$second_app') and l.locktype='advisory' and not l.granted")"
  if [[ "$waiter_count" == '2' ]]; then contenders_ready=t; break; fi
  sleep 0.05
done
if [[ "$contenders_ready" != t ]]; then
  echo 'Both classroom creation contenders did not reach the entitlement lock.' >&2
  exit 1
fi

psql_local -Atc "select pg_cancel_backend(pid) from pg_stat_activity where application_name='$coordinator_app'" >/dev/null
wait "$coordinator_pid" || true
set +e
wait "$first_pid"; first_status=$?
wait "$second_pid"; second_status=$?
set -e

if [[ "$(( (first_status == 0) + (second_status == 0) ))" != '1' ]]; then
  echo 'Concurrent Access creation did not admit exactly one classroom.' >&2
  exit 1
fi
if [[ "$(psql_local -Atc "select count(*) from public.classrooms where teacher_id='$race_user'::uuid and archived_at is null")" != '1' ]]; then
  echo 'Concurrent Access creation persisted an invalid active classroom count.' >&2
  exit 1
fi
loser_output="$race_dir/first.out"
if [[ "$first_status" == '0' ]]; then loser_output="$race_dir/second.out"; fi
if ! grep -q 'classroom_creation_active_limit_reached' "$loser_output"; then
  echo 'Concurrent Access creation loser did not receive the active-limit denial.' >&2
  exit 1
fi

echo 'Classroom creation entitlement database contracts passed.'
