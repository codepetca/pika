-- Resumable, version-aware classroom archive restore. Restore remains canary-gated in the app.

alter table public.classroom_archive_operations
  add column if not exists target_schema_migration text,
  add column if not exists adapter_chain jsonb;

alter table public.classroom_archive_operations
  drop constraint if exists classroom_archive_operations_restore_contract_check;
alter table public.classroom_archive_operations
  add constraint classroom_archive_operations_restore_contract_check check (
    operation_type <> 'restore'
    or (
      target_schema_migration is not null
      and target_schema_migration ~ '^\d{3}(?:_[a-z0-9_]+)?$'
      and jsonb_typeof(adapter_chain) = 'array'
    )
  );

create table if not exists public.classroom_cold_tombstones (
  classroom_id uuid primary key,
  teacher_id uuid not null,
  archive_id uuid not null unique references public.classroom_archives (id),
  title text not null,
  archived_at timestamptz not null,
  compacted_at timestamptz not null default clock_timestamp(),
  source_revision bigint not null check (source_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  check (compacted_at >= archived_at)
);

create table if not exists public.classroom_archive_restore_staging (
  operation_id uuid not null references public.classroom_archive_operations (id) on delete cascade,
  table_name text not null references public.classroom_archive_resource_contract (table_name),
  row_id uuid not null,
  row_data jsonb not null check (jsonb_typeof(row_data) = 'object'),
  staged_at timestamptz not null default clock_timestamp(),
  primary key (operation_id, table_name, row_id)
);

create index if not exists idx_classroom_archive_restore_staging_operation_table
  on public.classroom_archive_restore_staging (operation_id, table_name, row_id);

create table if not exists public.classroom_archive_restore_expected_objects (
  operation_id uuid not null references public.classroom_archive_operations (id) on delete cascade,
  storage_bucket text not null check (storage_bucket in (
    'assignment-artifacts', 'submission-images', 'test-documents'
  )),
  storage_path text not null check (
    storage_path <> '' and storage_path not like '/%' and strpos(storage_path, E'\\') = 0
  ),
  expected_sha256 text not null check (expected_sha256 ~ '^[a-f0-9]{64}$'),
  expected_byte_size bigint not null check (expected_byte_size >= 0),
  primary key (operation_id, storage_bucket, storage_path)
);

alter table public.classroom_cold_tombstones enable row level security;
alter table public.classroom_archive_restore_staging enable row level security;
alter table public.classroom_archive_restore_expected_objects enable row level security;

-- Preserve archived values while the atomic restore transaction replays normal insert triggers.
create or replace function public.bump_classroom_blueprint_source_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('pika.classroom_archive_restore', true) = 'on' then
    return new;
  end if;
  if new.blueprint_source_revision = old.blueprint_source_revision then
    new.blueprint_source_revision := old.blueprint_source_revision + 1;
  end if;
  return new;
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
  if current_setting('pika.classroom_archive_restore', true) = 'on' then
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
  if current_setting('pika.classroom_archive_restore', true) = 'on' then
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
  if current_setting('pika.classroom_archive_restore', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    select classroom_id into v_old_classroom_id from public.assignments where id = old.assignment_id;
  end if;
  if tg_op <> 'DELETE' then
    select classroom_id into v_new_classroom_id from public.assignments where id = new.assignment_id;
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

create or replace function public.bump_classroom_archive_revision_from_classroom()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('pika.classroom_archive_restore', true) = 'on' then
    if tg_op = 'INSERT' then
      insert into public.classroom_archive_revisions (classroom_id, revision)
      values (
        new.id,
        current_setting('pika.classroom_archive_source_revision', true)::bigint
      )
      on conflict (classroom_id) do update
      set revision = excluded.revision, updated_at = now();
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.classroom_archive_revisions (classroom_id)
    values (new.id)
    on conflict (classroom_id) do nothing;
    return new;
  end if;
  if tg_op = 'DELETE' then
    delete from public.classroom_archive_revisions where classroom_id = old.id;
    return old;
  end if;
  update public.classroom_archive_revisions
  set revision = revision + 1, updated_at = now()
  where classroom_id = old.id;
  return new;
end;
$$;

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
  if current_setting('pika.classroom_archive_restore', true) = 'on' then
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

create or replace function public.begin_classroom_archive_restore(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_archive_id uuid,
  p_request_sha256 text,
  p_target_schema_migration text,
  p_adapter_chain jsonb,
  p_resource_counts jsonb,
  p_storage_objects jsonb,
  p_database_budget_bytes bigint
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_archive public.classroom_archives;
  v_tombstone public.classroom_cold_tombstones;
  v_database_size bigint;
  v_required_headroom bigint;
  v_now timestamptz := clock_timestamp();
  v_contract_count integer;
  v_resource_count_key_count integer;
  v_count_key text;
  v_count_value jsonb;
  v_storage_object jsonb;
  v_expected_object_count bigint;
  v_expected_object_bytes bigint;
  v_expected_by_bucket jsonb;
begin
  if p_request_sha256 !~ '^[a-f0-9]{64}$'
    or p_target_schema_migration !~ '^\d{3}(?:_[a-z0-9_]+)?$'
    or p_adapter_chain is null
    or jsonb_typeof(p_adapter_chain) <> 'array'
    or exists (
      select 1 from jsonb_array_elements(p_adapter_chain) item
      where jsonb_typeof(item) <> 'string' or length(item #>> '{}') = 0
    )
    or p_resource_counts is null
    or jsonb_typeof(p_resource_counts) <> 'object'
    or p_storage_objects is null
    or jsonb_typeof(p_storage_objects) <> 'array'
    or jsonb_array_length(p_storage_objects) > 10000
    or p_database_budget_bytes <= 0
  then
    raise exception 'Invalid classroom archive restore request'
      using errcode = '22023';
  end if;

  select count(*) into v_contract_count
  from public.classroom_archive_resource_contract;
  select count(*) into v_resource_count_key_count
  from jsonb_object_keys(p_resource_counts);
  if v_resource_count_key_count <> v_contract_count
    or exists (
      select 1
      from public.classroom_archive_resource_contract contract
      where not p_resource_counts ? contract.table_name
    )
  then
    raise exception 'Restore resource counts do not match the classroom resource contract'
      using errcode = '22023';
  end if;
  for v_count_key, v_count_value in
    select key, value from jsonb_each(p_resource_counts)
  loop
    if jsonb_typeof(v_count_value) <> 'number'
      or (v_count_value #>> '{}') !~ '^\d+$'
      or (v_count_value #>> '{}')::numeric > 2147483647
    then
      raise exception 'Invalid restore resource count for %', v_count_key
        using errcode = '22023';
    end if;
  end loop;
  if (p_resource_counts->>'classrooms')::integer <> 1 then
    raise exception 'Restore must contain exactly one classroom root'
      using errcode = '22023';
  end if;
  for v_storage_object in select value from jsonb_array_elements(p_storage_objects)
  loop
    if jsonb_typeof(v_storage_object) <> 'object'
      or v_storage_object - 'storage_bucket' - 'storage_path'
        - 'expected_sha256' - 'expected_byte_size' <> '{}'::jsonb
      or v_storage_object->>'storage_bucket' not in (
        'assignment-artifacts', 'submission-images', 'test-documents'
      )
      or coalesce(v_storage_object->>'storage_path', '') = ''
      or v_storage_object->>'storage_path' like '/%'
      or strpos(v_storage_object->>'storage_path', E'\\') > 0
      or array_length(string_to_array(v_storage_object->>'storage_path', '/'), 1) <> 4
      or split_part(v_storage_object->>'storage_path', '/', 1) <> 'restores'
      or split_part(v_storage_object->>'storage_path', '/', 2) <> p_classroom_id::text
      or split_part(v_storage_object->>'storage_path', '/', 3) <> p_operation_id::text
      or split_part(v_storage_object->>'storage_path', '/', 4)
        !~ '^[a-f0-9]{64}-[a-f0-9]{64}$'
      or split_part(split_part(v_storage_object->>'storage_path', '/', 4), '-', 2)
        <> v_storage_object->>'expected_sha256'
      or exists (
        select 1
        from regexp_split_to_table(v_storage_object->>'storage_path', '/') segment(value)
        where segment.value in ('', '.', '..')
      )
      or coalesce(v_storage_object->>'expected_sha256', '') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(v_storage_object->'expected_byte_size') <> 'number'
      or (v_storage_object->>'expected_byte_size') !~ '^\d+$'
    then
      raise exception 'Invalid classroom archive restore storage descriptor'
        using errcode = '22023';
    end if;
  end loop;
  if (
    select count(*)
    from (
      select value->>'storage_bucket', value->>'storage_path'
      from jsonb_array_elements(p_storage_objects)
      group by value->>'storage_bucket', value->>'storage_path'
    ) unique_objects
  ) <> jsonb_array_length(p_storage_objects) then
    raise exception 'Duplicate classroom archive restore storage descriptor'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  perform public.cleanup_expired_classroom_archive_snapshots();

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  if found then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.archive_id <> p_archive_id
      or v_operation.operation_type <> 'restore'
      or v_operation.request_sha256 <> p_request_sha256
      or v_operation.target_schema_migration <> p_target_schema_migration
      or v_operation.adapter_chain <> p_adapter_chain
      or v_operation.resource_counts <> p_resource_counts
      or exists (
        (select storage_bucket, storage_path, expected_sha256, expected_byte_size
         from public.classroom_archive_restore_expected_objects
         where operation_id = p_operation_id
         except
         select value->>'storage_bucket', value->>'storage_path',
           value->>'expected_sha256', (value->>'expected_byte_size')::bigint
         from jsonb_array_elements(p_storage_objects))
        union all
        (select value->>'storage_bucket', value->>'storage_path',
           value->>'expected_sha256', (value->>'expected_byte_size')::bigint
         from jsonb_array_elements(p_storage_objects)
         except
         select storage_bucket, storage_path, expected_sha256, expected_byte_size
         from public.classroom_archive_restore_expected_objects
         where operation_id = p_operation_id)
      )
    then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different restore request',
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
        'verification', v_operation.verification
      );
    end if;
    if v_operation.status = 'failed' and v_operation.retryable is false then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', v_operation.error_code,
        'error', 'Restore operation failed and requires a new idempotency key',
        'retryable', false
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
  select
    count(*)::bigint,
    coalesce(sum((value->>'expected_byte_size')::bigint), 0)::bigint
  into v_expected_object_count, v_expected_object_bytes
  from jsonb_array_elements(p_storage_objects);
  select coalesce(jsonb_object_agg(
    storage_bucket,
    jsonb_build_object('count', object_count, 'bytes', object_bytes)
    order by storage_bucket
  ), '{}'::jsonb)
  into v_expected_by_bucket
  from (
    select value->>'storage_bucket' as storage_bucket,
      count(*)::bigint as object_count,
      sum((value->>'expected_byte_size')::bigint)::bigint as object_bytes
    from jsonb_array_elements(p_storage_objects)
    group by value->>'storage_bucket'
  ) expected;
  if v_expected_object_count <> (v_archive.storage_object_counts->>'total_count')::bigint
    or v_expected_object_bytes <> (v_archive.storage_object_counts->>'total_bytes')::bigint
    or v_expected_by_bucket <> v_archive.storage_object_counts->'by_bucket'
  then
    raise exception 'Restore storage descriptors do not match archive metadata'
      using errcode = '22023';
  end if;

  select * into v_tombstone
  from public.classroom_cold_tombstones
  where classroom_id = p_classroom_id
  for update;
  if v_tombstone.classroom_id is null
    or v_tombstone.teacher_id <> p_teacher_id
    or v_tombstone.archive_id <> p_archive_id
    or v_tombstone.source_revision <> v_archive.source_revision
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'cold_tombstone_mismatch',
      'error', 'Verified cold classroom state does not match the archive',
      'retryable', false
    );
  end if;
  if exists (select 1 from public.classrooms where id = p_classroom_id) then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'hot_classroom_conflict',
      'error', 'Classroom already exists in hot storage',
      'retryable', false
    );
  end if;
  if exists (
    select 1
    from public.classroom_archive_operations active_restore
    where active_restore.classroom_id = p_classroom_id
      and active_restore.operation_type = 'restore'
      and (
        (
          active_restore.status = 'snapshot_ready'
          and active_restore.snapshot_expires_at > v_now
        )
        or (
          active_restore.status = 'failed'
          and active_restore.retryable is true
          and active_restore.snapshot_expires_at > v_now
        )
      )
      and active_restore.id <> p_operation_id
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'restore_already_in_progress',
      'error', 'Another restore operation is already in progress',
      'retryable', true
    );
  end if;

  v_database_size := pg_database_size(current_database());
  v_required_headroom := greatest(v_archive.uncompressed_byte_size * 2, 1048576);
  if v_database_size + v_required_headroom > p_database_budget_bytes then
    return jsonb_build_object(
      'ok', false,
      'status', 507,
      'operation_id', p_operation_id,
      'error_code', 'insufficient_database_headroom',
      'error', 'Database budget does not have enough restore staging headroom',
      'retryable', true,
      'database_size_bytes', v_database_size,
      'required_headroom_bytes', v_required_headroom
    );
  end if;

  if v_operation.id is null then
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
      target_schema_migration,
      adapter_chain,
      retention,
      resource_counts,
      storage_object_counts,
      archive_id,
      storage_bucket,
      storage_path,
      artifact_sha256,
      content_sha256,
      compressed_byte_size,
      uncompressed_byte_size,
      snapshot_created_at,
      snapshot_expires_at
    )
    values (
      p_operation_id,
      p_teacher_id,
      p_classroom_id,
      'restore',
      p_request_sha256,
      'snapshot_ready',
      v_archive.source_revision,
      v_archive.source_schema_migration,
      v_archive.source_app_commit,
      p_target_schema_migration,
      p_adapter_chain,
      v_archive.retention,
      p_resource_counts,
      v_archive.storage_object_counts,
      p_archive_id,
      v_archive.storage_bucket,
      v_archive.storage_path,
      v_archive.artifact_sha256,
      v_archive.content_sha256,
      v_archive.compressed_byte_size,
      v_archive.uncompressed_byte_size,
      v_now,
      v_now + interval '24 hours'
    );
    insert into public.classroom_archive_restore_expected_objects (
      operation_id, storage_bucket, storage_path, expected_sha256, expected_byte_size
    )
    select p_operation_id, value->>'storage_bucket', value->>'storage_path',
      value->>'expected_sha256', (value->>'expected_byte_size')::bigint
    from jsonb_array_elements(p_storage_objects);
  else
    update public.classroom_archive_operations
    set
      status = 'snapshot_ready',
      attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
      error_code = null,
      retryable = null,
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
    'replayed', v_operation.id is not null,
    'resource_counts', p_resource_counts,
    'snapshot_expires_at', v_now + interval '24 hours',
    'database_size_bytes', v_database_size,
    'required_headroom_bytes', v_required_headroom
  );
end;
$$;

create or replace function public.stage_classroom_archive_object_upload(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_expected_sha256 text,
  p_expected_byte_size bigint
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_upload public.classroom_archive_object_upload_cleanup;
begin
  if p_storage_bucket not in (
      'classroom-archives',
      'assignment-artifacts',
      'submission-images',
      'test-documents'
    )
    or p_storage_path is null
    or p_storage_path = ''
    or p_storage_path like '/%'
    or strpos(p_storage_path, E'\\') > 0
    or exists (
      select 1
      from regexp_split_to_table(p_storage_path, '/') as path_segment(value)
      where path_segment.value in ('', '.', '..')
    )
    or p_expected_sha256 is null
    or p_expected_sha256 !~ '^[a-f0-9]{64}$'
    or p_expected_byte_size is null
    or p_expected_byte_size < 0
  then
    raise exception 'Invalid classroom archive restore object upload intent'
      using errcode = '22023';
  end if;

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
    and teacher_id = p_teacher_id
    and operation_type in ('export', 'restore')
  for update;
  if v_operation.id is null
    or v_operation.status <> 'snapshot_ready'
    or v_operation.snapshot_expires_at <= now()
  then
    return false;
  end if;
  if (v_operation.operation_type = 'export' and p_storage_bucket <> 'classroom-archives')
    or (
      v_operation.operation_type = 'restore'
      and p_storage_bucket not in ('assignment-artifacts', 'submission-images', 'test-documents')
    )
  then
    return false;
  end if;
  if v_operation.operation_type = 'export' and p_storage_path <> format(
    '%s/%s/%s/classroom-v1.tar.gz',
    v_operation.teacher_id,
    v_operation.classroom_id,
    v_operation.archive_id
  ) then
    return false;
  end if;
  if v_operation.operation_type = 'restore' and (
    array_length(string_to_array(p_storage_path, '/'), 1) <> 4
    or split_part(p_storage_path, '/', 1) <> 'restores'
    or split_part(p_storage_path, '/', 2) <> v_operation.classroom_id::text
    or split_part(p_storage_path, '/', 3) <> p_operation_id::text
    or split_part(p_storage_path, '/', 4) !~ '^[a-f0-9]{64}-[a-f0-9]{64}$'
  ) then
    return false;
  end if;
  if v_operation.operation_type = 'restore' and not exists (
    select 1
    from public.classroom_archive_restore_expected_objects expected
    where expected.operation_id = p_operation_id
      and expected.storage_bucket = p_storage_bucket
      and expected.storage_path = p_storage_path
      and expected.expected_sha256 = p_expected_sha256
      and expected.expected_byte_size = p_expected_byte_size
  ) then
    return false;
  end if;

  insert into public.classroom_archive_object_upload_cleanup (
    operation_id,
    storage_bucket,
    storage_path,
    expected_sha256,
    expected_byte_size
  ) values (
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

create or replace function public.stage_classroom_archive_restore_rows(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_table_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_contract public.classroom_archive_resource_contract;
  v_expected_columns text[];
  v_actual_columns text[];
  v_expected_count integer;
  v_staged_count integer;
  v_row jsonb;
  v_row_id uuid;
  v_parent_id uuid;
  v_actor_column text;
  v_actor_id uuid;
  v_existing jsonb;
  v_typed_row jsonb;
begin
  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 500
    or pg_column_size(p_rows) > 1048576
  then
    raise exception 'Restore staging batch must contain 1-500 rows and be at most 1 MiB'
      using errcode = '22023';
  end if;

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;
  if v_operation.id is null
    or v_operation.teacher_id <> p_teacher_id
    or v_operation.operation_type not in ('restore', 'compact')
  then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'error_code', 'restore_operation_not_found',
      'error', 'Restore operation not found',
      'retryable', false
    );
  end if;
  if v_operation.status = 'snapshot_ready' and v_operation.snapshot_expires_at <= now() then
    update public.classroom_archive_operations
    set
      status = 'failed',
      error_code = 'archive_snapshot_expired',
      retryable = false,
      updated_at = clock_timestamp()
    where id = p_operation_id;
    delete from public.classroom_archive_restore_staging where operation_id = p_operation_id;
    update public.classroom_archive_object_upload_cleanup
    set status = 'pending', next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
    where operation_id = p_operation_id and status = 'staged';
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'archive_snapshot_expired',
      'error', 'Restore staging expired',
      'retryable', false
    );
  end if;
  if v_operation.status <> 'snapshot_ready' then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', coalesce(v_operation.error_code, 'restore_staging_not_ready'),
      'error', 'Restore staging is not available',
      'retryable', coalesce(v_operation.retryable, false)
    );
  end if;

  select * into v_contract
  from public.classroom_archive_resource_contract
  where table_name = p_table_name;
  if v_contract.table_name is null then
    raise exception 'Unknown classroom archive restore resource: %', p_table_name
      using errcode = '22023';
  end if;

  select array_agg(attribute.attname order by attribute.attname)
  into v_expected_columns
  from pg_attribute attribute
  join pg_class relation on relation.oid = attribute.attrelid
  join pg_namespace relation_namespace on relation_namespace.oid = relation.relnamespace
  where relation_namespace.nspname = 'public'
    and relation.relname = p_table_name
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = '';

  v_expected_count := (v_operation.resource_counts->>p_table_name)::integer;
  select count(*) into v_staged_count
  from public.classroom_archive_restore_staging
  where operation_id = p_operation_id and table_name = p_table_name;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Restore row for % must be an object', p_table_name
        using errcode = '22023';
    end if;
    select array_agg(key order by key) into v_actual_columns
    from jsonb_object_keys(v_row) key;
    if v_actual_columns is distinct from v_expected_columns then
      raise exception 'Restore row columns do not match current schema for %', p_table_name
        using errcode = '22023';
    end if;
    begin
      execute format(
        'select to_jsonb(typed_row) from jsonb_populate_record(null::public.%I, $1) typed_row',
        p_table_name
      ) into v_typed_row using v_row;
    exception when others then
      raise exception 'Restore row types do not match current schema for %', p_table_name
        using errcode = '22023';
    end;

    begin
      v_row_id := nullif(v_row->>v_contract.primary_key_columns[1], '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Restore row has an invalid primary key for %', p_table_name
        using errcode = '22023';
    end;
    if v_row_id is null then
      raise exception 'Restore row is missing its primary key for %', p_table_name
        using errcode = '22023';
    end if;

    if p_table_name = 'classrooms' then
      if v_row_id <> v_operation.classroom_id
        or nullif(v_row->>'teacher_id', '')::uuid <> v_operation.teacher_id
        or v_row->>'archived_at' is null
      then
        raise exception 'Restore classroom root does not match the cold operation'
          using errcode = '22023';
      end if;
    else
      begin
        v_parent_id := nullif(v_row->>v_contract.parent_column, '')::uuid;
      exception when invalid_text_representation then
        raise exception 'Restore row has an invalid parent for %', p_table_name
          using errcode = '22023';
      end;
      if v_parent_id is null or not exists (
        select 1
        from public.classroom_archive_restore_staging parent
        where parent.operation_id = p_operation_id
          and parent.table_name = v_contract.parent_table
          and parent.row_id = v_parent_id
      ) then
        raise exception 'Restore parent is not staged for %', p_table_name
          using errcode = '23503';
      end if;
    end if;

    foreach v_actor_column in array v_contract.actor_columns
    loop
      begin
        v_actor_id := nullif(v_row->>v_actor_column, '')::uuid;
      exception when invalid_text_representation then
        raise exception 'Restore row has an invalid actor for %.%', p_table_name, v_actor_column
          using errcode = '22023';
      end;
      if v_actor_id is not null
        and not exists (select 1 from public.users where id = v_actor_id)
      then
        raise exception 'Restore actor is unresolved for %.%', p_table_name, v_actor_column
          using errcode = '23503';
      end if;
    end loop;

    select row_data into v_existing
    from public.classroom_archive_restore_staging
    where operation_id = p_operation_id
      and table_name = p_table_name
      and row_id = v_row_id;
    if found and v_existing <> v_row then
      raise exception 'Restore staging replay differs for %.%', p_table_name, v_row_id
        using errcode = '23505';
    end if;
    if not found then
      if v_staged_count >= v_expected_count then
        raise exception 'Restore staging exceeds expected count for %', p_table_name
          using errcode = '22023';
      end if;
      insert into public.classroom_archive_restore_staging (
        operation_id, table_name, row_id, row_data
      ) values (p_operation_id, p_table_name, v_row_id, v_row);
      v_staged_count := v_staged_count + 1;
    end if;
  end loop;

  select count(*) into v_staged_count
  from public.classroom_archive_restore_staging
  where operation_id = p_operation_id and table_name = p_table_name;
  return jsonb_build_object(
    'ok', true,
    'status', 202,
    'operation_id', p_operation_id,
    'table_name', p_table_name,
    'staged_count', v_staged_count,
    'expected_count', v_expected_count
  );
end;
$$;

create or replace function public.complete_classroom_archive_restore(
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
  v_tombstone public.classroom_cold_tombstones;
  v_resource record;
  v_bucket record;
  v_expected_count integer;
  v_staged_count integer;
  v_staged_object_count bigint;
  v_staged_object_bytes bigint;
  v_conflict_count integer;
  v_restored_count integer;
  v_rows jsonb;
  v_final_verification jsonb;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;
  if v_operation.id is null
    or v_operation.teacher_id <> p_teacher_id
    or v_operation.operation_type <> 'restore'
  then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'error_code', 'restore_operation_not_found',
      'error', 'Restore operation not found',
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
      'resource_counts', v_operation.resource_counts,
      'verification', v_operation.verification
    );
  end if;
  if v_operation.status <> 'snapshot_ready' or v_operation.snapshot_expires_at <= v_now then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'restore_staging_not_ready',
      'error', 'Restore staging is not available',
      'retryable', false
    );
  end if;
  if p_verification is null
    or jsonb_typeof(p_verification) <> 'object'
    or p_verification - 'archive_checksum_verified'
      - 'manifest_verified'
      - 'resource_checksums_verified'
      - 'resource_counts_verified'
      - 'storage_objects_verified'
      - 'actor_snapshots_verified'
      - 'schema_adapter_available'
      - 'restored_storage_objects_verified'
      - 'adapter_chain' <> '{}'::jsonb
    or coalesce((p_verification->>'archive_checksum_verified')::boolean, false) is not true
    or coalesce((p_verification->>'manifest_verified')::boolean, false) is not true
    or coalesce((p_verification->>'resource_checksums_verified')::boolean, false) is not true
    or coalesce((p_verification->>'resource_counts_verified')::boolean, false) is not true
    or coalesce((p_verification->>'storage_objects_verified')::boolean, false) is not true
    or coalesce((p_verification->>'actor_snapshots_verified')::boolean, false) is not true
    or coalesce((p_verification->>'schema_adapter_available')::boolean, false) is not true
    or coalesce((p_verification->>'restored_storage_objects_verified')::boolean, false) is not true
    or p_verification->'adapter_chain' is distinct from v_operation.adapter_chain
  then
    raise exception 'Classroom archive restore verification evidence is incomplete'
      using errcode = '22023';
  end if;

  select * into v_archive
  from public.classroom_archives
  where id = v_operation.archive_id
    and teacher_id = v_operation.teacher_id;
  if v_archive.id is null
    or jsonb_typeof(v_archive.storage_object_counts) <> 'object'
    or jsonb_typeof(v_archive.storage_object_counts->'by_bucket') <> 'object'
    or coalesce(v_archive.storage_object_counts->>'total_count', '') !~ '^[0-9]+$'
    or coalesce(v_archive.storage_object_counts->>'total_bytes', '') !~ '^[0-9]+$'
  then
    raise exception 'Classroom archive storage inventory is invalid'
      using errcode = '22023';
  end if;

  select count(*), coalesce(sum(expected_byte_size), 0)
  into v_staged_object_count, v_staged_object_bytes
  from public.classroom_archive_object_upload_cleanup
  where operation_id = p_operation_id and status = 'staged';
  if v_staged_object_count <> (v_archive.storage_object_counts->>'total_count')::bigint
    or v_staged_object_bytes <> (v_archive.storage_object_counts->>'total_bytes')::bigint
  then
    raise exception 'Restore object upload inventory differs from the archive'
      using errcode = '22023';
  end if;
  if exists (
    (select storage_bucket, storage_path, expected_sha256, expected_byte_size
     from public.classroom_archive_restore_expected_objects
     where operation_id = p_operation_id
     except
     select storage_bucket, storage_path, expected_sha256, expected_byte_size
     from public.classroom_archive_object_upload_cleanup
     where operation_id = p_operation_id and status = 'staged')
    union all
    (select storage_bucket, storage_path, expected_sha256, expected_byte_size
     from public.classroom_archive_object_upload_cleanup
     where operation_id = p_operation_id and status = 'staged'
     except
     select storage_bucket, storage_path, expected_sha256, expected_byte_size
     from public.classroom_archive_restore_expected_objects
     where operation_id = p_operation_id)
  ) then
    raise exception 'Restore object upload set differs from expected descriptors'
      using errcode = '22023';
  end if;
  for v_bucket in
    select key as storage_bucket, value as counts
    from jsonb_each(v_archive.storage_object_counts->'by_bucket')
  loop
    if jsonb_typeof(v_bucket.counts) <> 'object'
      or coalesce(v_bucket.counts->>'count', '') !~ '^[0-9]+$'
      or coalesce(v_bucket.counts->>'bytes', '') !~ '^[0-9]+$'
    then
      raise exception 'Classroom archive bucket inventory is invalid'
        using errcode = '22023';
    end if;
    select count(*), coalesce(sum(expected_byte_size), 0)
    into v_staged_object_count, v_staged_object_bytes
    from public.classroom_archive_object_upload_cleanup
    where operation_id = p_operation_id
      and storage_bucket = v_bucket.storage_bucket
      and status = 'staged';
    if v_staged_object_count <> (v_bucket.counts->>'count')::bigint
      or v_staged_object_bytes <> (v_bucket.counts->>'bytes')::bigint
    then
      raise exception 'Restore object upload inventory differs for bucket %', v_bucket.storage_bucket
        using errcode = '22023';
    end if;
  end loop;

  select * into v_tombstone
  from public.classroom_cold_tombstones
  where classroom_id = v_operation.classroom_id
  for update;
  if v_tombstone.classroom_id is null
    or v_tombstone.teacher_id <> v_operation.teacher_id
    or v_tombstone.archive_id <> v_operation.archive_id
    or v_tombstone.source_revision <> v_operation.source_revision
  then
    raise exception 'Cold classroom tombstone changed during restore'
      using errcode = '40001';
  end if;
  if exists (select 1 from public.classrooms where id = v_operation.classroom_id) then
    raise exception 'Hot classroom conflicts with archive restore'
      using errcode = '23505';
  end if;

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
    order by export_position
  loop
    v_expected_count := (v_operation.resource_counts->>v_resource.table_name)::integer;
    select count(*) into v_staged_count
    from public.classroom_archive_restore_staging
    where operation_id = p_operation_id and table_name = v_resource.table_name;
    if v_staged_count <> v_expected_count then
      raise exception 'Restore staging count differs for %', v_resource.table_name
        using errcode = '22023';
    end if;

    execute format(
      'select count(*) from public.classroom_archive_restore_staging staged
       join public.%I target on target.%I = staged.row_id
       where staged.operation_id = $1 and staged.table_name = $2',
      v_resource.table_name,
      v_resource.primary_key_column
    ) into v_conflict_count using p_operation_id, v_resource.table_name;
    if v_conflict_count <> 0 then
      raise exception 'Restore target already contains rows for %', v_resource.table_name
        using errcode = '23505';
    end if;
  end loop;

  perform set_config('pika.classroom_archive_restore', 'on', true);
  perform set_config(
    'pika.classroom_archive_source_revision',
    v_operation.source_revision::text,
    true
  );

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
    order by export_position
  loop
    select coalesce(jsonb_agg(row_data order by row_id), '[]'::jsonb)
    into v_rows
    from public.classroom_archive_restore_staging
    where operation_id = p_operation_id and table_name = v_resource.table_name;
    if jsonb_array_length(v_rows) > 0 then
      execute format(
        'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)',
        v_resource.table_name,
        v_resource.table_name
      ) using v_rows;
    end if;

    execute format(
      'select count(*) from public.classroom_archive_restore_staging staged
       join public.%I restored on restored.%I = staged.row_id
       where staged.operation_id = $1
         and staged.table_name = $2
         and public.resolve_classroom_archive_resource_classroom_id($2, staged.row_id) = $3',
      v_resource.table_name,
      v_resource.primary_key_column
    ) into v_restored_count
      using p_operation_id, v_resource.table_name, v_operation.classroom_id;
    v_expected_count := (v_operation.resource_counts->>v_resource.table_name)::integer;
    if v_restored_count <> v_expected_count then
      raise exception 'Restored classroom ownership verification failed for %', v_resource.table_name
        using errcode = '40001';
    end if;
  end loop;

  v_final_verification := p_verification || jsonb_build_object(
    'referential_integrity_verified', true
  );

  update public.classroom_archive_operations
  set
    status = 'completed',
    verification = v_final_verification,
    error_code = null,
    retryable = null,
    completed_at = v_now,
    updated_at = v_now
  where id = p_operation_id;
  delete from public.classroom_archive_restore_staging where operation_id = p_operation_id;
  delete from public.classroom_archive_object_upload_cleanup
  where operation_id = p_operation_id;
  delete from public.classroom_cold_tombstones where classroom_id = v_operation.classroom_id;

  return jsonb_build_object(
    'ok', true,
    'status', 201,
    'operation_id', p_operation_id,
    'archive_id', v_operation.archive_id,
    'operation_status', 'completed',
    'replayed', false,
    'resource_counts', v_operation.resource_counts,
    'verification', v_final_verification
  );
end;
$$;

create or replace function public.fail_classroom_archive_restore(
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
  v_operation public.classroom_archive_operations;
begin
  if p_error_code !~ '^[a-z0-9_]+$' then
    raise exception 'Invalid classroom archive restore error code'
      using errcode = '22023';
  end if;
  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
    and teacher_id = p_teacher_id
    and operation_type = 'restore'
  for update;
  if v_operation.id is null or v_operation.status = 'completed' then
    return false;
  end if;
  if v_operation.status = 'failed' and v_operation.retryable is false then
    return v_operation.error_code = 'archive_snapshot_expired';
  end if;
  if v_operation.snapshot_expires_at <= now() then
    update public.classroom_archive_operations
    set
      status = 'failed',
      error_code = 'archive_snapshot_expired',
      retryable = false,
      updated_at = clock_timestamp()
    where id = p_operation_id;
    delete from public.classroom_archive_restore_staging where operation_id = p_operation_id;
    update public.classroom_archive_object_upload_cleanup
    set status = 'pending', next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
    where operation_id = p_operation_id and status = 'staged';
    return true;
  end if;

  update public.classroom_archive_operations
  set
    status = 'failed',
    error_code = p_error_code,
    retryable = p_retryable,
    updated_at = clock_timestamp()
  where id = p_operation_id;
  if not p_retryable then
    delete from public.classroom_archive_restore_staging where operation_id = p_operation_id;
    update public.classroom_archive_object_upload_cleanup
    set status = 'pending', next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
    where operation_id = p_operation_id and status = 'staged';
  end if;
  return true;
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
      updated_at = clock_timestamp()
    where (
        status = 'snapshot_ready'
        or (status = 'failed' and retryable is true)
      )
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
  update public.classroom_archive_object_upload_cleanup
  set status = 'pending', next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
  where operation_id = any(v_operation_ids) and status = 'staged';
  return cardinality(v_operation_ids);
end;
$$;

create or replace function public.claim_due_classroom_archive_object_upload_cleanup(
  p_lease_token uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns table (
  operation_id uuid,
  storage_bucket text,
  storage_path text,
  attempt_count integer
)
language plpgsql
set search_path = public
as $$
begin
  if p_lease_token is null
    or p_limit is null or p_limit < 1 or p_limit > 100
    or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 1800
  then
    raise exception 'Invalid classroom archive object cleanup claim'
      using errcode = '22023';
  end if;
  return query
  with candidates as (
    select cleanup.operation_id, cleanup.storage_bucket, cleanup.storage_path
    from public.classroom_archive_object_upload_cleanup cleanup
    join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
    where operation.status = 'failed'
      and operation.retryable is false
      and cleanup.next_attempt_at <= clock_timestamp()
      and (
        cleanup.status in ('pending', 'failed')
        or (cleanup.status = 'processing' and cleanup.lease_expires_at <= clock_timestamp())
      )
    order by cleanup.next_attempt_at, cleanup.created_at
    for update of cleanup skip locked
    limit p_limit
  ), claimed as (
    update public.classroom_archive_object_upload_cleanup cleanup
    set status = 'processing', attempt_count = cleanup.attempt_count + 1,
        lease_token = p_lease_token,
        lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
        last_error_code = null, updated_at = clock_timestamp()
    from candidates
    where cleanup.operation_id = candidates.operation_id
      and cleanup.storage_bucket = candidates.storage_bucket
      and cleanup.storage_path = candidates.storage_path
    returning cleanup.operation_id, cleanup.storage_bucket, cleanup.storage_path,
      cleanup.attempt_count
  )
  select * from claimed;
end;
$$;

create or replace function public.renew_classroom_archive_object_upload_cleanup_lease(
  p_operation_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_lease_token uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
set search_path = public
as $$
declare v_updated boolean;
begin
  if p_lease_token is null or p_lease_seconds < 30 or p_lease_seconds > 1800 then
    raise exception 'Invalid classroom archive object cleanup renewal'
      using errcode = '22023';
  end if;
  update public.classroom_archive_object_upload_cleanup
  set lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
  where operation_id = p_operation_id
    and storage_bucket = p_storage_bucket
    and storage_path = p_storage_path
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp();
  v_updated := found;
  return v_updated;
end;
$$;

create or replace function public.complete_classroom_archive_object_upload_cleanup(
  p_operation_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_lease_token uuid
)
returns boolean
language plpgsql
set search_path = public
as $$
declare v_updated boolean;
begin
  update public.classroom_archive_object_upload_cleanup
  set status = 'deleted', lease_token = null, lease_expires_at = null,
      last_error_code = null, deleted_at = clock_timestamp(), updated_at = clock_timestamp()
  where operation_id = p_operation_id
    and storage_bucket = p_storage_bucket
    and storage_path = p_storage_path
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp();
  v_updated := found;
  return v_updated;
end;
$$;

create or replace function public.fail_classroom_archive_object_upload_cleanup(
  p_operation_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_lease_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare v_updated boolean;
begin
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{3,80}$' then
    raise exception 'Invalid classroom archive object cleanup failure'
      using errcode = '22023';
  end if;
  update public.classroom_archive_object_upload_cleanup
  set status = 'failed', lease_token = null, lease_expires_at = null,
      last_error_code = p_error_code,
      next_attempt_at = clock_timestamp() + make_interval(
        mins => least(1440, greatest(1, power(2, least(attempt_count, 10))::integer))
      ),
      updated_at = clock_timestamp()
  where operation_id = p_operation_id
    and storage_bucket = p_storage_bucket
    and storage_path = p_storage_path
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp();
  v_updated := found;
  return v_updated;
end;
$$;

revoke all on table public.classroom_cold_tombstones from public, anon, authenticated;
revoke all on table public.classroom_archive_restore_staging from public, anon, authenticated;
revoke all on table public.classroom_archive_restore_expected_objects from public, anon, authenticated;
grant select on table public.classroom_cold_tombstones to service_role;
grant select on table public.classroom_archive_restore_staging to service_role;
grant select, insert on table public.classroom_archive_restore_expected_objects to service_role;

revoke all on function public.begin_classroom_archive_restore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.stage_classroom_archive_restore_rows(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.stage_classroom_archive_object_upload(uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.complete_classroom_archive_restore(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_classroom_archive_restore(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.claim_due_classroom_archive_object_upload_cleanup(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.renew_classroom_archive_object_upload_cleanup_lease(uuid, text, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_classroom_archive_object_upload_cleanup(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.fail_classroom_archive_object_upload_cleanup(uuid, text, text, uuid, text) from public, anon, authenticated;

grant execute on function public.begin_classroom_archive_restore(uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, bigint) to service_role;
grant execute on function public.stage_classroom_archive_restore_rows(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.stage_classroom_archive_object_upload(uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.complete_classroom_archive_restore(uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_classroom_archive_restore(uuid, uuid, text, boolean) to service_role;
grant execute on function public.claim_due_classroom_archive_object_upload_cleanup(uuid, integer, integer) to service_role;
grant execute on function public.renew_classroom_archive_object_upload_cleanup_lease(uuid, text, text, uuid, integer) to service_role;
grant execute on function public.complete_classroom_archive_object_upload_cleanup(uuid, text, text, uuid) to service_role;
grant execute on function public.fail_classroom_archive_object_upload_cleanup(uuid, text, text, uuid, text) to service_role;

comment on table public.classroom_cold_tombstones is
  'Minimal durable identity for a verified cold classroom; intentionally has no classroom foreign key.';
comment on table public.classroom_archive_restore_staging is
  'Short-lived, bounded row staging for resumable classroom archive restore.';
comment on table public.classroom_archive_object_upload_cleanup is
  'Durable upload intents for export and restore objects; successful finalization clears them and terminal failures authorize bounded cleanup.';
