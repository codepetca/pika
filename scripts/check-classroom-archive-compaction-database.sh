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

insert into public.assignments (id, classroom_id, title, description, due_at, created_by)
values
  (
    '22000000-0000-4000-8000-000000000021',
    '21000000-0000-4000-8000-000000000021',
    'Rollback assignment',
    'Must survive a failed compaction',
    clock_timestamp() + interval '1 day',
    '11000000-0000-4000-8000-000000000021'
  ),
  (
    '22000000-0000-4000-8000-000000000022',
    '21000000-0000-4000-8000-000000000022',
    'Cold assignment',
    'Must be removed only after verification',
    clock_timestamp() + interval '1 day',
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

insert into public.assignment_submission_requirements (
  id,
  assignment_id,
  type,
  label
) values (
  '27000000-0000-4000-8000-000000000022',
  '22000000-0000-4000-8000-000000000022',
  'image',
  'Compaction evidence'
);

insert into public.assignment_submission_artifacts (
  id,
  assignment_doc_id,
  requirement_id,
  student_id,
  type,
  storage_path,
  validation_status
) values (
  '28000000-0000-4000-8000-000000000022',
  '23000000-0000-4000-8000-000000000022',
  '27000000-0000-4000-8000-000000000022',
  '11000000-0000-4000-8000-000000000022',
  'image',
  'teacher/classroom/success.txt',
  'valid'
);

insert into storage.objects (bucket_id, name, metadata)
values (
  'assignment-artifacts',
  'teacher/classroom/success.txt',
  '{"size":10}'::jsonb
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

do $timeout_contract$
begin
  if not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'complete_classroom_archive_compaction'
      and pg_get_function_identity_arguments(procedure.oid) =
        'p_operation_id uuid, p_teacher_id uuid, p_actors jsonb, p_verification jsonb'
      and procedure.proconfig @> array['statement_timeout=60s']::text[]
  ) then
    raise exception 'Compaction finalizer does not have the function-scoped 60-second timeout';
  end if;
end;
$timeout_contract$;

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
  v_claim_count integer;
  v_resource record;
  v_rows jsonb;
  v_actors jsonb := '[
    {"actor_id":"11000000-0000-4000-8000-000000000021","role":"teacher"},
    {"actor_id":"11000000-0000-4000-8000-000000000022","role":"student"}
  ]'::jsonb;
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
  if not public.stage_classroom_archive_object_upload(
    v_rollback_archive_id, v_teacher_id, 'classroom-archives',
    format(
      '%s/%s/%s/classroom-v1.tar.gz',
      v_teacher_id,
      v_rollback_classroom_id,
      v_rollback_archive_id
    ),
    repeat('a', 64), 1024
  ) then
    raise exception 'Rollback archive upload intent was rejected';
  end if;
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
  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
    order by export_position
  loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(source) order by source.%I), ''[]''::jsonb)
       from public.%I source
       where public.resolve_classroom_archive_resource_classroom_id(%L, source.%I) = $1',
      v_resource.primary_key_column,
      v_resource.table_name,
      v_resource.table_name,
      v_resource.primary_key_column
    ) into v_rows using v_rollback_classroom_id;
    if jsonb_array_length(v_rows) > 0 then
      perform public.stage_classroom_archive_restore_rows(
        v_rollback_compaction_id, v_teacher_id, v_resource.table_name, v_rows
      );
    end if;
  end loop;
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
    'schema_adapter_verified', true,
    'actor_references_resolved', true,
    'source_object_cleanup_staged', true
  );
  begin
    perform public.complete_classroom_archive_compaction(
      v_rollback_compaction_id,
      v_teacher_id,
      v_actors,
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
      jsonb_set(v_actors, '{0,role}', '"student"'::jsonb),
      v_verification
    );
    raise exception 'Changed actor role was accepted for compaction';
  exception when serialization_failure then null;
  end;

  begin
    perform public.complete_classroom_archive_compaction(
      v_rollback_compaction_id,
      v_teacher_id,
      v_actors,
      v_verification
    );
    raise exception 'Compaction trigger preflight did not fail';
  exception when check_violation then
    if sqlerrm <> 'Compaction database foreign keys or triggers reject staged rows' then
      raise;
    end if;
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
  if not public.stage_classroom_archive_object_upload(
    v_success_archive_id, v_teacher_id, 'classroom-archives',
    format('%s/%s/%s/classroom-v1.tar.gz', v_teacher_id, v_success_classroom_id, v_success_archive_id),
    repeat('3', 64), 1024
  ) then
    raise exception 'Successful archive upload intent was rejected';
  end if;
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
  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
    order by export_position
  loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(source) order by source.%I), ''[]''::jsonb)
       from public.%I source
       where public.resolve_classroom_archive_resource_classroom_id(%L, source.%I) = $1',
      v_resource.primary_key_column,
      v_resource.table_name,
      v_resource.table_name,
      v_resource.primary_key_column
    ) into v_rows using v_success_classroom_id;
    if jsonb_array_length(v_rows) > 0 then
      perform public.stage_classroom_archive_restore_rows(
        v_success_compaction_id, v_teacher_id, v_resource.table_name, v_rows
      );
    end if;
  end loop;
  perform public.stage_classroom_archive_compaction_objects(
    v_success_compaction_id,
    v_teacher_id,
    '[{
      "storage_bucket":"assignment-artifacts",
      "storage_path":"teacher/classroom/success.txt",
      "sha256":"6666666666666666666666666666666666666666666666666666666666666666",
      "byte_size":10
    }]'::jsonb
  );
  select count(*) into v_claim_count
  from public.claim_due_classroom_archive_source_object_cleanup_v2(
    '26000000-0000-4000-8000-000000000030',
    v_success_compaction_id,
    1,
    300
  );
  if v_claim_count <> 0 then
    raise exception 'Staged source-object cleanup was claimable before compaction completed';
  end if;
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
    'schema_adapter_verified', true,
    'actor_references_resolved', true,
    'source_object_cleanup_staged', true
  );
  v_result := public.complete_classroom_archive_compaction(
    v_success_compaction_id,
    v_teacher_id,
    v_actors,
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
    v_actors,
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

update public.classroom_archive_source_object_cleanup
set status = 'processing',
    lease_token = '26000000-0000-4000-8000-000000000030'::uuid,
    lease_expires_at = clock_timestamp() + interval '5 minutes',
    last_error_code = null
where operation_id = '25000000-0000-4000-8000-000000000022'::uuid;

set local role service_role;

do $stale_lease_transition$
begin
  if public.complete_classroom_archive_source_object_cleanup(
    '25000000-0000-4000-8000-000000000022'::uuid,
    'assignment-artifacts',
    'teacher/classroom/success.txt',
    '26000000-0000-4000-8000-000000000030'::uuid
  ) then
    raise exception 'Pre-fence source cleanup lease completed without a reservation';
  end if;
end;
$stale_lease_transition$;

reset role;

update public.classroom_archive_source_object_cleanup
set status = 'pending',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = null
where operation_id = '25000000-0000-4000-8000-000000000022'::uuid;

do $stale_worker_delete$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  begin
    delete from storage.objects
    where bucket_id = 'assignment-artifacts'
      and name = 'teacher/classroom/success.txt';
    raise exception 'Pre-fence source cleanup worker deleted without a reservation';
  exception when object_not_in_prerequisite_state then null;
  end;
  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'assignment-artifacts'
      and name = 'teacher/classroom/success.txt'
  ) then
    raise exception 'Blocked pre-fence deletion removed the source object';
  end if;
end;
$stale_worker_delete$;

do $cleanup_ownership_evidence$
begin
  begin
    update public.classroom_archive_source_object_cleanup
    set ownership_verified = true
    where operation_id = '25000000-0000-4000-8000-000000000022'::uuid;
    raise exception 'Boolean-only source ownership evidence was accepted';
  exception when check_violation then null;
  end;
end;
$cleanup_ownership_evidence$;

set local role service_role;

do $source_object_presence$
declare
  v_present jsonb;
  v_absent jsonb;
begin
  v_present := public.get_classroom_archive_source_object_presence(
    'assignment-artifacts',
    'teacher/classroom/success.txt'
  );
  if coalesce((v_present->>'bucket_exists')::boolean, false) is not true
    or coalesce((v_present->>'object_exists')::boolean, false) is not true
  then
    raise exception 'Exact source-object presence lookup missed an existing object: %', v_present;
  end if;

  v_absent := public.get_classroom_archive_source_object_presence(
    'assignment-artifacts',
    'teacher/classroom/absent.txt'
  );
  if coalesce((v_absent->>'bucket_exists')::boolean, false) is not true
    or coalesce((v_absent->>'object_exists')::boolean, true) is not false
  then
    raise exception 'Exact source-object presence lookup invented an absent object: %', v_absent;
  end if;

  begin
    perform public.get_classroom_archive_source_object_presence(
      'assignment-artifacts',
      '../outside'
    );
    raise exception 'Malformed source-object presence path was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$source_object_presence$;

do $cleanup_reservation$
declare
  v_result jsonb;
begin
  v_result := public.verify_and_reserve_classroom_archive_source_objects(
    '25000000-0000-4000-8000-000000000022'::uuid,
    1
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true
    or (v_result->>'verified')::integer <> 1
    or (v_result->>'preserved')::integer <> 0
  then
    raise exception 'Source-object ownership reservation failed: %', v_result;
  end if;
  v_result := public.verify_and_reserve_classroom_archive_source_objects(
    '25000000-0000-4000-8000-000000000022'::uuid,
    1
  );
  if coalesce((v_result->>'replayed')::boolean, false) is not true then
    raise exception 'Source-object ownership reservation did not replay: %', v_result;
  end if;

  begin
    insert into public.assignment_submission_artifacts (
      assignment_doc_id,
      requirement_id,
      student_id,
      type,
      storage_path
    ) values (
      '23000000-0000-4000-8000-000000000099',
      '27000000-0000-4000-8000-000000000099',
      '11000000-0000-4000-8000-000000000022',
      'image',
      'teacher/classroom/success.txt'
    );
    raise exception 'Reserved source path was attached to hot relational data';
  exception when object_not_in_prerequisite_state then null;
  end;

  begin
    update storage.objects
    set metadata = '{"size":11}'::jsonb
    where bucket_id = 'assignment-artifacts'
      and name = 'teacher/classroom/success.txt';
    raise exception 'Reserved source object was overwritten';
  exception when object_not_in_prerequisite_state then null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('assignment-artifacts', 'teacher/classroom/success.txt');
    raise exception 'Reserved source object path was reused';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$cleanup_reservation$;

do $cleanup_claim$
declare
  v_claim record;
  v_claim_count integer;
begin
  begin
    perform public.claim_due_classroom_archive_source_object_cleanup_v2(
      '26000000-0000-4000-8000-000000000031',
      '25000000-0000-4000-8000-000000000022',
      0,
      300
    );
    raise exception 'Invalid source-object cleanup claim bounds were accepted';
  exception when invalid_parameter_value then null;
  end;

  select * into v_claim
  from public.claim_due_classroom_archive_source_object_cleanup_v2(
    '26000000-0000-4000-8000-000000000031',
    '25000000-0000-4000-8000-000000000022',
    1,
    300
  );
  if v_claim.operation_id is null
    or v_claim.operation_id <> '25000000-0000-4000-8000-000000000022'::uuid
    or v_claim.archive_id <> '24000000-0000-4000-8000-000000000022'::uuid
    or v_claim.classroom_id <> '21000000-0000-4000-8000-000000000022'::uuid
    or v_claim.storage_bucket <> 'assignment-artifacts'
    or v_claim.storage_path <> 'teacher/classroom/success.txt'
    or v_claim.expected_sha256 <> repeat('6', 64)
    or v_claim.expected_byte_size <> 10
    or v_claim.attempt_count <> 1
  then
    raise exception 'Source-object cleanup claim contract differed: %', row_to_json(v_claim);
  end if;

  select count(*) into v_claim_count
  from public.claim_due_classroom_archive_source_object_cleanup_v2(
    '26000000-0000-4000-8000-000000000032',
    '25000000-0000-4000-8000-000000000022',
    1,
    300
  );
  if v_claim_count <> 0 then
    raise exception 'Active source-object cleanup lease was claimed twice';
  end if;
end;
$cleanup_claim$;

reset role;

update public.classroom_archive_source_object_cleanup
set lease_expires_at = clock_timestamp() - interval '1 second'
where operation_id = '25000000-0000-4000-8000-000000000022'::uuid;

set local role service_role;

do $cleanup_reclaim$
declare
  v_claim record;
  v_claim_count integer;
begin
  select * into v_claim
  from public.claim_due_classroom_archive_source_object_cleanup_v2(
    '26000000-0000-4000-8000-000000000032',
    '25000000-0000-4000-8000-000000000022',
    1,
    300
  );
  if v_claim.operation_id is null or v_claim.attempt_count <> 2 then
    raise exception 'Expired source-object cleanup lease was not reclaimed';
  end if;
  if public.complete_classroom_archive_source_object_cleanup(
    v_claim.operation_id,
    v_claim.storage_bucket,
    v_claim.storage_path,
    '26000000-0000-4000-8000-000000000031'
  ) then
    raise exception 'Stale source-object cleanup lease completed work';
  end if;
  if not public.fail_classroom_archive_source_object_cleanup(
    v_claim.operation_id,
    v_claim.storage_bucket,
    v_claim.storage_path,
    '26000000-0000-4000-8000-000000000032',
    'contract_retry'
  ) then
    raise exception 'Current source-object cleanup lease could not record failure';
  end if;
  select count(*) into v_claim_count
  from public.claim_due_classroom_archive_source_object_cleanup_v2(
    '26000000-0000-4000-8000-000000000033',
    '25000000-0000-4000-8000-000000000022',
    1,
    300
  );
  if v_claim_count <> 0 then
    raise exception 'Source-object cleanup retry backoff was bypassed';
  end if;
end;
$cleanup_reclaim$;

reset role;

update public.classroom_archive_source_object_cleanup
set next_attempt_at = clock_timestamp()
where operation_id = '25000000-0000-4000-8000-000000000022'::uuid;

set local role service_role;

do $cleanup_complete$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_due_classroom_archive_source_object_cleanup_v2(
    '26000000-0000-4000-8000-000000000033',
    '25000000-0000-4000-8000-000000000022',
    1,
    300
  );
  if v_claim.operation_id is null or v_claim.attempt_count <> 3 then
    raise exception 'Failed source-object cleanup was not claimable after backoff';
  end if;
  begin
    perform public.complete_classroom_archive_source_object_cleanup(
      v_claim.operation_id,
      v_claim.storage_bucket,
      '../outside',
      '26000000-0000-4000-8000-000000000033'
    );
    raise exception 'Invalid source-object cleanup completion path was accepted';
  exception when invalid_parameter_value then null;
  end;
  if public.complete_classroom_archive_source_object_cleanup(
    v_claim.operation_id,
    v_claim.storage_bucket,
    v_claim.storage_path,
    '26000000-0000-4000-8000-000000000034'
  ) then
    raise exception 'Wrong source-object cleanup lease completed work';
  end if;
  if not public.complete_classroom_archive_source_object_cleanup(
    v_claim.operation_id,
    v_claim.storage_bucket,
    v_claim.storage_path,
    '26000000-0000-4000-8000-000000000033'
  ) then
    raise exception 'Current source-object cleanup lease could not complete work';
  end if;
  if public.complete_classroom_archive_source_object_cleanup(
    v_claim.operation_id,
    v_claim.storage_bucket,
    v_claim.storage_path,
    '26000000-0000-4000-8000-000000000033'
  ) then
    raise exception 'Completed source-object cleanup replay mutated the ledger';
  end if;
  if not exists (
    select 1
    from public.classroom_archive_source_object_cleanup
    where operation_id = v_claim.operation_id
      and storage_bucket = v_claim.storage_bucket
      and storage_path = v_claim.storage_path
      and status = 'deleted'
      and deleted_at is not null
      and lease_token is null
      and lease_expires_at is null
  ) then
    raise exception 'Source-object cleanup completion did not preserve audit evidence';
  end if;
  if not exists (
    select 1
    from public.classroom_archive_source_object_reservations reservation
    where reservation.operation_id = v_claim.operation_id
      and reservation.storage_bucket = v_claim.storage_bucket
      and reservation.storage_path_sha256 =
        public.classroom_archive_source_object_path_sha256(
          v_claim.storage_bucket, v_claim.storage_path
        )
  ) then
    raise exception 'Source-object cleanup completion released its permanent reservation';
  end if;
end;
$cleanup_complete$;

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
    'public.complete_classroom_archive_compaction(uuid,uuid,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role can execute classroom compaction RPCs';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.verify_and_reserve_classroom_archive_source_objects(uuid,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.get_classroom_archive_source_object_presence(text,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_due_classroom_archive_source_object_cleanup_v2(uuid,uuid,integer,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_classroom_archive_source_object_cleanup(uuid,text,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.fail_classroom_archive_source_object_cleanup(uuid,text,text,uuid,text)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.claim_due_classroom_archive_source_object_cleanup_v2(uuid,uuid,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role can execute source-object cleanup RPCs';
  end if;
  if has_function_privilege(
    'service_role',
    'public.claim_due_classroom_archive_source_object_cleanup(uuid,uuid,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'Service role can bypass the source-object ownership fence';
  end if;
  if has_table_privilege(
    'authenticated',
    'public.classroom_archive_source_object_cleanup',
    'SELECT'
  ) then
    raise exception 'Authenticated role can read source-object cleanup rows';
  end if;
  if has_table_privilege(
    'authenticated',
    'public.classroom_archive_source_object_reservations',
    'SELECT'
  ) then
    raise exception 'Authenticated role can read source-object reservations';
  end if;
  if has_table_privilege(
    'service_role',
    'public.classroom_archive_source_object_cleanup',
    'UPDATE'
  ) or has_table_privilege(
    'service_role',
    'public.classroom_archive_source_object_reservations',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'public.classroom_archive_source_object_reservations',
    'DELETE'
  ) then
    raise exception 'Service role can mutate source ownership evidence directly';
  end if;
end;
$security$;

rollback;
SQL

RACE_OPERATION_ID="25000000-0000-4000-8000-000000000029"
RACE_STAGING_OPERATION_ID="25000000-0000-4000-8000-000000000028"
RACE_ARCHIVE_ID="24000000-0000-4000-8000-000000000029"
RACE_CLASSROOM_ID="21000000-0000-4000-8000-000000000029"
RACE_PATH="teacher/classroom/concurrent-race.txt"
RACE_STORAGE_PATH="zz-unreserved-canary-path.txt"
RACE_STAGING_PATH="zzzz-concurrent-staging-path.txt"
RACE_OUTPUT="$(mktemp)"

cleanup_race_fixture() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
    -v operation_id="$RACE_OPERATION_ID" \
    -v staging_operation_id="$RACE_STAGING_OPERATION_ID" \
    -v archive_id="$RACE_ARCHIVE_ID" \
    -v classroom_id="$RACE_CLASSROOM_ID" \
    -v storage_path="$RACE_PATH" \
    -v storage_race_path="$RACE_STORAGE_PATH" \
    -v staging_race_path="$RACE_STAGING_PATH" >/dev/null <<'SQL'
delete from public.classroom_cold_tombstones where classroom_id = :'classroom_id'::uuid;
delete from public.classroom_archive_source_object_cleanup
where operation_id in (:'operation_id'::uuid, :'staging_operation_id'::uuid);
delete from public.classroom_archives where id = :'archive_id'::uuid;
delete from public.classroom_archive_operations where id = :'operation_id'::uuid;
delete from public.classroom_archive_operations where id = :'staging_operation_id'::uuid;
delete from public.classroom_archive_source_object_reservations
where storage_bucket = 'assignment-artifacts'
  and storage_path_sha256 in (
    public.classroom_archive_source_object_path_sha256(
      'assignment-artifacts', :'storage_path'
    ),
    public.classroom_archive_source_object_path_sha256(
      'assignment-artifacts', :'storage_race_path'
    ),
    public.classroom_archive_source_object_path_sha256(
      'assignment-artifacts', :'staging_race_path'
    )
  );
delete from public.classrooms
where id = '21000000-0000-4000-8000-000000000030'::uuid;
delete from public.users
where id in (
  '11000000-0000-4000-8000-000000000029'::uuid,
  '11000000-0000-4000-8000-000000000030'::uuid
);
SQL
  rm -f "$RACE_OUTPUT"
}
trap cleanup_race_fixture EXIT
cleanup_race_fixture

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -v operation_id="$RACE_OPERATION_ID" \
  -v staging_operation_id="$RACE_STAGING_OPERATION_ID" \
  -v archive_id="$RACE_ARCHIVE_ID" \
  -v classroom_id="$RACE_CLASSROOM_ID" \
  -v storage_path="$RACE_PATH" \
  -v storage_race_path="$RACE_STORAGE_PATH" \
  -v staging_race_path="$RACE_STAGING_PATH" <<'SQL' >/dev/null
insert into public.users (id, email, role)
values
  ('11000000-0000-4000-8000-000000000029', 'archive-race-teacher@example.test', 'teacher'),
  ('11000000-0000-4000-8000-000000000030', 'archive-race-student@example.test', 'student');

insert into public.classrooms (id, teacher_id, title, class_code)
values (
  '21000000-0000-4000-8000-000000000030',
  '11000000-0000-4000-8000-000000000029',
  'Archive ownership race hot classroom',
  'CMP029'
);

insert into public.assignments (id, classroom_id, title, description, due_at, created_by)
values (
  '22000000-0000-4000-8000-000000000029',
  '21000000-0000-4000-8000-000000000030',
  'Archive ownership race assignment',
  'Keeps the concurrent artifact write relationally valid',
  clock_timestamp() + interval '1 day',
  '11000000-0000-4000-8000-000000000029'
);

insert into public.assignment_docs (id, assignment_id, student_id, content)
values (
  '23000000-0000-4000-8000-000000000029',
  '22000000-0000-4000-8000-000000000029',
  '11000000-0000-4000-8000-000000000030',
  '{"type":"doc","content":[]}'::jsonb
);

insert into public.assignment_submission_requirements (id, assignment_id, type, label)
values (
  '27000000-0000-4000-8000-000000000029',
  '22000000-0000-4000-8000-000000000029',
  'image',
  'Archive ownership race evidence'
);

insert into public.classroom_archive_operations (
  id, teacher_id, classroom_id, operation_type, request_sha256, status,
  source_revision, source_schema_migration, source_app_commit, retention,
  archive_id, storage_bucket, storage_path, artifact_sha256, content_sha256,
  compressed_byte_size, uncompressed_byte_size, verification,
  snapshot_created_at, snapshot_expires_at, completed_at,
  source_object_cleanup_staged_at
) values (
  :'operation_id'::uuid,
  '11000000-0000-4000-8000-000000000029'::uuid,
  :'classroom_id'::uuid,
  'compact', repeat('1', 64), 'completed', 1, '096_race_fixture', 'fixture',
  '{}'::jsonb, :'archive_id'::uuid, 'classroom-archives',
  'race/archive.tar.gz', repeat('2', 64), repeat('3', 64), 1, 1,
  '{}'::jsonb, clock_timestamp() - interval '2 minutes',
  clock_timestamp() + interval '1 hour', clock_timestamp() - interval '1 minute',
  clock_timestamp() - interval '1 minute'
);
insert into public.classroom_archive_operations (
  id, teacher_id, classroom_id, operation_type, request_sha256, status,
  source_revision, source_schema_migration, source_app_commit, retention,
  archive_id, storage_bucket, storage_path, artifact_sha256, content_sha256,
  compressed_byte_size, uncompressed_byte_size, verification,
  snapshot_created_at, snapshot_expires_at
) values (
  :'staging_operation_id'::uuid,
  '11000000-0000-4000-8000-000000000029'::uuid,
  :'classroom_id'::uuid,
  'compact', repeat('6', 64), 'snapshot_ready', 1, '096_race_fixture', 'fixture',
  '{}'::jsonb, :'archive_id'::uuid, 'classroom-archives',
  'race/staging-archive.tar.gz', repeat('7', 64), repeat('8', 64), 1, 1,
  '{}'::jsonb, clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '1 hour'
);
insert into public.classroom_archives (
  id, operation_id, classroom_id, teacher_id, format, format_version,
  source_revision, source_schema_migration, source_app_commit, storage_bucket,
  storage_path, artifact_sha256, content_sha256, compressed_byte_size,
  uncompressed_byte_size, resource_counts, storage_object_counts, verification,
  retention, created_at, verified_at
) values (
  :'archive_id'::uuid, :'operation_id'::uuid, :'classroom_id'::uuid,
  '11000000-0000-4000-8000-000000000029'::uuid,
  'pika.classroom-archive', 1, 1, '096_race_fixture', 'fixture',
  'classroom-archives', 'race/archive.tar.gz', repeat('2', 64), repeat('3', 64),
  1, 1, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
  clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '1 minute'
);
insert into public.classroom_cold_tombstones (
  classroom_id, teacher_id, archive_id, title, archived_at, compacted_at,
  source_revision
) values (
  :'classroom_id'::uuid,
  '11000000-0000-4000-8000-000000000029'::uuid,
  :'archive_id'::uuid, 'Race fixture', clock_timestamp() - interval '3 minutes',
  clock_timestamp() - interval '1 minute', 1
);
insert into public.classroom_archive_source_object_cleanup (
  operation_id, archive_id, classroom_id, storage_bucket, storage_path,
  expected_sha256, expected_byte_size, status
) values
(
  :'operation_id'::uuid, :'archive_id'::uuid, :'classroom_id'::uuid,
  'assignment-artifacts', :'storage_path', repeat('4', 64), 1, 'pending'
), (
  :'operation_id'::uuid, :'archive_id'::uuid, :'classroom_id'::uuid,
  'assignment-artifacts', :'storage_race_path', repeat('5', 64), 1, 'pending'
), (
  :'operation_id'::uuid, :'archive_id'::uuid, :'classroom_id'::uuid,
  'assignment-artifacts', :'staging_race_path', repeat('9', 64), 1, 'pending'
);
SQL

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -c "begin; set local role service_role; select public.verify_and_reserve_classroom_archive_source_objects('$RACE_OPERATION_ID'::uuid, 1); select pg_sleep(3); commit;" \
  >"$RACE_OUTPUT" 2>&1 &
RACE_VERIFIER_PID=$!

for _ in {1..40}; do
  LOCK_COUNT="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
    "select count(*) from pg_locks locks join pg_stat_activity activity using (pid) where locks.locktype = 'advisory' and locks.granted and activity.query like '%verify_and_reserve_classroom_archive_source_objects%pg_sleep(3)%';")"
  [[ "$LOCK_COUNT" -gt 0 ]] && break
  sleep 0.1
done
if [[ "${LOCK_COUNT:-0}" -eq 0 ]]; then
  wait "$RACE_VERIFIER_PID" || true
  cat "$RACE_OUTPUT" >&2
  echo "Verifier did not acquire the expected advisory lock." >&2
  exit 1
fi

RACE_WRITE_OUTPUT="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -c "set statement_timeout = '10s'; insert into public.assignment_submission_artifacts (assignment_doc_id, requirement_id, student_id, type, storage_path) values ('23000000-0000-4000-8000-000000000029', '27000000-0000-4000-8000-000000000029', '11000000-0000-4000-8000-000000000030', 'image', '$RACE_PATH');" 2>&1)" && RACE_WRITE_STATUS=0 || RACE_WRITE_STATUS=$?
wait "$RACE_VERIFIER_PID"

RACE_BOUND_COUNTS="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
  "select (select count(*) from public.classroom_archive_source_object_reservations where operation_id = '$RACE_OPERATION_ID'::uuid), (select count(*) from public.classroom_archive_source_object_cleanup where operation_id = '$RACE_OPERATION_ID'::uuid and ownership_verified), (select count(*) from public.classroom_archive_source_object_cleanup where operation_id = '$RACE_OPERATION_ID'::uuid and not ownership_verified);")"

if [[ "$RACE_WRITE_STATUS" -eq 0 ]] \
  || [[ "$RACE_WRITE_OUTPUT" != *"Assignment artifact storage path is reserved"* ]]; then
  printf '%s\n' "$RACE_WRITE_OUTPUT" >&2
  echo "Concurrent hot reference write was not serialized behind the reservation." >&2
  exit 1
fi
if [[ "$RACE_BOUND_COUNTS" != "1|1|2" ]]; then
  echo "One-claim verification fenced more than one source path: $RACE_BOUND_COUNTS" >&2
  exit 1
fi

RACE_CLAIM_COUNT="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
  "select count(*) from public.claim_due_classroom_archive_source_object_cleanup_v2('26000000-0000-4000-8000-000000000039'::uuid, '$RACE_OPERATION_ID'::uuid, 1, 300);")"
if [[ "$RACE_CLAIM_COUNT" != "1" ]]; then
  echo "Relational race fixture could not claim its first bounded reservation." >&2
  exit 1
fi

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -c "begin; set local role service_role; select public.verify_and_reserve_classroom_archive_source_objects('$RACE_OPERATION_ID'::uuid, 1); select pg_sleep(3); commit;" \
  >"$RACE_OUTPUT" 2>&1 &
RACE_VERIFIER_PID=$!

LOCK_COUNT=0
for _ in {1..40}; do
  LOCK_COUNT="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
    "select count(*) from pg_locks locks join pg_stat_activity activity using (pid) where locks.locktype = 'advisory' and locks.granted and activity.query like '%verify_and_reserve_classroom_archive_source_objects%pg_sleep(3)%';")"
  [[ "$LOCK_COUNT" -gt 0 ]] && break
  sleep 0.1
done
if [[ "$LOCK_COUNT" -eq 0 ]]; then
  wait "$RACE_VERIFIER_PID" || true
  cat "$RACE_OUTPUT" >&2
  echo "Storage verifier did not acquire the expected advisory lock." >&2
  exit 1
fi

RACE_STORAGE_OUTPUT="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -c "set statement_timeout = '10s'; insert into storage.objects (bucket_id, name) values ('assignment-artifacts', '$RACE_STORAGE_PATH');" 2>&1)" && RACE_STORAGE_STATUS=0 || RACE_STORAGE_STATUS=$?
wait "$RACE_VERIFIER_PID"

RACE_FINAL_COUNTS="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
  "select (select count(*) from public.classroom_archive_source_object_reservations where operation_id = '$RACE_OPERATION_ID'::uuid), (select count(*) from public.classroom_archive_source_object_cleanup where operation_id = '$RACE_OPERATION_ID'::uuid and ownership_verified), (select count(*) from public.classroom_archive_source_object_cleanup where operation_id = '$RACE_OPERATION_ID'::uuid and not ownership_verified);")"
if [[ "$RACE_STORAGE_STATUS" -eq 0 ]] \
  || [[ "$RACE_STORAGE_OUTPUT" != *"Storage path is reserved by a classroom archive"* ]]; then
  printf '%s\n' "$RACE_STORAGE_OUTPUT" >&2
  echo "Concurrent Storage write was not serialized behind the reservation." >&2
  exit 1
fi
if [[ "$RACE_FINAL_COUNTS" != "2|2|1" ]]; then
  echo "Bounded Storage-race verification produced unexpected evidence: $RACE_FINAL_COUNTS" >&2
  exit 1
fi

RACE_SECOND_CLAIM_COUNT="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
  "select count(*) from public.claim_due_classroom_archive_source_object_cleanup_v2('26000000-0000-4000-8000-000000000038'::uuid, '$RACE_OPERATION_ID'::uuid, 1, 300);")"
if [[ "$RACE_SECOND_CLAIM_COUNT" != "1" ]]; then
  echo "Storage race fixture could not claim its bounded reservation." >&2
  exit 1
fi

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -c "begin; set local role service_role; select public.verify_and_reserve_classroom_archive_source_objects('$RACE_OPERATION_ID'::uuid, 1); select pg_sleep(3); commit;" \
  >"$RACE_OUTPUT" 2>&1 &
RACE_VERIFIER_PID=$!

LOCK_COUNT=0
for _ in {1..40}; do
  LOCK_COUNT="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
    "select count(*) from pg_locks locks join pg_stat_activity activity using (pid) where locks.locktype = 'advisory' and locks.granted and activity.query like '%verify_and_reserve_classroom_archive_source_objects%pg_sleep(3)%';")"
  [[ "$LOCK_COUNT" -gt 0 ]] && break
  sleep 0.1
done
if [[ "$LOCK_COUNT" -eq 0 ]]; then
  wait "$RACE_VERIFIER_PID" || true
  cat "$RACE_OUTPUT" >&2
  echo "Staging verifier did not acquire the expected advisory lock." >&2
  exit 1
fi

RACE_STAGING_OUTPUT="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -c "set statement_timeout = '10s'; select public.stage_classroom_archive_compaction_objects('$RACE_STAGING_OPERATION_ID'::uuid, '11000000-0000-4000-8000-000000000029'::uuid, jsonb_build_array(jsonb_build_object('storage_bucket', 'assignment-artifacts', 'storage_path', '$RACE_STAGING_PATH', 'sha256', repeat('a', 64), 'byte_size', 1)));" 2>&1)" && RACE_STAGING_STATUS=0 || RACE_STAGING_STATUS=$?
wait "$RACE_VERIFIER_PID"

RACE_STAGING_COUNTS="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -Atc \
  "select (select count(*) from public.classroom_archive_source_object_reservations where operation_id = '$RACE_OPERATION_ID'::uuid), (select count(*) from public.classroom_archive_source_object_cleanup where operation_id = '$RACE_OPERATION_ID'::uuid and ownership_verified), (select count(*) from public.classroom_archive_source_object_cleanup where operation_id = '$RACE_STAGING_OPERATION_ID'::uuid);")"
if [[ "$RACE_STAGING_STATUS" -eq 0 ]] \
  || [[ "$RACE_STAGING_OUTPUT" != *"Classroom archive source cleanup path is already reserved"* ]]; then
  printf '%s\n' "$RACE_STAGING_OUTPUT" >&2
  echo "Concurrent cleanup staging was not serialized behind the reservation." >&2
  exit 1
fi
if [[ "$RACE_STAGING_COUNTS" != "3|3|0" ]]; then
  echo "Concurrent staging race produced unexpected evidence: $RACE_STAGING_COUNTS" >&2
  exit 1
fi

echo "Classroom archive compaction database contract passed."
