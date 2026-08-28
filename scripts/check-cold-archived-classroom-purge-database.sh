#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${COLD_CLASSROOM_PURGE_DB_CONTAINER:-supabase_db_pika}"
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
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '122'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations where version = '136'
  ) or to_regprocedure(
    'public.begin_cold_archived_classroom_purge(uuid,uuid,uuid,uuid,text,jsonb)'
  ) is null
  then raise exception 'Migrations 122 and 136 are not applied to the local database'; end if;
end;
$migration$;

begin;

do $privileges$
declare
  v_table text;
begin
  if (select rollout_mode from public.cold_classroom_purge_settings where singleton)
      <> 'disabled'
  then raise exception 'Cold purge rollout was enabled by migration'; end if;
  if has_function_privilege(
      'anon',
      'public.begin_cold_archived_classroom_purge(uuid,uuid,uuid,uuid,text,jsonb)',
      'execute'
    ) or has_function_privilege(
      'authenticated',
      'public.begin_cold_archived_classroom_purge(uuid,uuid,uuid,uuid,text,jsonb)',
      'execute'
    ) or not has_function_privilege(
      'service_role',
      'public.begin_cold_archived_classroom_purge(uuid,uuid,uuid,uuid,text,jsonb)',
      'execute'
    )
  then raise exception 'Cold purge entry-point privileges are unsafe'; end if;
  if has_function_privilege(
      'service_role',
      'public.claim_classroom_purge_object_v118(uuid,uuid,uuid,integer)',
      'execute'
    ) or has_function_privilege(
      'service_role',
      'public.finalize_hot_archived_classroom_purge_v118(uuid,uuid)',
      'execute'
    )
  then raise exception 'Migration 118 worker bypass is executable'; end if;
  foreach v_table in array array[
    'cold_classroom_purge_settings',
    'cold_classroom_purge_fences',
    'cold_classroom_purge_resources'
  ]
  loop
    if has_table_privilege('service_role', 'public.' || v_table, 'INSERT')
      or has_table_privilege('service_role', 'public.' || v_table, 'UPDATE')
      or has_table_privilege('service_role', 'public.' || v_table, 'DELETE')
    then raise exception 'service_role can forge cold purge authority through %', v_table;
    end if;
  end loop;
end;
$privileges$;

do $activate$
declare
  v_run public.managed_storage_readiness_runs;
begin
  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then
    raise exception 'Managed storage readiness blocked with % findings',
      v_run.finding_count;
  end if;
  perform public.activate_managed_storage_enforcement(
    v_run.generation, v_run.inventory_digest
  );
end;
$activate$;

insert into public.users (id, email, role) values
  ('c2200000-0000-4000-8000-000000000001', 'cold-teacher@example.test', 'teacher'),
  ('c2200000-0000-4000-8000-000000000002', 'cold-student@example.test', 'student'),
  ('c2200000-0000-4000-8000-000000000003', 'cold-other@example.test', 'teacher');

insert into public.course_blueprints (id, teacher_id, title) values (
  'c2200000-0000-4000-8000-000000000020',
  'c2200000-0000-4000-8000-000000000001',
  'Preserved cold purge Blueprint'
);
insert into public.classrooms (id, teacher_id, title, class_code) values
  ('c2200000-0000-4000-8000-000000000010',
    'c2200000-0000-4000-8000-000000000001', 'Cold purge fixture', 'CLD122'),
  ('c2200000-0000-4000-8000-000000000011',
    'c2200000-0000-4000-8000-000000000001', 'Preserved classroom', 'KEP122');

select public.begin_managed_storage_upload(
  'c2200000-0000-4000-8000-000000000101', 'test-documents',
  'cold-purge-fixture/remaining.pdf', 'c2200000-0000-4000-8000-000000000010',
  null, null, 'teacher_test_material',
  'c2200000-0000-4000-8000-000000000001', null,
  'fixture', null, 'application/pdf', 1
);
select public.begin_managed_storage_upload(
  'c2200000-0000-4000-8000-000000000102', 'classroom-archives',
  'cold-purge-fixture/archive.tar.gz', 'c2200000-0000-4000-8000-000000000010',
  null, null, 'classroom_archive',
  'c2200000-0000-4000-8000-000000000001', null,
  'classroom_archive_operation', 'c2200000-0000-4000-8000-000000000200',
  'application/gzip', 1
);
insert into storage.objects (bucket_id, name) values
  ('test-documents', 'cold-purge-fixture/remaining.pdf'),
  ('classroom-archives', 'cold-purge-fixture/archive.tar.gz');

do $ready$
declare
  v_id uuid;
begin
  foreach v_id in array array[
    'c2200000-0000-4000-8000-000000000101'::uuid,
    'c2200000-0000-4000-8000-000000000102'::uuid
  ]
  loop
    perform public.verify_managed_storage_upload(v_id, repeat('a', 64));
    perform public.managed_storage_mark_ready(v_id);
  end loop;
end;
$ready$;

insert into public.classroom_archive_operations (
  id, teacher_id, classroom_id, operation_type, request_sha256, status,
  source_revision, source_schema_migration, source_app_commit, retention,
  archive_id, storage_bucket, storage_path, artifact_sha256, content_sha256,
  compressed_byte_size, uncompressed_byte_size, verification,
  snapshot_created_at, snapshot_expires_at, managed_object_id
) values (
  'c2200000-0000-4000-8000-000000000200',
  'c2200000-0000-4000-8000-000000000001',
  'c2200000-0000-4000-8000-000000000010',
  'export', repeat('1', 64), 'completed', 1, '122_cold_fixture', 'fixture',
  '{"mode":"teacher_managed","delete_after":null}'::jsonb,
  'c2200000-0000-4000-8000-000000000201', 'classroom-archives',
  'cold-purge-fixture/archive.tar.gz', repeat('a', 64), repeat('b', 64),
  1, 1, '{}'::jsonb, clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '1 minute',
  'c2200000-0000-4000-8000-000000000102'
);
insert into public.classroom_archives (
  id, operation_id, classroom_id, teacher_id, format, format_version,
  source_revision, source_schema_migration, source_app_commit, storage_bucket,
  storage_path, artifact_sha256, content_sha256, compressed_byte_size,
  uncompressed_byte_size, resource_counts, storage_object_counts, verification,
  retention, created_at, verified_at, managed_object_id
) values (
  'c2200000-0000-4000-8000-000000000201',
  'c2200000-0000-4000-8000-000000000200',
  'c2200000-0000-4000-8000-000000000010',
  'c2200000-0000-4000-8000-000000000001',
  'pika.classroom-archive', 1, 1, '122_cold_fixture', 'fixture',
  'classroom-archives', 'cold-purge-fixture/archive.tar.gz', repeat('a', 64),
  repeat('b', 64), 1, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  '{"mode":"teacher_managed","delete_after":null}'::jsonb,
  clock_timestamp() - interval '2 minutes',
  clock_timestamp() - interval '1 minute',
  'c2200000-0000-4000-8000-000000000102'
);
insert into public.classroom_cold_tombstones (
  classroom_id, teacher_id, archive_id, title, archived_at, compacted_at,
  source_revision
) values (
  'c2200000-0000-4000-8000-000000000010',
  'c2200000-0000-4000-8000-000000000001',
  'c2200000-0000-4000-8000-000000000201', 'Cold purge fixture',
  clock_timestamp() - interval '3 minutes',
  clock_timestamp() - interval '1 minute', 1
);
insert into public.classroom_cold_archive_actors (
  classroom_id, actor_id, actor_role
) values
  ('c2200000-0000-4000-8000-000000000010',
    'c2200000-0000-4000-8000-000000000001', 'teacher'),
  ('c2200000-0000-4000-8000-000000000010',
    'c2200000-0000-4000-8000-000000000002', 'student');
delete from public.classrooms
where id = 'c2200000-0000-4000-8000-000000000010';

do $authorization_and_gate$
declare
  v_result jsonb;
begin
  v_result := public.get_cold_archived_classroom_purge_inventory(
    'c2200000-0000-4000-8000-000000000003',
    'c2200000-0000-4000-8000-000000000010',
    'c2200000-0000-4000-8000-000000000201'
  );
  if v_result->>'error_code' <> 'cold_classroom_not_found' then
    raise exception 'Non-owner learned cold purge inventory: %', v_result;
  end if;
  v_result := public.get_cold_archived_classroom_purge_inventory(
    'c2200000-0000-4000-8000-000000000001',
    'c2200000-0000-4000-8000-000000000010',
    'c2200000-0000-4000-8000-000000000201'
  );
  if coalesce((v_result->>'deletion_available')::boolean, true) then
    raise exception 'Disabled cold purge gate exposed deletion: %', v_result;
  end if;
end;
$authorization_and_gate$;

insert into public.classroom_archive_operations (
  id, teacher_id, classroom_id, operation_type, request_sha256, status,
  source_revision, source_schema_migration, source_app_commit, retention,
  snapshot_created_at, snapshot_expires_at, target_schema_migration,
  adapter_chain
) values (
  'c2200000-0000-4000-8000-000000000210',
  'c2200000-0000-4000-8000-000000000001',
  'c2200000-0000-4000-8000-000000000010',
  'restore', repeat('2', 64), 'snapshot_ready', 1, '122_cold_fixture', 'fixture',
  '{"mode":"teacher_managed","delete_after":null}'::jsonb,
  clock_timestamp(), clock_timestamp() + interval '1 hour',
  '122_cold_fixture', '[]'::jsonb
);
do $restore_conflict$
declare
  v_result jsonb;
begin
  update public.cold_classroom_purge_settings
  set rollout_mode = 'canary',
      canary_teacher_id = 'c2200000-0000-4000-8000-000000000001',
      canary_classroom_id = 'c2200000-0000-4000-8000-000000000010'
  where singleton;
  v_result := public.get_cold_archived_classroom_purge_inventory(
    'c2200000-0000-4000-8000-000000000001',
    'c2200000-0000-4000-8000-000000000010',
    'c2200000-0000-4000-8000-000000000201'
  );
  if v_result->>'conflicting_operation' <> 'classroom_archive_operation_active'
    or coalesce((v_result->>'deletion_available')::boolean, true)
  then raise exception 'Active restore did not block cold purge: %', v_result; end if;
end;
$restore_conflict$;
delete from public.classroom_archive_operations
where id = 'c2200000-0000-4000-8000-000000000210';

do $begin_purge$
declare
  v_inventory jsonb;
  v_result jsonb;
begin
  v_inventory := public.get_cold_archived_classroom_purge_inventory(
    'c2200000-0000-4000-8000-000000000001',
    'c2200000-0000-4000-8000-000000000010',
    'c2200000-0000-4000-8000-000000000201'
  );
  if not coalesce((v_inventory->>'deletion_available')::boolean, false)
    or (v_inventory->>'student_count')::integer <> 1
    or (v_inventory->>'managed_file_count')::integer <> 2
  then raise exception 'Cold purge inventory was incomplete: %', v_inventory; end if;
  v_result := public.begin_cold_archived_classroom_purge(
    'c2200000-0000-4000-8000-000000000300',
    'c2200000-0000-4000-8000-000000000001',
    'c2200000-0000-4000-8000-000000000010',
    'c2200000-0000-4000-8000-000000000201', repeat('e', 64), v_inventory
  );
  if not coalesce((v_result->>'ok')::boolean, false)
    or v_result->>'operation_status' <> 'deleting_objects'
  then raise exception 'Cold purge did not begin: %', v_result; end if;
  if (select count(*) from public.classroom_purge_objects
      where operation_id = 'c2200000-0000-4000-8000-000000000300') <> 2
  then raise exception 'Cold purge did not snapshot exact managed objects'; end if;
end;
$begin_purge$;

do $fence$
begin
  begin
    perform public.guard_classroom_purge_lifecycle(
      'c2200000-0000-4000-8000-000000000010'
    );
    raise exception 'Lifecycle guard crossed the cold purge fence';
  exception when sqlstate '55000' then
    if sqlerrm <> 'classroom_purge_active' then raise; end if;
  end;
  begin
    delete from public.classroom_cold_tombstones
    where classroom_id = 'c2200000-0000-4000-8000-000000000010';
    raise exception 'Cold tombstone delete crossed the purge fence';
  exception when sqlstate '55000' then
    if sqlerrm <> 'classroom_purge_active' then raise; end if;
  end;
end;
$fence$;

do $retry_lease_and_archive_last$
declare
  v_claim public.classroom_purge_objects;
  v_second public.classroom_purge_objects;
  v_result jsonb;
begin
  select * into v_claim from public.claim_cold_classroom_purge_object(
    'c2200000-0000-4000-8000-000000000300',
    'c2200000-0000-4000-8000-000000000001',
    'c2200000-0000-4000-8000-000000000401', 60
  );
  if not found or v_claim.delete_priority <> 10 then
    raise exception 'Non-archive object was not claimed first';
  end if;
  select * into v_second from public.claim_cold_classroom_purge_object(
    'c2200000-0000-4000-8000-000000000300',
    'c2200000-0000-4000-8000-000000000001',
    'c2200000-0000-4000-8000-000000000402', 60
  );
  if found then raise exception 'Live lease was claimed concurrently'; end if;
  if not public.fail_classroom_purge_object(
    v_claim.id, 'c2200000-0000-4000-8000-000000000001',
    v_claim.lease_token, 'fixture_provider_failure'
  ) then raise exception 'Retryable Storage failure was not recorded'; end if;
  update public.classroom_purge_objects
  set next_attempt_at = clock_timestamp()
  where id = v_claim.id;

  select * into v_claim from public.claim_cold_classroom_purge_object(
    'c2200000-0000-4000-8000-000000000300',
    'c2200000-0000-4000-8000-000000000001',
    'c2200000-0000-4000-8000-000000000403', 60
  );
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
  where bucket_id = v_claim.storage_bucket and name = v_claim.storage_path;
  if not public.complete_classroom_purge_object(
    v_claim.id, 'c2200000-0000-4000-8000-000000000001', v_claim.lease_token
  ) then raise exception 'Retried exact object did not complete'; end if;

  v_result := public.finalize_cold_archived_classroom_purge(
    'c2200000-0000-4000-8000-000000000300',
    'c2200000-0000-4000-8000-000000000001'
  );
  if not coalesce((v_result->>'waiting_for_storage')::boolean, false)
    or not exists (
      select 1 from public.classroom_cold_tombstones
      where classroom_id = 'c2200000-0000-4000-8000-000000000010'
    )
  then raise exception 'Partial cold purge lost recovery state: %', v_result; end if;

  select * into v_claim from public.claim_cold_classroom_purge_object(
    'c2200000-0000-4000-8000-000000000300',
    'c2200000-0000-4000-8000-000000000001',
    'c2200000-0000-4000-8000-000000000404', 60
  );
  if not found or v_claim.delete_priority <> 100
    or v_claim.managed_storage_object_id <>
      'c2200000-0000-4000-8000-000000000102'::uuid
  then raise exception 'Authoritative recovery archive was not claimed last'; end if;
  delete from storage.objects
  where bucket_id = v_claim.storage_bucket and name = v_claim.storage_path;
  if not public.complete_classroom_purge_object(
    v_claim.id, 'c2200000-0000-4000-8000-000000000001', v_claim.lease_token
  ) then raise exception 'Recovery archive deletion did not complete'; end if;
end;
$retry_lease_and_archive_last$;

do $finalize$
declare
  v_result jsonb;
begin
  v_result := public.finalize_cold_archived_classroom_purge(
    'c2200000-0000-4000-8000-000000000300',
    'c2200000-0000-4000-8000-000000000001'
  );
  if not coalesce((v_result->>'ok')::boolean, false)
    or v_result->>'operation_status' <> 'completed'
  then raise exception 'Cold purge did not finalize: %', v_result; end if;
  if exists (select 1 from public.classroom_cold_tombstones
      where classroom_id = 'c2200000-0000-4000-8000-000000000010')
    or exists (select 1 from public.classroom_archives
      where classroom_id = 'c2200000-0000-4000-8000-000000000010')
    or exists (select 1 from public.classroom_archive_operations
      where classroom_id = 'c2200000-0000-4000-8000-000000000010')
    or exists (select 1 from public.managed_storage_objects
      where classroom_id = 'c2200000-0000-4000-8000-000000000010')
    or exists (select 1 from public.cold_classroom_purge_fences
      where classroom_id = 'c2200000-0000-4000-8000-000000000010')
  then raise exception 'Cold-classroom-owned state survived purge'; end if;
  if not exists (select 1 from public.users
      where id = 'c2200000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.course_blueprints
      where id = 'c2200000-0000-4000-8000-000000000020')
    or not exists (select 1 from public.classrooms
      where id = 'c2200000-0000-4000-8000-000000000011')
  then raise exception 'User, Blueprint, or other Classroom was removed'; end if;
  if not exists (select 1 from public.classroom_purge_operations
      where id = 'c2200000-0000-4000-8000-000000000300'
        and status = 'completed' and purge_scope = 'cold_classroom')
    or exists (select 1 from public.cold_classroom_purge_resources
      where operation_id = 'c2200000-0000-4000-8000-000000000300')
  then raise exception 'Cold purge audit record was not retained safely'; end if;
end;
$finalize$;

rollback;
SQL
