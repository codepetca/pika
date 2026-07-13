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
  ('11000000-0000-4000-8000-000000000021', 'compact-teacher@example.test', 'teacher'),
  ('11000000-0000-4000-8000-000000000022', 'compact-student@example.test', 'student');

insert into public.student_profiles (user_id, student_number, first_name, last_name)
values ('11000000-0000-4000-8000-000000000022', 'C1', 'Compact', 'Student');

insert into public.classrooms (id, teacher_id, title, class_code, archived_at)
values
  (
    '21000000-0000-4000-8000-000000000021',
    '11000000-0000-4000-8000-000000000021',
    'Rollback compaction classroom',
    'CMP021',
    clock_timestamp()
  ),
  (
    '21000000-0000-4000-8000-000000000022',
    '11000000-0000-4000-8000-000000000021',
    'Successful compaction classroom',
    'CMP022',
    clock_timestamp()
  );

insert into public.assignments (id, classroom_id, title, description, created_by)
values
  (
    '22000000-0000-4000-8000-000000000021',
    '21000000-0000-4000-8000-000000000021',
    'Rollback assignment',
    'Must survive a failed compaction',
    '11000000-0000-4000-8000-000000000021'
  ),
  (
    '22000000-0000-4000-8000-000000000022',
    '21000000-0000-4000-8000-000000000022',
    'Cold assignment',
    'Must be removed only after verification',
    '11000000-0000-4000-8000-000000000021'
  );

insert into public.assignment_docs (id, assignment_id, student_id, content)
values
  (
    '23000000-0000-4000-8000-000000000021',
    '22000000-0000-4000-8000-000000000021',
    '11000000-0000-4000-8000-000000000022',
    '{"type":"doc","content":[]}'::jsonb
  ),
  (
    '23000000-0000-4000-8000-000000000022',
    '22000000-0000-4000-8000-000000000022',
    '11000000-0000-4000-8000-000000000022',
    '{"type":"doc","content":[]}'::jsonb
  );

create function public.reject_test_classroom_archive_compaction()
returns trigger
language plpgsql
as $$
begin
  if old.id = '21000000-0000-4000-8000-000000000021'::uuid then
    raise exception 'forced compaction rollback';
  end if;
  return old;
end;
$$;

create trigger reject_rollback_compaction
  before delete on public.classrooms
  for each row execute function public.reject_test_classroom_archive_compaction();

set local role service_role;

do $contract$
declare
  v_teacher_id constant uuid := '11000000-0000-4000-8000-000000000021';
  v_rollback_classroom_id constant uuid := '21000000-0000-4000-8000-000000000021';
  v_success_classroom_id constant uuid := '21000000-0000-4000-8000-000000000022';
  v_rollback_archive_id constant uuid := '24000000-0000-4000-8000-000000000021';
  v_success_archive_id constant uuid := '24000000-0000-4000-8000-000000000022';
  v_rollback_compaction_id constant uuid := '25000000-0000-4000-8000-000000000021';
  v_success_compaction_id constant uuid := '25000000-0000-4000-8000-000000000022';
  v_concurrent_id constant uuid := '25000000-0000-4000-8000-000000000023';
  v_result jsonb;
  v_counts jsonb;
  v_verification jsonb;
begin
  v_result := public.begin_classroom_archive_export(
    v_rollback_archive_id,
    v_teacher_id,
    v_rollback_classroom_id,
    repeat('1', 64),
    '085_atomic_classroom_archive_compaction',
    'abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Rollback archive begin failed: %', v_result;
  end if;
  v_counts := v_result->'resource_counts';
  v_result := public.complete_classroom_archive_export(
    v_rollback_archive_id,
    v_teacher_id,
    'classroom-archives',
    format(
      '%s/%s/%s/classroom-v1.tar.gz',
      v_teacher_id,
      v_rollback_classroom_id,
      v_rollback_archive_id
    ),
    repeat('a', 64),
    repeat('b', 64),
    1024,
    4096,
    v_counts,
    '{
      "total_count": 1,
      "total_bytes": 10,
      "by_bucket": {"assignment-artifacts": {"count": 1, "bytes": 10}}
    }'::jsonb,
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
    raise exception 'Rollback archive completion failed: %', v_result;
  end if;

  v_result := public.begin_classroom_archive_compaction(
    v_rollback_compaction_id,
    v_teacher_id,
    v_rollback_classroom_id,
    v_rollback_archive_id,
    repeat('c', 64)
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'snapshot_ready'
  then
    raise exception 'Rollback compaction begin failed: %', v_result;
  end if;
  v_result := public.begin_classroom_archive_compaction(
    v_rollback_compaction_id,
    v_teacher_id,
    v_rollback_classroom_id,
    v_rollback_archive_id,
    repeat('d', 64)
  );
  if v_result->>'error_code' <> 'idempotency_conflict' then
    raise exception 'Compaction idempotency conflict was not rejected: %', v_result;
  end if;
  v_result := public.begin_classroom_archive_compaction(
    v_concurrent_id,
    v_teacher_id,
    v_rollback_classroom_id,
    v_rollback_archive_id,
    repeat('e', 64)
  );
  if v_result->>'error_code' <> 'compaction_already_in_progress'
    or exists (select 1 from public.classroom_archive_operations where id = v_concurrent_id)
  then
    raise exception 'Concurrent compaction was not rejected safely: %', v_result;
  end if;

  begin
    perform public.stage_classroom_archive_compaction_objects(
      v_rollback_compaction_id,
      v_teacher_id,
      '[{
        "storage_bucket":"assignment-artifacts",
        "storage_path":"../outside",
        "sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        "byte_size":10
      }]'::jsonb
    );
    raise exception 'Traversal cleanup path was accepted';
  exception when invalid_parameter_value then null;
  end;

  v_result := public.stage_classroom_archive_compaction_objects(
    v_rollback_compaction_id,
    v_teacher_id,
    '[{
      "storage_bucket":"assignment-artifacts",
      "storage_path":"teacher/classroom/submission.txt",
      "sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      "byte_size":10
    }]'::jsonb
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or (v_result->>'staged_object_count')::integer <> 1
  then
    raise exception 'Compaction cleanup staging failed: %', v_result;
  end if;

  v_verification := jsonb_build_object(
    'operation_id', v_rollback_compaction_id,
    'archive_id', v_rollback_archive_id,
    'artifact_sha256', repeat('a', 64),
    'content_sha256', repeat('b', 64),
    'verified_at', clock_timestamp(),
    'read_back_verified', true,
    'artifact_checksum_verified', true,
    'manifest_verified', true,
    'resource_checksums_verified', true,
    'resource_counts_verified', true,
    'storage_objects_verified', true,
    'actor_snapshots_verified', true,
    'source_object_cleanup_staged', true
  );
  begin
    perform public.complete_classroom_archive_compaction(
      v_rollback_compaction_id,
      v_teacher_id,
      jsonb_set(v_verification, '{read_back_verified}', 'false'::jsonb)
    );
    raise exception 'Incomplete compaction verification was accepted';
  exception when invalid_parameter_value then null;
  end;
  if not exists (select 1 from public.classrooms where id = v_rollback_classroom_id)
    or not exists (
      select 1 from public.assignment_docs
      where id = '23000000-0000-4000-8000-000000000021'
    )
    or exists (
      select 1 from public.classroom_cold_tombstones
      where classroom_id = v_rollback_classroom_id
    )
  then
    raise exception 'Verification failure changed hot classroom state';
  end if;

  begin
    perform public.complete_classroom_archive_compaction(
      v_rollback_compaction_id,
      v_teacher_id,
      v_verification
    );
    raise exception 'Forced compaction rollback did not fail';
  exception when raise_exception then
    if sqlerrm <> 'forced compaction rollback' then raise; end if;
  end;
  if not exists (select 1 from public.classrooms where id = v_rollback_classroom_id)
    or not exists (
      select 1 from public.assignment_docs
      where id = '23000000-0000-4000-8000-000000000021'
    )
    or exists (
      select 1 from public.classroom_cold_tombstones
      where classroom_id = v_rollback_classroom_id
    )
    or (
      select status from public.classroom_archive_operations
      where id = v_rollback_compaction_id
    ) <> 'snapshot_ready'
    or (
      select count(*) from public.classroom_archive_source_object_cleanup
      where operation_id = v_rollback_compaction_id
    ) <> 1
    or (
      select status from public.classroom_archive_source_object_cleanup
      where operation_id = v_rollback_compaction_id
    ) <> 'staged'
  then
    raise exception 'Compaction transaction did not roll back completely';
  end if;
  if not public.fail_classroom_archive_compaction(
    v_rollback_compaction_id,
    v_teacher_id,
    'forced_rollback_verified',
    false
  ) then
    raise exception 'Terminal compaction failure was not recorded';
  end if;
  if exists (
    select 1 from public.classroom_archive_source_object_cleanup
    where operation_id = v_rollback_compaction_id
  ) then
    raise exception 'Terminal compaction failure retained cleanup staging';
  end if;

  v_result := public.begin_classroom_archive_export(
    v_success_archive_id,
    v_teacher_id,
    v_success_classroom_id,
    repeat('2', 64),
    '085_atomic_classroom_archive_compaction',
    'abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb
  );
  v_counts := v_result->'resource_counts';
  v_result := public.complete_classroom_archive_export(
    v_success_archive_id,
    v_teacher_id,
    'classroom-archives',
    format('%s/%s/%s/classroom-v1.tar.gz', v_teacher_id, v_success_classroom_id, v_success_archive_id),
    repeat('3', 64),
    repeat('4', 64),
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
    raise exception 'Successful archive setup failed: %', v_result;
  end if;
  v_result := public.begin_classroom_archive_compaction(
    v_success_compaction_id,
    v_teacher_id,
    v_success_classroom_id,
    v_success_archive_id,
    repeat('5', 64)
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Successful compaction begin failed: %', v_result;
  end if;
  perform public.stage_classroom_archive_compaction_objects(
    v_success_compaction_id,
    v_teacher_id,
    '[]'::jsonb
  );
  v_verification := jsonb_build_object(
    'operation_id', v_success_compaction_id,
    'archive_id', v_success_archive_id,
    'artifact_sha256', repeat('3', 64),
    'content_sha256', repeat('4', 64),
    'verified_at', clock_timestamp(),
    'read_back_verified', true,
    'artifact_checksum_verified', true,
    'manifest_verified', true,
    'resource_checksums_verified', true,
    'resource_counts_verified', true,
    'storage_objects_verified', true,
    'actor_snapshots_verified', true,
    'source_object_cleanup_staged', true
  );
  v_result := public.complete_classroom_archive_compaction(
    v_success_compaction_id,
    v_teacher_id,
    v_verification
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'completed'
  then
    raise exception 'Successful compaction failed: %', v_result;
  end if;
  if exists (select 1 from public.classrooms where id = v_success_classroom_id)
    or exists (
      select 1 from public.assignments
      where id = '22000000-0000-4000-8000-000000000022'
    )
    or exists (
      select 1 from public.assignment_docs
      where id = '23000000-0000-4000-8000-000000000022'
    )
    or not exists (
      select 1 from public.classroom_cold_tombstones
      where classroom_id = v_success_classroom_id
        and archive_id = v_success_archive_id
    )
    or not exists (select 1 from public.classroom_archives where id = v_success_archive_id)
    or coalesce((v_result->'verification'->>'relational_deletion_verified')::boolean, false) is not true
  then
    raise exception 'Successful compaction did not produce exact cold state';
  end if;
  v_result := public.complete_classroom_archive_compaction(
    v_success_compaction_id,
    v_teacher_id,
    v_verification
  );
  if (v_result->>'status')::integer <> 200
    or (v_result->>'replayed')::boolean is not true
  then
    raise exception 'Completed compaction did not replay idempotently: %', v_result;
  end if;
end;
$contract$;

reset role;

do $security$
begin
  if has_function_privilege(
    'authenticated',
    'public.begin_classroom_archive_compaction(uuid,uuid,uuid,uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.stage_classroom_archive_compaction_objects(uuid,uuid,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_classroom_archive_compaction(uuid,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role can execute classroom compaction RPCs';
  end if;
  if has_table_privilege(
    'authenticated',
    'public.classroom_archive_source_object_cleanup',
    'SELECT'
  ) then
    raise exception 'Authenticated role can read source-object cleanup rows';
  end if;
end;
$security$;

rollback;
SQL

echo "Classroom archive compaction database contract passed."
