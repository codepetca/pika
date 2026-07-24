-- Activate direct classroom archive-v2 snapshots.
--
-- Existing Quiz rows and Quiz-format draft/envelope payloads are intentionally
-- disposable. This migration removes those preserved payloads and makes the
-- live archive registry use the version-2 graph. It does not drop the legacy
-- source tables; that remains a separately reviewed destructive migration.

begin;

set local timezone = 'UTC';
set local lock_timeout = '5s';

lock table
  public.classroom_archive_operations,
  public.classroom_archive_snapshot_resources,
  public.classroom_archive_snapshot_actors,
  public.classroom_archive_resource_contract
in access exclusive mode;

do $active_operation_guard$
begin
  if exists (
    select 1
    from public.classroom_archive_operations
    where snapshot_expires_at > clock_timestamp()
      and operation_type in ('export', 'restore', 'compact')
      and (
        status = 'snapshot_ready'
        or (status = 'failed' and retryable is true)
      )
  ) then
    raise exception 'Cannot activate archive-v2 while an archive operation is active'
      using errcode = '55006';
  end if;
end;
$active_operation_guard$;

create or replace function private.reject_legacy_quiz_source_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('pika.classroom_archive_compaction', true) = 'on'
    and tg_op = 'DELETE'
  then
    return old;
  end if;

  if tg_table_name = 'assessment_drafts' and tg_op <> 'TRUNCATE' then
    if tg_op = 'INSERT' and new.assessment_type <> 'quiz' then
      return new;
    end if;
    if tg_op = 'UPDATE'
      and old.assessment_type <> 'quiz'
      and new.assessment_type <> 'quiz'
    then
      return new;
    end if;
    if tg_op = 'DELETE' and old.assessment_type <> 'quiz' then
      return old;
    end if;
  end if;

  raise exception 'Legacy Quiz source is frozen: %.% %',
    tg_table_schema, tg_table_name, tg_op
    using errcode = '0A000';
end;
$$;

select set_config('pika.classroom_archive_compaction', 'on', true);

delete from public.quiz_responses;
delete from public.quiz_student_scores;
delete from public.quiz_questions;
delete from public.quizzes;

drop trigger if exists freeze_legacy_quiz_drafts on public.assessment_drafts;
drop trigger if exists freeze_legacy_quiz_drafts_truncate on public.assessment_drafts;

delete from public.assessment_drafts
where assessment_type = 'quiz';

alter table public.assessment_drafts
  drop constraint if exists assessment_drafts_assessment_type_check;
alter table public.assessment_drafts
  add constraint assessment_drafts_assessment_type_check
  check (assessment_type = 'test');

delete from public.classroom_retired_assessment_records
where source_contract = 'pika.classroom-archive@1/legacy-quiz';

update public.classroom_archive_resource_contract
set export_position = export_position + 1000;

insert into public.classroom_archive_resource_contract (
  table_name,
  primary_key_columns,
  parent_table,
  parent_column,
  actor_columns,
  restore_after,
  export_position
)
select
  table_name,
  primary_key_columns,
  parent_table,
  parent_column,
  actor_columns,
  restore_after,
  export_position
from public.classroom_archive_resource_contract_versions
where format_version = 2
order by export_position
on conflict (table_name) do update
set
  primary_key_columns = excluded.primary_key_columns,
  parent_table = excluded.parent_table,
  parent_column = excluded.parent_column,
  actor_columns = excluded.actor_columns,
  restore_after = excluded.restore_after,
  export_position = excluded.export_position;

delete from public.classroom_archive_resource_contract live_contract
where not exists (
  select 1
  from public.classroom_archive_resource_contract_versions versioned_contract
  where versioned_contract.format_version = 2
    and versioned_contract.table_name = live_contract.table_name
);

comment on table public.classroom_archive_resource_contract is
  'Live classroom archive resource graph. Migration 107 promotes this compatibility registry to format version 2.';

create or replace function public.begin_classroom_archive_export_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_request_sha256 text,
  p_source_schema_migration text,
  p_source_app_commit text,
  p_retention jsonb,
  p_source_contract_version integer,
  p_archive_format_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.classroom_archive_operations;
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_revision bigint;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_source_contract_version <> 2
    or p_archive_format_version <> 2
  then
    raise exception 'Unsupported classroom archive export contract transition'
      using errcode = '22023';
  end if;
  if p_request_sha256 !~ '^[a-f0-9]{64}$'
    or p_source_schema_migration !~ '^\d{3}(?:_[a-z0-9_]+)?$'
    or p_source_app_commit !~ '^[a-f0-9]{7,40}$'
  then
    raise exception 'Invalid classroom archive-v2 source request'
      using errcode = '22023';
  end if;
  if p_retention is null
    or jsonb_typeof(p_retention) <> 'object'
    or coalesce(p_retention->>'mode', '') not in ('teacher_managed', 'scheduled')
    or p_retention - 'mode' - 'delete_after' <> '{}'::jsonb
    or (
      p_retention->>'mode' = 'teacher_managed'
      and p_retention->'delete_after' is distinct from 'null'::jsonb
    )
    or (
      p_retention->>'mode' = 'scheduled'
      and (
        jsonb_typeof(p_retention->'delete_after') is distinct from 'string'
        or (p_retention->>'delete_after')::timestamptz <= v_now
      )
    )
  then
    raise exception 'Invalid classroom archive retention policy'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  if v_operation.id is not null
    and (
      v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.operation_type <> 'export'
      or v_operation.request_sha256 <> p_request_sha256
      or v_operation.source_contract_version <> p_source_contract_version
      or v_operation.archive_format_version <> p_archive_format_version
    )
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'idempotency_conflict',
      'error', 'Idempotency key was already used for another archive contract',
      'retryable', false
    );
  end if;

  if v_operation.id is null then
    select classroom.teacher_id, classroom.archived_at, revision.revision
    into v_teacher_id, v_archived_at, v_revision
    from public.classrooms classroom
    join public.classroom_archive_revisions revision
      on revision.classroom_id = classroom.id
    where classroom.id = p_classroom_id
    for share of revision;

    if v_teacher_id is null then
      return jsonb_build_object(
        'ok', false,
        'status', 404,
        'operation_id', p_operation_id,
        'error_code', 'classroom_not_found',
        'error', 'Classroom not found',
        'retryable', false
      );
    end if;
    if v_teacher_id <> p_teacher_id then
      return jsonb_build_object(
        'ok', false,
        'status', 403,
        'operation_id', p_operation_id,
        'error_code', 'classroom_forbidden',
        'error', 'Forbidden',
        'retryable', false
      );
    end if;
    if v_archived_at is null then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'classroom_not_archived',
        'error', 'Classroom must be archived before export',
        'retryable', false
      );
    end if;

    insert into public.classroom_archive_operations (
      id,
      teacher_id,
      classroom_id,
      operation_type,
      request_sha256,
      status,
      source_revision,
      source_schema_migration,
      source_app_commit,
      retention,
      archive_id,
      snapshot_created_at,
      snapshot_expires_at,
      source_contract_version,
      archive_format_version,
      restore_contract_version
    )
    values (
      p_operation_id,
      p_teacher_id,
      p_classroom_id,
      'export',
      p_request_sha256,
      'snapshot_ready',
      v_revision,
      p_source_schema_migration,
      p_source_app_commit,
      p_retention,
      p_operation_id,
      v_now,
      v_now + interval '24 hours',
      p_source_contract_version,
      p_archive_format_version,
      p_archive_format_version
    )
    on conflict (id) do nothing;
  end if;

  v_result := private.begin_classroom_archive_export_v082(
    p_operation_id,
    p_teacher_id,
    p_classroom_id,
    p_request_sha256,
    p_source_schema_migration,
    p_source_app_commit,
    p_retention
  );

  if coalesce((v_result->>'ok')::boolean, false) is true then
    update public.classroom_archive_operations
    set
      source_contract_version = p_source_contract_version,
      archive_format_version = p_archive_format_version,
      restore_contract_version = p_archive_format_version,
      source_resource_counts = resource_counts,
      updated_at = clock_timestamp()
    where id = p_operation_id
      and operation_type = 'export';

    v_result := v_result || jsonb_build_object(
      'source_contract_version', p_source_contract_version,
      'archive_format_version', p_archive_format_version
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.stage_classroom_archive_object_upload_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_expected_sha256 text,
  p_expected_byte_size bigint,
  p_archive_format_version integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.classroom_archive_operations;
  v_upload public.classroom_archive_object_upload_cleanup;
begin
  if p_archive_format_version <> 2
    or p_storage_bucket is null
    or p_storage_bucket <> 'classroom-archives'
    or p_storage_path is null
    or p_storage_path = ''
    or p_storage_path like '/%'
    or strpos(p_storage_path, E'\\') > 0
    or exists (
      select 1
      from regexp_split_to_table(p_storage_path, '/') path_segment(value)
      where path_segment.value in ('', '.', '..')
    )
    or p_expected_sha256 is null
    or p_expected_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_byte_size is null
    or p_expected_byte_size < 0
  then
    raise exception 'Invalid classroom archive-v2 object upload intent'
      using errcode = '22023';
  end if;

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
    and teacher_id = p_teacher_id
    and operation_type = 'export'
  for update;

  if v_operation.id is null
    or v_operation.status <> 'snapshot_ready'
    or v_operation.snapshot_expires_at <= clock_timestamp()
    or v_operation.source_contract_version <> 2
    or v_operation.archive_format_version <> p_archive_format_version
    or p_storage_path <> format(
      '%s/%s/%s/classroom-v2.tar.gz',
      v_operation.teacher_id,
      v_operation.classroom_id,
      v_operation.archive_id
    )
  then
    return false;
  end if;

  insert into public.classroom_archive_object_upload_cleanup (
    operation_id,
    storage_bucket,
    storage_path,
    expected_sha256,
    expected_byte_size
  )
  values (
    p_operation_id,
    p_storage_bucket,
    p_storage_path,
    p_expected_sha256,
    p_expected_byte_size
  )
  on conflict (operation_id, storage_bucket, storage_path) do nothing;

  select * into v_upload
  from public.classroom_archive_object_upload_cleanup
  where operation_id = p_operation_id
    and storage_bucket = p_storage_bucket
    and storage_path = p_storage_path;

  return v_upload.expected_sha256 = p_expected_sha256
    and v_upload.expected_byte_size = p_expected_byte_size
    and v_upload.status = 'staged';
end;
$$;

create or replace function public.complete_classroom_archive_export_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_artifact_sha256 text,
  p_content_sha256 text,
  p_compressed_byte_size bigint,
  p_uncompressed_byte_size bigint,
  p_resource_counts jsonb,
  p_archive_format_version integer,
  p_archive_resource_counts jsonb,
  p_storage_object_counts jsonb,
  p_verification jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.classroom_archive_operations;
  v_current_revision bigint;
  v_resource record;
  v_expected_count integer;
  v_current_count integer;
  v_contract_count integer;
  v_resource_count_key_count integer;
  v_count_key text;
  v_count_value jsonb;
  v_verified_at timestamptz := clock_timestamp();
begin
  if p_archive_format_version <> 2 then
    raise exception 'Unsupported classroom archive format version'
      using errcode = '22023';
  end if;

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null or v_operation.teacher_id <> p_teacher_id then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'error_code', 'archive_operation_not_found',
      'error', 'Archive operation not found',
      'retryable', false
    );
  end if;
  if v_operation.source_contract_version <> 2
    or v_operation.archive_format_version <> p_archive_format_version
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'archive_contract_mismatch',
      'error', 'Archive operation contract does not match finalization',
      'retryable', false
    );
  end if;
  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'ok', true,
      'status', 200,
      'operation_id', p_operation_id,
      'archive_id', v_operation.archive_id,
      'operation_status', 'completed',
      'replayed', true,
      'storage_bucket', v_operation.storage_bucket,
      'storage_path', v_operation.storage_path,
      'artifact_sha256', v_operation.artifact_sha256,
      'content_sha256', v_operation.content_sha256,
      'compressed_byte_size', v_operation.compressed_byte_size,
      'uncompressed_byte_size', v_operation.uncompressed_byte_size,
      'resource_counts', v_operation.resource_counts,
      'storage_object_counts', v_operation.storage_object_counts,
      'verification', v_operation.verification,
      'source_contract_version', v_operation.source_contract_version,
      'archive_format_version', v_operation.archive_format_version
    );
  end if;
  if v_operation.status <> 'snapshot_ready' then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', coalesce(v_operation.error_code, 'archive_snapshot_not_ready'),
      'error', 'Archive snapshot is not ready',
      'retryable', coalesce(v_operation.retryable, false)
    );
  end if;
  if v_operation.snapshot_expires_at <= v_verified_at then
    update public.classroom_archive_operations
    set
      status = 'failed',
      error_code = 'archive_snapshot_expired',
      retryable = false,
      updated_at = v_verified_at
    where id = p_operation_id;
    delete from public.classroom_archive_snapshot_resources
    where operation_id = p_operation_id;
    delete from public.classroom_archive_snapshot_actors
    where operation_id = p_operation_id;
    update public.classroom_archive_object_upload_cleanup
    set
      status = 'pending',
      next_attempt_at = v_verified_at,
      updated_at = v_verified_at
    where operation_id = p_operation_id
      and status = 'staged';
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'archive_snapshot_expired',
      'error', 'Archive snapshot expired before verification',
      'retryable', false
    );
  end if;

  if p_storage_bucket <> 'classroom-archives'
    or p_storage_path <> format(
      '%s/%s/%s/classroom-v2.tar.gz',
      v_operation.teacher_id,
      v_operation.classroom_id,
      v_operation.archive_id
    )
    or p_artifact_sha256 !~ '^[a-f0-9]{64}$'
    or p_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_compressed_byte_size <= 0
    or p_compressed_byte_size > 52428800
    or p_uncompressed_byte_size <= 0
  then
    raise exception 'Invalid classroom archive-v2 artifact metadata'
      using errcode = '22023';
  end if;

  if p_resource_counts is distinct from v_operation.source_resource_counts
    or p_archive_resource_counts is distinct from p_resource_counts
  then
    raise exception 'Direct archive-v2 counts do not match the snapshot'
      using errcode = '22023';
  end if;

  select count(*) into v_contract_count
  from public.classroom_archive_resource_contract_versions
  where format_version = p_archive_format_version;
  select count(*) into v_resource_count_key_count
  from jsonb_object_keys(p_archive_resource_counts);
  if p_archive_resource_counts is null
    or jsonb_typeof(p_archive_resource_counts) <> 'object'
    or v_resource_count_key_count <> v_contract_count
    or exists (
      select 1
      from public.classroom_archive_resource_contract_versions contract
      where contract.format_version = p_archive_format_version
        and not p_archive_resource_counts ? contract.table_name
    )
  then
    raise exception 'Archive resource counts do not match the versioned contract'
      using errcode = '22023';
  end if;
  for v_count_key, v_count_value in
    select key, value from jsonb_each(p_archive_resource_counts)
  loop
    if jsonb_typeof(v_count_value) <> 'number'
      or (v_count_value #>> '{}') !~ '^\d+$'
      or (v_count_value #>> '{}')::numeric > 2147483647
    then
      raise exception 'Invalid archive resource count for %', v_count_key
        using errcode = '22023';
    end if;
  end loop;
  if (p_archive_resource_counts->>'classrooms')::integer <> 1 then
    raise exception 'Archive must contain exactly one classroom root'
      using errcode = '22023';
  end if;

  if coalesce((p_verification->>'read_back_verified')::boolean, false) is not true
    or coalesce((p_verification->>'artifact_checksum_verified')::boolean, false) is not true
    or coalesce((p_verification->>'manifest_verified')::boolean, false) is not true
    or coalesce((p_verification->>'resource_checksums_verified')::boolean, false) is not true
    or coalesce((p_verification->>'resource_counts_verified')::boolean, false) is not true
    or coalesce((p_verification->>'storage_objects_verified')::boolean, false) is not true
    or coalesce((p_verification->>'actor_snapshots_verified')::boolean, false) is not true
  then
    raise exception 'Classroom archive verification evidence is incomplete'
      using errcode = '22023';
  end if;

  select revision
  into v_current_revision
  from public.classroom_archive_revisions
  where classroom_id = v_operation.classroom_id
  for share;

  if v_current_revision is null
    or v_current_revision <> v_operation.source_revision
  then
    update public.classroom_archive_operations
    set
      status = 'failed',
      error_code = 'classroom_changed_during_export',
      retryable = false,
      updated_at = v_verified_at
    where id = p_operation_id;
    delete from public.classroom_archive_snapshot_resources
    where operation_id = p_operation_id;
    delete from public.classroom_archive_snapshot_actors
    where operation_id = p_operation_id;
    update public.classroom_archive_object_upload_cleanup
    set
      status = 'pending',
      next_attempt_at = v_verified_at,
      updated_at = v_verified_at
    where operation_id = p_operation_id
      and status = 'staged';
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_changed_during_export',
      'error', 'Classroom data changed during archive export',
      'retryable', false
    );
  end if;

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract_versions
    where format_version = v_operation.source_contract_version
    order by export_position
  loop
    v_expected_count := coalesce(
      (p_resource_counts->>v_resource.table_name)::integer,
      0
    );
    execute format(
      'select count(*)::integer
       from public.classroom_archive_snapshot_resources snapshot
       join public.%I source on source.%I = snapshot.row_id
       where snapshot.operation_id = $1
         and snapshot.source_contract_version = $2
         and snapshot.table_name = $3',
      v_resource.table_name,
      v_resource.primary_key_column
    )
    into v_current_count
    using
      p_operation_id,
      v_operation.source_contract_version,
      v_resource.table_name;

    if v_current_count <> v_expected_count then
      raise exception 'Classroom archive source count changed for %', v_resource.table_name
        using errcode = '40001';
    end if;
  end loop;

  if not exists (
    select 1
    from public.classroom_archive_object_upload_cleanup upload
    where upload.operation_id = p_operation_id
      and upload.storage_bucket = p_storage_bucket
      and upload.storage_path = p_storage_path
      and upload.expected_sha256 = p_artifact_sha256
      and upload.expected_byte_size = p_compressed_byte_size
      and upload.status = 'staged'
  ) then
    raise exception 'Classroom archive upload intent is missing during finalization'
      using errcode = '40001';
  end if;

  insert into public.classroom_archives (
    id,
    operation_id,
    classroom_id,
    teacher_id,
    format,
    format_version,
    source_revision,
    source_schema_migration,
    source_app_commit,
    storage_bucket,
    storage_path,
    artifact_sha256,
    content_sha256,
    compressed_byte_size,
    uncompressed_byte_size,
    resource_counts,
    storage_object_counts,
    verification,
    retention,
    created_at,
    verified_at
  )
  values (
    v_operation.archive_id,
    p_operation_id,
    v_operation.classroom_id,
    v_operation.teacher_id,
    'pika.classroom-archive',
    p_archive_format_version,
    v_operation.source_revision,
    v_operation.source_schema_migration,
    v_operation.source_app_commit,
    p_storage_bucket,
    p_storage_path,
    p_artifact_sha256,
    p_content_sha256,
    p_compressed_byte_size,
    p_uncompressed_byte_size,
    p_archive_resource_counts,
    p_storage_object_counts,
    p_verification,
    v_operation.retention,
    v_operation.snapshot_created_at,
    v_verified_at
  )
  on conflict (id) do nothing;

  update public.classroom_archive_operations
  set
    status = 'completed',
    storage_bucket = p_storage_bucket,
    storage_path = p_storage_path,
    artifact_sha256 = p_artifact_sha256,
    content_sha256 = p_content_sha256,
    compressed_byte_size = p_compressed_byte_size,
    uncompressed_byte_size = p_uncompressed_byte_size,
    source_resource_counts = p_resource_counts,
    resource_counts = p_archive_resource_counts,
    storage_object_counts = p_storage_object_counts,
    verification = p_verification,
    error_code = null,
    retryable = null,
    completed_at = v_verified_at,
    updated_at = v_verified_at
  where id = p_operation_id;

  delete from public.classroom_archive_snapshot_resources
  where operation_id = p_operation_id;
  delete from public.classroom_archive_snapshot_actors
  where operation_id = p_operation_id;
  delete from public.classroom_archive_object_upload_cleanup
  where operation_id = p_operation_id;

  return jsonb_build_object(
    'ok', true,
    'status', 201,
    'operation_id', p_operation_id,
    'archive_id', v_operation.archive_id,
    'operation_status', 'completed',
    'replayed', false,
    'storage_bucket', p_storage_bucket,
    'storage_path', p_storage_path,
    'artifact_sha256', p_artifact_sha256,
    'content_sha256', p_content_sha256,
    'compressed_byte_size', p_compressed_byte_size,
    'uncompressed_byte_size', p_uncompressed_byte_size,
    'resource_counts', p_archive_resource_counts,
    'storage_object_counts', p_storage_object_counts,
    'verification', p_verification,
    'source_contract_version', v_operation.source_contract_version,
    'archive_format_version', p_archive_format_version
  );
end;
$$;

create or replace function public.begin_classroom_archive_compaction_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_archive_id uuid,
  p_request_sha256 text,
  p_restore_contract_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.classroom_archive_operations;
  v_archive_format_version integer;
  v_result jsonb;
begin
  if p_restore_contract_version <> 2 then
    raise exception 'Unsupported classroom archive compaction contract'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  if v_operation.id is not null
    and (
      v_operation.source_contract_version <> 2
      or v_operation.archive_format_version <> 2
      or v_operation.restore_contract_version <> p_restore_contract_version
    )
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'idempotency_conflict',
      'error', 'Idempotency key was already used for another compaction contract',
      'retryable', false
    );
  end if;

  select archive.format_version
  into v_archive_format_version
  from public.classroom_archives archive
  where archive.id = p_archive_id
    and archive.teacher_id = p_teacher_id
    and archive.classroom_id = p_classroom_id;

  if v_archive_format_version is not null
    and v_archive_format_version <> 2
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_reexport_required',
      'error', 'Classroom must be re-exported with archive-v2 before compaction',
      'retryable', false
    );
  end if;

  v_result := public.begin_classroom_archive_compaction(
    p_operation_id,
    p_teacher_id,
    p_classroom_id,
    p_archive_id,
    p_request_sha256
  );

  if coalesce((v_result->>'ok')::boolean, false) is true then
    update public.classroom_archive_operations
    set
      source_contract_version = 2,
      archive_format_version = 2,
      restore_contract_version = p_restore_contract_version,
      source_resource_counts = resource_counts,
      updated_at = clock_timestamp()
    where id = p_operation_id
      and operation_type = 'compact';

    v_result := v_result || jsonb_build_object(
      'source_contract_version', 2,
      'archive_format_version', 2,
      'restore_contract_version', p_restore_contract_version
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.complete_classroom_archive_compaction_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_actors jsonb,
  p_verification jsonb,
  p_restore_contract_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  v_operation public.classroom_archive_operations;
  v_result jsonb;
begin
  if p_restore_contract_version <> 2 then
    raise exception 'Unsupported classroom archive compaction contract'
      using errcode = '22023';
  end if;

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  if v_operation.id is not null
    and (
      v_operation.source_contract_version <> 2
      or v_operation.archive_format_version <> 2
      or v_operation.restore_contract_version <> p_restore_contract_version
    )
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'archive_contract_mismatch',
      'error', 'Compaction operation contract does not match finalization',
      'retryable', false
    );
  end if;

  v_result := public.complete_classroom_archive_compaction(
    p_operation_id,
    p_teacher_id,
    p_actors,
    p_verification
  );

  if coalesce((v_result->>'ok')::boolean, false) is true then
    v_result := v_result || jsonb_build_object(
      'source_contract_version', 2,
      'archive_format_version', 2,
      'restore_contract_version', p_restore_contract_version
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.stage_classroom_archive_restore_rows(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_table_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restore_contract_version integer;
  v_operation_type text;
begin
  select restore_contract_version, operation_type
  into v_restore_contract_version, v_operation_type
  from public.classroom_archive_operations
  where id = p_operation_id
    and teacher_id = p_teacher_id;

  if v_restore_contract_version = 1 then
    return private.stage_classroom_archive_restore_rows_v094(
      p_operation_id,
      p_teacher_id,
      p_table_name,
      p_rows
    );
  end if;
  if v_restore_contract_version = 2
    and v_operation_type = 'compact'
  then
    return private.stage_classroom_archive_restore_rows_v094(
      p_operation_id,
      p_teacher_id,
      p_table_name,
      p_rows
    );
  end if;
  if v_restore_contract_version = 2 then
    return public.stage_classroom_archive_restore_rows_v2(
      p_operation_id,
      p_teacher_id,
      p_table_name,
      p_rows,
      v_restore_contract_version
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'status', 404,
    'operation_id', p_operation_id,
    'error_code', 'restore_operation_not_found',
    'error', 'Restore operation not found',
    'retryable', false
  );
end;
$$;

revoke all on function public.begin_classroom_archive_compaction_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  integer
) from public, anon, authenticated;
grant execute on function public.begin_classroom_archive_compaction_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  integer
) to service_role;

revoke all on function public.complete_classroom_archive_compaction_v2(
  uuid,
  uuid,
  jsonb,
  jsonb,
  integer
) from public, anon, authenticated;
grant execute on function public.complete_classroom_archive_compaction_v2(
  uuid,
  uuid,
  jsonb,
  jsonb,
  integer
) to service_role;

comment on function public.begin_classroom_archive_compaction_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  integer
) is
  'Begins archive-v2-only hot-to-cold compaction. V1 archives must be re-exported before compaction.';
comment on function public.complete_classroom_archive_compaction_v2(
  uuid,
  uuid,
  jsonb,
  jsonb,
  integer
) is
  'Finalizes archive-v2-only hot-to-cold compaction against restore contract 2.';

commit;
