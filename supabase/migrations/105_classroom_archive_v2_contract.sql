-- Additive classroom archive-v2 data contract.
--
-- The deployed v1 RPCs continue to use classroom_archive_resource_contract.
-- New version-aware paths use classroom_archive_resource_contract_versions.
-- Existing v1 public signatures and service-role grants remain available;
-- compatibility wrappers strengthen version and envelope safety internally.
-- Existing foreign keys and the archive format check are broadened in place
-- because their original definitions admit only the v1 graph.
-- This migration does not backfill or remove the legacy Quiz source tables.

create table public.classroom_retired_assessment_records (
  id uuid primary key,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  source_contract text not null check (
    source_contract = btrim(source_contract)
    and length(source_contract) between 1 and 160
  ),
  source_contract_version integer not null check (source_contract_version > 0),
  source_resource text not null check (
    source_resource = btrim(source_resource)
    and length(source_resource) between 1 and 160
  ),
  source_row_id uuid not null,
  parent_source_resource text,
  parent_source_row_id uuid,
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload->'id') = 'string'
    and payload->>'id' = source_row_id::text
  ),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  checksum_algorithm text not null check (
    checksum_algorithm = 'sha256-canonical-json-v1'
  ),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  unique (
    classroom_id,
    source_contract,
    source_contract_version,
    source_resource,
    source_row_id
  ),
  check (
    (parent_source_resource is null and parent_source_row_id is null)
    or (
      parent_source_resource is not null
      and parent_source_resource = btrim(parent_source_resource)
      and length(parent_source_resource) between 1 and 160
      and parent_source_row_id is not null
    )
  ),
  foreign key (
    classroom_id,
    source_contract,
    source_contract_version,
    parent_source_resource,
    parent_source_row_id
  ) references public.classroom_retired_assessment_records (
    classroom_id,
    source_contract,
    source_contract_version,
    source_resource,
    source_row_id
  ) deferrable initially deferred
);

create index idx_classroom_retired_assessment_records_classroom
  on public.classroom_retired_assessment_records (
    classroom_id,
    source_contract,
    source_contract_version,
    source_resource,
    source_row_id
  );

create index idx_classroom_retired_assessment_records_parent
  on public.classroom_retired_assessment_records (
    classroom_id,
    source_contract,
    source_contract_version,
    parent_source_resource,
    parent_source_row_id
  )
  where parent_source_resource is not null;

create table public.classroom_retired_assessment_record_actors (
  id uuid primary key,
  record_id uuid not null
    references public.classroom_retired_assessment_records (id) on delete cascade,
  actor_id uuid not null references public.users (id) on delete restrict,
  source_column text not null check (
    source_column = btrim(source_column)
    and length(source_column) between 1 and 160
  ),
  unique (record_id, source_column, actor_id)
);

create index idx_classroom_retired_assessment_record_actors_record
  on public.classroom_retired_assessment_record_actors (record_id, id);

create index idx_classroom_retired_assessment_record_actors_actor
  on public.classroom_retired_assessment_record_actors (actor_id, record_id);

alter table public.classroom_retired_assessment_records enable row level security;
alter table public.classroom_retired_assessment_record_actors enable row level security;

revoke all on table public.classroom_retired_assessment_records
  from public, anon, authenticated;
revoke all on table public.classroom_retired_assessment_record_actors
  from public, anon, authenticated;
grant select on table public.classroom_retired_assessment_records to service_role;
grant select on table public.classroom_retired_assessment_record_actors to service_role;

comment on table public.classroom_retired_assessment_records is
  'Private classroom archive payloads for retired assessment source contracts; includes teacher content, student work, and grades.';
comment on table public.classroom_retired_assessment_record_actors is
  'Private normalized actor references for retired classroom assessment payloads; includes student identity.';

create table public.classroom_archive_resource_contract_versions (
  format_version integer not null check (format_version in (1, 2)),
  table_name text not null,
  primary_key_columns text[] not null,
  parent_table text,
  parent_column text,
  actor_columns text[] not null default array[]::text[],
  restore_after text[] not null,
  export_position integer not null,
  primary key (format_version, table_name),
  unique (format_version, export_position),
  check (cardinality(primary_key_columns) = 1),
  check (
    (table_name = 'classrooms' and parent_table is null and parent_column is null)
    or
    (table_name <> 'classrooms' and parent_table is not null and parent_column is not null)
  )
);

insert into public.classroom_archive_resource_contract_versions (
  format_version,
  table_name,
  primary_key_columns,
  parent_table,
  parent_column,
  actor_columns,
  restore_after,
  export_position
)
select
  1,
  table_name,
  primary_key_columns,
  parent_table,
  parent_column,
  actor_columns,
  restore_after,
  export_position
from public.classroom_archive_resource_contract
order by export_position;

insert into public.classroom_archive_resource_contract_versions (
  format_version,
  table_name,
  primary_key_columns,
  parent_table,
  parent_column,
  actor_columns,
  restore_after,
  export_position
)
select
  2,
  table_name,
  primary_key_columns,
  parent_table,
  parent_column,
  actor_columns,
  array(
    select dependency
    from unnest(restore_after) dependency
    where dependency not in (
      'quizzes',
      'quiz_questions',
      'quiz_responses',
      'quiz_student_scores'
    )
  ),
  row_number() over (order by export_position)::integer - 1
from public.classroom_archive_resource_contract
where table_name not in (
  'quizzes',
  'quiz_questions',
  'quiz_responses',
  'quiz_student_scores'
)
order by export_position;

insert into public.classroom_archive_resource_contract_versions (
  format_version,
  table_name,
  primary_key_columns,
  parent_table,
  parent_column,
  actor_columns,
  restore_after,
  export_position
)
values
  (
    2,
    'classroom_retired_assessment_records',
    array['id'],
    'classrooms',
    'classroom_id',
    array[]::text[],
    array['classrooms'],
    (
      select max(export_position) + 1
      from public.classroom_archive_resource_contract_versions
      where format_version = 2
    )
  ),
  (
    2,
    'classroom_retired_assessment_record_actors',
    array['id'],
    'classroom_retired_assessment_records',
    'record_id',
    array['actor_id'],
    array['classroom_retired_assessment_records'],
    (
      select max(export_position) + 2
      from public.classroom_archive_resource_contract_versions
      where format_version = 2
    )
  );

alter table public.classroom_archive_resource_contract_versions
  add constraint classroom_archive_resource_versions_parent_fkey
  foreign key (format_version, parent_table)
  references public.classroom_archive_resource_contract_versions (
    format_version,
    table_name
  )
  deferrable initially deferred;

alter table public.classroom_archive_resource_contract_versions
  enable row level security;
revoke all on table public.classroom_archive_resource_contract_versions
  from public, anon, authenticated;
grant select on table public.classroom_archive_resource_contract_versions
  to service_role;

comment on table public.classroom_archive_resource_contract_versions is
  'Version-pinned archive resource graphs. The original unversioned registry remains the deployed v1 compatibility surface.';

alter table public.classroom_archive_operations
  add column source_contract_version integer not null default 1,
  add column archive_format_version integer not null default 1,
  add column restore_contract_version integer not null default 1,
  add column source_resource_counts jsonb not null default '{}'::jsonb;

update public.classroom_archive_operations
set source_resource_counts = resource_counts;

alter table public.classroom_archive_operations
  add constraint classroom_archive_operations_source_contract_version_check
    check (source_contract_version in (1, 2)),
  add constraint classroom_archive_operations_archive_format_version_check
    check (archive_format_version in (1, 2)),
  add constraint classroom_archive_operations_restore_contract_version_check
    check (restore_contract_version in (1, 2)),
  add constraint classroom_archive_operations_resource_count_shapes_check
    check (
      jsonb_typeof(resource_counts) = 'object'
      and jsonb_typeof(source_resource_counts) = 'object'
    );

alter table public.classroom_archive_snapshot_resources
  add column source_contract_version integer not null default 1;

alter table public.classroom_archive_restore_staging
  add column restore_contract_version integer not null default 1;

alter table public.classroom_archive_snapshot_resources
  drop constraint if exists classroom_archive_snapshot_resources_table_name_fkey;
alter table public.classroom_archive_restore_staging
  drop constraint if exists classroom_archive_restore_staging_table_name_fkey;

alter table public.classroom_archive_snapshot_resources
  add constraint classroom_archive_snapshot_resources_versioned_resource_fkey
  foreign key (source_contract_version, table_name)
  references public.classroom_archive_resource_contract_versions (
    format_version,
    table_name
  );

alter table public.classroom_archive_restore_staging
  add constraint classroom_archive_restore_staging_versioned_resource_fkey
  foreign key (restore_contract_version, table_name)
  references public.classroom_archive_resource_contract_versions (
    format_version,
    table_name
  );

create or replace function public.pin_classroom_archive_snapshot_contract()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_source_contract_version integer;
begin
  select source_contract_version
  into v_source_contract_version
  from public.classroom_archive_operations
  where id = new.operation_id;

  if v_source_contract_version is null then
    raise exception 'Classroom archive snapshot operation is missing'
      using errcode = '23503';
  end if;

  new.source_contract_version := v_source_contract_version;
  return new;
end;
$$;

create trigger pin_classroom_archive_snapshot_contract
before insert or update on public.classroom_archive_snapshot_resources
for each row
execute function public.pin_classroom_archive_snapshot_contract();

create or replace function public.pin_classroom_archive_restore_contract()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_restore_contract_version integer;
begin
  select restore_contract_version
  into v_restore_contract_version
  from public.classroom_archive_operations
  where id = new.operation_id;

  if v_restore_contract_version is null then
    raise exception 'Classroom archive restore operation is missing'
      using errcode = '23503';
  end if;

  new.restore_contract_version := v_restore_contract_version;
  return new;
end;
$$;

create trigger pin_classroom_archive_restore_contract
before insert or update on public.classroom_archive_restore_staging
for each row
execute function public.pin_classroom_archive_restore_contract();

alter table public.classroom_archives
  drop constraint if exists classroom_archives_format_version_check;
alter table public.classroom_archives
  add constraint classroom_archives_format_version_check
    check (format_version in (1, 2));

create or replace function public.enforce_classroom_archive_operation_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_archive_format_version integer;
begin
  select archive_format_version
  into v_archive_format_version
  from public.classroom_archive_operations
  where id = new.operation_id;

  if v_archive_format_version is distinct from new.format_version then
    raise exception 'Classroom archive metadata version differs from its operation'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_classroom_archive_operation_version
before insert on public.classroom_archives
for each row
execute function public.enforce_classroom_archive_operation_version();

create or replace function public.resolve_classroom_archive_resource_classroom_id_versioned(
  p_contract_version integer,
  p_table_name text,
  p_row_id uuid
)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v_parent_table text;
  v_parent_column text;
  v_primary_key_column text;
  v_parent_id uuid;
begin
  if p_row_id is null then
    return null;
  end if;
  if p_table_name = 'classrooms' then
    return p_row_id;
  end if;

  select parent_table, parent_column, primary_key_columns[1]
  into v_parent_table, v_parent_column, v_primary_key_column
  from public.classroom_archive_resource_contract_versions
  where format_version = p_contract_version
    and table_name = p_table_name;

  if v_parent_table is null or v_parent_column is null then
    raise exception 'Unknown classroom archive resource: %@%', p_table_name, p_contract_version
      using errcode = '22023';
  end if;

  execute format(
    'select %I from public.%I where %I = $1',
    v_parent_column,
    p_table_name,
    v_primary_key_column
  )
  into v_parent_id
  using p_row_id;

  return public.resolve_classroom_archive_resource_classroom_id_versioned(
    p_contract_version,
    v_parent_table,
    v_parent_id
  );
end;
$$;

create or replace function public.bump_classroom_archive_revision_from_versioned_resource()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_contract_version integer := tg_argv[0]::integer;
  v_parent_table text := tg_argv[1];
  v_parent_column text := tg_argv[2];
  v_old_parent_id uuid;
  v_new_parent_id uuid;
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'INSERT' then
    v_old_parent_id := nullif(to_jsonb(old)->>v_parent_column, '')::uuid;
    v_old_classroom_id :=
      public.resolve_classroom_archive_resource_classroom_id_versioned(
        v_contract_version,
        v_parent_table,
        v_old_parent_id
      );
  end if;
  if tg_op <> 'DELETE' then
    v_new_parent_id := nullif(to_jsonb(new)->>v_parent_column, '')::uuid;
    v_new_classroom_id :=
      public.resolve_classroom_archive_resource_classroom_id_versioned(
        v_contract_version,
        v_parent_table,
        v_new_parent_id
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

create trigger car_classroom_retired_assessment_records
before insert or update or delete on public.classroom_retired_assessment_records
for each row
execute function public.bump_classroom_archive_revision_from_versioned_resource(
  '2',
  'classrooms',
  'classroom_id'
);

create trigger car_classroom_retired_assessment_record_actors
before insert or update or delete on public.classroom_retired_assessment_record_actors
for each row
execute function public.bump_classroom_archive_revision_from_versioned_resource(
  '2',
  'classroom_retired_assessment_records',
  'record_id'
);

alter function public.begin_classroom_archive_export(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) set schema private;
alter function private.begin_classroom_archive_export(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) rename to begin_classroom_archive_export_v082;

revoke all on function private.begin_classroom_archive_export_v082(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated, service_role;

-- Preserve the v1 signature while preventing legacy clients from snapshotting
-- a classroom whose retired assessment envelopes would be omitted.
create or replace function public.begin_classroom_archive_export(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_request_sha256 text,
  p_source_schema_migration text,
  p_source_app_commit text,
  p_retention jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.classroom_archive_operations;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));

  select *
  into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  if v_operation.id is not null
    and (
      v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.operation_type <> 'export'
      or v_operation.request_sha256 <> p_request_sha256
      or v_operation.source_contract_version <> 1
      or v_operation.archive_format_version <> 1
    )
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'idempotency_conflict',
      'error', 'Idempotency key was already used for a different archive request',
      'retryable', false
    );
  end if;

  if v_operation.status = 'completed'
    or (v_operation.status = 'failed' and v_operation.retryable is false)
  then
    return private.begin_classroom_archive_export_v082(
      p_operation_id,
      p_teacher_id,
      p_classroom_id,
      p_request_sha256,
      p_source_schema_migration,
      p_source_app_commit,
      p_retention
    );
  end if;

  perform revision
  from public.classroom_archive_revisions
  where classroom_id = p_classroom_id
  for update;

  if exists (
    select 1
    from public.classroom_retired_assessment_records
    where classroom_id = p_classroom_id
  )
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'archive_v2_envelope_source_not_supported',
      'error', 'Retired assessment envelopes require a versioned source snapshot',
      'retryable', false
    );
  end if;

  return private.begin_classroom_archive_export_v082(
    p_operation_id,
    p_teacher_id,
    p_classroom_id,
    p_request_sha256,
    p_source_schema_migration,
    p_source_app_commit,
    p_retention
  );
end;
$$;

-- Opt-in export overload. The source snapshot remains the deployed v1 graph;
-- the application deterministically adapts it before finalizing archive-v2.
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
  v_result jsonb;
begin
  if p_source_contract_version <> 1
    or p_archive_format_version <> 2
  then
    raise exception 'Unsupported classroom archive export contract transition'
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

  perform revision
  from public.classroom_archive_revisions
  where classroom_id = p_classroom_id
  for update;

  -- Pass A snapshots the v1 relational graph and adapts it in the application.
  -- Existing envelope rows are not part of that snapshot, so fail closed rather
  -- than silently producing an incomplete re-export. Completed operations still
  -- replay deterministically after envelope rows are introduced.
  if v_operation.status is distinct from 'completed'
    and exists (
      select 1
      from public.classroom_retired_assessment_records
      where classroom_id = p_classroom_id
    )
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'archive_v2_envelope_source_not_supported',
      'error', 'Retired assessment envelopes require a versioned source snapshot',
      'retryable', false
    );
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
      source_resource_counts = case
        when status = 'completed' then source_resource_counts
        else resource_counts
      end,
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
    or v_operation.source_contract_version <> 1
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

alter function public.stage_classroom_archive_object_upload(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint
) set schema private;
alter function private.stage_classroom_archive_object_upload(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint
) rename to stage_classroom_archive_object_upload_v082;

revoke all on function private.stage_classroom_archive_object_upload_v082(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint
) from public, anon, authenticated, service_role;

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
security definer
set search_path = ''
as $$
declare
  v_archive_format_version integer;
  v_operation_type text;
begin
  select archive_format_version, operation_type
  into v_archive_format_version, v_operation_type
  from public.classroom_archive_operations
  where id = p_operation_id
    and teacher_id = p_teacher_id;

  if v_operation_type <> 'export' or v_archive_format_version = 1 then
    return private.stage_classroom_archive_object_upload_v082(
      p_operation_id,
      p_teacher_id,
      p_storage_bucket,
      p_storage_path,
      p_expected_sha256,
      p_expected_byte_size
    );
  end if;
  if v_archive_format_version = 2 then
    return public.stage_classroom_archive_object_upload_v2(
      p_operation_id,
      p_teacher_id,
      p_storage_bucket,
      p_storage_path,
      p_expected_sha256,
      p_expected_byte_size,
      v_archive_format_version
    );
  end if;
  return false;
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
  if v_operation.source_contract_version <> 1
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

  if p_resource_counts is distinct from v_operation.source_resource_counts then
    raise exception 'Classroom archive source counts do not match the snapshot'
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

-- Version-aware restore initiation. The hardened v097 begin function remains
-- authoritative for tombstone, capacity, storage, recovery, and idempotency
-- checks. It receives a transient v1-shaped count object solely because that
-- deployed function validates the compatibility registry. The durable
-- operation is immediately pinned back to the adapted v2 restore graph.
create or replace function public.begin_classroom_archive_restore_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_archive_id uuid,
  p_request_sha256 text,
  p_target_schema_migration text,
  p_adapter_chain jsonb,
  p_resource_counts jsonb,
  p_storage_objects jsonb,
  p_database_budget_bytes bigint,
  p_source_contract_version integer,
  p_restore_contract_version integer,
  p_source_resource_counts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archive public.classroom_archives;
  v_operation public.classroom_archive_operations;
  v_compat_resource_counts jsonb;
  v_contract_count integer;
  v_resource_count_key_count integer;
  v_count_key text;
  v_count_value jsonb;
  v_result jsonb;
begin
  if p_source_contract_version not in (1, 2)
    or p_restore_contract_version <> 2
    or p_resource_counts is null
    or jsonb_typeof(p_resource_counts) <> 'object'
    or p_source_resource_counts is null
    or jsonb_typeof(p_source_resource_counts) <> 'object'
  then
    raise exception 'Unsupported classroom archive restore contract transition'
      using errcode = '22023';
  end if;

  select count(*) into v_contract_count
  from public.classroom_archive_resource_contract_versions
  where format_version = p_restore_contract_version;
  select count(*) into v_resource_count_key_count
  from jsonb_object_keys(p_resource_counts);
  if v_resource_count_key_count <> v_contract_count
    or exists (
      select 1
      from public.classroom_archive_resource_contract_versions contract
      where contract.format_version = p_restore_contract_version
        and not p_resource_counts ? contract.table_name
    )
  then
    raise exception 'Restore resource counts do not match the versioned contract'
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
  if v_archive.format_version <> p_source_contract_version
    or v_archive.resource_counts <> p_source_resource_counts
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'archive_contract_mismatch',
      'error', 'Archive metadata version does not match the requested source contract',
      'retryable', false
    );
  end if;

  select jsonb_object_agg(
    contract.table_name,
    coalesce(p_source_resource_counts->contract.table_name, '0'::jsonb)
    order by contract.export_position
  )
  into v_compat_resource_counts
  from public.classroom_archive_resource_contract contract;

  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  if v_operation.id is not null then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.archive_id <> p_archive_id
      or v_operation.operation_type <> 'restore'
      or v_operation.request_sha256 <> p_request_sha256
      or v_operation.target_schema_migration <> p_target_schema_migration
      or v_operation.adapter_chain <> p_adapter_chain
      or v_operation.source_contract_version <> p_source_contract_version
      or v_operation.archive_format_version <> p_source_contract_version
      or v_operation.restore_contract_version <> p_restore_contract_version
      or v_operation.source_resource_counts <> p_source_resource_counts
      or v_operation.resource_counts <> p_resource_counts
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

    update public.classroom_archive_operations
    set resource_counts = v_compat_resource_counts
    where id = p_operation_id;
  end if;

  v_result := public.begin_classroom_archive_restore(
    p_operation_id,
    p_teacher_id,
    p_classroom_id,
    p_archive_id,
    p_request_sha256,
    p_target_schema_migration,
    p_adapter_chain,
    v_compat_resource_counts,
    p_storage_objects,
    p_database_budget_bytes
  );

  update public.classroom_archive_operations
  set
    source_contract_version = p_source_contract_version,
    archive_format_version = p_source_contract_version,
    restore_contract_version = p_restore_contract_version,
    source_resource_counts = p_source_resource_counts,
    resource_counts = p_resource_counts,
    updated_at = clock_timestamp()
  where id = p_operation_id
    and teacher_id = p_teacher_id
    and classroom_id = p_classroom_id
    and archive_id = p_archive_id
    and operation_type = 'restore'
    and request_sha256 = p_request_sha256;

  if exists (
    select 1
    from public.classroom_archive_operations
    where id = p_operation_id
      and source_contract_version = p_source_contract_version
      and restore_contract_version = p_restore_contract_version
  ) then
    v_result := v_result || jsonb_build_object(
      'resource_counts', p_resource_counts,
      'source_contract_version', p_source_contract_version,
      'archive_format_version', p_source_contract_version,
      'restore_contract_version', p_restore_contract_version
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.stage_classroom_archive_restore_rows_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_table_name text,
  p_rows jsonb,
  p_restore_contract_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.classroom_archive_operations;
  v_contract public.classroom_archive_resource_contract_versions;
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
  if p_restore_contract_version <> 2
    or p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 500
    or pg_column_size(p_rows) > 1048576
  then
    raise exception 'Restore staging batch or contract is invalid'
      using errcode = '22023';
  end if;

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
  if v_operation.restore_contract_version <> p_restore_contract_version then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'restore_contract_mismatch',
      'error', 'Restore operation contract does not match staging',
      'retryable', false
    );
  end if;
  if v_operation.status = 'snapshot_ready'
    and v_operation.snapshot_expires_at <= clock_timestamp()
  then
    update public.classroom_archive_operations
    set
      status = 'failed',
      error_code = 'archive_snapshot_expired',
      retryable = false,
      updated_at = clock_timestamp()
    where id = p_operation_id;
    delete from public.classroom_archive_restore_staging
    where operation_id = p_operation_id;
    update public.classroom_archive_object_upload_cleanup
    set
      status = 'pending',
      next_attempt_at = clock_timestamp(),
      updated_at = clock_timestamp()
    where operation_id = p_operation_id
      and status = 'staged';
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
  from public.classroom_archive_resource_contract_versions
  where format_version = p_restore_contract_version
    and table_name = p_table_name;
  if v_contract.table_name is null then
    raise exception 'Unknown classroom archive restore resource: %', p_table_name
      using errcode = '22023';
  end if;

  select array_agg(attribute.attname order by attribute.attname)
  into v_expected_columns
  from pg_attribute attribute
  join pg_class relation on relation.oid = attribute.attrelid
  join pg_namespace relation_namespace
    on relation_namespace.oid = relation.relnamespace
  where relation_namespace.nspname = 'public'
    and relation.relname = p_table_name
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = '';

  v_expected_count := (v_operation.resource_counts->>p_table_name)::integer;
  select count(*) into v_staged_count
  from public.classroom_archive_restore_staging
  where operation_id = p_operation_id
    and restore_contract_version = p_restore_contract_version
    and table_name = p_table_name;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Restore row for % must be an object', p_table_name
        using errcode = '22023';
    end if;

    v_row := public.normalize_classroom_archive_restore_row(
      p_operation_id,
      p_table_name,
      v_row
    );

    select array_agg(key order by key) into v_actual_columns
    from jsonb_object_keys(v_row) key;
    if v_actual_columns is distinct from v_expected_columns then
      raise exception 'Restore row columns do not match current schema for %', p_table_name
        using errcode = '22023';
    end if;

    begin
      execute format(
        'select to_jsonb(typed_row)
         from jsonb_populate_record(null::public.%I, $1) typed_row',
        p_table_name
      )
      into v_typed_row
      using v_row;
    exception when others then
      raise exception 'Restore row types do not match current schema for %', p_table_name
        using errcode = '22023';
    end;

    begin
      v_row_id := nullif(
        v_row->>v_contract.primary_key_columns[1],
        ''
      )::uuid;
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
      if v_parent_id is null
        or not exists (
          select 1
          from public.classroom_archive_restore_staging parent
          where parent.operation_id = p_operation_id
            and parent.restore_contract_version = p_restore_contract_version
            and parent.table_name = v_contract.parent_table
            and parent.row_id = v_parent_id
        )
      then
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
        and not exists (
          select 1 from public.users where id = v_actor_id
        )
      then
        raise exception 'Restore actor is unresolved for %.%', p_table_name, v_actor_column
          using errcode = '23503';
      end if;
    end loop;

    select row_data into v_existing
    from public.classroom_archive_restore_staging
    where operation_id = p_operation_id
      and restore_contract_version = p_restore_contract_version
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
        operation_id,
        restore_contract_version,
        table_name,
        row_id,
        row_data
      )
      values (
        p_operation_id,
        p_restore_contract_version,
        p_table_name,
        v_row_id,
        v_row
      );
      v_staged_count := v_staged_count + 1;
    end if;
  end loop;

  select count(*) into v_staged_count
  from public.classroom_archive_restore_staging
  where operation_id = p_operation_id
    and restore_contract_version = p_restore_contract_version
    and table_name = p_table_name;

  return jsonb_build_object(
    'ok', true,
    'status', 202,
    'operation_id', p_operation_id,
    'table_name', p_table_name,
    'staged_count', v_staged_count,
    'expected_count', v_expected_count,
    'restore_contract_version', p_restore_contract_version
  );
end;
$$;

create or replace function public.complete_classroom_archive_restore_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_verification jsonb,
  p_restore_contract_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior_restore_mode text :=
    current_setting('pika.classroom_archive_restore', true);
  v_prior_source_revision text :=
    current_setting('pika.classroom_archive_source_revision', true);
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
  if p_restore_contract_version <> 2 then
    raise exception 'Unsupported classroom archive restore contract'
      using errcode = '22023';
  end if;

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
  if v_operation.restore_contract_version <> p_restore_contract_version then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'restore_contract_mismatch',
      'error', 'Restore operation contract does not match finalization',
      'retryable', false
    );
  end if;
  if v_operation.status = 'failed'
    and v_operation.retryable is true
    and v_operation.snapshot_expires_at > v_now
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', v_operation.error_code,
      'error', 'Restore operation failed and can be retried',
      'retryable', true
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
  if v_operation.status <> 'snapshot_ready'
    or v_operation.snapshot_expires_at <= v_now
  then
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
    or coalesce((p_verification->>'archive_checksum_verified')::boolean, false)
      is not true
    or coalesce((p_verification->>'manifest_verified')::boolean, false)
      is not true
    or coalesce((p_verification->>'resource_checksums_verified')::boolean, false)
      is not true
    or coalesce((p_verification->>'resource_counts_verified')::boolean, false)
      is not true
    or coalesce((p_verification->>'storage_objects_verified')::boolean, false)
      is not true
    or coalesce((p_verification->>'actor_snapshots_verified')::boolean, false)
      is not true
    or coalesce((p_verification->>'schema_adapter_available')::boolean, false)
      is not true
    or coalesce(
      (p_verification->>'restored_storage_objects_verified')::boolean,
      false
    ) is not true
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
    or v_archive.format_version <> v_operation.archive_format_version
    or v_archive.resource_counts <> v_operation.source_resource_counts
    or jsonb_typeof(v_archive.storage_object_counts) <> 'object'
    or jsonb_typeof(v_archive.storage_object_counts->'by_bucket') <> 'object'
    or coalesce(v_archive.storage_object_counts->>'total_count', '') !~ '^[0-9]+$'
    or coalesce(v_archive.storage_object_counts->>'total_bytes', '') !~ '^[0-9]+$'
  then
    raise exception 'Classroom archive metadata or storage inventory is invalid'
      using errcode = '22023';
  end if;

  select count(*), coalesce(sum(expected_byte_size), 0)
  into v_staged_object_count, v_staged_object_bytes
  from public.classroom_archive_object_upload_cleanup
  where operation_id = p_operation_id
    and status = 'staged';
  if v_staged_object_count <>
      (v_archive.storage_object_counts->>'total_count')::bigint
    or v_staged_object_bytes <>
      (v_archive.storage_object_counts->>'total_bytes')::bigint
  then
    raise exception 'Restore object upload inventory differs from the archive'
      using errcode = '22023';
  end if;

  if exists (
    (
      select storage_bucket, storage_path, expected_sha256, expected_byte_size
      from public.classroom_archive_restore_expected_objects
      where operation_id = p_operation_id
      except
      select storage_bucket, storage_path, expected_sha256, expected_byte_size
      from public.classroom_archive_object_upload_cleanup
      where operation_id = p_operation_id
        and status = 'staged'
    )
    union all
    (
      select storage_bucket, storage_path, expected_sha256, expected_byte_size
      from public.classroom_archive_object_upload_cleanup
      where operation_id = p_operation_id
        and status = 'staged'
      except
      select storage_bucket, storage_path, expected_sha256, expected_byte_size
      from public.classroom_archive_restore_expected_objects
      where operation_id = p_operation_id
    )
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
      raise exception 'Restore object upload inventory differs for bucket %',
        v_bucket.storage_bucket
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
  if exists (
    select 1
    from public.classrooms
    where id = v_operation.classroom_id
  ) then
    raise exception 'Hot classroom conflicts with archive restore'
      using errcode = '23505';
  end if;

  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract_versions
    where format_version = p_restore_contract_version
    order by export_position
  loop
    v_expected_count :=
      (v_operation.resource_counts->>v_resource.table_name)::integer;
    select count(*) into v_staged_count
    from public.classroom_archive_restore_staging
    where operation_id = p_operation_id
      and restore_contract_version = p_restore_contract_version
      and table_name = v_resource.table_name;
    if v_staged_count <> v_expected_count then
      raise exception 'Restore staging count differs for %', v_resource.table_name
        using errcode = '22023';
    end if;

    execute format(
      'select count(*)
       from public.classroom_archive_restore_staging staged
       join public.%I target on target.%I = staged.row_id
       where staged.operation_id = $1
         and staged.restore_contract_version = $2
         and staged.table_name = $3',
      v_resource.table_name,
      v_resource.primary_key_column
    )
    into v_conflict_count
    using
      p_operation_id,
      p_restore_contract_version,
      v_resource.table_name;
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

  begin
    for v_resource in
      select table_name, primary_key_columns[1] as primary_key_column
      from public.classroom_archive_resource_contract_versions
      where format_version = p_restore_contract_version
      order by export_position
    loop
      select coalesce(jsonb_agg(row_data order by row_id), '[]'::jsonb)
      into v_rows
      from public.classroom_archive_restore_staging
      where operation_id = p_operation_id
        and restore_contract_version = p_restore_contract_version
        and table_name = v_resource.table_name;

      if jsonb_array_length(v_rows) > 0 then
        execute format(
          'insert into public.%I
           select *
           from jsonb_populate_recordset(null::public.%I, $1)',
          v_resource.table_name,
          v_resource.table_name
        )
        using v_rows;
      end if;

      execute format(
        'select count(*)
         from public.classroom_archive_restore_staging staged
         join public.%I restored on restored.%I = staged.row_id
         where staged.operation_id = $1
           and staged.restore_contract_version = $2
           and staged.table_name = $3
           and public.resolve_classroom_archive_resource_classroom_id_versioned(
             $2,
             $3,
             staged.row_id
           ) = $4',
        v_resource.table_name,
        v_resource.primary_key_column
      )
      into v_restored_count
      using
        p_operation_id,
        p_restore_contract_version,
        v_resource.table_name,
        v_operation.classroom_id;

      v_expected_count :=
        (v_operation.resource_counts->>v_resource.table_name)::integer;
      if v_restored_count <> v_expected_count then
        raise exception 'Restored classroom ownership verification failed for %',
          v_resource.table_name
          using errcode = '40001';
      end if;
    end loop;

    set constraints public.ensure_current_assignment_submit_history immediate;
    set constraints public.ensure_current_assignment_submit_history deferred;
  exception when others then
    perform set_config(
      'pika.classroom_archive_restore',
      coalesce(v_prior_restore_mode, 'off'),
      true
    );
    perform set_config(
      'pika.classroom_archive_source_revision',
      coalesce(v_prior_source_revision, ''),
      true
    );
    raise;
  end;

  v_final_verification := p_verification || jsonb_build_object(
    'referential_integrity_verified',
    true
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

  delete from public.classroom_archive_restore_staging
  where operation_id = p_operation_id;
  delete from public.classroom_archive_object_upload_cleanup
  where operation_id = p_operation_id;
  delete from public.classroom_cold_tombstones
  where classroom_id = v_operation.classroom_id;

  perform set_config(
    'pika.classroom_archive_restore',
    coalesce(v_prior_restore_mode, 'off'),
    true
  );
  perform set_config(
    'pika.classroom_archive_source_revision',
    coalesce(v_prior_source_revision, ''),
    true
  );

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

revoke all on function public.pin_classroom_archive_snapshot_contract()
  from public, anon, authenticated, service_role;
revoke all on function public.pin_classroom_archive_restore_contract()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_classroom_archive_operation_version()
  from public, anon, authenticated, service_role;
revoke all on function public.bump_classroom_archive_revision_from_versioned_resource()
  from public, anon, authenticated, service_role;
revoke all on function
  public.resolve_classroom_archive_resource_classroom_id_versioned(integer, text, uuid)
  from public, anon, authenticated;
grant execute on function
  public.resolve_classroom_archive_resource_classroom_id_versioned(integer, text, uuid)
  to service_role;

revoke all on function public.begin_classroom_archive_export(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.begin_classroom_archive_export(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) to service_role;

revoke all on function public.begin_classroom_archive_export_v2(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  integer,
  integer
) from public, anon, authenticated;
grant execute on function public.begin_classroom_archive_export_v2(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  integer,
  integer
) to service_role;

revoke all on function public.stage_classroom_archive_object_upload(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint
) from public, anon, authenticated;
grant execute on function public.stage_classroom_archive_object_upload(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint
) to service_role;
revoke all on function public.stage_classroom_archive_object_upload_v2(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  integer
) from public, anon, authenticated;
grant execute on function public.stage_classroom_archive_object_upload_v2(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  integer
) to service_role;

revoke all on function public.complete_classroom_archive_export_v2(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  jsonb,
  integer,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.complete_classroom_archive_export_v2(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  bigint,
  jsonb,
  integer,
  jsonb,
  jsonb,
  jsonb
) to service_role;

revoke all on function public.begin_classroom_archive_restore_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  bigint,
  integer,
  integer,
  jsonb
) from public, anon, authenticated;
grant execute on function public.begin_classroom_archive_restore_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  jsonb,
  bigint,
  integer,
  integer,
  jsonb
) to service_role;

revoke all on function public.stage_classroom_archive_restore_rows_v2(
  uuid,
  uuid,
  text,
  jsonb,
  integer
) from public, anon, authenticated;
grant execute on function public.stage_classroom_archive_restore_rows_v2(
  uuid,
  uuid,
  text,
  jsonb,
  integer
) to service_role;

revoke all on function public.complete_classroom_archive_restore_v2(
  uuid,
  uuid,
  jsonb,
  integer
) from public, anon, authenticated;
grant execute on function public.complete_classroom_archive_restore_v2(
  uuid,
  uuid,
  jsonb,
  integer
) to service_role;

comment on column public.classroom_archive_operations.source_contract_version is
  'Resource graph read from the database for export, or verified from archive metadata for restore.';
comment on column public.classroom_archive_operations.archive_format_version is
  'Immutable pika.classroom-archive metadata version produced or consumed by the operation.';
comment on column public.classroom_archive_operations.restore_contract_version is
  'Versioned resource graph staged into the current database.';
comment on column public.classroom_archive_operations.source_resource_counts is
  'Counts at the declared source contract before archive or restore adaptation.';

alter function public.complete_classroom_archive_restore(
  uuid,
  uuid,
  jsonb
) rename to complete_classroom_archive_restore_v099;
alter function public.complete_classroom_archive_restore_v099(
  uuid,
  uuid,
  jsonb
) set schema private;

revoke all on function private.complete_classroom_archive_restore_v099(
  uuid,
  uuid,
  jsonb
) from public, anon, authenticated, service_role;

create or replace function public.complete_classroom_archive_restore(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_verification jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restore_contract_version integer;
begin
  select restore_contract_version
  into v_restore_contract_version
  from public.classroom_archive_operations
  where id = p_operation_id
    and teacher_id = p_teacher_id;

  if v_restore_contract_version = 1 then
    return private.complete_classroom_archive_restore_v099(
      p_operation_id,
      p_teacher_id,
      p_verification
    );
  end if;
  if v_restore_contract_version = 2 then
    return public.complete_classroom_archive_restore_v2(
      p_operation_id,
      p_teacher_id,
      p_verification,
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

alter function public.stage_classroom_archive_restore_rows(
  uuid,
  uuid,
  text,
  jsonb
) set schema private;
alter function private.stage_classroom_archive_restore_rows(
  uuid,
  uuid,
  text,
  jsonb
) rename to stage_classroom_archive_restore_rows_v094;

revoke all on function private.stage_classroom_archive_restore_rows_v094(
  uuid,
  uuid,
  text,
  jsonb
) from public, anon, authenticated, service_role;

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
begin
  select restore_contract_version
  into v_restore_contract_version
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

revoke all on function public.complete_classroom_archive_restore(
  uuid,
  uuid,
  jsonb
) from public, anon, authenticated;
grant execute on function public.complete_classroom_archive_restore(
  uuid,
  uuid,
  jsonb
) to service_role;

revoke all on function public.stage_classroom_archive_restore_rows(
  uuid,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.stage_classroom_archive_restore_rows(
  uuid,
  uuid,
  text,
  jsonb
) to service_role;
