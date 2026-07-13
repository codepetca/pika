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
  ('10000000-0000-4000-8000-000000000001', 'archive-teacher@example.test', 'teacher'),
  ('10000000-0000-4000-8000-000000000002', 'archive-student@example.test', 'student'),
  ('10000000-0000-4000-8000-000000000003', 'unrelated-user@example.test', 'student');

insert into public.student_profiles (user_id, student_number, first_name, last_name)
values ('10000000-0000-4000-8000-000000000002', 'S1', 'Archive', 'Student');

insert into public.classrooms (id, teacher_id, title, class_code)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Archive contract classroom',
  'ARC001'
);

insert into public.classroom_enrollments (classroom_id, student_id)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);

insert into public.assignments (id, classroom_id, title, description, due_at, created_by)
values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Archive assignment',
  '10000000-0000-4000-8000-000000000003',
  now() + interval '1 day',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.assignment_docs (assignment_id, student_id)
values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);

do $contract$
declare
  v_teacher_id constant uuid := '10000000-0000-4000-8000-000000000001';
  v_classroom_id constant uuid := '20000000-0000-4000-8000-000000000001';
  v_stale_operation_id constant uuid := '40000000-0000-4000-8000-000000000001';
  v_success_operation_id constant uuid := '40000000-0000-4000-8000-000000000002';
  v_result jsonb;
  v_replay jsonb;
  v_counts jsonb;
  v_revision bigint;
  v_trigger_count integer;
begin
  if (select count(*) from public.classroom_archive_resource_contract) <> 42 then
    raise exception 'Expected 42 database archive resources';
  end if;
  if not exists (
    select 1
    from public.classroom_archive_resource_contract
    where table_name = 'gradebook_settings'
      and primary_key_columns = array['classroom_id']
  ) then
    raise exception 'Gradebook settings primary key contract is stale';
  end if;
  select count(*)
  into v_trigger_count
  from pg_trigger trigger_definition
  join pg_class relation on relation.oid = trigger_definition.tgrelid
  join pg_namespace relation_namespace on relation_namespace.oid = relation.relnamespace
  where not trigger_definition.tgisinternal
    and relation_namespace.nspname = 'public'
    and trigger_definition.tgname like 'car_%';
  if v_trigger_count <> 41 then
    raise exception 'Expected 41 classroom descendant revision triggers, got %', v_trigger_count;
  end if;

  v_result := public.begin_classroom_archive_export(
    v_stale_operation_id,
    v_teacher_id,
    v_classroom_id,
    repeat('a', 64),
    '082_verified_classroom_archive_exports',
    'abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb
  );
  if v_result->>'error_code' <> 'classroom_not_archived' then
    raise exception 'Active classroom export was not rejected: %', v_result;
  end if;
  begin
    perform public.begin_classroom_archive_export(
      '40000000-0000-4000-8000-000000000003',
      v_teacher_id,
      v_classroom_id,
      repeat('0', 64),
      '082_verified_classroom_archive_exports',
      'abcdef1',
      '{"mode":"scheduled","delete_after":"2020-01-01T00:00:00.000Z"}'::jsonb
    );
    raise exception 'Expired archive retention unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;

  update public.classrooms set archived_at = now() where id = v_classroom_id;
  v_result := public.begin_classroom_archive_export(
    v_stale_operation_id,
    v_teacher_id,
    v_classroom_id,
    repeat('a', 64),
    '082_verified_classroom_archive_exports',
    'abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Archived classroom snapshot failed: %', v_result;
  end if;
  v_counts := v_result->'resource_counts';
  if (v_counts->>'classrooms')::integer <> 1
    or (v_counts->>'assignments')::integer <> 1
    or (v_counts->>'assignment_docs')::integer <> 1
  then
    raise exception 'Archive snapshot counts are wrong: %', v_counts;
  end if;
  if (
    select count(*)
    from public.classroom_archive_snapshot_actors
    where operation_id = v_stale_operation_id
  ) <> 2 then
    raise exception 'Actor snapshot did not include exactly the referenced teacher and student';
  end if;
  if exists (
    select 1
    from public.classroom_archive_snapshot_actors
    where operation_id = v_stale_operation_id
      and actor_id = '10000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Actor snapshot leaked an unrelated UUID found in free text';
  end if;
  if exists (
    select 1
    from public.classroom_archive_snapshot_actors,
      lateral jsonb_object_keys(snapshot) key
    where operation_id = v_stale_operation_id
      and key in ('password_hash', 'workos_user_id', 'session', 'token')
  ) then
    raise exception 'Actor snapshot contains a forbidden credential field';
  end if;

  v_replay := public.begin_classroom_archive_export(
    v_stale_operation_id,
    v_teacher_id,
    v_classroom_id,
    repeat('a', 64),
    '082_verified_classroom_archive_exports',
    'abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb
  );
  if not coalesce((v_replay->>'replayed')::boolean, false) then
    raise exception 'Snapshot-ready operation did not replay';
  end if;
  v_replay := public.begin_classroom_archive_export(
    v_stale_operation_id,
    v_teacher_id,
    v_classroom_id,
    repeat('f', 64),
    '082_verified_classroom_archive_exports',
    'abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb
  );
  if v_replay->>'error_code' <> 'idempotency_conflict' then
    raise exception 'Idempotency conflict was not rejected: %', v_replay;
  end if;

  select source_revision into v_revision
  from public.classroom_archive_operations
  where id = v_stale_operation_id;
  update public.assignments
  set title = 'Changed during export'
  where id = '30000000-0000-4000-8000-000000000001';
  if (
    select revision
    from public.classroom_archive_revisions
    where classroom_id = v_classroom_id
  ) <= v_revision then
    raise exception 'Classroom descendant mutation did not advance the archive revision';
  end if;

  v_result := public.complete_classroom_archive_export(
    v_stale_operation_id,
    v_teacher_id,
    'classroom-archives',
    format('%s/%s/%s/classroom-v1.tar.gz', v_teacher_id, v_classroom_id, v_stale_operation_id),
    repeat('b', 64),
    repeat('c', 64),
    100,
    200,
    v_counts,
    '{"total_count":0,"total_bytes":0,"by_bucket":{}}'::jsonb,
    '{"read_back_verified":true,"artifact_checksum_verified":true,"manifest_verified":true,"resource_checksums_verified":true,"resource_counts_verified":true,"storage_objects_verified":true,"actor_snapshots_verified":true,"verified_at":"2026-07-13T12:00:00.000Z"}'::jsonb
  );
  if v_result->>'error_code' <> 'classroom_changed_during_export' then
    raise exception 'Changed classroom archive was finalized: %', v_result;
  end if;
  if exists (
    select 1 from public.classroom_archive_snapshot_resources
    where operation_id = v_stale_operation_id
  ) then
    raise exception 'Terminal stale snapshot was not cleaned up';
  end if;
  v_replay := public.begin_classroom_archive_export(
    v_stale_operation_id,
    v_teacher_id,
    v_classroom_id,
    repeat('a', 64),
    '082_verified_classroom_archive_exports',
    'abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb
  );
  if v_replay->>'error_code' <> 'classroom_changed_during_export'
    or coalesce((v_replay->>'retryable')::boolean, true)
  then
    raise exception 'Terminal archive operation did not require a new idempotency key: %', v_replay;
  end if;

  v_result := public.begin_classroom_archive_export(
    v_success_operation_id,
    v_teacher_id,
    v_classroom_id,
    repeat('d', 64),
    '082_verified_classroom_archive_exports',
    'abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Second archive snapshot failed: %', v_result;
  end if;
  v_counts := v_result->'resource_counts';
  v_result := public.complete_classroom_archive_export(
    v_success_operation_id,
    v_teacher_id,
    'classroom-archives',
    format('%s/%s/%s/classroom-v1.tar.gz', v_teacher_id, v_classroom_id, v_success_operation_id),
    repeat('e', 64),
    repeat('f', 64),
    101,
    201,
    v_counts,
    '{"total_count":0,"total_bytes":0,"by_bucket":{}}'::jsonb,
    '{"read_back_verified":true,"artifact_checksum_verified":true,"manifest_verified":true,"resource_checksums_verified":true,"resource_counts_verified":true,"storage_objects_verified":true,"actor_snapshots_verified":true,"verified_at":"2026-07-13T12:00:00.000Z"}'::jsonb
  );
  if not coalesce((v_result->>'ok')::boolean, false)
    or v_result->>'operation_status' <> 'completed'
  then
    raise exception 'Verified archive did not finalize: %', v_result;
  end if;
  if (select count(*) from public.classroom_archives where id = v_success_operation_id) <> 1 then
    raise exception 'Verified archive metadata was not persisted exactly once';
  end if;
  if exists (
    select 1 from public.classroom_archive_snapshot_resources
    where operation_id = v_success_operation_id
  ) then
    raise exception 'Completed archive row-id staging was not removed';
  end if;

  v_replay := public.begin_classroom_archive_export(
    v_success_operation_id,
    v_teacher_id,
    v_classroom_id,
    repeat('d', 64),
    '082_verified_classroom_archive_exports',
    'abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb
  );
  if not coalesce((v_replay->>'replayed')::boolean, false)
    or v_replay->>'operation_status' <> 'completed'
    or v_replay->'storage_object_counts' <> '{"total_count":0,"total_bytes":0,"by_bucket":{}}'::jsonb
  then
    raise exception 'Completed archive operation did not replay: %', v_replay;
  end if;

  begin
    update public.classroom_archives
    set artifact_sha256 = repeat('0', 64)
    where id = v_success_operation_id;
    raise exception 'Verified archive metadata update unexpectedly succeeded';
  exception
    when sqlstate '55000' then null;
  end;
end;
$contract$;

do $security$
begin
  if exists (
    select 1 from storage.buckets
    where id in ('classroom-archives', 'gradex-analytics-extracts')
      and (public or file_size_limit <> 52428800)
  ) then
    raise exception 'Archive destination buckets are not private 50 MB buckets';
  end if;
  if (
    select count(*) from storage.buckets
    where id in ('classroom-archives', 'gradex-analytics-extracts')
  ) <> 2 then
    raise exception 'Archive destination buckets are missing';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.begin_classroom_archive_export(uuid,uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role can execute archive begin RPC';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.begin_classroom_archive_export(uuid,uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Service role cannot execute archive begin RPC';
  end if;
end;
$security$;

rollback;
SQL

echo "Verified classroom archive database contract passes."
