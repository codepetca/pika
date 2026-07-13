#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${CLASSROOM_ARCHIVE_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

insert into public.users (id, email, role)
values
  ('11000000-0000-4000-8000-000000000001', 'restore-teacher@example.test', 'teacher'),
  ('11000000-0000-4000-8000-000000000002', 'restore-student@example.test', 'student');

insert into public.student_profiles (user_id, student_number, first_name, last_name)
values ('11000000-0000-4000-8000-000000000002', 'R1', 'Restore', 'Student');

insert into public.classrooms (id, teacher_id, title, class_code, archived_at)
values (
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'Restore contract classroom',
  'RST001',
  clock_timestamp()
);

insert into public.classroom_enrollments (id, classroom_id, student_id)
values (
  '22000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000002'
);

insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by
)
values (
  '23000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'Restore assignment',
  'Preserve this content exactly',
  clock_timestamp() + interval '1 day',
  '11000000-0000-4000-8000-000000000001'
);

insert into public.assignment_docs (
  id, assignment_id, student_id, content, is_submitted, submitted_at
)
values (
  '24000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000002',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Student answer"}]}]}'::jsonb,
  true,
  clock_timestamp()
);

create temporary table expected_restore_rows (
  table_name text not null,
  row_id uuid not null,
  row_data jsonb not null,
  primary key (table_name, row_id)
) on commit drop;
grant all on expected_restore_rows to service_role;

set local role service_role;

do $contract$
declare
  v_teacher_id constant uuid := '11000000-0000-4000-8000-000000000001';
  v_classroom_id constant uuid := '21000000-0000-4000-8000-000000000001';
  v_archive_id constant uuid := '25000000-0000-4000-8000-000000000001';
  v_compaction_id constant uuid := '25000000-0000-4000-8000-000000000002';
  v_restore_id constant uuid := '26000000-0000-4000-8000-000000000001';
  v_capacity_id constant uuid := '26000000-0000-4000-8000-000000000002';
  v_concurrent_id constant uuid := '26000000-0000-4000-8000-000000000003';
  v_result jsonb;
  v_counts jsonb;
  v_resource record;
  v_rows jsonb;
  v_mismatch_count integer;
  v_source_revision bigint;
begin
  v_result := public.begin_classroom_archive_export(
    v_archive_id,
    v_teacher_id,
    v_classroom_id,
    repeat('a', 64),
    '082_verified_classroom_archive_exports',
    'abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Restore canary export snapshot failed: %', v_result;
  end if;
  v_counts := v_result->'resource_counts';

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
    order by export_position
  loop
    execute format(
      'insert into expected_restore_rows (table_name, row_id, row_data)
       select %L, source.%I, to_jsonb(source)
       from public.classroom_archive_snapshot_resources snapshot
       join public.%I source on source.%I = snapshot.row_id
       where snapshot.operation_id = $1 and snapshot.table_name = %L',
      v_resource.table_name,
      v_resource.primary_key_column,
      v_resource.table_name,
      v_resource.primary_key_column,
      v_resource.table_name
    ) using v_archive_id;
  end loop;

  v_result := public.complete_classroom_archive_export(
    v_archive_id,
    v_teacher_id,
    'classroom-archives',
    format('%s/%s/%s/classroom-v1.tar.gz', v_teacher_id, v_classroom_id, v_archive_id),
    repeat('b', 64),
    repeat('c', 64),
    1024,
    4096,
    v_counts,
    '{"total_count":0,"total_bytes":0,"by_bucket":{}}'::jsonb,
    '{
      "read_back_verified": true,
      "artifact_checksum_verified": true,
      "manifest_verified": true,
      "resource_checksums_verified": true,
      "resource_counts_verified": true,
      "storage_objects_verified": true,
      "actor_snapshots_verified": true
    }'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Restore canary archive finalization failed: %', v_result;
  end if;

  select revision into v_source_revision
  from public.classroom_archive_revisions
  where classroom_id = v_classroom_id;

  v_result := public.begin_classroom_archive_compaction(
    v_compaction_id,
    v_teacher_id,
    v_classroom_id,
    v_archive_id,
    repeat('9', 64)
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'snapshot_ready'
  then
    raise exception 'Restore round trip compaction begin failed: %', v_result;
  end if;
  v_result := public.stage_classroom_archive_compaction_objects(
    v_compaction_id,
    v_teacher_id,
    '[]'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Restore round trip cleanup staging failed: %', v_result;
  end if;
  v_result := public.complete_classroom_archive_compaction(
    v_compaction_id,
    v_teacher_id,
    jsonb_build_object(
      'operation_id', v_compaction_id,
      'archive_id', v_archive_id,
      'artifact_sha256', repeat('b', 64),
      'content_sha256', repeat('c', 64),
      'verified_at', clock_timestamp(),
      'read_back_verified', true,
      'artifact_checksum_verified', true,
      'manifest_verified', true,
      'resource_checksums_verified', true,
      'resource_counts_verified', true,
      'storage_objects_verified', true,
      'actor_snapshots_verified', true,
      'source_object_cleanup_staged', true
    )
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'completed'
  then
    raise exception 'Restore round trip compaction failed: %', v_result;
  end if;
  if exists (select 1 from public.classrooms where id = v_classroom_id) then
    raise exception 'Classroom was not removed for cold restore canary';
  end if;

  v_result := public.begin_classroom_archive_restore(
    v_capacity_id,
    v_teacher_id,
    v_classroom_id,
    v_archive_id,
    repeat('d', 64),
    '083_resumable_classroom_archive_restore',
    '["classroom-archive-v1-082-to-083"]'::jsonb,
    v_counts,
    1
  );
  if v_result->>'error_code' <> 'insufficient_database_headroom' then
    raise exception 'Restore capacity guard did not fail closed: %', v_result;
  end if;
  if exists (select 1 from public.classroom_archive_operations where id = v_capacity_id) then
    raise exception 'Capacity rejection persisted a restore operation';
  end if;

  v_result := public.begin_classroom_archive_restore(
    v_restore_id,
    v_teacher_id,
    v_classroom_id,
    v_archive_id,
    repeat('e', 64),
    '083_resumable_classroom_archive_restore',
    '["classroom-archive-v1-082-to-083"]'::jsonb,
    v_counts,
    2147483648
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'snapshot_ready'
  then
    raise exception 'Restore begin failed: %', v_result;
  end if;

  v_result := public.begin_classroom_archive_restore(
    v_concurrent_id,
    v_teacher_id,
    v_classroom_id,
    v_archive_id,
    repeat('f', 64),
    '083_resumable_classroom_archive_restore',
    '["classroom-archive-v1-082-to-083"]'::jsonb,
    v_counts,
    2147483648
  );
  if v_result->>'error_code' <> 'restore_already_in_progress' then
    raise exception 'Concurrent restore operation was not rejected: %', v_result;
  end if;

  update public.classroom_archive_operations
  set snapshot_expires_at = clock_timestamp() - interval '1 second'
  where id = v_restore_id;
  v_result := public.begin_classroom_archive_restore(
    v_concurrent_id,
    v_teacher_id,
    v_classroom_id,
    v_archive_id,
    repeat('f', 64),
    '083_resumable_classroom_archive_restore',
    '["classroom-archive-v1-082-to-083"]'::jsonb,
    v_counts,
    2147483648
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'snapshot_ready'
  then
    raise exception 'Expired restore operation still blocked a replacement: %', v_result;
  end if;
  if not public.fail_classroom_archive_restore(
    v_concurrent_id,
    v_teacher_id,
    'restore_canary_replacement_complete',
    false
  ) then
    raise exception 'Replacement restore operation could not be closed';
  end if;
  update public.classroom_archive_operations
  set snapshot_expires_at = clock_timestamp() + interval '24 hours'
  where id = v_restore_id;

  select jsonb_agg(row_data order by row_id) into v_rows
  from expected_restore_rows where table_name = 'classrooms';
  begin
    perform public.stage_classroom_archive_restore_rows(
      v_restore_id,
      v_teacher_id,
      'classrooms',
      jsonb_build_array((v_rows->0) - 'title')
    );
    raise exception 'Restore row with stale schema unexpectedly staged';
  exception when sqlstate '22023' then null;
  end;

  select jsonb_agg(
    jsonb_set(row_data, '{created_by}', to_jsonb('99000000-0000-4000-8000-000000000001'::text))
    order by row_id
  ) into v_rows
  from expected_restore_rows where table_name = 'assignments';
  begin
    perform public.stage_classroom_archive_restore_rows(
      v_restore_id,
      v_teacher_id,
      'assignments',
      v_rows
    );
    raise exception 'Restore row with unresolved actor unexpectedly staged';
  exception when sqlstate '23503' then null;
  end;

  for v_resource in
    select table_name
    from public.classroom_archive_resource_contract
    order by export_position
  loop
    select jsonb_agg(row_data order by row_id) into v_rows
    from expected_restore_rows where table_name = v_resource.table_name;
    if v_rows is not null then
      v_result := public.stage_classroom_archive_restore_rows(
        v_restore_id,
        v_teacher_id,
        v_resource.table_name,
        v_rows
      );
      if coalesce((v_result->>'ok')::boolean, false) is not true then
        raise exception 'Restore staging failed for %: %', v_resource.table_name, v_result;
      end if;
    end if;
  end loop;

  select jsonb_agg(row_data order by row_id) into v_rows
  from expected_restore_rows where table_name = 'classrooms';
  v_result := public.stage_classroom_archive_restore_rows(
    v_restore_id,
    v_teacher_id,
    'classrooms',
    v_rows
  );
  if (v_result->>'staged_count')::integer <> 1 then
    raise exception 'Idempotent restore staging replay changed the row count: %', v_result;
  end if;

  begin
    perform public.complete_classroom_archive_restore(
      v_restore_id,
      v_teacher_id,
      '{"archive_checksum_verified":true}'::jsonb
    );
    raise exception 'Restore completed with incomplete verification evidence';
  exception when sqlstate '22023' then null;
  end;
  if exists (select 1 from public.classrooms where id = v_classroom_id) then
    raise exception 'Rejected restore left relational rows behind';
  end if;

  v_result := public.complete_classroom_archive_restore(
    v_restore_id,
    v_teacher_id,
    '{
      "archive_checksum_verified": true,
      "manifest_verified": true,
      "resource_checksums_verified": true,
      "resource_counts_verified": true,
      "storage_objects_verified": true,
      "actor_snapshots_verified": true,
      "schema_adapter_available": true,
      "restored_storage_objects_verified": true,
      "adapter_chain": ["classroom-archive-v1-082-to-083"]
    }'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'completed'
  then
    raise exception 'Restore completion failed: %', v_result;
  end if;

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
    order by export_position
  loop
    execute format(
      'select count(*)
       from expected_restore_rows expected
       left join public.%I restored on restored.%I = expected.row_id
       where expected.table_name = $1
         and (restored.%I is null or to_jsonb(restored) is distinct from expected.row_data)',
      v_resource.table_name,
      v_resource.primary_key_column,
      v_resource.primary_key_column
    ) into v_mismatch_count using v_resource.table_name;
    if v_mismatch_count <> 0 then
      raise exception 'Restored rows differ from the archive for %', v_resource.table_name;
    end if;
  end loop;

  if exists (
    select 1 from public.classroom_cold_tombstones where classroom_id = v_classroom_id
  ) then
    raise exception 'Successful restore retained the cold tombstone';
  end if;
  if exists (
    select 1 from public.classroom_archive_restore_staging where operation_id = v_restore_id
  ) then
    raise exception 'Successful restore retained staged rows';
  end if;
  if (
    select revision from public.classroom_archive_revisions where classroom_id = v_classroom_id
  ) <> v_source_revision then
    raise exception 'Restore did not preserve the archived classroom revision';
  end if;

  v_result := public.complete_classroom_archive_restore(
    v_restore_id,
    v_teacher_id,
    '{
      "archive_checksum_verified": true,
      "manifest_verified": true,
      "resource_checksums_verified": true,
      "resource_counts_verified": true,
      "storage_objects_verified": true,
      "actor_snapshots_verified": true,
      "schema_adapter_available": true,
      "restored_storage_objects_verified": true,
      "adapter_chain": ["classroom-archive-v1-082-to-083"]
    }'::jsonb
  );
  if (v_result->>'status')::integer <> 200 or (v_result->>'replayed')::boolean is not true then
    raise exception 'Completed restore did not replay idempotently: %', v_result;
  end if;
end;
$contract$;

reset role;

do $security$
begin
  if has_function_privilege(
    'authenticated',
    'public.begin_classroom_archive_restore(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,bigint)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role can execute restore begin RPC';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.begin_classroom_archive_restore(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,bigint)',
    'EXECUTE'
  ) then
    raise exception 'Service role cannot execute restore begin RPC';
  end if;
  if has_table_privilege(
    'authenticated',
    'public.classroom_archive_restore_staging',
    'SELECT'
  ) then
    raise exception 'Authenticated role can read restore staging';
  end if;
end;
$security$;

rollback;
SQL

echo "Classroom archive restore database contract passes."
