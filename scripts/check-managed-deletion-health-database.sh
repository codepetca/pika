#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${MANAGED_DELETION_HEALTH_DB_CONTAINER:-supabase_db_pika}"
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

cleanup_storage_helper() {
  docker exec -i "$DB_CONTAINER" sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U supabase_storage_admin -d postgres -X -v ON_ERROR_STOP=1 -c "drop function if exists storage.insert_managed_deletion_health_reappearance_fixture()"' \
    >/dev/null 2>&1 || true
}
trap cleanup_storage_helper EXIT

# Provider-side bytes can reappear without a PostgreSQL write. Install one
# fixed-input, Storage-owner-only helper so this local fixture can model that
# impossible-through-the-app state without weakening the production trigger.
docker exec -i "$DB_CONTAINER" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U supabase_storage_admin -d postgres -X -v ON_ERROR_STOP=1' <<'SQL'
create or replace function storage.insert_managed_deletion_health_reappearance_fixture()
returns void
language plpgsql
security definer
set search_path = storage, pg_temp
as $$
begin
  lock table storage.objects in access exclusive mode;
  alter table storage.objects disable trigger enforce_managed_storage_object_write;
  insert into storage.objects (bucket_id, name)
  values ('test-documents', 'monitor-fixture/reappeared.pdf');
  alter table storage.objects enable trigger enforce_managed_storage_object_write;
end;
$$;
revoke all on function storage.insert_managed_deletion_health_reappearance_fixture()
  from public, anon, authenticated, service_role;
grant execute on function storage.insert_managed_deletion_health_reappearance_fixture()
  to postgres;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $migration$
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '121'
  ) or to_regprocedure(
    'public.get_managed_deletion_health_snapshot(integer)'
  ) is null
  then raise exception 'Migration 121 is not applied to the local database'; end if;
end;
$migration$;

begin read only;
do $privileges$
declare
  v_volatility "char";
  v_security_definer boolean;
begin
  if has_function_privilege(
      'anon', 'public.get_managed_deletion_health_snapshot(integer)', 'execute'
    ) or has_function_privilege(
      'authenticated',
      'public.get_managed_deletion_health_snapshot(integer)', 'execute'
    )
  then raise exception 'Managed deletion monitor is publicly executable'; end if;
  if not has_function_privilege(
      'service_role',
      'public.get_managed_deletion_health_snapshot(integer)', 'execute'
    )
  then raise exception 'service_role monitor privilege is missing'; end if;

  select provolatile, prosecdef into strict v_volatility, v_security_definer
  from pg_proc
  where oid = 'public.get_managed_deletion_health_snapshot(integer)'::regprocedure;
  if v_volatility <> 's' or not v_security_definer then
    raise exception 'Monitor is not stable and security definer';
  end if;
end;
$privileges$;

do $thresholds$
begin
  begin
    perform public.get_managed_deletion_health_snapshot(299);
    raise exception 'Low stuck threshold was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'managed_deletion_health_stuck_threshold_invalid' then raise; end if;
  end;
  begin
    perform public.get_managed_deletion_health_snapshot(604801);
    raise exception 'High stuck threshold was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'managed_deletion_health_stuck_threshold_invalid' then raise; end if;
  end;
end;
$thresholds$;

do $baseline$
declare
  v_snapshot jsonb := public.get_managed_deletion_health_snapshot(3600);
begin
  if not (v_snapshot->>'healthy')::boolean
    or (v_snapshot->>'critical_count')::integer <> 0
    or (v_snapshot->>'warning_count')::integer <> 0
  then raise exception 'Local baseline is not healthy: %', v_snapshot; end if;
  if v_snapshot::text ~
    '"(teacher_id|student_id|user_id|classroom_id|course_blueprint_id|operation_id|managed_object_id|storage_path|email|title)"[[:space:]]*:'
    or v_snapshot::text ~
      '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  then raise exception 'Identity-bearing evidence escaped the snapshot'; end if;
end;
$baseline$;
commit;

-- A due retry is warning-only until the enclosing operation becomes stale.
begin;
insert into public.users (id, email, role) values
  ('c1210000-0000-4000-8000-000000000001',
   'monitor-teacher@example.test', 'teacher');
insert into public.classrooms (id, teacher_id, title, class_code) values (
  'c1210000-0000-4000-8000-000000000010',
  'c1210000-0000-4000-8000-000000000001',
  'Monitor warning fixture', 'MON121'
);
insert into public.classroom_purge_operations (
  id, teacher_id, classroom_id, classroom_title, request_sha256, status,
  source_revision, impact_summary
) values (
  'c1210000-0000-4000-8000-000000000020',
  'c1210000-0000-4000-8000-000000000001',
  'c1210000-0000-4000-8000-000000000010',
  'Monitor warning fixture', repeat('1', 64), 'deleting_objects', 1, '{}'::jsonb
);
insert into public.classroom_purge_fences (
  classroom_id, operation_id, teacher_id
) values (
  'c1210000-0000-4000-8000-000000000010',
  'c1210000-0000-4000-8000-000000000020',
  'c1210000-0000-4000-8000-000000000001'
);
insert into public.classroom_purge_objects (
  id, operation_id, storage_bucket, storage_path, storage_path_sha256,
  disposition, status, next_attempt_at
) values (
  'c1210000-0000-4000-8000-000000000021',
  'c1210000-0000-4000-8000-000000000020', 'submission-images',
  'monitor-fixture/retry.png',
  public.managed_storage_identity_sha256(
    'submission-images', 'monitor-fixture/retry.png'
  ),
  'delete', 'failed', clock_timestamp() - interval '1 minute'
);
do $warning$
declare
  v_snapshot jsonb := public.get_managed_deletion_health_snapshot(3600);
begin
  if not (v_snapshot->>'healthy')::boolean
    or (v_snapshot->>'critical_count')::integer <> 0
    or (v_snapshot#>>'{operations,classroom,due_failed_objects}')::integer <> 1
  then raise exception 'Warning-only fixture was misclassified: %', v_snapshot; end if;
end;
$warning$;
rollback;

-- Critical purge, partial-progress, lease, provider-reappearance, and managed
-- ownership findings are detected together, then fully rolled back.
begin;
insert into public.users (id, email, role) values
  ('c1210000-0000-4000-8000-000000000001',
   'monitor-teacher@example.test', 'teacher');
insert into public.classrooms (id, teacher_id, title, class_code) values
  ('c1210000-0000-4000-8000-000000000010',
   'c1210000-0000-4000-8000-000000000001',
   'Monitor purge fixture', 'MON121'),
  ('c1210000-0000-4000-8000-000000000011',
   'c1210000-0000-4000-8000-000000000001',
   'Monitor storage fixture', 'MON122');

insert into public.managed_storage_objects (
  id, storage_bucket, storage_path, classroom_id, purpose, status,
  verified_at, ready_at, created_by_user_id
) values (
  'c1210000-0000-4000-8000-000000000040', 'test-documents',
  'monitor-fixture/missing.pdf', 'c1210000-0000-4000-8000-000000000011',
  'teacher_test_material', 'ready', clock_timestamp(), clock_timestamp(),
  'c1210000-0000-4000-8000-000000000001'
);
insert into public.managed_storage_objects (
  id, storage_bucket, storage_path, classroom_id, purpose, status,
  reservation_expires_at, created_by_user_id
) values (
  'c1210000-0000-4000-8000-000000000041', 'submission-images',
  'monitor-fixture/expired.png', 'c1210000-0000-4000-8000-000000000011',
  'student_inline_image', 'reserved', clock_timestamp() - interval '1 minute',
  'c1210000-0000-4000-8000-000000000001'
);

insert into public.classroom_purge_operations (
  id, teacher_id, classroom_id, classroom_title, request_sha256, status,
  source_revision, impact_summary, updated_at
) values (
  'c1210000-0000-4000-8000-000000000020',
  'c1210000-0000-4000-8000-000000000001',
  'c1210000-0000-4000-8000-000000000010',
  'Monitor purge fixture', repeat('1', 64), 'deleting_objects', 1, '{}'::jsonb,
  clock_timestamp() - interval '2 hours'
);
insert into public.classroom_purge_fences (
  classroom_id, operation_id, teacher_id
) values (
  'c1210000-0000-4000-8000-000000000010',
  'c1210000-0000-4000-8000-000000000020',
  'c1210000-0000-4000-8000-000000000001'
);
insert into public.classroom_purge_objects (
  id, operation_id, storage_bucket, storage_path, storage_path_sha256,
  disposition, status, next_attempt_at, deleted_at
) values
  ('c1210000-0000-4000-8000-000000000021',
   'c1210000-0000-4000-8000-000000000020', 'test-documents', null,
   public.managed_storage_identity_sha256(
     'test-documents', 'monitor-fixture/reappeared.pdf'
   ),
   'delete', 'deleted', clock_timestamp(), clock_timestamp()),
  ('c1210000-0000-4000-8000-000000000022',
   'c1210000-0000-4000-8000-000000000020', 'submission-images',
   'monitor-fixture/retry.png',
   public.managed_storage_identity_sha256(
     'submission-images', 'monitor-fixture/retry.png'
   ),
   'delete', 'failed', clock_timestamp() - interval '1 minute', null);
insert into public.classroom_purge_objects (
  id, operation_id, storage_bucket, storage_path, storage_path_sha256,
  disposition, status, next_attempt_at, lease_token, lease_expires_at
) values (
  'c1210000-0000-4000-8000-000000000023',
  'c1210000-0000-4000-8000-000000000020', 'assignment-artifacts',
  'monitor-fixture/leased.bin',
  public.managed_storage_identity_sha256(
    'assignment-artifacts', 'monitor-fixture/leased.bin'
  ),
  'delete', 'processing', clock_timestamp(),
  'c1210000-0000-4000-8000-000000000024',
  clock_timestamp() - interval '1 minute'
);

insert into public.course_blueprint_purge_operations (
  id, course_blueprint_id, teacher_id, course_blueprint_title,
  request_sha256, inventory_sha256, finalization_sha256, source_revision,
  status, retryable, impact_summary, error_code
) values (
  'c1210000-0000-4000-8000-000000000030',
  'c1210000-0000-4000-8000-000000000031',
  'c1210000-0000-4000-8000-000000000001', 'Monitor Blueprint',
  repeat('2', 64), repeat('3', 64), repeat('4', 64), 1,
  'failed', false, '{}'::jsonb, 'fixture_terminal_failure'
);
insert into public.course_blueprint_purge_fences (
  course_blueprint_id, operation_id
) values (
  'c1210000-0000-4000-8000-000000000031',
  'c1210000-0000-4000-8000-000000000030'
);
select storage.insert_managed_deletion_health_reappearance_fixture();

do $critical$
declare
  v_snapshot jsonb := public.get_managed_deletion_health_snapshot(3600);
begin
  if (v_snapshot->>'healthy')::boolean then
    raise exception 'Critical fixture reported healthy';
  end if;
  if (v_snapshot#>>'{operations,classroom,stale_operations}')::integer <> 1
    or (v_snapshot#>>'{operations,classroom,stale_partial_operations}')::integer <> 1
    or (v_snapshot#>>'{operations,classroom,expired_object_leases}')::integer <> 1
    or (v_snapshot#>>'{operations,classroom,due_failed_objects}')::integer <> 1
    or (v_snapshot#>>'{operations,classroom,deleted_objects_reappeared}')::integer <> 1
  then raise exception 'Classroom findings mismatch: %',
    v_snapshot->'operations'->'classroom'; end if;
  if (v_snapshot#>>'{operations,course_blueprint,terminal_failures}')::integer <> 1
  then raise exception 'Blueprint terminal failure is missing'; end if;
  if (v_snapshot#>>'{managed_storage,unregistered_storage_objects}')::integer <> 1
    or (v_snapshot#>>'{managed_storage,registered_objects_missing_storage}')::integer <> 1
    or (v_snapshot#>>'{managed_storage,expired_reservations}')::integer <> 1
  then raise exception 'Managed-storage findings mismatch: %',
    v_snapshot->'managed_storage'; end if;
  if v_snapshot::text ~
    '"(teacher_id|student_id|user_id|classroom_id|course_blueprint_id|operation_id|managed_object_id|storage_path|email|title)"[[:space:]]*:'
    or v_snapshot::text ~
      '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  then raise exception 'Identity-bearing evidence escaped critical snapshot'; end if;
end;
$critical$;
rollback;

-- One thousand ready objects is deliberately above the current production
-- inventory. The aggregate must stay comfortably below the cron budget.
begin;
insert into public.users (id, email, role) values
  ('c1210000-0000-4000-8000-000000000001',
   'monitor-teacher@example.test', 'teacher');
insert into public.classrooms (id, teacher_id, title, class_code) values (
  'c1210000-0000-4000-8000-000000000011',
  'c1210000-0000-4000-8000-000000000001',
  'Monitor load fixture', 'MON122'
);
insert into public.managed_storage_objects (
  id, storage_bucket, storage_path, classroom_id, purpose, status,
  verified_at, ready_at, created_by_user_id
)
select
  public.managed_storage_legacy_object_id(
    'test-documents', 'monitor-load/' || value::text || '.pdf'
  ),
  'test-documents', 'monitor-load/' || value::text || '.pdf',
  'c1210000-0000-4000-8000-000000000011', 'teacher_test_material', 'ready',
  clock_timestamp(), clock_timestamp(),
  'c1210000-0000-4000-8000-000000000001'
from generate_series(1, 1000) value;
insert into storage.objects (bucket_id, name)
select 'test-documents', 'monitor-load/' || value::text || '.pdf'
from generate_series(1, 1000) value;

do $runtime$
declare
  v_started_at timestamptz := clock_timestamp();
  v_snapshot jsonb;
  v_elapsed_ms numeric;
begin
  v_snapshot := public.get_managed_deletion_health_snapshot(3600);
  v_elapsed_ms := extract(epoch from (clock_timestamp() - v_started_at)) * 1000;
  if (v_snapshot#>>'{managed_storage,ready_objects_unreferenced}')::integer <> 1000
  then raise exception 'Load fixture was not counted exactly'; end if;
  if v_elapsed_ms >= 5000 then
    raise exception 'Health snapshot exceeded local 5-second budget: % ms', v_elapsed_ms;
  end if;
  raise notice 'Managed deletion health 1000-object runtime: % ms',
    round(v_elapsed_ms, 3);
end;
$runtime$;
explain (analyze, buffers, summary)
select public.get_managed_deletion_health_snapshot(3600);
rollback;

do $restored$
declare
  v_snapshot jsonb := public.get_managed_deletion_health_snapshot(3600);
begin
  if not (v_snapshot->>'healthy')::boolean
    or (v_snapshot->>'critical_count')::integer <> 0
    or (v_snapshot->>'warning_count')::integer <> 0
  then raise exception 'Fixture rollback did not restore healthy state: %', v_snapshot; end if;
end;
$restored$;
SQL

CONCURRENT_RESULTS="$(
  seq 1 8 | xargs -P8 -I{} docker exec "$DB_CONTAINER" \
    psql -U postgres -d postgres -X -Atqc \
    "select public.get_managed_deletion_health_snapshot(3600)->>'healthy'"
)"
if [[ "$(grep -c '^true$' <<<"$CONCURRENT_RESULTS")" -ne 8 ]]; then
  echo "Concurrent health snapshots did not all complete healthy." >&2
  exit 1
fi

echo "Managed deletion health database checks passed (8 concurrent readers)."
