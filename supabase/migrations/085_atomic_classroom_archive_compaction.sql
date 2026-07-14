-- Atomic archived-hot to archived-cold transition. This migration defines no app route or caller.

alter table public.classroom_archive_operations
  add column if not exists source_object_cleanup_staged_at timestamptz;

alter table public.classroom_archive_operations
  drop constraint if exists classroom_archive_operations_compaction_contract_check;
alter table public.classroom_archive_operations
  add constraint classroom_archive_operations_compaction_contract_check check (
    operation_type <> 'compact'
    or (
      archive_id is not null
      and storage_bucket = 'classroom-archives'
      and storage_path is not null
      and artifact_sha256 ~ '^[a-f0-9]{64}$'
      and content_sha256 ~ '^[a-f0-9]{64}$'
      and compressed_byte_size > 0
      and uncompressed_byte_size > 0
    )
  );

create table if not exists public.classroom_archive_source_object_cleanup (
  operation_id uuid not null references public.classroom_archive_operations (id) on delete cascade,
  archive_id uuid not null references public.classroom_archives (id),
  classroom_id uuid not null,
  storage_bucket text not null check (storage_bucket in (
    'assignment-artifacts',
    'submission-images',
    'test-documents'
  )),
  storage_path text not null check (length(storage_path) > 0),
  expected_sha256 text not null check (expected_sha256 ~ '^[a-f0-9]{64}$'),
  expected_byte_size bigint not null check (expected_byte_size >= 0),
  status text not null default 'staged' check (status in ('staged', 'pending', 'deleted')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (operation_id, storage_bucket, storage_path),
  check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  ),
  check (
    (status in ('staged', 'pending') and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
  )
);

create index if not exists idx_classroom_archive_source_object_cleanup_due
  on public.classroom_archive_source_object_cleanup (status, next_attempt_at, created_at)
  where status = 'pending';

alter table public.classroom_archive_source_object_cleanup enable row level security;

-- Compaction owns the revision lock, so trigger-side revision churn is unnecessary while deleting.
create or replace function public.bump_classroom_archive_revision_from_resource()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent_table text := tg_argv[0];
  v_parent_column text := tg_argv[1];
  v_old_parent_id uuid;
  v_new_parent_id uuid;
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if current_setting('pika.classroom_archive_restore', true) = 'on'
    or current_setting('pika.classroom_archive_compaction', true) = 'on'
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    v_old_parent_id := nullif(to_jsonb(old)->>v_parent_column, '')::uuid;
    v_old_classroom_id := public.resolve_classroom_archive_resource_classroom_id(
      v_parent_table, v_old_parent_id
    );
  end if;
  if tg_op <> 'DELETE' then
    v_new_parent_id := nullif(to_jsonb(new)->>v_parent_column, '')::uuid;
    v_new_classroom_id := public.resolve_classroom_archive_resource_classroom_id(
      v_parent_table, v_new_parent_id
    );
  end if;
  update public.classroom_archive_revisions
  set revision = revision + 1, updated_at = now()
  where classroom_id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classroom_archive_revisions
    set revision = revision + 1, updated_at = now()
    where classroom_id = v_new_classroom_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.fail_classroom_archive_compaction(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_error_code text,
  p_retryable boolean
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_updated boolean;
begin
  if p_error_code !~ '^[a-z0-9_]{3,80}$' then
    raise exception 'Invalid classroom archive compaction error code'
      using errcode = '22023';
  end if;
  update public.classroom_archive_operations
  set
    status = 'failed',
    error_code = p_error_code,
    retryable = p_retryable,
    source_object_cleanup_staged_at = case
      when p_retryable then source_object_cleanup_staged_at
      else null
    end,
    updated_at = clock_timestamp()
  where id = p_operation_id
    and teacher_id = p_teacher_id
    and operation_type = 'compact'
    and status <> 'completed';
  v_updated := found;
  if v_updated and not p_retryable then
    delete from public.classroom_archive_source_object_cleanup where operation_id = p_operation_id;
  end if;
  return v_updated;
end;
$$;

create or replace function public.cleanup_expired_classroom_archive_snapshots()
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_operation_ids uuid[];
begin
  with expired as (
    update public.classroom_archive_operations
    set
      status = 'failed',
      error_code = 'archive_snapshot_expired',
      retryable = false,
      source_object_cleanup_staged_at = null,
      updated_at = clock_timestamp()
    where status <> 'completed'
      and snapshot_expires_at <= now()
    returning id
  )
  select coalesce(array_agg(id), array[]::uuid[])
  into v_operation_ids
  from expired;

  delete from public.classroom_archive_snapshot_resources
  where operation_id = any(v_operation_ids);
  delete from public.classroom_archive_snapshot_actors
  where operation_id = any(v_operation_ids);
  delete from public.classroom_archive_restore_staging
  where operation_id = any(v_operation_ids);
  delete from public.classroom_archive_source_object_cleanup
  where operation_id = any(v_operation_ids);
  return cardinality(v_operation_ids);
end;
$$;

create or replace function public.stage_classroom_archive_compaction_objects(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_objects jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_object jsonb;
  v_existing public.classroom_archive_source_object_cleanup;
  v_bucket text;
  v_path text;
  v_sha256 text;
  v_byte_size bigint;
  v_count integer;
  v_bytes bigint;
begin
  if p_operation_id is null
    or p_teacher_id is null
    or p_objects is null
    or jsonb_typeof(p_objects) <> 'array'
    or jsonb_array_length(p_objects) > 500
    or pg_column_size(p_objects) > 1048576
  then
    raise exception 'Invalid classroom archive compaction object batch'
      using errcode = '22023';
  end if;

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;
  if v_operation.id is null
    or v_operation.teacher_id <> p_teacher_id
    or v_operation.operation_type <> 'compact'
  then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'operation_id', p_operation_id,
      'error_code', 'compaction_operation_not_found',
      'error', 'Compaction operation not found', 'retryable', false
    );
  end if;
  if v_operation.status <> 'snapshot_ready'
    or v_operation.snapshot_expires_at <= clock_timestamp()
  then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'operation_id', p_operation_id,
      'error_code', 'compaction_not_ready',
      'error', 'Compaction operation is not available for staging', 'retryable', false
    );
  end if;

  for v_object in select value from jsonb_array_elements(p_objects)
  loop
    if jsonb_typeof(v_object) <> 'object'
      or not (v_object ?& array['storage_bucket', 'storage_path', 'sha256', 'byte_size'])
      or v_object - 'storage_bucket' - 'storage_path' - 'sha256' - 'byte_size' <> '{}'::jsonb
      or jsonb_typeof(v_object->'storage_bucket') <> 'string'
      or jsonb_typeof(v_object->'storage_path') <> 'string'
      or jsonb_typeof(v_object->'sha256') <> 'string'
      or jsonb_typeof(v_object->'byte_size') <> 'number'
      or (v_object->>'byte_size') !~ '^\d+$'
      or (v_object->>'byte_size')::numeric > 9223372036854775807
    then
      raise exception 'Invalid classroom archive compaction object'
        using errcode = '22023';
    end if;
    v_bucket := v_object->>'storage_bucket';
    v_path := v_object->>'storage_path';
    v_sha256 := v_object->>'sha256';
    v_byte_size := (v_object->>'byte_size')::bigint;
    if v_bucket not in ('assignment-artifacts', 'submission-images', 'test-documents')
      or v_path = ''
      or left(v_path, 1) = '/'
      or position(E'\\' in v_path) > 0
      or exists (
        select 1 from unnest(string_to_array(v_path, '/')) segment
        where segment in ('', '.', '..')
      )
      or v_sha256 !~ '^[a-f0-9]{64}$'
    then
      raise exception 'Invalid classroom archive compaction object identity'
        using errcode = '22023';
    end if;

    select * into v_existing
    from public.classroom_archive_source_object_cleanup
    where operation_id = p_operation_id
      and storage_bucket = v_bucket
      and storage_path = v_path
    for update;
    if found then
      if v_existing.archive_id <> v_operation.archive_id
        or v_existing.classroom_id <> v_operation.classroom_id
        or v_existing.expected_sha256 <> v_sha256
        or v_existing.expected_byte_size <> v_byte_size
      then
        raise exception 'Compaction object staging replay differs'
          using errcode = '22023';
      end if;
    else
      insert into public.classroom_archive_source_object_cleanup (
        operation_id,
        archive_id,
        classroom_id,
        storage_bucket,
        storage_path,
        expected_sha256,
        expected_byte_size
      ) values (
        p_operation_id,
        v_operation.archive_id,
        v_operation.classroom_id,
        v_bucket,
        v_path,
        v_sha256,
        v_byte_size
      );
    end if;
  end loop;

  update public.classroom_archive_operations
  set source_object_cleanup_staged_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_operation_id;
  select count(*)::integer, coalesce(sum(expected_byte_size), 0)::bigint
  into v_count, v_bytes
  from public.classroom_archive_source_object_cleanup
  where operation_id = p_operation_id;

  return jsonb_build_object(
    'ok', true,
    'status', 202,
    'operation_id', p_operation_id,
    'operation_status', 'snapshot_ready',
    'staged_object_count', v_count,
    'staged_object_bytes', v_bytes
  );
end;
$$;

create or replace function public.touch_classroom_blueprint_source_revision()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if current_setting('pika.classroom_archive_restore', true) = 'on'
    or current_setting('pika.classroom_archive_compaction', true) = 'on'
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then v_old_classroom_id := old.classroom_id; end if;
  if tg_op <> 'DELETE' then v_new_classroom_id := new.classroom_id; end if;
  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_classroom_blueprint_source_from_test_question()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if current_setting('pika.classroom_archive_restore', true) = 'on'
    or current_setting('pika.classroom_archive_compaction', true) = 'on'
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    select classroom_id into v_old_classroom_id from public.tests where id = old.test_id;
  end if;
  if tg_op <> 'DELETE' then
    select classroom_id into v_new_classroom_id from public.tests where id = new.test_id;
  end if;
  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_classroom_blueprint_source_from_requirement()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if current_setting('pika.classroom_archive_restore', true) = 'on'
    or current_setting('pika.classroom_archive_compaction', true) = 'on'
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    select classroom_id into v_old_classroom_id
    from public.assignments where id = old.assignment_id;
  end if;
  if tg_op <> 'DELETE' then
    select classroom_id into v_new_classroom_id
    from public.assignments where id = new.assignment_id;
  end if;
  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1
  where id = v_old_classroom_id;
  if v_new_classroom_id is distinct from v_old_classroom_id then
    update public.classrooms
    set blueprint_source_revision = blueprint_source_revision + 1
    where id = v_new_classroom_id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.begin_classroom_archive_compaction(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_archive_id uuid,
  p_request_sha256 text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_archive public.classroom_archives;
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_revision bigint;
  v_now timestamptz := clock_timestamp();
  v_bucket text;
  v_bucket_counts jsonb;
  v_total_count bigint;
  v_total_bytes bigint;
  v_summed_count bigint := 0;
  v_summed_bytes bigint := 0;
  v_contract_resource_count bigint;
begin
  if p_operation_id is null
    or p_teacher_id is null
    or p_classroom_id is null
    or p_archive_id is null
    or p_request_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Invalid classroom archive compaction request'
      using errcode = '22023';
  end if;

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  if found then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.archive_id <> p_archive_id
      or v_operation.operation_type <> 'compact'
      or v_operation.request_sha256 <> p_request_sha256
    then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different compaction request',
        'retryable', false
      );
    end if;
    if v_operation.status = 'completed' then
      return jsonb_build_object(
        'ok', true,
        'status', 200,
        'operation_id', p_operation_id,
        'archive_id', p_archive_id,
        'operation_status', 'completed',
        'replayed', true,
        'resource_counts', v_operation.resource_counts,
        'storage_object_counts', v_operation.storage_object_counts,
        'verification', v_operation.verification
      );
    end if;
    if v_operation.status = 'failed' and v_operation.retryable is false then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', v_operation.error_code,
        'error', 'Compaction failed and requires a new idempotency key',
        'retryable', false
      );
    end if;
    if v_operation.retention is distinct from jsonb_build_object(
      'mode', 'teacher_managed',
      'delete_after', null
    ) then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'classroom_archive_retention_not_compactable',
        'error', 'Only teacher-managed archives can be compacted',
        'retryable', false
      );
    end if;
    if v_operation.snapshot_expires_at > v_now then
      update public.classroom_archive_operations
      set
        status = 'snapshot_ready',
        attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
        error_code = null,
        retryable = null,
        updated_at = v_now
      where id = p_operation_id
      returning * into v_operation;
      return jsonb_build_object(
        'ok', true,
        'status', 202,
        'operation_id', p_operation_id,
        'archive_id', p_archive_id,
        'operation_status', 'snapshot_ready',
        'replayed', true,
        'snapshot_expires_at', v_operation.snapshot_expires_at,
        'resource_counts', v_operation.resource_counts,
        'storage_object_counts', v_operation.storage_object_counts,
        'storage_bucket', v_operation.storage_bucket,
        'storage_path', v_operation.storage_path,
        'artifact_sha256', v_operation.artifact_sha256,
        'content_sha256', v_operation.content_sha256
      );
    end if;
  end if;

  select * into v_archive
  from public.classroom_archives
  where id = p_archive_id;
  if v_archive.id is null
    or v_archive.teacher_id <> p_teacher_id
    or v_archive.classroom_id <> p_classroom_id
  then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_not_found',
      'error', 'Classroom archive not found',
      'retryable', false
    );
  end if;
  if coalesce((v_archive.verification->>'read_back_verified')::boolean, false) is not true
    or coalesce((v_archive.verification->>'artifact_checksum_verified')::boolean, false) is not true
    or coalesce((v_archive.verification->>'manifest_verified')::boolean, false) is not true
    or coalesce((v_archive.verification->>'resource_checksums_verified')::boolean, false) is not true
    or coalesce((v_archive.verification->>'resource_counts_verified')::boolean, false) is not true
    or coalesce((v_archive.verification->>'storage_objects_verified')::boolean, false) is not true
    or coalesce((v_archive.verification->>'actor_snapshots_verified')::boolean, false) is not true
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_not_verified',
      'error', 'Classroom archive verification is incomplete',
      'retryable', false
    );
  end if;

  if v_archive.retention is distinct from jsonb_build_object(
    'mode', 'teacher_managed',
    'delete_after', null
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_retention_not_compactable',
      'error', 'Only teacher-managed archives can be compacted',
      'retryable', false
    );
  end if;

  if v_archive.resource_counts is null
    or jsonb_typeof(v_archive.resource_counts) <> 'object'
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_resource_contract_invalid',
      'error', 'Classroom archive resource counts are not compactable',
      'retryable', false
    );
  end if;
  select count(*)::bigint into v_contract_resource_count
  from public.classroom_archive_resource_contract;
  if (select count(*)::bigint from jsonb_object_keys(v_archive.resource_counts))
      <> v_contract_resource_count
    or exists (
      select 1
      from public.classroom_archive_resource_contract contract
      where not (v_archive.resource_counts ? contract.table_name)
        or jsonb_typeof(v_archive.resource_counts->contract.table_name) <> 'number'
        or case
          when (v_archive.resource_counts->>contract.table_name) ~ '^\d+$'
            then (v_archive.resource_counts->>contract.table_name)::numeric > 2147483647
          else true
        end
    )
    or exists (
      select 1
      from jsonb_object_keys(v_archive.resource_counts) as resource_keys(resource_key)
      left join public.classroom_archive_resource_contract contract
        on contract.table_name = resource_keys.resource_key
      where contract.table_name is null
    )
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_resource_contract_invalid',
      'error', 'Classroom archive resource counts do not match the resource contract',
      'retryable', false
    );
  end if;

  if v_archive.storage_object_counts is null
    or jsonb_typeof(v_archive.storage_object_counts) <> 'object'
    or not (v_archive.storage_object_counts ?& array['total_count', 'total_bytes', 'by_bucket'])
    or v_archive.storage_object_counts - 'total_count' - 'total_bytes' - 'by_bucket' <> '{}'::jsonb
    or jsonb_typeof(v_archive.storage_object_counts->'total_count') <> 'number'
    or jsonb_typeof(v_archive.storage_object_counts->'total_bytes') <> 'number'
    or jsonb_typeof(v_archive.storage_object_counts->'by_bucket') <> 'object'
    or (v_archive.storage_object_counts->>'total_count') !~ '^\d+$'
    or (v_archive.storage_object_counts->>'total_bytes') !~ '^\d+$'
    or (v_archive.storage_object_counts->>'total_count')::numeric > 9223372036854775807
    or (v_archive.storage_object_counts->>'total_bytes')::numeric > 9223372036854775807
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_storage_inventory_invalid',
      'error', 'Classroom archive storage inventory is not compactable',
      'retryable', false
    );
  end if;
  v_total_count := (v_archive.storage_object_counts->>'total_count')::bigint;
  v_total_bytes := (v_archive.storage_object_counts->>'total_bytes')::bigint;
  for v_bucket, v_bucket_counts in
    select key, value from jsonb_each(v_archive.storage_object_counts->'by_bucket')
  loop
    if v_bucket not in ('assignment-artifacts', 'submission-images', 'test-documents')
      or jsonb_typeof(v_bucket_counts) <> 'object'
      or not (v_bucket_counts ?& array['count', 'bytes'])
      or v_bucket_counts - 'count' - 'bytes' <> '{}'::jsonb
      or jsonb_typeof(v_bucket_counts->'count') <> 'number'
      or jsonb_typeof(v_bucket_counts->'bytes') <> 'number'
      or (v_bucket_counts->>'count') !~ '^\d+$'
      or (v_bucket_counts->>'bytes') !~ '^\d+$'
      or (v_bucket_counts->>'count')::numeric > 9223372036854775807
      or (v_bucket_counts->>'bytes')::numeric > 9223372036854775807
    then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'classroom_archive_storage_inventory_invalid',
        'error', 'Classroom archive storage inventory is not compactable',
        'retryable', false
      );
    end if;
    v_summed_count := v_summed_count + (v_bucket_counts->>'count')::bigint;
    v_summed_bytes := v_summed_bytes + (v_bucket_counts->>'bytes')::bigint;
  end loop;
  if v_summed_count <> v_total_count or v_summed_bytes <> v_total_bytes then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_storage_inventory_invalid',
      'error', 'Classroom archive storage inventory totals are inconsistent',
      'retryable', false
    );
  end if;

  select classroom.teacher_id, classroom.archived_at, revision.revision
  into v_teacher_id, v_archived_at, v_revision
  from public.classrooms classroom
  join public.classroom_archive_revisions revision on revision.classroom_id = classroom.id
  where classroom.id = p_classroom_id
  for update of classroom, revision;
  if v_teacher_id is null then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'operation_id', p_operation_id,
      'error_code', 'classroom_not_found', 'error', 'Classroom not found', 'retryable', false
    );
  end if;
  if v_teacher_id <> p_teacher_id then
    return jsonb_build_object(
      'ok', false, 'status', 403, 'operation_id', p_operation_id,
      'error_code', 'classroom_forbidden', 'error', 'Forbidden', 'retryable', false
    );
  end if;
  if v_archived_at is null then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'operation_id', p_operation_id,
      'error_code', 'classroom_not_archived_hot',
      'error', 'Classroom must be archived hot before compaction', 'retryable', false
    );
  end if;
  if v_revision <> v_archive.source_revision then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'operation_id', p_operation_id,
      'error_code', 'classroom_archive_source_changed',
      'error', 'Classroom no longer matches the verified archive', 'retryable', false
    );
  end if;
  if exists (
    select 1 from public.classroom_cold_tombstones where classroom_id = p_classroom_id
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'operation_id', p_operation_id,
      'error_code', 'cold_tombstone_already_exists',
      'error', 'Classroom already has a cold tombstone', 'retryable', false
    );
  end if;
  if exists (
    select 1
    from public.classroom_archive_operations active_compaction
    where active_compaction.classroom_id = p_classroom_id
      and active_compaction.operation_type = 'compact'
      and active_compaction.id <> p_operation_id
      and active_compaction.snapshot_expires_at > v_now
      and (
        active_compaction.status = 'snapshot_ready'
        or (active_compaction.status = 'failed' and active_compaction.retryable is true)
      )
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'operation_id', p_operation_id,
      'error_code', 'compaction_already_in_progress',
      'error', 'Another compaction operation is already in progress', 'retryable', true
    );
  end if;

  if v_operation.id is null then
    insert into public.classroom_archive_operations (
      id, teacher_id, classroom_id, operation_type, request_sha256, status,
      source_revision, source_schema_migration, source_app_commit, retention,
      resource_counts, storage_object_counts, archive_id, storage_bucket, storage_path,
      artifact_sha256, content_sha256, compressed_byte_size, uncompressed_byte_size,
      snapshot_created_at, snapshot_expires_at
    ) values (
      p_operation_id, p_teacher_id, p_classroom_id, 'compact', p_request_sha256,
      'snapshot_ready', v_archive.source_revision, v_archive.source_schema_migration,
      v_archive.source_app_commit, v_archive.retention, v_archive.resource_counts,
      v_archive.storage_object_counts, p_archive_id, v_archive.storage_bucket,
      v_archive.storage_path, v_archive.artifact_sha256, v_archive.content_sha256,
      v_archive.compressed_byte_size, v_archive.uncompressed_byte_size,
      v_now, v_now + interval '24 hours'
    );
  else
    delete from public.classroom_archive_source_object_cleanup
    where operation_id = p_operation_id;
    update public.classroom_archive_operations
    set
      status = 'snapshot_ready',
      attempt_count = attempt_count + 1,
      source_object_cleanup_staged_at = null,
      error_code = null,
      retryable = null,
      snapshot_created_at = v_now,
      snapshot_expires_at = v_now + interval '24 hours',
      updated_at = v_now
    where id = p_operation_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 202,
    'operation_id', p_operation_id,
    'archive_id', p_archive_id,
    'operation_status', 'snapshot_ready',
    'replayed', false,
    'snapshot_expires_at', v_now + interval '24 hours',
    'resource_counts', v_archive.resource_counts,
    'storage_object_counts', v_archive.storage_object_counts,
    'storage_bucket', v_archive.storage_bucket,
    'storage_path', v_archive.storage_path,
    'artifact_sha256', v_archive.artifact_sha256,
    'content_sha256', v_archive.content_sha256
  );
end;
$$;

create or replace function public.complete_classroom_archive_compaction(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_verification jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_archive public.classroom_archives;
  v_resource record;
  v_teacher_id uuid;
  v_title text;
  v_archived_at timestamptz;
  v_revision bigint;
  v_expected_count integer;
  v_current_count integer;
  v_deleted_count integer;
  v_staged_count bigint;
  v_staged_bytes bigint;
  v_staged_by_bucket jsonb;
  v_contract_resource_count bigint;
  v_evidence_time timestamptz;
  v_final_verification jsonb;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;
  if v_operation.id is null
    or p_teacher_id is null
    or v_operation.teacher_id <> p_teacher_id
    or v_operation.operation_type <> 'compact'
  then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'operation_id', p_operation_id,
      'error_code', 'compaction_operation_not_found',
      'error', 'Compaction operation not found', 'retryable', false
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
      'resource_counts', v_operation.resource_counts,
      'storage_object_counts', v_operation.storage_object_counts,
      'verification', v_operation.verification
    );
  end if;
  if v_operation.status <> 'snapshot_ready'
    or v_operation.snapshot_expires_at <= v_now
  then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'operation_id', p_operation_id,
      'error_code', 'compaction_not_ready',
      'error', 'Compaction operation is not ready', 'retryable', false
    );
  end if;

  if p_verification is null
    or jsonb_typeof(p_verification) <> 'object'
    or not (p_verification ?& array[
      'operation_id',
      'archive_id',
      'artifact_sha256',
      'content_sha256',
      'verified_at',
      'read_back_verified',
      'artifact_checksum_verified',
      'manifest_verified',
      'resource_checksums_verified',
      'resource_counts_verified',
      'storage_objects_verified',
      'actor_snapshots_verified',
      'schema_adapter_verified',
      'actor_references_resolved',
      'source_object_cleanup_staged'
    ])
    or p_verification - 'operation_id'
      - 'archive_id'
      - 'artifact_sha256'
      - 'content_sha256'
      - 'verified_at'
      - 'read_back_verified'
      - 'artifact_checksum_verified'
      - 'manifest_verified'
      - 'resource_checksums_verified'
      - 'resource_counts_verified'
      - 'storage_objects_verified'
      - 'actor_snapshots_verified'
      - 'schema_adapter_verified'
      - 'actor_references_resolved'
      - 'source_object_cleanup_staged' <> '{}'::jsonb
    or jsonb_typeof(p_verification->'operation_id') <> 'string'
    or jsonb_typeof(p_verification->'archive_id') <> 'string'
    or jsonb_typeof(p_verification->'artifact_sha256') <> 'string'
    or jsonb_typeof(p_verification->'content_sha256') <> 'string'
    or jsonb_typeof(p_verification->'verified_at') <> 'string'
    or exists (
      select 1
      from unnest(array[
        'read_back_verified',
        'artifact_checksum_verified',
        'manifest_verified',
        'resource_checksums_verified',
        'resource_counts_verified',
        'storage_objects_verified',
        'actor_snapshots_verified',
        'schema_adapter_verified',
        'actor_references_resolved',
        'source_object_cleanup_staged'
      ]) required_boolean(key)
      where jsonb_typeof(p_verification->required_boolean.key) <> 'boolean'
    )
    or (p_verification->>'operation_id')::uuid <> p_operation_id
    or (p_verification->>'archive_id')::uuid <> v_operation.archive_id
    or p_verification->>'artifact_sha256' <> v_operation.artifact_sha256
    or p_verification->>'content_sha256' <> v_operation.content_sha256
    or coalesce((p_verification->>'read_back_verified')::boolean, false) is not true
    or coalesce((p_verification->>'artifact_checksum_verified')::boolean, false) is not true
    or coalesce((p_verification->>'manifest_verified')::boolean, false) is not true
    or coalesce((p_verification->>'resource_checksums_verified')::boolean, false) is not true
    or coalesce((p_verification->>'resource_counts_verified')::boolean, false) is not true
    or coalesce((p_verification->>'storage_objects_verified')::boolean, false) is not true
    or coalesce((p_verification->>'actor_snapshots_verified')::boolean, false) is not true
    or coalesce((p_verification->>'schema_adapter_verified')::boolean, false) is not true
    or coalesce((p_verification->>'actor_references_resolved')::boolean, false) is not true
    or coalesce((p_verification->>'source_object_cleanup_staged')::boolean, false) is not true
    or v_operation.source_object_cleanup_staged_at is null
  then
    raise exception 'Classroom archive compaction verification evidence is incomplete'
      using errcode = '22023';
  end if;
  v_evidence_time := (p_verification->>'verified_at')::timestamptz;
  if v_evidence_time < v_operation.snapshot_created_at
    or v_evidence_time > v_now + interval '5 minutes'
  then
    raise exception 'Classroom archive compaction verification time is invalid'
      using errcode = '22023';
  end if;

  select * into v_archive
  from public.classroom_archives
  where id = v_operation.archive_id;
  if v_archive.id is null
    or v_archive.teacher_id <> v_operation.teacher_id
    or v_archive.classroom_id <> v_operation.classroom_id
    or v_archive.source_revision <> v_operation.source_revision
    or v_archive.storage_bucket <> v_operation.storage_bucket
    or v_archive.storage_path <> v_operation.storage_path
    or v_archive.artifact_sha256 <> v_operation.artifact_sha256
    or v_archive.content_sha256 <> v_operation.content_sha256
    or v_archive.resource_counts <> v_operation.resource_counts
    or v_archive.storage_object_counts <> v_operation.storage_object_counts
  then
    raise exception 'Verified classroom archive changed during compaction'
      using errcode = '40001';
  end if;

  if v_operation.resource_counts is null
    or jsonb_typeof(v_operation.resource_counts) <> 'object'
  then
    raise exception 'Compaction resource contract is invalid'
      using errcode = '22023';
  end if;
  select count(*)::bigint into v_contract_resource_count
  from public.classroom_archive_resource_contract;
  if (select count(*)::bigint from jsonb_object_keys(v_operation.resource_counts))
      <> v_contract_resource_count
    or exists (
      select 1
      from public.classroom_archive_resource_contract contract
      where not (v_operation.resource_counts ? contract.table_name)
        or jsonb_typeof(v_operation.resource_counts->contract.table_name) <> 'number'
        or case
          when (v_operation.resource_counts->>contract.table_name) ~ '^\d+$'
            then (v_operation.resource_counts->>contract.table_name)::numeric > 2147483647
          else true
        end
    )
    or exists (
      select 1
      from jsonb_object_keys(v_operation.resource_counts) as resource_keys(resource_key)
      left join public.classroom_archive_resource_contract contract
        on contract.table_name = resource_keys.resource_key
      where contract.table_name is null
    )
  then
    raise exception 'Compaction resource contract is invalid'
      using errcode = '22023';
  end if;

  select
    count(*)::bigint,
    coalesce(sum(expected_byte_size), 0)::bigint
  into v_staged_count, v_staged_bytes
  from public.classroom_archive_source_object_cleanup
  where operation_id = p_operation_id;
  select coalesce(
    jsonb_object_agg(
      storage_bucket,
      jsonb_build_object('count', object_count, 'bytes', object_bytes)
      order by storage_bucket
    ),
    '{}'::jsonb
  )
  into v_staged_by_bucket
  from (
    select
      storage_bucket,
      count(*)::bigint as object_count,
      coalesce(sum(expected_byte_size), 0)::bigint as object_bytes
    from public.classroom_archive_source_object_cleanup
    where operation_id = p_operation_id
    group by storage_bucket
  ) staged;
  if v_staged_count <> (v_archive.storage_object_counts->>'total_count')::bigint then
    raise exception 'Compaction source-object cleanup count differs'
      using errcode = '22023';
  end if;
  if v_staged_bytes <> (v_archive.storage_object_counts->>'total_bytes')::bigint then
    raise exception 'Compaction source-object cleanup bytes differ'
      using errcode = '22023';
  end if;
  if v_staged_by_bucket <> v_archive.storage_object_counts->'by_bucket' then
    raise exception 'Compaction source-object cleanup bucket totals differ'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.classroom_archive_source_object_cleanup
    where operation_id = p_operation_id and status <> 'staged'
  ) then
    raise exception 'Compaction source-object cleanup became eligible before commit'
      using errcode = '40001';
  end if;

  select classroom.teacher_id, classroom.title, classroom.archived_at, revision.revision
  into v_teacher_id, v_title, v_archived_at, v_revision
  from public.classrooms classroom
  join public.classroom_archive_revisions revision on revision.classroom_id = classroom.id
  where classroom.id = v_operation.classroom_id
  for update of classroom, revision;
  if v_teacher_id is null
    or v_teacher_id <> v_operation.teacher_id
    or v_archived_at is null
    or v_revision <> v_operation.source_revision
  then
    update public.classroom_archive_operations
    set
      status = 'failed',
      error_code = 'classroom_archive_source_changed',
      retryable = false,
      source_object_cleanup_staged_at = null,
      updated_at = v_now
    where id = p_operation_id;
    delete from public.classroom_archive_source_object_cleanup
    where operation_id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409, 'operation_id', p_operation_id,
      'error_code', 'classroom_archive_source_changed',
      'error', 'Classroom no longer matches the verified archive', 'retryable', false
    );
  end if;
  if exists (
    select 1 from public.classroom_cold_tombstones
    where classroom_id = v_operation.classroom_id
  ) then
    raise exception 'Cold classroom tombstone appeared during compaction'
      using errcode = '40001';
  end if;

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
    order by export_position
  loop
    if not (v_operation.resource_counts ? v_resource.table_name) then
      raise exception 'Compaction resource contract is missing %', v_resource.table_name
        using errcode = '22023';
    end if;
    v_expected_count := (v_operation.resource_counts->>v_resource.table_name)::integer;
    execute format(
      'select count(*)::integer from public.%I source
       where public.resolve_classroom_archive_resource_classroom_id(%L, source.%I) = $1',
      v_resource.table_name,
      v_resource.table_name,
      v_resource.primary_key_column
    ) into v_current_count using v_operation.classroom_id;
    if v_current_count <> v_expected_count then
      update public.classroom_archive_operations
      set
        status = 'failed',
        error_code = 'classroom_compaction_source_count_changed',
        retryable = false,
        source_object_cleanup_staged_at = null,
        updated_at = v_now
      where id = p_operation_id;
      delete from public.classroom_archive_source_object_cleanup
      where operation_id = p_operation_id;
      return jsonb_build_object(
        'ok', false, 'status', 409, 'operation_id', p_operation_id,
        'error_code', 'classroom_compaction_source_count_changed',
        'error', format('Classroom compaction source count differs for %s', v_resource.table_name),
        'retryable', false
      );
    end if;
  end loop;

  insert into public.classroom_cold_tombstones (
    classroom_id,
    teacher_id,
    archive_id,
    title,
    archived_at,
    compacted_at,
    source_revision
  ) values (
    v_operation.classroom_id,
    v_operation.teacher_id,
    v_operation.archive_id,
    v_title,
    v_archived_at,
    v_now,
    v_operation.source_revision
  );

  perform set_config('pika.classroom_archive_compaction', 'on', true);
  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
    order by export_position desc
  loop
    if not (v_operation.resource_counts ? v_resource.table_name) then
      raise exception 'Compaction resource contract is missing %', v_resource.table_name
        using errcode = '22023';
    end if;
    v_expected_count := (v_operation.resource_counts->>v_resource.table_name)::integer;
    execute format(
      'delete from public.%I target
       where public.resolve_classroom_archive_resource_classroom_id(%L, target.%I) = $1',
      v_resource.table_name,
      v_resource.table_name,
      v_resource.primary_key_column
    ) using v_operation.classroom_id;
    get diagnostics v_deleted_count = row_count;
    if v_deleted_count <> v_expected_count then
      raise exception 'Classroom compaction deletion count differs for %', v_resource.table_name
        using errcode = '40001';
    end if;
  end loop;

  if exists (select 1 from public.classrooms where id = v_operation.classroom_id)
    or exists (
      select 1 from public.classroom_archive_revisions
      where classroom_id = v_operation.classroom_id
    )
  then
    raise exception 'Classroom compaction left hot root state'
      using errcode = '40001';
  end if;

  v_final_verification := p_verification || jsonb_build_object(
    'source_revision_verified', true,
    'resource_ownership_verified', true,
    'relational_deletion_verified', true,
    'tombstone_verified', true
  );
  update public.classroom_archive_source_object_cleanup
  set status = 'pending', next_attempt_at = v_now, updated_at = v_now
  where operation_id = p_operation_id and status = 'staged';
  update public.classroom_archive_operations
  set
    status = 'completed',
    verification = v_final_verification,
    error_code = null,
    retryable = null,
    completed_at = v_now,
    updated_at = v_now
  where id = p_operation_id;

  return jsonb_build_object(
    'ok', true,
    'status', 201,
    'operation_id', p_operation_id,
    'archive_id', v_operation.archive_id,
    'operation_status', 'completed',
    'replayed', false,
    'resource_counts', v_operation.resource_counts,
    'storage_object_counts', v_operation.storage_object_counts,
    'verification', v_final_verification
  );
end;
$$;

revoke all on table public.classroom_archive_source_object_cleanup from public, anon, authenticated;
grant select on table public.classroom_archive_source_object_cleanup to service_role;

revoke all on function public.begin_classroom_archive_compaction(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.stage_classroom_archive_compaction_objects(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.complete_classroom_archive_compaction(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_classroom_archive_compaction(uuid, uuid, text, boolean) from public, anon, authenticated;

grant execute on function public.begin_classroom_archive_compaction(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.stage_classroom_archive_compaction_objects(uuid, uuid, jsonb) to service_role;
grant execute on function public.complete_classroom_archive_compaction(uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_classroom_archive_compaction(uuid, uuid, text, boolean) to service_role;

comment on table public.classroom_archive_source_object_cleanup is
  'Durable, private cleanup ledger staged from a verified archive before hot rows are compacted.';
comment on function public.begin_classroom_archive_compaction(uuid, uuid, uuid, uuid, text) is
  'Starts an idempotent archived-hot compaction lease without deleting classroom data.';
comment on function public.complete_classroom_archive_compaction(uuid, uuid, jsonb) is
  'Atomically verifies exact hot ownership, creates the cold tombstone, and deletes rows child-first.';
