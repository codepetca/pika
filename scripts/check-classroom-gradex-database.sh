#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${CLASSROOM_ARCHIVE_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local role service_role;

do $contract$
declare
  v_teacher_id constant uuid := '11000000-0000-4000-8000-000000000011';
  v_classroom_id constant uuid := '21000000-0000-4000-8000-000000000011';
  v_export_operation_id constant uuid := '22000000-0000-4000-8000-000000000011';
  v_archive_id constant uuid := '23000000-0000-4000-8000-000000000011';
  v_wrong_teacher_extract_id constant uuid := '24000000-0000-4000-8000-000000000009';
  v_wrong_classroom_extract_id constant uuid := '24000000-0000-4000-8000-000000000010';
  v_extract_id constant uuid := '24000000-0000-4000-8000-000000000011';
  v_concurrent_id constant uuid := '24000000-0000-4000-8000-000000000012';
  v_superseding_id constant uuid := '24000000-0000-4000-8000-000000000013';
  v_lease_one constant uuid := '25000000-0000-4000-8000-000000000011';
  v_lease_two constant uuid := '25000000-0000-4000-8000-000000000012';
  v_delete_after timestamptz := clock_timestamp() + interval '30 days';
  v_counts jsonb;
  v_verification jsonb;
  v_result jsonb;
  v_claim record;
begin
  insert into public.classroom_archive_operations (
    id, teacher_id, classroom_id, operation_type, request_sha256, status,
    source_revision, source_schema_migration, source_app_commit, retention,
    resource_counts, storage_object_counts, archive_id, storage_bucket, storage_path,
    artifact_sha256, content_sha256, compressed_byte_size, uncompressed_byte_size,
    verification, snapshot_created_at, snapshot_expires_at, completed_at
  ) values (
    v_export_operation_id, v_teacher_id, v_classroom_id, 'export', repeat('a', 64),
    'completed', 1, '082_verified_classroom_archive_exports', 'deadbee',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb,
    '{}'::jsonb, '{}'::jsonb, v_archive_id, 'classroom-archives',
    'teacher/classroom/archive/classroom-v1.tar.gz', repeat('b', 64), repeat('c', 64),
    100, 200, '{"read_back_verified":true}'::jsonb,
    clock_timestamp(), clock_timestamp() + interval '24 hours', clock_timestamp()
  );
  insert into public.classroom_archives (
    id, operation_id, classroom_id, teacher_id, format, format_version,
    source_revision, source_schema_migration, source_app_commit, storage_bucket,
    storage_path, artifact_sha256, content_sha256, compressed_byte_size,
    uncompressed_byte_size, resource_counts, storage_object_counts, verification,
    retention, created_at, verified_at
  ) values (
    v_archive_id, v_export_operation_id, v_classroom_id, v_teacher_id,
    'pika.classroom-archive', 1, 1, '082_verified_classroom_archive_exports',
    'deadbee', 'classroom-archives', 'teacher/classroom/archive/classroom-v1.tar.gz',
    repeat('b', 64), repeat('c', 64), 100, 200, '{}'::jsonb, '{}'::jsonb,
    '{"read_back_verified":true}'::jsonb,
    '{"mode":"teacher_managed","delete_after":null}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );

  select jsonb_object_agg(table_name, 0 order by table_name)
  into v_counts from public.classroom_gradex_resource_contract;
  v_verification := jsonb_build_object(
    'source_archive_checksum_verified', true,
    'source_archive_manifest_verified', true,
    'resource_checksums_verified', true,
    'resource_counts_verified', true,
    'structured_privacy_verified', true,
    'pseudonym_relationships_verified', true,
    'storage_objects_excluded', true,
    'read_back_verified', true,
    'artifact_checksum_verified', true,
    'direct_identifier_findings', 0,
    'verified_at', clock_timestamp()
  );

  v_result := public.begin_classroom_gradex_extract(
    v_wrong_teacher_extract_id, '11000000-0000-4000-8000-000000000099',
    v_classroom_id, v_archive_id, repeat('2', 64), v_delete_after
  );
  if v_result->>'error_code' <> 'classroom_archive_not_found'
    or exists (
      select 1 from public.classroom_archive_operations
      where id = v_wrong_teacher_extract_id
    )
  then
    raise exception 'Foreign teacher Gradex request was not rejected safely: %', v_result;
  end if;

  v_result := public.begin_classroom_gradex_extract(
    v_wrong_classroom_extract_id, v_teacher_id,
    '21000000-0000-4000-8000-000000000099', v_archive_id,
    repeat('3', 64), v_delete_after
  );
  if v_result->>'error_code' <> 'classroom_archive_not_found'
    or exists (
      select 1 from public.classroom_archive_operations
      where id = v_wrong_classroom_extract_id
    )
  then
    raise exception 'Wrong classroom Gradex request was not rejected safely: %', v_result;
  end if;

  begin
    perform public.begin_classroom_gradex_extract(
      v_extract_id, v_teacher_id, v_classroom_id, v_archive_id,
      repeat('d', 64), clock_timestamp() + interval '91 days'
    );
    raise exception 'Gradex retention above 90 days was accepted';
  exception when invalid_parameter_value then null;
  end;

  v_result := public.begin_classroom_gradex_extract(
    v_extract_id, v_teacher_id, v_classroom_id, v_archive_id,
    repeat('d', 64), v_delete_after
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'snapshot_ready'
    or v_result->>'source_archive_sha256' <> repeat('b', 64)
  then
    raise exception 'Gradex begin failed: %', v_result;
  end if;
  if not exists (
    select 1 from public.classroom_gradex_extract_cleanup
    where operation_id = v_extract_id
      and extract_id is null
      and status = 'staged'
      and storage_path = v_result->>'storage_path'
  ) then
    raise exception 'Gradex cleanup intent was not persisted before upload';
  end if;

  v_result := public.begin_classroom_gradex_extract(
    v_concurrent_id, v_teacher_id, v_classroom_id, v_archive_id,
    repeat('e', 64), v_delete_after
  );
  if v_result->>'error_code' <> 'gradex_extract_already_in_progress' then
    raise exception 'Concurrent Gradex generation was not rejected: %', v_result;
  end if;

  v_verification := jsonb_set(
    v_verification,
    '{verified_at}',
    to_jsonb(clock_timestamp())
  );

  begin
    perform public.complete_classroom_gradex_extract(
      v_extract_id, v_teacher_id, repeat('f', 64), repeat('1', 64), 100, 200,
      v_counts, v_verification - 'structured_privacy_verified'
    );
    raise exception 'Incomplete Gradex verification was accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.complete_classroom_gradex_extract(
      v_extract_id, v_teacher_id, repeat('f', 64), repeat('1', 64), 100, 200,
      v_counts,
      jsonb_set(v_verification, '{structured_privacy_verified}', '"true"'::jsonb)
    );
    raise exception 'Stringified Gradex verification evidence was accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.complete_classroom_gradex_extract(
      v_extract_id, v_teacher_id, repeat('f', 64), repeat('1', 64), 100, 200,
      v_counts,
      jsonb_set(
        v_verification,
        '{verified_at}',
        to_jsonb(clock_timestamp() + interval '10 minutes')
      )
    );
    raise exception 'Future Gradex verification timestamp was accepted';
  exception when invalid_parameter_value then null;
  end;

  v_result := public.complete_classroom_gradex_extract(
    v_extract_id, v_teacher_id, repeat('f', 64), repeat('1', 64), 100, 200,
    v_counts, v_verification
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or v_result->>'operation_status' <> 'completed'
  then
    raise exception 'Gradex completion failed: %', v_result;
  end if;
  if not exists (
    select 1 from public.classroom_gradex_extracts
    where id = v_extract_id and source_archive_sha256 = repeat('b', 64)
      and delete_after = v_delete_after
  ) then
    raise exception 'Immutable Gradex metadata was not persisted';
  end if;
  if not exists (
    select 1 from public.classroom_gradex_extract_cleanup
    where operation_id = v_extract_id
      and extract_id = v_extract_id
      and status = 'pending'
  ) then
    raise exception 'Gradex cleanup intent was not finalized';
  end if;

  v_result := public.begin_classroom_gradex_extract(
    v_extract_id, v_teacher_id, v_classroom_id, v_archive_id,
    repeat('d', 64), v_delete_after
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or coalesce((v_result->>'replayed')::boolean, false) is not true
  then
    raise exception 'Completed Gradex replay failed: %', v_result;
  end if;

  v_result := public.complete_classroom_gradex_extract(
    v_extract_id, v_teacher_id, repeat('9', 64), repeat('1', 64), 100, 200,
    v_counts, v_verification
  );
  if v_result->>'error_code' <> 'gradex_finalization_conflict' then
    raise exception 'Conflicting Gradex finalization replay was accepted: %', v_result;
  end if;

  v_result := public.begin_classroom_gradex_extract(
    v_superseding_id, v_teacher_id, v_classroom_id, v_archive_id,
    repeat('8', 64), v_delete_after
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Superseding Gradex generation did not begin: %', v_result;
  end if;
  v_verification := jsonb_set(
    v_verification,
    '{verified_at}',
    to_jsonb(clock_timestamp())
  );
  v_result := public.complete_classroom_gradex_extract(
    v_superseding_id, v_teacher_id, repeat('7', 64), repeat('6', 64), 100, 200,
    v_counts, v_verification
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'Superseding Gradex generation did not complete: %', v_result;
  end if;
  if not exists (
    select 1 from public.classroom_gradex_extract_cleanup
    where extract_id = v_extract_id
      and superseded_by_extract_id = v_superseding_id
      and next_attempt_at <= clock_timestamp()
  ) then
    raise exception 'Prior Gradex extract was not scheduled after supersession';
  end if;

  begin
    perform public.fail_classroom_gradex_extract(
      v_concurrent_id, v_teacher_id, 'x', null
    );
    raise exception 'Invalid Gradex failure evidence was accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    update public.classroom_gradex_extracts set content_sha256 = repeat('2', 64)
    where id = v_extract_id;
    raise exception 'Gradex metadata update was accepted';
  exception when sqlstate '55000' then null;
  end;

  begin
    perform public.claim_due_classroom_gradex_extract_cleanup(null, 25, 300);
    raise exception 'Null Gradex cleanup lease was accepted';
  exception when invalid_parameter_value then null;
  end;
  select * into v_claim
  from public.claim_due_classroom_gradex_extract_cleanup(v_lease_one, 25, 300);
  if v_claim.extract_id <> v_extract_id or v_claim.attempt_count <> 1 then
    raise exception 'Due Gradex cleanup was not claimed';
  end if;
  if not public.fail_classroom_gradex_extract_cleanup(
    v_extract_id, v_lease_one, 'storage_delete_failed'
  ) then
    raise exception 'Gradex cleanup failure was not recorded';
  end if;
  update public.classroom_gradex_extract_cleanup
  set next_attempt_at = clock_timestamp() - interval '1 second'
  where extract_id = v_extract_id;
  select * into v_claim
  from public.claim_due_classroom_gradex_extract_cleanup(v_lease_two, 25, 300);
  if v_claim.extract_id <> v_extract_id or v_claim.attempt_count <> 2 then
    raise exception 'Failed Gradex cleanup was not reclaimed';
  end if;
  if public.complete_classroom_gradex_extract_cleanup(v_extract_id, v_lease_one) then
    raise exception 'Stale Gradex cleanup lease was accepted';
  end if;
  if not public.complete_classroom_gradex_extract_cleanup(v_extract_id, v_lease_two) then
    raise exception 'Gradex cleanup completion failed';
  end if;
  if not exists (
    select 1 from public.classroom_gradex_extract_cleanup
    where extract_id = v_extract_id and status = 'deleted' and deleted_at is not null
  ) then
    raise exception 'Gradex cleanup deletion evidence is missing';
  end if;

  if has_table_privilege('authenticated', 'public.classroom_gradex_extracts', 'select')
    or has_table_privilege('authenticated', 'public.classroom_gradex_extract_cleanup', 'select')
    or has_function_privilege(
      'authenticated',
      'public.begin_classroom_gradex_extract(uuid,uuid,uuid,uuid,text,timestamptz)',
      'execute'
    )
  then
    raise exception 'Browser role retained Gradex operation privileges';
  end if;
end;
$contract$;

rollback;
SQL

echo "Classroom Gradex database contract passes."
