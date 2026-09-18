#!/usr/bin/env bash
set -euo pipefail

# Local-only database contracts. This harness never applies migrations and
# refuses hosted or unexpected targets.
CREATION_DB_CONTAINER="${CREATION_DB_CONTAINER:-supabase_db_pika}"
CREATION_DB_NAME="${CREATION_DB_NAME:-postgres}"
if [[ "$CREATION_DB_CONTAINER" != 'supabase_db_pika' ]] \
  || [[ ! "$CREATION_DB_NAME" =~ ^(postgres|pika_entitlement_181_[a-z0-9_]+)$ ]] \
  || [[ "$(docker inspect "$CREATION_DB_CONTAINER" --format '{{ index .Config.Labels "com.supabase.cli.project" }}')" != 'pika' ]] \
  || ! docker port "$CREATION_DB_CONTAINER" 5432/tcp | grep -q ':54322$'; then
  echo 'Refusing unexpected classroom-creation entitlement test target.' >&2
  exit 2
fi

psql_local() {
  docker exec -i "$CREATION_DB_CONTAINER" psql -U postgres -d "$CREATION_DB_NAME" -X \
    -v ON_ERROR_STOP=1 "$@"
}

if [[ "$(psql_local -Atc "select count(*) from supabase_migrations.schema_migrations where version in ('166','167','181')")" != '3' ]]; then
  echo 'Migrations 166-167 and 181 are required; this harness never applies them.' >&2
  exit 2
fi

psql_local < scripts/check-classroom-creation-entitlements-database.sql

race_dir="$(mktemp -d)"
race_user='f1660000-0000-4000-8000-000000000001'
race_operation='f1660000-0000-4000-8000-000000000002'
coordinator_app="pika_creation_166_gate_$$"
first_app="pika_creation_166_first_$$"
second_app="pika_creation_166_second_$$"
replay_user='f1670000-0000-4000-8000-000000000001'
replay_operation='f1670000-0000-4000-8000-000000000002'
replay_entitlement_operation='f1670000-0000-4000-8000-000000000003'
replay_coordinator_app="pika_creation_167_gate_$$"
replay_first_app="pika_creation_167_first_$$"
replay_second_app="pika_creation_167_second_$$"
cutover_user='f1810000-0000-4000-8000-000000000001'
cutover_operation='f1810000-0000-4000-8000-000000000002'
cutover_coordinator_app="pika_creation_181_gate_$$"
cutover_activation_app="pika_creation_181_activation_$$"
cutover_signup_app="pika_creation_181_signup_$$"

cleanup() {
  psql_local >/dev/null 2>&1 <<SQL || true
select pg_terminate_backend(pid)
from pg_stat_activity
where application_name in (
  '$coordinator_app', '$first_app', '$second_app',
  '$replay_coordinator_app', '$replay_first_app', '$replay_second_app',
  '$cutover_coordinator_app', '$cutover_activation_app', '$cutover_signup_app'
)
  and pid <> pg_backend_pid();
update private.classroom_creation_entitlement_settings
set strict_enforcement_enabled=false,
    activated_at=null,
    activation_operation_id=null,
    activated_by=null
where singleton and activation_operation_id='$cutover_operation'::uuid;
delete from public.classrooms where teacher_id = '$race_user'::uuid;
delete from public.classrooms where teacher_id = '$replay_user'::uuid;
delete from public.classrooms where teacher_id = '$cutover_user'::uuid;
delete from public.effective_feature_entitlement_audit
where subject_user_id in ('$race_user'::uuid, '$replay_user'::uuid, '$cutover_user'::uuid);
delete from public.users
where id in ('$race_user'::uuid, '$replay_user'::uuid, '$cutover_user'::uuid);
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
  'test:migration-166', 'concurrency_fixture', 1
);
SQL

docker exec -e PGAPPNAME="$coordinator_app" "$CREATION_DB_CONTAINER" \
  psql -U postgres -d "$CREATION_DB_NAME" -X -v ON_ERROR_STOP=1 \
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
    psql -U postgres -d "$CREATION_DB_NAME" -X -v ON_ERROR_STOP=1 \
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

psql_local >/dev/null <<SQL
insert into public.users (id, email, role) values (
  '$replay_user', 'retry-race-167@example.invalid', 'teacher'
);
set role service_role;
select public.set_effective_feature_entitlement_v1(
  '$replay_entitlement_operation', '$replay_user', 'classrooms.create', 'manual', true,
  '2026-09-01T00:00:00Z', null, 1,
  'test:migration-167', 'idempotency_concurrency_fixture', 1
);
SQL

docker exec -e PGAPPNAME="$replay_coordinator_app" "$CREATION_DB_CONTAINER" \
  psql -U postgres -d "$CREATION_DB_NAME" -X -v ON_ERROR_STOP=1 \
  -c "select pg_advisory_lock(hashtextextended('$replay_user:classrooms.create',16620260912)); select pg_sleep(30);" \
  >"$race_dir/replay-coordinator.out" 2>&1 &
replay_coordinator_pid=$!

replay_coordinator_ready=f
for _ in {1..100}; do
  replay_coordinator_ready="$(psql_local -Atc "select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name='$replay_coordinator_app' and l.locktype='advisory' and l.granted)")"
  [[ "$replay_coordinator_ready" == t ]] && break
  sleep 0.05
done
if [[ "$replay_coordinator_ready" != t ]]; then
  echo 'Classroom idempotency race coordinator did not acquire its lock.' >&2
  exit 1
fi

for contender in first second; do
  if [[ "$contender" == first ]]; then
    contender_app="$replay_first_app"
  else
    contender_app="$replay_second_app"
  fi
  docker exec -e PGAPPNAME="$contender_app" "$CREATION_DB_CONTAINER" \
    psql -U postgres -d "$CREATION_DB_NAME" -X -v ON_ERROR_STOP=1 \
    -c "set role service_role; select public.create_classroom_atomic_v1('$replay_operation','$replay_user',repeat('c',64),'Concurrent retry','F167ONE',null,'blue');" \
    >"$race_dir/replay-$contender.out" 2>&1 &
  if [[ "$contender" == first ]]; then replay_first_pid=$!; else replay_second_pid=$!; fi
done

replay_contenders_ready=f
for _ in {1..100}; do
  waiter_count="$(psql_local -Atc "select count(distinct a.application_name) from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name in ('$replay_first_app','$replay_second_app') and l.locktype='advisory' and not l.granted")"
  if [[ "$waiter_count" == '2' ]]; then replay_contenders_ready=t; break; fi
  sleep 0.05
done
if [[ "$replay_contenders_ready" != t ]]; then
  echo 'Both classroom idempotency contenders did not reach the entitlement lock.' >&2
  exit 1
fi

psql_local -Atc "select pg_cancel_backend(pid) from pg_stat_activity where application_name='$replay_coordinator_app'" >/dev/null
wait "$replay_coordinator_pid" || true
set +e
wait "$replay_first_pid"; replay_first_status=$?
wait "$replay_second_pid"; replay_second_status=$?
set -e

if [[ "$replay_first_status" != '0' || "$replay_second_status" != '0' ]]; then
  echo 'Concurrent retries did not both return the stored classroom result.' >&2
  exit 1
fi
if [[ "$(psql_local -Atc "select count(*) from public.classrooms where teacher_id='$replay_user'::uuid")" != '1' ]] \
  || [[ "$(psql_local -Atc "select count(*) from public.classroom_creation_operations where operation_id='$replay_operation'::uuid")" != '1' ]]; then
  echo 'Concurrent retries persisted more than one classroom or operation.' >&2
  exit 1
fi
if ! grep -q '"replayed": true' "$race_dir/replay-first.out" \
  && ! grep -q '"replayed": true' "$race_dir/replay-second.out"; then
  echo 'Concurrent retry did not replay the first stored result.' >&2
  exit 1
fi

# Queue activation before a concurrent signup behind the same settings-row
# lock. Activation may commit first, but signup must still provision Free before
# its user row commits, leaving strict mode with complete coverage.
docker exec -e PGAPPNAME="$cutover_coordinator_app" "$CREATION_DB_CONTAINER" \
  psql -U postgres -d "$CREATION_DB_NAME" -X -v ON_ERROR_STOP=1 \
  -c "begin; select singleton from private.classroom_creation_entitlement_settings where singleton for update; select pg_sleep(30); rollback;" \
  >"$race_dir/cutover-coordinator.out" 2>&1 &
cutover_coordinator_pid=$!

cutover_coordinator_ready=f
for _ in {1..100}; do
  cutover_coordinator_ready="$(psql_local -Atc "select exists(select 1 from pg_stat_activity where application_name='$cutover_coordinator_app' and wait_event='PgSleep')")"
  [[ "$cutover_coordinator_ready" == t ]] && break
  sleep 0.05
done
if [[ "$cutover_coordinator_ready" != t ]]; then
  echo 'Cutover race coordinator did not lock the settings row.' >&2
  exit 1
fi

docker exec -e PGAPPNAME="$cutover_activation_app" "$CREATION_DB_CONTAINER" \
  psql -U postgres -d "$CREATION_DB_NAME" -X -v ON_ERROR_STOP=1 \
  -c "set role service_role; select public.activate_classroom_creation_entitlement_cutover_v1('$cutover_operation','test:migration-181-race');" \
  >"$race_dir/cutover-activation.out" 2>&1 &
cutover_activation_pid=$!

cutover_activation_waiting=f
for _ in {1..100}; do
  cutover_activation_waiting="$(psql_local -Atc "select exists(select 1 from pg_stat_activity where application_name='$cutover_activation_app' and wait_event_type='Lock')")"
  [[ "$cutover_activation_waiting" == t ]] && break
  sleep 0.05
done
if [[ "$cutover_activation_waiting" != t ]]; then
  echo 'Cutover activation did not wait on the settings row.' >&2
  exit 1
fi

docker exec -e PGAPPNAME="$cutover_signup_app" "$CREATION_DB_CONTAINER" \
  psql -U postgres -d "$CREATION_DB_NAME" -X -v ON_ERROR_STOP=1 \
  -c "insert into public.users(id,email,role) values('$cutover_user','cutover-race-181@example.invalid','student');" \
  >"$race_dir/cutover-signup.out" 2>&1 &
cutover_signup_pid=$!

cutover_signup_waiting=f
for _ in {1..100}; do
  cutover_signup_waiting="$(psql_local -Atc "select exists(select 1 from pg_stat_activity where application_name='$cutover_signup_app' and wait_event_type='Lock')")"
  [[ "$cutover_signup_waiting" == t ]] && break
  sleep 0.05
done
if [[ "$cutover_signup_waiting" != t ]]; then
  echo 'Concurrent signup did not wait on the cutover settings row.' >&2
  exit 1
fi

psql_local -Atc "select pg_cancel_backend(pid) from pg_stat_activity where application_name='$cutover_coordinator_app'" >/dev/null
wait "$cutover_coordinator_pid" || true
wait "$cutover_activation_pid"
wait "$cutover_signup_pid"

if [[ "$(psql_local -Atc "select strict_enforcement_enabled from private.classroom_creation_entitlement_settings where singleton")" != 't' ]] \
  || [[ "$(psql_local -Atc "select count(*) from public.users account where not exists(select 1 from public.effective_feature_entitlements entitlement where entitlement.subject_user_id=account.id and entitlement.feature_key='classrooms.create')")" != '0' ]] \
  || [[ "$(psql_local -Atc "select count(*) from public.effective_feature_entitlements where subject_user_id='$cutover_user'::uuid and feature_key='classrooms.create' and source='plan' and not enabled and quota_limit=0")" != '1' ]]; then
  echo 'Activation/signup race left strict enforcement without complete Free provisioning.' >&2
  exit 1
fi

echo 'Classroom creation entitlement database contracts passed.'
