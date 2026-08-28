#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${CROSS_PURGE_DB_CONTAINER:-supabase_db_pika}"
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

psql_local() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X \
    -v ON_ERROR_STOP=1 "$@"
}

cleanup() {
  psql_local >/dev/null 2>&1 <<'SQL' || true
delete from public.course_blueprint_purge_fences
where operation_id in (
  'd1360000-0000-4000-8000-000000000040',
  'd1360000-0000-4000-8000-000000000041',
  'd1360000-0000-4000-8000-000000000042'
);
delete from public.classroom_purge_fences
where operation_id in (
  'd1360000-0000-4000-8000-000000000030',
  'd1360000-0000-4000-8000-000000000031',
  'd1360000-0000-4000-8000-000000000032'
);
delete from public.course_blueprint_purge_operations
where id in (
  'd1360000-0000-4000-8000-000000000040',
  'd1360000-0000-4000-8000-000000000041',
  'd1360000-0000-4000-8000-000000000042'
);
delete from public.classroom_purge_operations
where id in (
  'd1360000-0000-4000-8000-000000000030',
  'd1360000-0000-4000-8000-000000000031',
  'd1360000-0000-4000-8000-000000000032'
);
delete from public.course_blueprint_change_proposals
where id = 'd1360000-0000-4000-8000-000000000050';
delete from public.course_blueprint_operations
where id = 'd1360000-0000-4000-8000-000000000051';
delete from public.course_blueprint_editing_sessions
where id = 'd1360000-0000-4000-8000-000000000052';
delete from public.classrooms
where id in (
  'd1360000-0000-4000-8000-000000000010',
  'd1360000-0000-4000-8000-000000000011',
  'd1360000-0000-4000-8000-000000000012'
);
delete from public.course_blueprints
where id in (
  'd1360000-0000-4000-8000-000000000020',
  'd1360000-0000-4000-8000-000000000021',
  'd1360000-0000-4000-8000-000000000022'
);
delete from public.users where id = 'd1360000-0000-4000-8000-000000000001';
SQL
}
trap cleanup EXIT
cleanup

psql_local <<'SQL'
do $migration$
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '136'
  ) then raise exception 'Migration 136 is not applied to the local database'; end if;
end;
$migration$;

insert into public.users (id, email, role) values (
  'd1360000-0000-4000-8000-000000000001',
  'cross-purge-race@example.test', 'teacher'
);
insert into public.classrooms (id, teacher_id, title, class_code) values
  ('d1360000-0000-4000-8000-000000000010',
    'd1360000-0000-4000-8000-000000000001', 'Proposal race', 'PRP136'),
  ('d1360000-0000-4000-8000-000000000011',
    'd1360000-0000-4000-8000-000000000001', 'Operation race', 'OPR136'),
  ('d1360000-0000-4000-8000-000000000012',
    'd1360000-0000-4000-8000-000000000001', 'Session race', 'SES136');
insert into public.course_blueprints (id, teacher_id, title) values
  ('d1360000-0000-4000-8000-000000000020',
    'd1360000-0000-4000-8000-000000000001', 'Proposal race'),
  ('d1360000-0000-4000-8000-000000000021',
    'd1360000-0000-4000-8000-000000000001', 'Operation race'),
  ('d1360000-0000-4000-8000-000000000022',
    'd1360000-0000-4000-8000-000000000001', 'Session race');
insert into public.course_blueprint_change_proposals (
  id, teacher_id, course_blueprint_id, target_classroom_id, target_kind,
  source_kind, status, base_blueprint_revision, base_classroom_revision,
  request_sha256, idempotency_key, applied_blueprint_revision, applied_at
) values (
  'd1360000-0000-4000-8000-000000000050',
  'd1360000-0000-4000-8000-000000000001',
  'd1360000-0000-4000-8000-000000000020',
  'd1360000-0000-4000-8000-000000000010', 'classroom', 'blueprint',
  'applied', 1, 1, repeat('1', 64),
  'd1360000-0000-4000-8000-000000000053', 1, clock_timestamp()
);
insert into public.course_blueprint_operations (
  id, teacher_id, operation_type, request_sha256, status,
  source_classroom_id, result_blueprint_id
) values (
  'd1360000-0000-4000-8000-000000000051',
  'd1360000-0000-4000-8000-000000000001', 'capture', repeat('2', 64),
  'completed', 'd1360000-0000-4000-8000-000000000011',
  'd1360000-0000-4000-8000-000000000021'
);
insert into public.course_blueprint_editing_sessions (
  id, teacher_id, course_blueprint_id, classroom_id,
  base_blueprint_revision, package_sha256, status, expires_at, closed_at
) values (
  'd1360000-0000-4000-8000-000000000052',
  'd1360000-0000-4000-8000-000000000001',
  'd1360000-0000-4000-8000-000000000022',
  'd1360000-0000-4000-8000-000000000012', 1, repeat('3', 64),
  'closed', clock_timestamp() - interval '1 hour', clock_timestamp()
);
insert into public.classroom_purge_operations (
  id, teacher_id, classroom_id, classroom_title, request_sha256, status,
  source_revision, impact_summary
) values
  ('d1360000-0000-4000-8000-000000000030',
    'd1360000-0000-4000-8000-000000000001',
    'd1360000-0000-4000-8000-000000000010', 'Proposal race',
    repeat('4', 64), 'inventorying', 1, '{}'::jsonb),
  ('d1360000-0000-4000-8000-000000000031',
    'd1360000-0000-4000-8000-000000000001',
    'd1360000-0000-4000-8000-000000000011', 'Operation race',
    repeat('5', 64), 'inventorying', 1, '{}'::jsonb),
  ('d1360000-0000-4000-8000-000000000032',
    'd1360000-0000-4000-8000-000000000001',
    'd1360000-0000-4000-8000-000000000012', 'Session race',
    repeat('6', 64), 'inventorying', 1, '{}'::jsonb);
insert into public.course_blueprint_purge_operations (
  id, course_blueprint_id, teacher_id, course_blueprint_title,
  request_sha256, inventory_sha256, finalization_sha256, source_revision,
  status
) values
  ('d1360000-0000-4000-8000-000000000040',
    'd1360000-0000-4000-8000-000000000020',
    'd1360000-0000-4000-8000-000000000001', 'Proposal race',
    repeat('7', 64), repeat('8', 64), repeat('9', 64), 1, 'inventorying'),
  ('d1360000-0000-4000-8000-000000000041',
    'd1360000-0000-4000-8000-000000000021',
    'd1360000-0000-4000-8000-000000000001', 'Operation race',
    repeat('a', 64), repeat('b', 64), repeat('c', 64), 1, 'inventorying'),
  ('d1360000-0000-4000-8000-000000000042',
    'd1360000-0000-4000-8000-000000000022',
    'd1360000-0000-4000-8000-000000000001', 'Session race',
    repeat('d', 64), repeat('e', 64), repeat('f', 64), 1, 'inventorying');
SQL

run_race() {
  local classroom_id="$1"
  local blueprint_id="$2"
  local classroom_operation_id="$3"
  local blueprint_operation_id="$4"

  psql_local -c "select pg_advisory_lock(hashtextextended(jsonb_build_array('classroom_blueprint_purge_pair', '${classroom_id}'::uuid, '${blueprint_id}'::uuid)::text, 0)); select pg_sleep(2); select pg_advisory_unlock(hashtextextended(jsonb_build_array('classroom_blueprint_purge_pair', '${classroom_id}'::uuid, '${blueprint_id}'::uuid)::text, 0));" >/dev/null &
  local coordinator_pid=$!
  sleep 0.2

  psql_local -c "begin; insert into public.classroom_purge_fences (classroom_id, operation_id, teacher_id) select '${classroom_id}'::uuid, '${classroom_operation_id}'::uuid, 'd1360000-0000-4000-8000-000000000001'::uuid where public.classroom_purge_conflict('${classroom_id}'::uuid) is null; commit;" >/dev/null &
  local classroom_pid=$!
  psql_local -c "begin; insert into public.course_blueprint_purge_fences (course_blueprint_id, operation_id) select '${blueprint_id}'::uuid, '${blueprint_operation_id}'::uuid where public.course_blueprint_purge_conflict('${blueprint_id}'::uuid) is null; commit;" >/dev/null &
  local blueprint_pid=$!

  wait "$coordinator_pid"
  wait "$classroom_pid"
  wait "$blueprint_pid"

  local winner_count
  winner_count="$(psql_local -Atc "select (exists (select 1 from public.classroom_purge_fences where classroom_id = '${classroom_id}'::uuid))::integer + (exists (select 1 from public.course_blueprint_purge_fences where course_blueprint_id = '${blueprint_id}'::uuid))::integer")"
  if [[ "$winner_count" != "1" ]]; then
    echo "Cross-purge race did not admit exactly one owner." >&2
    return 1
  fi

  local staged_object_count
  staged_object_count="$(psql_local -Atc "select (select count(*) from public.classroom_purge_objects where operation_id = '${classroom_operation_id}'::uuid) + (select count(*) from public.course_blueprint_purge_objects where operation_id = '${blueprint_operation_id}'::uuid)")"
  if [[ "$staged_object_count" != "0" ]]; then
    echo "Cross-purge loser staged deletion work." >&2
    return 1
  fi
}

run_race \
  'd1360000-0000-4000-8000-000000000010' \
  'd1360000-0000-4000-8000-000000000020' \
  'd1360000-0000-4000-8000-000000000030' \
  'd1360000-0000-4000-8000-000000000040'
run_race \
  'd1360000-0000-4000-8000-000000000011' \
  'd1360000-0000-4000-8000-000000000021' \
  'd1360000-0000-4000-8000-000000000031' \
  'd1360000-0000-4000-8000-000000000041'
run_race \
  'd1360000-0000-4000-8000-000000000012' \
  'd1360000-0000-4000-8000-000000000022' \
  'd1360000-0000-4000-8000-000000000032' \
  'd1360000-0000-4000-8000-000000000042'

echo "Classroom/Blueprint purge concurrency contract passed."
