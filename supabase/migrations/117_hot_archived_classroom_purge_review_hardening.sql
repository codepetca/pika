-- Explicit managed-file ownership and fail-safe hot archived classroom purge.
--
-- Migrations 115 and 116 are already deployed. This migration deliberately
-- replaces their URL/JSON reference inference with exact (bucket, path)
-- ownership while preserving their durable purge/resource ledgers.

create table public.managed_storage_settings (
  singleton boolean primary key default true check (singleton),
  enforce_ownership boolean not null default false,
  hot_classroom_purge_enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.managed_storage_settings (singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.managed_storage_settings enable row level security;
revoke all on table public.managed_storage_settings from public, anon, authenticated, service_role;
grant select on table public.managed_storage_settings to service_role;

comment on table public.managed_storage_settings is
  'Operator-controlled rollout gates. Both values default false; migration application cannot enable purge.';

create table public.managed_storage_objects (
  id uuid primary key default gen_random_uuid(),
  storage_bucket text not null check (storage_bucket in (
    'assignment-artifacts',
    'submission-images',
    'test-documents'
  )),
  storage_path text not null check (
    storage_path <> ''
    and storage_path not like '/%'
    and strpos(storage_path, E'\\') = 0
    and not ('..' = any(string_to_array(storage_path, '/')))
  ),
  classroom_id uuid constraint managed_storage_objects_classroom_id_fkey
    references public.classrooms (id) on delete no action deferrable initially immediate,
  cold_classroom_id uuid references public.classroom_cold_tombstones (classroom_id) on delete restrict,
  cold_archive_id uuid references public.classroom_archives (id) on delete restrict,
  course_blueprint_id uuid references public.course_blueprints (id) on delete restrict,
  purpose text not null check (purpose in (
    'student_assignment_artifact',
    'student_inline_image',
    'teacher_test_material',
    'test_execution_snapshot',
    'legacy_classroom_file'
  )),
  status text not null default 'pending_upload' check (status in (
    'pending_upload',
    'ready',
    'cleanup_pending',
    'cleanup_processing',
    'purging'
  )),
  created_by_user_id uuid references public.users (id) on delete set null,
  data_subject_user_id uuid references public.users (id) on delete set null,
  resource_type text,
  resource_id uuid,
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  content_sha256 text check (
    content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  upload_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  ready_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique (storage_bucket, storage_path),
  check (num_nonnulls(classroom_id, cold_classroom_id, course_blueprint_id) = 1),
  check ((cold_classroom_id is null) = (cold_archive_id is null)),
  check (
    purpose not in (
      'student_assignment_artifact',
      'student_inline_image',
      'test_execution_snapshot',
      'legacy_classroom_file'
    )
    or classroom_id is not null
    or cold_classroom_id is not null
  ),
  check (
    (status = 'cleanup_processing' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'cleanup_processing' and lease_token is null and lease_expires_at is null)
  ),
  check ((status = 'ready') = (ready_at is not null))
);

create index managed_storage_objects_classroom
  on public.managed_storage_objects (classroom_id, status, created_at)
  where classroom_id is not null;
create index managed_storage_objects_cold_classroom
  on public.managed_storage_objects (cold_classroom_id, status, created_at)
  where cold_classroom_id is not null;
create index managed_storage_objects_blueprint
  on public.managed_storage_objects (course_blueprint_id, status, created_at)
  where course_blueprint_id is not null;
create index managed_storage_objects_cleanup_due
  on public.managed_storage_objects (next_attempt_at, created_at)
  where status in ('cleanup_pending', 'cleanup_processing');
create index managed_storage_objects_created_by
  on public.managed_storage_objects (created_by_user_id)
  where created_by_user_id is not null;
create index managed_storage_objects_data_subject
  on public.managed_storage_objects (data_subject_user_id)
  where data_subject_user_id is not null;

alter table public.managed_storage_objects enable row level security;
revoke all on table public.managed_storage_objects from public, anon, authenticated;
grant select on table public.managed_storage_objects to service_role;

comment on table public.managed_storage_objects is
  'Exact physical source-object ownership. One object has one lifecycle owner: a hot classroom, cold classroom tombstone, or Course Blueprint; user ids are attribution only.';

create table public.classroom_managed_storage_coverage (
  classroom_id uuid primary key constraint classroom_managed_storage_coverage_classroom_id_fkey
    references public.classrooms (id) on delete no action deferrable initially immediate,
  status text not null default 'pending' check (status in ('pending', 'verified', 'blocked')),
  inventory_version integer not null default 1 check (inventory_version > 0),
  source_revision bigint,
  reference_count integer not null default 0 check (reference_count >= 0),
  object_count integer not null default 0 check (object_count >= 0),
  inventory_sha256 text check (
    inventory_sha256 is null or inventory_sha256 ~ '^[a-f0-9]{64}$'
  ),
  error_code text,
  verified_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (status = 'verified' and verified_at is not null and inventory_sha256 is not null)
    or (status <> 'verified' and verified_at is null)
  )
);

insert into public.classroom_managed_storage_coverage (classroom_id, status)
select id, 'pending'
from public.classrooms
on conflict (classroom_id) do nothing;

alter table public.classroom_managed_storage_coverage enable row level security;
revoke all on table public.classroom_managed_storage_coverage from public, anon, authenticated;
grant select on table public.classroom_managed_storage_coverage to service_role;

-- A compacted classroom retains its exact source-object ledger through its
-- tombstone. `remaining_object_count` is decremented only after a source
-- object has been proven absent and its cold owner has been removed.
create table public.classroom_cold_managed_storage_coverage (
  classroom_id uuid primary key
    references public.classroom_cold_tombstones (classroom_id) on delete restrict,
  archive_id uuid not null references public.classroom_archives (id) on delete restrict,
  source_revision bigint not null,
  inventory_version integer not null check (inventory_version > 0),
  reference_count integer not null check (reference_count >= 0),
  object_count integer not null check (object_count >= 0),
  remaining_object_count integer not null check (
    remaining_object_count >= 0 and remaining_object_count <= object_count
  ),
  inventory_sha256 text not null check (inventory_sha256 ~ '^[a-f0-9]{64}$'),
  transferred_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (classroom_id, archive_id)
);

alter table public.classroom_cold_managed_storage_coverage enable row level security;
revoke all on table public.classroom_cold_managed_storage_coverage from public, anon, authenticated;
grant select on table public.classroom_cold_managed_storage_coverage to service_role;

alter table public.managed_storage_objects
  add constraint managed_storage_objects_cold_owner_coverage_fk
  foreign key (cold_classroom_id, cold_archive_id)
  references public.classroom_cold_managed_storage_coverage (classroom_id, archive_id)
  on delete restrict;

create or replace function public.transfer_classroom_managed_storage_to_cold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coverage public.classroom_managed_storage_coverage;
  v_object_count integer;
begin
  if current_setting('pika.classroom_archive_compaction', true) is distinct from 'on' then
    if exists (
      select 1 from public.managed_storage_objects object
      where object.classroom_id = new.classroom_id
    ) or exists (
      select 1 from public.classroom_managed_storage_coverage coverage
      where coverage.classroom_id = new.classroom_id
    ) then
      raise exception 'cold_tombstone_requires_managed_storage_transition'
        using errcode = '55000';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.classroom_archive_operations operation
    where operation.id = nullif(
        current_setting('pika.classroom_archive_compaction_operation_id', true),
        ''
      )::uuid
      and operation.classroom_id = new.classroom_id
      and operation.archive_id = new.archive_id
      and operation.source_revision = new.source_revision
      and operation.operation_type = 'compact'
      and operation.status = 'snapshot_ready'
  ) then
    raise exception 'cold_tombstone_compaction_operation_missing' using errcode = '40001';
  end if;

  select * into v_coverage
  from public.classroom_managed_storage_coverage coverage
  where coverage.classroom_id = new.classroom_id
  for update;
  if not found
    or v_coverage.status <> 'verified'
    or v_coverage.inventory_sha256 is null
    or v_coverage.source_revision is distinct from new.source_revision
  then
    raise exception 'cold_tombstone_managed_storage_coverage_unverified'
      using errcode = '40001';
  end if;

  select count(*)::integer into v_object_count
  from public.managed_storage_objects object
  where object.classroom_id = new.classroom_id;
  if v_object_count <> v_coverage.object_count
    or v_object_count <> v_coverage.reference_count
  then
    raise exception 'cold_tombstone_managed_storage_coverage_drift'
      using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.managed_storage_objects object
    where object.classroom_id = new.classroom_id
      and not exists (
        select 1
        from public.classroom_archive_source_object_cleanup cleanup
        where cleanup.classroom_id = new.classroom_id
          and cleanup.archive_id = new.archive_id
          and cleanup.storage_bucket = object.storage_bucket
          and cleanup.storage_path = object.storage_path
      )
  ) then
    raise exception 'cold_tombstone_managed_storage_cleanup_missing'
      using errcode = '40001';
  end if;

  insert into public.classroom_cold_managed_storage_coverage (
    classroom_id, archive_id, source_revision, inventory_version,
    reference_count, object_count, remaining_object_count, inventory_sha256
  ) values (
    new.classroom_id, new.archive_id, new.source_revision, v_coverage.inventory_version,
    v_coverage.reference_count, v_coverage.object_count, v_object_count,
    v_coverage.inventory_sha256
  );

  update public.managed_storage_objects object
  set
    classroom_id = null,
    cold_classroom_id = new.classroom_id,
    cold_archive_id = new.archive_id,
    updated_at = clock_timestamp()
  where object.classroom_id = new.classroom_id;
  if (select count(*) from public.managed_storage_objects object
      where object.cold_classroom_id = new.classroom_id
        and object.cold_archive_id = new.archive_id) <> v_object_count then
    raise exception 'cold_tombstone_managed_storage_transfer_incomplete'
      using errcode = '40001';
  end if;

  delete from public.classroom_managed_storage_coverage
  where classroom_id = new.classroom_id;
  return new;
end;
$$;

drop trigger if exists transfer_classroom_managed_storage_to_cold on public.classroom_cold_tombstones;
create trigger transfer_classroom_managed_storage_to_cold
after insert on public.classroom_cold_tombstones
for each row execute function public.transfer_classroom_managed_storage_to_cold();

create or replace function public.release_cold_managed_storage_on_restore()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_coverage public.classroom_cold_managed_storage_coverage;
  v_current_count integer;
  v_restore_operation_id uuid;
begin
  if current_setting('pika.classroom_archive_restore', true) is distinct from 'on' then
    if exists (
      select 1 from public.managed_storage_objects object
      where object.cold_classroom_id = old.classroom_id
    ) then
      raise exception 'cold_classroom_deletion_not_implemented' using errcode = '55000';
    end if;
    return old;
  end if;

  if not exists (select 1 from public.classrooms where id = old.classroom_id) then
    raise exception 'cold_managed_storage_restore_target_missing' using errcode = '40001';
  end if;

  select * into v_coverage
  from public.classroom_cold_managed_storage_coverage coverage
  where coverage.classroom_id = old.classroom_id
    and coverage.archive_id = old.archive_id
  for update;
  if found then
    select count(*)::integer into v_current_count
    from public.managed_storage_objects object
    where object.cold_classroom_id = old.classroom_id
      and object.cold_archive_id = old.archive_id;
    if v_current_count <> v_coverage.remaining_object_count then
      raise exception 'cold_managed_storage_restore_coverage_drift' using errcode = '40001';
    end if;
  elsif exists (
    select 1 from public.managed_storage_objects object
    where object.cold_classroom_id = old.classroom_id
      and object.cold_archive_id = old.archive_id
  ) then
    raise exception 'cold_managed_storage_restore_coverage_missing' using errcode = '40001';
  end if;

  begin
    v_restore_operation_id := nullif(
      current_setting('pika.classroom_archive_restore_operation_id', true),
      ''
    )::uuid;
  exception when invalid_text_representation then
    v_restore_operation_id := null;
  end;
  if not exists (
    select 1
    from public.classroom_archive_operations operation
    where operation.id = v_restore_operation_id
      and operation.classroom_id = old.classroom_id
      and operation.teacher_id = old.teacher_id
      and operation.archive_id = old.archive_id
      and operation.operation_type = 'restore'
      and operation.status = 'completed'
  ) then
    v_restore_operation_id := null;
  end if;

  -- The original source stays cold-owned until the restore contract has an
  -- exact replacement descriptor and the replacement object is physically
  -- present. This prevents the tombstone deletion from creating an untracked
  -- interval for a source object that may still be needed by restore.
  if exists (
    select 1 from public.managed_storage_objects object
    where object.cold_classroom_id = old.classroom_id
      and object.cold_archive_id = old.archive_id
  ) and v_restore_operation_id is null then
    raise exception 'cold_managed_storage_restore_operation_missing' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.managed_storage_objects object
    left join public.classroom_archive_restore_managed_objects descriptor
      on descriptor.operation_id = v_restore_operation_id
     and descriptor.managed_object_id = object.id
    where object.cold_classroom_id = old.classroom_id
      and object.cold_archive_id = old.archive_id
      and (
        descriptor.managed_object_id is null
        or not exists (
          select 1 from storage.objects replacement
          where replacement.bucket_id = descriptor.storage_bucket
            and replacement.name = descriptor.storage_path
        )
      )
  ) then
    raise exception 'cold_managed_storage_restore_replacement_missing' using errcode = '40001';
  end if;

  with released as (
    delete from public.managed_storage_objects object
    where object.cold_classroom_id = old.classroom_id
      and object.cold_archive_id = old.archive_id
    returning
      object.storage_bucket, object.storage_path, object.purpose,
      object.created_by_user_id, object.data_subject_user_id, object.content_type,
      object.byte_size, object.content_sha256
  )
  insert into public.managed_storage_objects (
    storage_bucket, storage_path, classroom_id, purpose, status,
    created_by_user_id, data_subject_user_id, resource_type, resource_id,
    content_type, byte_size, content_sha256, last_error_code, next_attempt_at
  )
  select
    released.storage_bucket, released.storage_path, old.classroom_id,
    released.purpose, 'cleanup_pending', released.created_by_user_id,
    released.data_subject_user_id, 'archive_restore_source', v_restore_operation_id,
    released.content_type, released.byte_size, released.content_sha256,
    'archive_restored_source_cleanup', clock_timestamp()
  from released;

  delete from public.classroom_cold_managed_storage_coverage
  where classroom_id = old.classroom_id
    and archive_id = old.archive_id;
  return old;
end;
$$;

drop trigger if exists release_cold_managed_storage_on_restore on public.classroom_cold_tombstones;
create trigger release_cold_managed_storage_on_restore
before delete on public.classroom_cold_tombstones
for each row execute function public.release_cold_managed_storage_on_restore();

create or replace function public.initialize_classroom_managed_storage_coverage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.classroom_managed_storage_coverage (
    classroom_id,
    status,
    inventory_sha256,
    verified_at
  ) values (
    new.id,
    'verified',
    encode(extensions.digest(convert_to('[]', 'UTF8'), 'sha256'), 'hex'),
    clock_timestamp()
  ) on conflict (classroom_id) do nothing;
  return new;
end;
$$;

drop trigger if exists initialize_classroom_managed_storage_coverage on public.classrooms;
create trigger initialize_classroom_managed_storage_coverage
after insert on public.classrooms
for each row execute function public.initialize_classroom_managed_storage_coverage();

create table public.classroom_archive_restore_managed_objects (
  operation_id uuid not null
    references public.classroom_archive_operations (id) on delete cascade,
  managed_object_id uuid not null,
  storage_bucket text not null check (storage_bucket in (
    'assignment-artifacts', 'submission-images', 'test-documents'
  )),
  storage_path text not null check (btrim(storage_path) <> ''),
  purpose text not null check (purpose in (
    'student_assignment_artifact',
    'student_inline_image',
    'teacher_test_material',
    'test_execution_snapshot',
    'legacy_classroom_file'
  )),
  created_by_user_id uuid references public.users (id) on delete set null,
  data_subject_user_id uuid references public.users (id) on delete set null,
  resource_type text,
  resource_id uuid,
  content_type text,
  created_at timestamptz not null default clock_timestamp(),
  primary key (operation_id, managed_object_id),
  unique (operation_id, storage_bucket, storage_path)
);

alter table public.classroom_archive_restore_managed_objects enable row level security;
revoke all on table public.classroom_archive_restore_managed_objects
  from public, anon, authenticated;
grant select on table public.classroom_archive_restore_managed_objects to service_role;

create or replace function public.begin_classroom_archive_restore_managed_v2(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_archive_id uuid,
  p_request_sha256 text,
  p_target_schema_migration text,
  p_adapter_chain jsonb,
  p_resource_counts jsonb,
  p_storage_objects jsonb,
  p_managed_objects jsonb,
  p_database_budget_bytes bigint,
  p_source_contract_version integer,
  p_restore_contract_version integer,
  p_source_resource_counts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_descriptor jsonb;
begin
  if jsonb_typeof(p_managed_objects) <> 'array'
    or jsonb_array_length(p_managed_objects) <> jsonb_array_length(p_storage_objects)
  then
    raise exception 'Invalid managed restore inventory' using errcode = '22023';
  end if;
  for v_descriptor in select value from jsonb_array_elements(p_managed_objects)
  loop
    if jsonb_typeof(v_descriptor) <> 'object'
      or v_descriptor - 'managed_object_id' - 'storage_bucket' - 'storage_path'
        - 'purpose' - 'created_by_user_id' - 'data_subject_user_id'
        - 'resource_type' - 'resource_id' - 'content_type' <> '{}'::jsonb
      or public.managed_storage_uuid(v_descriptor->>'managed_object_id') is null
      or v_descriptor->>'purpose' not in (
        'student_assignment_artifact', 'student_inline_image',
        'teacher_test_material', 'test_execution_snapshot',
        'legacy_classroom_file'
      )
      or not exists (
        select 1
        from jsonb_array_elements(p_storage_objects) storage_object(value)
        where storage_object.value->>'storage_bucket' = v_descriptor->>'storage_bucket'
          and storage_object.value->>'storage_path' = v_descriptor->>'storage_path'
      )
    then
      raise exception 'Invalid managed restore descriptor' using errcode = '22023';
    end if;
  end loop;

  v_result := public.begin_classroom_archive_restore_v2(
    p_operation_id,
    p_teacher_id,
    p_classroom_id,
    p_archive_id,
    p_request_sha256,
    p_target_schema_migration,
    p_adapter_chain,
    p_resource_counts,
    p_storage_objects,
    p_database_budget_bytes,
    p_source_contract_version,
    p_restore_contract_version,
    p_source_resource_counts
  );
  if coalesce((v_result->>'ok')::boolean, false) is false then
    return v_result;
  end if;

  insert into public.classroom_archive_restore_managed_objects (
    operation_id,
    managed_object_id,
    storage_bucket,
    storage_path,
    purpose,
    created_by_user_id,
    data_subject_user_id,
    resource_type,
    resource_id,
    content_type
  )
  select
    p_operation_id,
    (descriptor.value->>'managed_object_id')::uuid,
    descriptor.value->>'storage_bucket',
    descriptor.value->>'storage_path',
    descriptor.value->>'purpose',
    nullif(descriptor.value->>'created_by_user_id', '')::uuid,
    nullif(descriptor.value->>'data_subject_user_id', '')::uuid,
    nullif(btrim(descriptor.value->>'resource_type'), ''),
    nullif(descriptor.value->>'resource_id', '')::uuid,
    nullif(btrim(descriptor.value->>'content_type'), '')
  from jsonb_array_elements(p_managed_objects) descriptor(value)
  on conflict (operation_id, managed_object_id) do nothing;

  if exists (
    (
      select managed_object_id, storage_bucket, storage_path, purpose,
        created_by_user_id, data_subject_user_id, resource_type, resource_id, content_type
      from public.classroom_archive_restore_managed_objects
      where operation_id = p_operation_id
      except
      select
        (value->>'managed_object_id')::uuid,
        value->>'storage_bucket', value->>'storage_path', value->>'purpose',
        nullif(value->>'created_by_user_id', '')::uuid,
        nullif(value->>'data_subject_user_id', '')::uuid,
        nullif(btrim(value->>'resource_type'), ''),
        nullif(value->>'resource_id', '')::uuid,
        nullif(btrim(value->>'content_type'), '')
      from jsonb_array_elements(p_managed_objects)
    ) union all (
      select
        (value->>'managed_object_id')::uuid,
        value->>'storage_bucket', value->>'storage_path', value->>'purpose',
        nullif(value->>'created_by_user_id', '')::uuid,
        nullif(value->>'data_subject_user_id', '')::uuid,
        nullif(btrim(value->>'resource_type'), ''),
        nullif(value->>'resource_id', '')::uuid,
        nullif(btrim(value->>'content_type'), '')
      from jsonb_array_elements(p_managed_objects)
      except
      select managed_object_id, storage_bucket, storage_path, purpose,
        created_by_user_id, data_subject_user_id, resource_type, resource_id, content_type
      from public.classroom_archive_restore_managed_objects
      where operation_id = p_operation_id
    )
  ) then
    raise exception 'Managed restore inventory changed' using errcode = '40001';
  end if;
  return v_result;
end;
$$;

-- Blueprint copies are operational until the target Blueprint/classroom graph
-- atomically adopts them. The existing Blueprint operation remains authority.
alter table public.course_blueprint_operations
  add column storage_copy_status text not null default 'not_required'
    check (storage_copy_status in (
      'not_required', 'copying', 'completed', 'failed'
    ));

create table public.course_blueprint_storage_copy_items (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.course_blueprint_operations (id) on delete cascade,
  source_object_id uuid references public.managed_storage_objects (id) on delete set null,
  source_storage_bucket text not null check (source_storage_bucket in (
    'assignment-artifacts',
    'submission-images',
    'test-documents'
  )),
  source_storage_path text not null check (btrim(source_storage_path) <> ''),
  target_object_id uuid not null,
  target_storage_bucket text not null check (target_storage_bucket in (
    'assignment-artifacts',
    'submission-images',
    'test-documents'
  )),
  target_storage_path text not null check (
    target_storage_path <> ''
    and target_storage_path not like '/%'
    and strpos(target_storage_path, E'\\') = 0
    and not ('..' = any(string_to_array(target_storage_path, '/')))
  ),
  target_classroom_id uuid references public.classrooms (id) on delete set null,
  target_course_blueprint_id uuid references public.course_blueprints (id) on delete set null,
  purpose text not null check (purpose = 'teacher_test_material'),
  target_resource_type text not null check (
    target_resource_type in ('course_blueprint_assessment', 'test')
  ),
  target_resource_id uuid not null,
  target_document_id text not null check (btrim(target_document_id) <> ''),
  target_public_url text,
  content_type text,
  status text not null default 'planned' check (status in (
    'planned', 'copying', 'copied', 'adopted', 'failed'
  )),
  expected_byte_size bigint check (expected_byte_size is null or expected_byte_size >= 0),
  expected_sha256 text check (
    expected_sha256 is null or expected_sha256 ~ '^[a-f0-9]{64}$'
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (operation_id, source_object_id),
  unique (target_object_id),
  unique (target_storage_bucket, target_storage_path),
  check (
    (status <> 'adopted' and source_object_id is not null)
    or status = 'adopted'
  ),
  check (
    (status <> 'adopted' and num_nonnulls(target_classroom_id, target_course_blueprint_id) = 1)
    or (status = 'adopted' and num_nonnulls(target_classroom_id, target_course_blueprint_id) <= 1)
  ),
  check (
    (status = 'copying' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'copying' and lease_token is null and lease_expires_at is null)
  )
);

alter table public.course_blueprint_storage_copy_items enable row level security;
revoke all on table public.course_blueprint_storage_copy_items from public, anon, authenticated;
grant select on table public.course_blueprint_storage_copy_items to service_role;

create or replace function public.refresh_classroom_managed_storage_coverage(
  p_classroom_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_inventory_sha256 text;
begin
  if p_classroom_id is null or not exists (
    select 1
    from public.classroom_managed_storage_coverage coverage
    where coverage.classroom_id = p_classroom_id
      and coverage.status = 'verified'
  ) then
    return;
  end if;

  select
    count(*)::integer,
    encode(
      extensions.digest(
        convert_to(
          coalesce(
            jsonb_agg(
              jsonb_build_array(object.storage_bucket, object.storage_path)
              order by object.storage_bucket, object.storage_path
            )::text,
            '[]'
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  into v_count, v_inventory_sha256
  from public.managed_storage_objects object
  where object.classroom_id = p_classroom_id;

  update public.classroom_managed_storage_coverage
  set
    reference_count = v_count,
    object_count = v_count,
    inventory_sha256 = v_inventory_sha256,
    updated_at = clock_timestamp()
  where classroom_id = p_classroom_id
    and status = 'verified';
end;
$$;

create or replace function public.refresh_managed_storage_coverage_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.refresh_classroom_managed_storage_coverage(old.classroom_id);
  end if;
  if tg_op <> 'DELETE'
    and (tg_op = 'INSERT' or new.classroom_id is distinct from old.classroom_id)
  then
    perform public.refresh_classroom_managed_storage_coverage(new.classroom_id);
  elsif tg_op = 'UPDATE' and new.classroom_id is not null then
    perform public.refresh_classroom_managed_storage_coverage(new.classroom_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger refresh_managed_storage_coverage_after_change
after insert or update or delete on public.managed_storage_objects
for each row execute function public.refresh_managed_storage_coverage_after_change();

-- Archived capture creates an immutable provenance Version in the same
-- transaction as the draft Blueprint. Keep that historical Version portable:
-- managed classroom documents are staged only in the mutable draft and are
-- added to a new final Version after their Blueprint-owned copies are adopted.
create or replace function public.remove_blueprint_managed_storage_documents(
  p_value jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_set(
    p_value,
    '{assessments}',
    coalesce((
      select jsonb_agg(
        assessment.value || jsonb_build_object(
          'documents',
          coalesce((
            select jsonb_agg(document.value order by document.ordinality)
            from jsonb_array_elements(
              coalesce(assessment.value->'documents', '[]'::jsonb)
            ) with ordinality document(value, ordinality)
            where not (
              jsonb_typeof(document.value) = 'object'
              and document.value ? 'managed_object_id'
            )
          ), '[]'::jsonb)
        )
        order by assessment.ordinality
      )
      from jsonb_array_elements(
        coalesce(p_value->'assessments', '[]'::jsonb)
      ) with ordinality assessment(value, ordinality)
    ), '[]'::jsonb),
    true
  );
$$;

alter function public.archived_classroom_blueprint_snapshot_from_plan(uuid, bigint, jsonb)
  rename to archived_classroom_blueprint_snapshot_from_plan_legacy_117;

create or replace function public.archived_classroom_blueprint_snapshot_from_plan(
  p_blueprint_id uuid,
  p_draft_revision bigint,
  p_plan jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select public.remove_blueprint_managed_storage_documents(
    public.archived_classroom_blueprint_snapshot_from_plan_legacy_117(
      p_blueprint_id,
      p_draft_revision,
      p_plan
    )
  );
$$;

revoke all on function public.remove_blueprint_managed_storage_documents(jsonb)
  from public, anon, authenticated;
grant execute on function public.remove_blueprint_managed_storage_documents(jsonb)
  to service_role;
revoke all on function public.archived_classroom_blueprint_snapshot_from_plan(uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.archived_classroom_blueprint_snapshot_from_plan(uuid, bigint, jsonb)
  to service_role;

alter function public.complete_classroom_archive_restore(uuid, uuid, jsonb)
  rename to complete_classroom_archive_restore_legacy_117;

create or replace function public.complete_classroom_archive_restore(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_verification jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_operation public.classroom_archive_operations;
  v_result jsonb;
begin
  perform set_config(
    'pika.classroom_archive_restore_operation_id',
    p_operation_id::text,
    true
  );
  v_result := public.complete_classroom_archive_restore_legacy_117(
    p_operation_id,
    p_teacher_id,
    p_verification
  );
  if coalesce((v_result->>'ok')::boolean, false) is false then
    return v_result;
  end if;

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
    and teacher_id = p_teacher_id
    and operation_type = 'restore'
    and status = 'completed'
  for update;
  if not found then
    raise exception 'Managed restore operation was not completed' using errcode = '40001';
  end if;
  if not exists (
    select 1 from public.classroom_archive_restore_managed_objects
    where operation_id = p_operation_id
  ) then
    return v_result;
  end if;
  if exists (
    select 1
    from public.classroom_archive_restore_managed_objects descriptor
    where descriptor.operation_id = p_operation_id
      and not exists (
        select 1 from storage.objects object
        where object.bucket_id = descriptor.storage_bucket
          and object.name = descriptor.storage_path
      )
  ) then
    raise exception 'Managed restored object is missing' using errcode = '55000';
  end if;

  perform set_config('pika.classroom_archive_restore', 'on', true);
  insert into public.managed_storage_objects (
    id,
    storage_bucket,
    storage_path,
    classroom_id,
    purpose,
    status,
    created_by_user_id,
    data_subject_user_id,
    resource_type,
    resource_id,
    content_type,
    ready_at
  )
  select
    descriptor.managed_object_id,
    descriptor.storage_bucket,
    descriptor.storage_path,
    v_operation.classroom_id,
    descriptor.purpose,
    'ready',
    descriptor.created_by_user_id,
    descriptor.data_subject_user_id,
    descriptor.resource_type,
    descriptor.resource_id,
    descriptor.content_type,
    clock_timestamp()
  from public.classroom_archive_restore_managed_objects descriptor
  where descriptor.operation_id = p_operation_id
  on conflict (id) do nothing;

  if exists (
    select 1
    from public.classroom_archive_restore_managed_objects descriptor
    left join public.managed_storage_objects object
      on object.id = descriptor.managed_object_id
     and object.storage_bucket = descriptor.storage_bucket
     and object.storage_path = descriptor.storage_path
     and object.classroom_id = v_operation.classroom_id
     and object.course_blueprint_id is null
     and object.purpose = descriptor.purpose
     and object.status = 'ready'
    where descriptor.operation_id = p_operation_id
      and object.id is null
  ) then
    raise exception 'Managed restored object ownership conflicts' using errcode = '23505';
  end if;
  perform public.refresh_classroom_managed_storage_coverage(v_operation.classroom_id);
  return v_result;
end;
$$;

-- Migration 085 inserts the tombstone before it sets its compaction context.
-- Keep its tested relational finalizer intact and establish the context in a
-- narrow wrapper so the tombstone trigger can atomically transfer managed
-- ownership before the classroom root is deleted.
alter function public.complete_classroom_archive_compaction(uuid, uuid, jsonb, jsonb)
  rename to complete_classroom_archive_compaction_legacy_117;

create or replace function public.complete_classroom_archive_compaction(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_actors jsonb,
  p_verification jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
begin
  perform set_config('pika.classroom_archive_compaction', 'on', true);
  perform set_config(
    'pika.classroom_archive_compaction_operation_id',
    p_operation_id::text,
    true
  );
  -- Migration 085's preflight exercises the real classroom DELETE in a
  -- rolled-back subtransaction before its tombstone exists. Defer only the
  -- two hot ownership FKs for that transaction; the delete trigger below
  -- admits it only with this marker and an exact snapshot-ready operation.
  perform set_config('pika.classroom_archive_compaction_dry_run', 'on', true);
  set constraints
    public.managed_storage_objects_classroom_id_fkey,
    public.classroom_managed_storage_coverage_classroom_id_fkey
    deferred;
  return public.complete_classroom_archive_compaction_legacy_117(
    p_operation_id,
    p_teacher_id,
    p_actors,
    p_verification
  );
end;
$$;

-- The app invokes the v2 contract. Rebind it to the wrapper because PL/pgSQL
-- dependencies retain the legacy function OID across an ALTER ... RENAME.
alter function public.complete_classroom_archive_compaction_v2(uuid, uuid, jsonb, jsonb, integer)
  rename to complete_classroom_archive_compaction_v2_legacy_117;

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

create or replace function public.managed_storage_uuid(p_value text)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function public.plan_course_blueprint_storage_copies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_planned integer := 0;
begin
  if new.status <> 'completed'
    or new.storage_copy_status = 'completed'
  then
    return new;
  end if;

  if new.operation_type in ('capture', 'import')
    and new.source_classroom_id is not null
    and new.result_blueprint_id is not null
  then
    if exists (
      select 1
      from public.course_blueprint_assessments assessment
      cross join lateral jsonb_array_elements(
        coalesce(assessment.documents, '[]'::jsonb)
      ) document(value)
      where assessment.course_blueprint_id = new.result_blueprint_id
        and document.value ? 'managed_object_id'
        and not exists (
          select 1
          from public.managed_storage_objects object
          join public.classrooms classroom on classroom.id = object.classroom_id
          where object.id = public.managed_storage_uuid(
              document.value->>'managed_object_id'
            )
            and object.classroom_id = new.source_classroom_id
            and classroom.teacher_id = new.teacher_id
            and object.purpose = 'teacher_test_material'
            and object.status = 'ready'
        )
    ) then
      raise exception 'blueprint_teacher_material_owner_mismatch'
        using errcode = '55000';
    end if;

    with source_references as (
      select distinct on (object.id)
        object.id source_object_id,
        object.storage_bucket,
        object.storage_path,
        object.content_type,
        object.byte_size,
        object.content_sha256,
        assessment.id target_resource_id,
        document.value->>'id' target_document_id
      from public.course_blueprint_assessments assessment
      cross join lateral jsonb_array_elements(
        coalesce(assessment.documents, '[]'::jsonb)
      ) document(value)
      join public.managed_storage_objects object
        on object.id = public.managed_storage_uuid(
          document.value->>'managed_object_id'
        )
      where assessment.course_blueprint_id = new.result_blueprint_id
        and document.value ? 'managed_object_id'
        and object.classroom_id = new.source_classroom_id
        and object.purpose = 'teacher_test_material'
        and object.status = 'ready'
      order by object.id, assessment.id, document.value->>'id'
    ), planned as (
      select source_references.*, gen_random_uuid() target_object_id
      from source_references
    )
    insert into public.course_blueprint_storage_copy_items (
      operation_id,
      source_object_id,
      source_storage_bucket,
      source_storage_path,
      target_object_id,
      target_storage_bucket,
      target_storage_path,
      target_course_blueprint_id,
      purpose,
      target_resource_type,
      target_resource_id,
      target_document_id,
      content_type,
      expected_byte_size,
      expected_sha256
    )
    select
      new.id,
      planned.source_object_id,
      planned.storage_bucket,
      planned.storage_path,
      planned.target_object_id,
      planned.storage_bucket,
      'blueprints/' || new.result_blueprint_id::text
        || '/tests/materials/' || planned.target_object_id::text
        || coalesce(substring(planned.storage_path from '(\.[A-Za-z0-9]{1,12})$'), ''),
      new.result_blueprint_id,
      'teacher_test_material',
      'course_blueprint_assessment',
      planned.target_resource_id,
      planned.target_document_id,
      planned.content_type,
      planned.byte_size,
      planned.content_sha256
    from planned
    on conflict (operation_id, source_object_id) do nothing;
    get diagnostics v_planned = row_count;
  elsif new.operation_type = 'instantiate'
    and new.source_blueprint_id is not null
    and new.result_classroom_id is not null
  then
    if exists (
      select 1
      from public.tests test
      cross join lateral jsonb_array_elements(
        coalesce(test.documents, '[]'::jsonb)
      ) document(value)
      where test.classroom_id = new.result_classroom_id
        and document.value->>'source' = 'upload'
        and public.managed_storage_uuid(
          document.value->>'managed_object_id'
        ) is null
    ) then
      raise exception 'blueprint_teacher_material_ownership_required'
        using errcode = '55000';
    end if;

    if exists (
      select 1
      from public.tests test
      cross join lateral jsonb_array_elements(
        coalesce(test.documents, '[]'::jsonb)
      ) document(value)
      where test.classroom_id = new.result_classroom_id
        and document.value ? 'managed_object_id'
        and not exists (
          select 1
          from public.managed_storage_objects object
          join public.course_blueprints blueprint
            on blueprint.id = object.course_blueprint_id
          where object.id = public.managed_storage_uuid(
              document.value->>'managed_object_id'
            )
            and object.course_blueprint_id = new.source_blueprint_id
            and blueprint.teacher_id = new.teacher_id
            and object.purpose = 'teacher_test_material'
            and object.status = 'ready'
        )
    ) then
      raise exception 'classroom_teacher_material_owner_mismatch'
        using errcode = '55000';
    end if;

    with source_references as (
      select distinct on (object.id)
        object.id source_object_id,
        object.storage_bucket,
        object.storage_path,
        object.content_type,
        object.byte_size,
        object.content_sha256,
        test.id target_resource_id,
        document.value->>'id' target_document_id
      from public.tests test
      cross join lateral jsonb_array_elements(
        coalesce(test.documents, '[]'::jsonb)
      ) document(value)
      join public.managed_storage_objects object
        on object.id = public.managed_storage_uuid(
          document.value->>'managed_object_id'
        )
      where test.classroom_id = new.result_classroom_id
        and document.value ? 'managed_object_id'
        and object.course_blueprint_id = new.source_blueprint_id
        and object.purpose = 'teacher_test_material'
        and object.status = 'ready'
      order by object.id, test.id, document.value->>'id'
    ), planned as (
      select source_references.*, gen_random_uuid() target_object_id
      from source_references
    )
    insert into public.course_blueprint_storage_copy_items (
      operation_id,
      source_object_id,
      source_storage_bucket,
      source_storage_path,
      target_object_id,
      target_storage_bucket,
      target_storage_path,
      target_classroom_id,
      purpose,
      target_resource_type,
      target_resource_id,
      target_document_id,
      content_type,
      expected_byte_size,
      expected_sha256
    )
    select
      new.id,
      planned.source_object_id,
      planned.storage_bucket,
      planned.storage_path,
      planned.target_object_id,
      planned.storage_bucket,
      'classrooms/' || new.result_classroom_id::text
        || '/tests/materials/' || planned.target_object_id::text
        || coalesce(substring(planned.storage_path from '(\.[A-Za-z0-9]{1,12})$'), ''),
      new.result_classroom_id,
      'teacher_test_material',
      'test',
      planned.target_resource_id,
      planned.target_document_id,
      planned.content_type,
      planned.byte_size,
      planned.content_sha256
    from planned
    on conflict (operation_id, source_object_id) do nothing;
    get diagnostics v_planned = row_count;
  end if;

  if v_planned > 0 or exists (
    select 1
    from public.course_blueprint_storage_copy_items item
    where item.operation_id = new.id
      and item.status <> 'adopted'
  ) then
    update public.course_blueprint_operations
    set
      status = 'running',
      storage_copy_status = 'copying',
      completed_at = null,
      updated_at = clock_timestamp()
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger plan_course_blueprint_storage_copies
after update of status, source_classroom_id, result_blueprint_id,
  source_blueprint_id, result_classroom_id
on public.course_blueprint_operations
for each row execute function public.plan_course_blueprint_storage_copies();

create or replace function public.claim_course_blueprint_storage_copy(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns setof public.course_blueprint_storage_copy_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.course_blueprint_storage_copy_items;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'invalid_blueprint_storage_copy_lease' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.course_blueprint_operations operation
    where operation.id = p_operation_id
      and operation.teacher_id = p_teacher_id
      and operation.status = 'running'
      and operation.storage_copy_status in ('copying', 'failed')
  ) then
    raise exception 'blueprint_storage_copy_operation_not_found' using errcode = 'P0002';
  end if;

  select * into v_candidate
  from public.course_blueprint_storage_copy_items item
  where item.operation_id = p_operation_id
    and item.next_attempt_at <= clock_timestamp()
    and (
      item.status in ('planned', 'failed')
      or (item.status = 'copying' and item.lease_expires_at <= clock_timestamp())
    )
  order by item.created_at, item.id
  for update skip locked
  limit 1;
  if not found then return; end if;

  return query
  update public.course_blueprint_storage_copy_items item
  set
    status = 'copying',
    attempt_count = item.attempt_count + 1,
    lease_token = p_lease_token,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    last_error_code = null,
    updated_at = clock_timestamp()
  where item.id = v_candidate.id
  returning item.*;

  update public.course_blueprint_operations
  set storage_copy_status = 'copying', updated_at = clock_timestamp()
  where id = p_operation_id;
end;
$$;

create or replace function public.complete_course_blueprint_storage_copy(
  p_item_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid,
  p_target_public_url text,
  p_byte_size bigint,
  p_content_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_item public.course_blueprint_storage_copy_items;
begin
  if p_target_public_url is null or btrim(p_target_public_url) = ''
    or p_byte_size < 0
    or p_content_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'invalid_blueprint_storage_copy_result' using errcode = '22023';
  end if;
  select item.* into v_item
  from public.course_blueprint_storage_copy_items item
  join public.course_blueprint_operations operation on operation.id = item.operation_id
  where item.id = p_item_id
    and operation.teacher_id = p_teacher_id
    and item.status = 'copying'
    and item.lease_token = p_lease_token
    and item.lease_expires_at > clock_timestamp()
  for update of item;
  if not found then return false; end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = v_item.target_storage_bucket
      and object.name = v_item.target_storage_path
  ) then
    raise exception 'blueprint_storage_copy_target_missing' using errcode = '55000';
  end if;
  if v_item.expected_byte_size is not null
    and v_item.expected_byte_size <> p_byte_size
  then
    raise exception 'blueprint_storage_copy_size_mismatch' using errcode = '40001';
  end if;
  if v_item.expected_sha256 is not null
    and v_item.expected_sha256 <> p_content_sha256
  then
    raise exception 'blueprint_storage_copy_hash_mismatch' using errcode = '40001';
  end if;
  update public.course_blueprint_storage_copy_items
  set
    status = 'copied',
    target_public_url = p_target_public_url,
    expected_byte_size = p_byte_size,
    expected_sha256 = p_content_sha256,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = null,
    updated_at = clock_timestamp()
  where id = p_item_id;
  return true;
end;
$$;

create or replace function public.fail_course_blueprint_storage_copy(
  p_item_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_id uuid;
begin
  update public.course_blueprint_storage_copy_items item
  set
    status = 'failed',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = left(
      coalesce(nullif(p_error_code, ''), 'blueprint_storage_copy_failed'),
      120
    ),
    next_attempt_at = clock_timestamp() + make_interval(
      secs => least(3600, greatest(5, (2 ^ least(item.attempt_count, 10))::integer))
    ),
    updated_at = clock_timestamp()
  from public.course_blueprint_operations operation
  where item.id = p_item_id
    and operation.id = item.operation_id
    and operation.teacher_id = p_teacher_id
    and item.status = 'copying'
    and item.lease_token = p_lease_token
  returning item.operation_id into v_operation_id;
  if v_operation_id is not null then
    update public.course_blueprint_operations
    set storage_copy_status = 'failed', updated_at = clock_timestamp()
    where id = v_operation_id;
  end if;
  return v_operation_id is not null;
end;
$$;

create or replace function public.rewrite_managed_storage_document_owner(
  p_value jsonb,
  p_source_object_id uuid,
  p_target_object_id uuid,
  p_target_public_url text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      if p_value->>'managed_object_id' = p_source_object_id::text then
        return p_value || jsonb_build_object(
          'managed_object_id', p_target_object_id,
          'url', p_target_public_url
        );
      end if;
      select jsonb_object_agg(
        entry.key,
        public.rewrite_managed_storage_document_owner(
          entry.value,
          p_source_object_id,
          p_target_object_id,
          p_target_public_url
        )
      ) into v_result
      from jsonb_each(p_value) entry;
      return coalesce(v_result, '{}'::jsonb);
    when 'array' then
      select jsonb_agg(
        public.rewrite_managed_storage_document_owner(
          item.value,
          p_source_object_id,
          p_target_object_id,
          p_target_public_url
        ) order by item.ordinality
      ) into v_result
      from jsonb_array_elements(p_value) with ordinality item(value, ordinality);
      return coalesce(v_result, '[]'::jsonb);
    else
      return p_value;
  end case;
end;
$$;

create or replace function public.prevent_blueprint_version_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and (
    not exists (
      select 1 from public.course_blueprints where id = old.course_blueprint_id
    )
    or not exists (
      select 1 from public.users where id = old.created_by
    )
  ) then
    return old;
  end if;
  raise exception 'Blueprint Versions are immutable' using errcode = '55000';
end;
$$;

create or replace function public.adopt_course_blueprint_storage_copies(
  p_operation_id uuid,
  p_teacher_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.course_blueprint_operations;
  v_item public.course_blueprint_storage_copy_items;
  v_version_id uuid;
  v_version_snapshot jsonb;
  v_final_version public.course_blueprint_versions;
  v_blueprint_revision bigint;
begin
  select * into v_operation
  from public.course_blueprint_operations
  where id = p_operation_id and teacher_id = p_teacher_id
  for update;
  if not found then
    raise exception 'blueprint_storage_copy_operation_not_found' using errcode = 'P0002';
  end if;
  if v_operation.storage_copy_status in ('not_required', 'completed') then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  if exists (
    select 1 from public.course_blueprint_storage_copy_items
    where operation_id = p_operation_id and status not in ('copied', 'adopted')
  ) then
    return jsonb_build_object(
      'ok', false,
      'error_code', 'blueprint_storage_copy_incomplete',
      'retryable', true
    );
  end if;

  v_version_id := null;
  if v_operation.operation_type in ('capture', 'import') then
    begin
      v_version_id := nullif(
        v_operation.result->>'source_blueprint_version_id',
        ''
      )::uuid;
    exception when invalid_text_representation then
      v_version_id := null;
    end;
  end if;
  if v_version_id is not null then
    select snapshot_json into v_version_snapshot
    from public.course_blueprint_versions
    where id = v_version_id
      and course_blueprint_id = v_operation.result_blueprint_id
      and created_by = p_teacher_id
    for update;
    if not found then
      raise exception 'blueprint_storage_copy_version_not_found' using errcode = 'P0002';
    end if;
  end if;

  perform set_config('pika.identity_mapping', 'on', true);

  for v_item in
    select *
    from public.course_blueprint_storage_copy_items
    where operation_id = p_operation_id and status = 'copied'
    order by created_at, id
    for update
  loop
    insert into public.managed_storage_objects (
      id,
      storage_bucket,
      storage_path,
      classroom_id,
      course_blueprint_id,
      purpose,
      status,
      created_by_user_id,
      resource_type,
      resource_id,
      content_type,
      byte_size,
      content_sha256,
      ready_at
    ) values (
      v_item.target_object_id,
      v_item.target_storage_bucket,
      v_item.target_storage_path,
      v_item.target_classroom_id,
      v_item.target_course_blueprint_id,
      v_item.purpose,
      'ready',
      p_teacher_id,
      v_item.target_resource_type,
      v_item.target_resource_id,
      v_item.content_type,
      v_item.expected_byte_size,
      v_item.expected_sha256,
      clock_timestamp()
    );

    if v_item.target_course_blueprint_id is not null then
      update public.course_blueprint_assessments assessment
      set documents = (
        select coalesce(jsonb_agg(
          case
            when document.value->>'managed_object_id' = v_item.source_object_id::text
            then document.value || jsonb_build_object(
              'managed_object_id', v_item.target_object_id,
              'url', v_item.target_public_url
            )
            else document.value
          end order by document.ordinality
        ), '[]'::jsonb)
        from jsonb_array_elements(
          coalesce(assessment.documents, '[]'::jsonb)
        ) with ordinality document(value, ordinality)
      )
      where assessment.course_blueprint_id = v_item.target_course_blueprint_id
        and exists (
          select 1
          from jsonb_array_elements(
            coalesce(assessment.documents, '[]'::jsonb)
          ) document(value)
          where document.value->>'managed_object_id' = v_item.source_object_id::text
        );
      if v_version_snapshot is not null then
        v_version_snapshot := public.rewrite_managed_storage_document_owner(
          v_version_snapshot,
          v_item.source_object_id,
          v_item.target_object_id,
          v_item.target_public_url
        );
      end if;
    else
      if not exists (
        select 1
        from public.managed_storage_objects source
        where source.id = v_item.source_object_id
          and source.course_blueprint_id = v_operation.source_blueprint_id
          and source.classroom_id is null
          and source.status = 'ready'
      ) then
        raise exception 'blueprint_storage_copy_source_owner_changed'
          using errcode = '40001';
      end if;
      update public.tests test
      set documents = (
        select coalesce(jsonb_agg(
          case
            when document.value->>'managed_object_id' = v_item.source_object_id::text
            then document.value || jsonb_build_object(
              'managed_object_id', v_item.target_object_id,
              'url', v_item.target_public_url
            )
            else document.value
          end order by document.ordinality
        ), '[]'::jsonb)
        from jsonb_array_elements(
          coalesce(test.documents, '[]'::jsonb)
        ) with ordinality document(value, ordinality)
      )
      where test.classroom_id = v_item.target_classroom_id
        and exists (
          select 1
          from jsonb_array_elements(coalesce(test.documents, '[]'::jsonb)) document(value)
          where document.value->>'managed_object_id' = v_item.source_object_id::text
        );
    end if;

    update public.course_blueprint_storage_copy_items
    set status = 'adopted', updated_at = clock_timestamp()
    where id = v_item.id;
  end loop;

  if v_version_snapshot is not null then
    v_version_snapshot := jsonb_set(
      v_version_snapshot,
      '{assessments}',
      coalesce((
        select jsonb_agg(
          snapshot_assessment.value || jsonb_build_object(
            'documents', coalesce(live_assessment.documents, '[]'::jsonb)
          )
          order by snapshot_assessment.ordinality
        )
        from jsonb_array_elements(
          coalesce(v_version_snapshot->'assessments', '[]'::jsonb)
        ) with ordinality snapshot_assessment(value, ordinality)
        left join public.course_blueprint_assessments live_assessment
          on live_assessment.course_blueprint_id = v_operation.result_blueprint_id
         and live_assessment.artifact_id::text = snapshot_assessment.value->>'artifact_id'
      ), '[]'::jsonb),
      true
    );
    select content_revision into v_blueprint_revision
    from public.course_blueprints
    where id = v_operation.result_blueprint_id
      and teacher_id = p_teacher_id
    for update;
    if not found then
      raise exception 'blueprint_storage_copy_blueprint_not_found' using errcode = 'P0002';
    end if;

    v_version_snapshot := jsonb_set(
      v_version_snapshot,
      '{draft_revision}',
      to_jsonb(v_blueprint_revision),
      true
    );
    -- This internal adoption path has already locked, copied, registered, and
    -- rewritten every exact object above; it is the only direct caller of the
    -- private Version insert implementation.
    select * into v_final_version
    from public.save_course_blueprint_version_atomic_legacy_117(
      p_teacher_id,
      v_operation.result_blueprint_id,
      v_blueprint_revision,
      coalesce((v_version_snapshot->>'schema_version')::integer, 2),
      v_version_snapshot,
      encode(
        extensions.digest(
          convert_to(
            public.course_blueprint_canonical_jsonb_text(v_version_snapshot),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      'classroom',
      jsonb_build_object(
        'operation_id', p_operation_id,
        'storage_copy_adopted_from_version_id', v_version_id
      )
    );

    update public.classrooms
    set
      source_blueprint_version_id = v_final_version.id,
      source_blueprint_origin = coalesce(source_blueprint_origin, '{}'::jsonb)
        || jsonb_build_object(
          'blueprint_version_id', v_final_version.id,
          'blueprint_version_number', v_final_version.version_number
        )
    where id = v_operation.source_classroom_id
      and source_blueprint_version_id = v_version_id;
    update public.assignments
    set source_blueprint_version_id = v_final_version.id
    where classroom_id = v_operation.source_classroom_id
      and source_blueprint_version_id = v_version_id;
    update public.assignment_submission_requirements requirement
    set source_blueprint_version_id = v_final_version.id
    where source_blueprint_version_id = v_version_id
      and exists (
        select 1 from public.assignments assignment
        where assignment.id = requirement.assignment_id
          and assignment.classroom_id = v_operation.source_classroom_id
      );
    update public.tests
    set source_blueprint_version_id = v_final_version.id
    where classroom_id = v_operation.source_classroom_id
      and source_blueprint_version_id = v_version_id;
    update public.test_questions question
    set source_blueprint_version_id = v_final_version.id
    where source_blueprint_version_id = v_version_id
      and exists (
        select 1 from public.tests test
        where test.id = question.test_id
          and test.classroom_id = v_operation.source_classroom_id
      );
    update public.lesson_plans
    set source_blueprint_version_id = v_final_version.id
    where classroom_id = v_operation.source_classroom_id
      and source_blueprint_version_id = v_version_id;
    update public.classwork_materials
    set source_blueprint_version_id = v_final_version.id
    where classroom_id = v_operation.source_classroom_id
      and source_blueprint_version_id = v_version_id;
    update public.surveys
    set source_blueprint_version_id = v_final_version.id
    where classroom_id = v_operation.source_classroom_id
      and source_blueprint_version_id = v_version_id;
    update public.survey_questions question
    set source_blueprint_version_id = v_final_version.id
    where source_blueprint_version_id = v_version_id
      and exists (
        select 1 from public.surveys survey
        where survey.id = question.survey_id
          and survey.classroom_id = v_operation.source_classroom_id
      );
  end if;

  update public.course_blueprint_operations
  set
    status = 'completed',
    storage_copy_status = 'completed',
    result = case
      when v_final_version.id is null then result
      else jsonb_set(
        result,
        '{source_blueprint_version_id}',
        to_jsonb(v_final_version.id),
        true
      )
    end,
    completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_operation_id;
  perform set_config('pika.identity_mapping', 'off', true);
  return jsonb_build_object('ok', true, 'replayed', false);
end;
$$;

alter table public.classroom_purge_objects
  add column managed_storage_object_id uuid
    references public.managed_storage_objects (id) on delete set null;
create unique index classroom_purge_objects_managed_object
  on public.classroom_purge_objects (operation_id, managed_storage_object_id)
  where managed_storage_object_id is not null;
-- Permanent key reservations are checked on every managed Storage write. The
-- purge ledger is retained indefinitely, so this lookup must not degrade into
-- an unbounded scan as completed operations accumulate.
create index classroom_purge_objects_permanent_storage_identity
  on public.classroom_purge_objects (storage_bucket, storage_path_sha256);

create or replace function public.managed_storage_identity_sha256(
  p_storage_bucket text,
  p_storage_path text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(jsonb_build_array(p_storage_bucket, p_storage_path)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$$;

create or replace function public.managed_storage_exact_lock(
  p_storage_bucket text,
  p_storage_path text
)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(p_storage_bucket, p_storage_path)::text,
      0
    )
  )
$$;

create or replace function public.begin_managed_storage_upload(
  p_object_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_classroom_id uuid,
  p_course_blueprint_id uuid,
  p_purpose text,
  p_created_by_user_id uuid,
  p_data_subject_user_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_content_type text,
  p_byte_size bigint
)
returns public.managed_storage_objects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.managed_storage_objects;
begin
  perform public.managed_storage_exact_lock(p_storage_bucket, p_storage_path);

  if p_classroom_id is not null then
    perform public.classroom_purge_lock(p_classroom_id);
    if not exists (
      select 1 from public.classrooms classroom
      where classroom.id = p_classroom_id
        and classroom.archived_at is null
    ) then
      raise exception 'classroom_not_writable' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.classroom_purge_fences
      where classroom_id = p_classroom_id
    ) then
      raise exception 'classroom_purge_active' using errcode = '55000';
    end if;
  end if;

  if p_course_blueprint_id is not null and not exists (
    select 1 from public.course_blueprints blueprint
    where blueprint.id = p_course_blueprint_id
      and blueprint.teacher_id = p_created_by_user_id
  ) then
    raise exception 'blueprint_not_owned' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.classroom_purge_objects object
    where object.storage_bucket = p_storage_bucket
      and object.storage_path_sha256 = public.managed_storage_identity_sha256(
        p_storage_bucket,
        p_storage_path
      )
  ) then
    raise exception 'storage_path_permanently_reserved' using errcode = '55000';
  end if;

  insert into public.managed_storage_objects (
    id,
    storage_bucket,
    storage_path,
    classroom_id,
    course_blueprint_id,
    purpose,
    created_by_user_id,
    data_subject_user_id,
    resource_type,
    resource_id,
    content_type,
    byte_size,
    upload_expires_at
  ) values (
    p_object_id,
    p_storage_bucket,
    p_storage_path,
    p_classroom_id,
    p_course_blueprint_id,
    p_purpose,
    p_created_by_user_id,
    p_data_subject_user_id,
    nullif(btrim(p_resource_type), ''),
    p_resource_id,
    nullif(btrim(p_content_type), ''),
    p_byte_size,
    clock_timestamp() + interval '1 hour'
  )
  returning * into v_object;

  return v_object;
end;
$$;

create or replace function public.adopt_managed_storage_upload(
  p_object_id uuid,
  p_content_sha256 text default null
)
returns public.managed_storage_objects
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_object public.managed_storage_objects;
begin
  select * into v_object
  from public.managed_storage_objects
  where id = p_object_id
  for update;

  if not found then
    raise exception 'managed_storage_object_not_found' using errcode = 'P0002';
  end if;
  perform public.managed_storage_exact_lock(v_object.storage_bucket, v_object.storage_path);
  if v_object.status = 'ready' then
    return v_object;
  end if;
  if v_object.status <> 'pending_upload' then
    raise exception 'managed_storage_object_not_adoptable' using errcode = '55000';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = v_object.storage_bucket
      and object.name = v_object.storage_path
  ) then
    raise exception 'managed_storage_upload_missing' using errcode = '55000';
  end if;

  update public.managed_storage_objects
  set
    status = 'ready',
    content_sha256 = coalesce(p_content_sha256, content_sha256),
    upload_expires_at = null,
    ready_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_object_id
  returning * into v_object;
  return v_object;
end;
$$;

create or replace function public.queue_managed_storage_cleanup(
  p_object_id uuid,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.managed_storage_objects
  set
    status = 'cleanup_pending',
    upload_expires_at = null,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = nullif(left(coalesce(p_error_code, ''), 120), ''),
    next_attempt_at = clock_timestamp(),
    ready_at = null,
    updated_at = clock_timestamp()
  where id = p_object_id
    and status in ('pending_upload', 'ready', 'cleanup_pending');
  return found;
end;
$$;

-- Removal of an object referenced by mutable test JSON must be conditional on
-- the complete server-derived ownership tuple. An object UUID by itself is not
-- authority: test-document payloads cross a client trust boundary.
create or replace function public.queue_classroom_managed_storage_cleanup(
  p_object_id uuid,
  p_classroom_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_purpose text,
  p_resource_type text,
  p_resource_id uuid,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_object_id is null
    or p_classroom_id is null
    or nullif(p_storage_bucket, '') is null
    or nullif(p_storage_path, '') is null
    or p_storage_path like '/%'
    or '' = any(string_to_array(p_storage_path, '/'))
    or '.' = any(string_to_array(p_storage_path, '/'))
    or '..' = any(string_to_array(p_storage_path, '/'))
    or nullif(p_purpose, '') is null
    or nullif(p_resource_type, '') is null
    or p_resource_id is null
  then
    return false;
  end if;

  if p_resource_type = 'test' then
    perform 1 from public.tests where id = p_resource_id for update;
    if not found then return false; end if;
  end if;

  perform public.managed_storage_exact_lock(p_storage_bucket, p_storage_path);
  update public.managed_storage_objects
  set
    status = 'cleanup_pending',
    upload_expires_at = null,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = nullif(left(coalesce(p_error_code, ''), 120), ''),
    next_attempt_at = clock_timestamp(),
    ready_at = null,
    updated_at = clock_timestamp()
  where id = p_object_id
    and classroom_id = p_classroom_id
    and cold_classroom_id is null
    and course_blueprint_id is null
    and storage_bucket = p_storage_bucket
    and storage_path = p_storage_path
    and purpose = p_purpose
    and resource_type = p_resource_type
    and resource_id = p_resource_id
    and (
      p_resource_type <> 'test'
      or not exists (
        select 1
        from public.tests test
        cross join lateral jsonb_array_elements(
          coalesce(test.documents, '[]'::jsonb)
        ) document(value)
        where test.id = p_resource_id
          and (
            document.value->>'managed_object_id' = p_object_id::text
            or document.value->>'snapshot_managed_object_id' = p_object_id::text
          )
      )
    )
    and status in ('pending_upload', 'ready', 'cleanup_pending');
  return found;
end;
$$;

-- The browser receives a managed object UUID after upload, but that UUID is an
-- untrusted claim when it returns in document JSON. Validate every claimed
-- object against a server-parsed path and the locked test owner before the
-- migration-110 atomic authoring function stores the payload.
create or replace function public.update_test_documents_managed_atomic(
  p_teacher_id uuid,
  p_test_id uuid,
  p_expected_status text,
  p_expected_documents jsonb,
  p_documents jsonb,
  p_expected_managed_storage_claims jsonb,
  p_managed_storage_claims jsonb,
  p_update_title boolean,
  p_title text,
  p_update_status boolean,
  p_status text,
  p_update_show_results boolean,
  p_show_results boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived_at timestamptz;
  v_claim jsonb;
  v_claim_count integer;
  v_classroom_id uuid;
  v_document jsonb;
  v_object_id uuid;
  v_owner_id uuid;
  v_path text;
  v_reference_count integer := 0;
  v_expected_reference_count integer := 0;
  v_result jsonb;
begin
  if jsonb_typeof(coalesce(p_documents, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_managed_storage_claims, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_expected_documents, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_expected_managed_storage_claims, '[]'::jsonb)) <> 'array'
  then
    raise exception 'invalid_managed_test_document_claims' using errcode = '22023';
  end if;

  select classroom.id, classroom.teacher_id, classroom.archived_at
  into v_classroom_id, v_owner_id, v_archived_at
  from public.tests test
  join public.classrooms classroom on classroom.id = test.classroom_id
  where test.id = p_test_id
  for update of test, classroom;
  if not found then raise exception 'test_not_found' using errcode = 'P0002'; end if;
  if v_owner_id is distinct from p_teacher_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_archived_at is not null then
    raise exception 'classroom_archived' using errcode = '55000';
  end if;

  for v_document in
    select value from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb))
  loop
    if nullif(v_document->>'managed_object_id', '') is not null then
      v_reference_count := v_reference_count + 1;
      v_object_id := public.managed_storage_uuid(v_document->>'managed_object_id');
      if v_object_id is null or v_document->>'source' is distinct from 'upload' then
        raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
      end if;

      v_claim_count := 0;
      for v_claim in
        select value
        from jsonb_array_elements(coalesce(p_managed_storage_claims, '[]'::jsonb))
        where value->>'document_id' = v_document->>'id'
          and value->>'reference_kind' = 'teacher_upload'
          and value->>'managed_object_id' = v_object_id::text
      loop
        v_claim_count := v_claim_count + 1;
        v_path := nullif(v_claim->>'storage_path', '');
        if v_claim - 'document_id' - 'reference_kind' - 'managed_object_id'
            - 'storage_bucket' - 'storage_path' - 'purpose' <> '{}'::jsonb
          or v_claim->>'storage_bucket' is distinct from 'test-documents'
          or v_claim->>'purpose' is distinct from 'teacher_test_material'
          or v_path is null
          or v_path like '/%'
          or '' = any(string_to_array(v_path, '/'))
          or '.' = any(string_to_array(v_path, '/'))
          or '..' = any(string_to_array(v_path, '/'))
          or not exists (
            select 1 from public.managed_storage_objects object
            where object.id = v_object_id
              and object.classroom_id = v_classroom_id
              and object.cold_classroom_id is null
              and object.course_blueprint_id is null
              and object.storage_bucket = 'test-documents'
              and object.storage_path = v_path
              and object.purpose = 'teacher_test_material'
              and object.resource_type = 'test'
              and object.resource_id = p_test_id
              and object.status = 'ready'
          )
        then
          raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
        end if;
      end loop;
      if v_claim_count <> 1 then
        raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
      end if;
      perform 1
      from public.managed_storage_objects object
      where object.id = v_object_id
        and object.classroom_id = v_classroom_id
        and object.cold_classroom_id is null
        and object.course_blueprint_id is null
        and object.storage_bucket = 'test-documents'
        and object.storage_path = v_path
        and object.purpose = 'teacher_test_material'
        and object.resource_type = 'test'
        and object.resource_id = p_test_id
        and object.status = 'ready'
      for update;
      if not found then
        raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
      end if;
    end if;

    if nullif(v_document->>'snapshot_managed_object_id', '') is not null then
      v_reference_count := v_reference_count + 1;
      v_object_id := public.managed_storage_uuid(
        v_document->>'snapshot_managed_object_id'
      );
      if v_object_id is null or v_document->>'source' is distinct from 'link' then
        raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
      end if;

      v_claim_count := 0;
      for v_claim in
        select value
        from jsonb_array_elements(coalesce(p_managed_storage_claims, '[]'::jsonb))
        where value->>'document_id' = v_document->>'id'
          and value->>'reference_kind' = 'execution_snapshot'
          and value->>'managed_object_id' = v_object_id::text
      loop
        v_claim_count := v_claim_count + 1;
        v_path := nullif(v_claim->>'storage_path', '');
        if v_claim - 'document_id' - 'reference_kind' - 'managed_object_id'
            - 'storage_bucket' - 'storage_path' - 'purpose' <> '{}'::jsonb
          or v_claim->>'storage_bucket' is distinct from 'test-documents'
          or v_claim->>'purpose' is distinct from 'test_execution_snapshot'
          or v_path is distinct from nullif(v_document->>'snapshot_path', '')
          or v_path is null
          or v_path like '/%'
          or '' = any(string_to_array(v_path, '/'))
          or '.' = any(string_to_array(v_path, '/'))
          or '..' = any(string_to_array(v_path, '/'))
          or not exists (
            select 1 from public.managed_storage_objects object
            where object.id = v_object_id
              and object.classroom_id = v_classroom_id
              and object.cold_classroom_id is null
              and object.course_blueprint_id is null
              and object.storage_bucket = 'test-documents'
              and object.storage_path = v_path
              and object.purpose = 'test_execution_snapshot'
              and object.resource_type = 'test'
              and object.resource_id = p_test_id
              and object.status = 'ready'
          )
        then
          raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
        end if;
      end loop;
      if v_claim_count <> 1 then
        raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
      end if;
      perform 1
      from public.managed_storage_objects object
      where object.id = v_object_id
        and object.classroom_id = v_classroom_id
        and object.cold_classroom_id is null
        and object.course_blueprint_id is null
        and object.storage_bucket = 'test-documents'
        and object.storage_path = v_path
        and object.purpose = 'test_execution_snapshot'
        and object.resource_type = 'test'
        and object.resource_id = p_test_id
        and object.status = 'ready'
      for update;
      if not found then
        raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
      end if;
    end if;
  end loop;

  if v_reference_count
    <> jsonb_array_length(coalesce(p_managed_storage_claims, '[]'::jsonb))
  then
    raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
  end if;

  -- Validate the previous ownership claims while the test row is locked. These
  -- claims are used only to queue objects that the successful compare-and-swap
  -- removes, keeping the data mutation and cleanup transition in one transaction.
  for v_document in
    select value from jsonb_array_elements(coalesce(p_expected_documents, '[]'::jsonb))
  loop
    if nullif(v_document->>'managed_object_id', '') is not null then
      v_expected_reference_count := v_expected_reference_count + 1;
    end if;
    if nullif(v_document->>'snapshot_managed_object_id', '') is not null then
      v_expected_reference_count := v_expected_reference_count + 1;
    end if;
  end loop;
  if v_expected_reference_count
    <> jsonb_array_length(coalesce(p_expected_managed_storage_claims, '[]'::jsonb))
  then
    raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
  end if;

  for v_document in
    select value from jsonb_array_elements(coalesce(p_expected_documents, '[]'::jsonb))
  loop
    if nullif(v_document->>'managed_object_id', '') is not null then
      select count(*) into v_claim_count
      from jsonb_array_elements(
        coalesce(p_expected_managed_storage_claims, '[]'::jsonb)
      ) claim(value)
      where claim.value->>'document_id' = v_document->>'id'
        and claim.value->>'reference_kind' = 'teacher_upload'
        and claim.value->>'managed_object_id' = v_document->>'managed_object_id';
      if v_claim_count <> 1 then
        raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
      end if;
    end if;
    if nullif(v_document->>'snapshot_managed_object_id', '') is not null then
      select count(*) into v_claim_count
      from jsonb_array_elements(
        coalesce(p_expected_managed_storage_claims, '[]'::jsonb)
      ) claim(value)
      where claim.value->>'document_id' = v_document->>'id'
        and claim.value->>'reference_kind' = 'execution_snapshot'
        and claim.value->>'managed_object_id' = v_document->>'snapshot_managed_object_id';
      if v_claim_count <> 1 then
        raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
      end if;
    end if;
  end loop;

  for v_claim in
    select value from jsonb_array_elements(
      coalesce(p_expected_managed_storage_claims, '[]'::jsonb)
    )
  loop
    v_object_id := public.managed_storage_uuid(v_claim->>'managed_object_id');
    v_path := nullif(v_claim->>'storage_path', '');
    if v_claim - 'document_id' - 'reference_kind' - 'managed_object_id'
        - 'storage_bucket' - 'storage_path' - 'purpose' <> '{}'::jsonb
      or v_object_id is null
      or v_claim->>'storage_bucket' is distinct from 'test-documents'
      or v_claim->>'reference_kind' not in ('teacher_upload', 'execution_snapshot')
      or v_claim->>'purpose' is distinct from (case v_claim->>'reference_kind'
        when 'teacher_upload' then 'teacher_test_material'
        else 'test_execution_snapshot'
      end)
      or v_path is null
      or v_path like '/%'
      or '' = any(string_to_array(v_path, '/'))
      or '.' = any(string_to_array(v_path, '/'))
      or '..' = any(string_to_array(v_path, '/'))
      or not exists (
        select 1
        from jsonb_array_elements(coalesce(p_expected_documents, '[]'::jsonb)) expected(value)
        where expected.value->>'id' = v_claim->>'document_id'
          and expected.value->>'source' = case v_claim->>'reference_kind'
            when 'teacher_upload' then 'upload'
            else 'link'
          end
          and expected.value->>(case v_claim->>'reference_kind'
            when 'teacher_upload' then 'managed_object_id'
            else 'snapshot_managed_object_id'
          end) = v_object_id::text
          and (
            v_claim->>'reference_kind' <> 'execution_snapshot'
            or expected.value->>'snapshot_path' = v_path
          )
      )
    then
      raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
    end if;

    perform 1
    from public.managed_storage_objects object
    where object.id = v_object_id
      and object.classroom_id = v_classroom_id
      and object.cold_classroom_id is null
      and object.course_blueprint_id is null
      and object.storage_bucket = 'test-documents'
      and object.storage_path = v_path
      and object.purpose = v_claim->>'purpose'
      and object.resource_type = 'test'
      and object.resource_id = p_test_id
      and object.status = 'ready'
    for update;
    if not found then
      raise exception 'managed_test_document_owner_mismatch' using errcode = '55000';
    end if;
  end loop;

  v_result := public.update_test_documents_atomic(
    p_teacher_id,
    p_test_id,
    p_expected_status,
    p_expected_documents,
    p_documents,
    p_update_title,
    p_title,
    p_update_status,
    p_status,
    p_update_show_results,
    p_show_results
  );

  if coalesce((v_result->>'ok')::boolean, false) then
    for v_claim in
      select previous.value from jsonb_array_elements(
        coalesce(p_expected_managed_storage_claims, '[]'::jsonb)
      ) previous(value)
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(p_managed_storage_claims, '[]'::jsonb)) current(value)
        where current.value->>'managed_object_id' = previous.value->>'managed_object_id'
      )
    loop
      perform public.queue_classroom_managed_storage_cleanup(
        public.managed_storage_uuid(v_claim->>'managed_object_id'),
        v_classroom_id,
        v_claim->>'storage_bucket',
        v_claim->>'storage_path',
        v_claim->>'purpose',
        'test',
        p_test_id,
        'test_document_removed'
      );
    end loop;
  end if;

  return v_result;
end;
$$;

create or replace function public.queue_managed_storage_cleanup_path(
  p_storage_bucket text,
  p_storage_path text,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.managed_storage_exact_lock(p_storage_bucket, p_storage_path);
  update public.managed_storage_objects
  set
    status = 'cleanup_pending',
    upload_expires_at = null,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = nullif(left(coalesce(p_error_code, ''), 120), ''),
    next_attempt_at = clock_timestamp(),
    ready_at = null,
    updated_at = clock_timestamp()
  where storage_bucket = p_storage_bucket
    and storage_path = p_storage_path
    and status in ('pending_upload', 'ready', 'cleanup_pending');
  return found;
end;
$$;

create or replace function public.claim_managed_storage_cleanup(
  p_lease_token uuid,
  p_limit integer default 10,
  p_lease_seconds integer default 60
)
returns setof public.managed_storage_objects
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 10 or p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'invalid_managed_storage_cleanup_claim' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select object.id
    from public.managed_storage_objects object
    where (
      object.status = 'cleanup_pending'
      or (
        object.status = 'pending_upload'
        and object.upload_expires_at <= clock_timestamp()
      )
      or (
        object.status = 'cleanup_processing'
        and object.lease_expires_at <= clock_timestamp()
      )
    )
      and object.next_attempt_at <= clock_timestamp()
    order by object.next_attempt_at, object.created_at, object.id
    for update skip locked
    limit p_limit
  )
  update public.managed_storage_objects object
  set
    status = 'cleanup_processing',
    attempt_count = object.attempt_count + 1,
    lease_token = p_lease_token,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    last_error_code = null,
    ready_at = null,
    updated_at = clock_timestamp()
  from candidates
  where object.id = candidates.id
  returning object.*;
end;
$$;

create or replace function public.complete_managed_storage_cleanup(
  p_object_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_object public.managed_storage_objects;
begin
  select * into v_object
  from public.managed_storage_objects
  where id = p_object_id
    and status = 'cleanup_processing'
    and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp()
  for update;
  if not found then return false; end if;
  if exists (
    select 1 from storage.objects object
    where object.bucket_id = v_object.storage_bucket
      and object.name = v_object.storage_path
  ) then
    raise exception 'managed_storage_cleanup_not_absent' using errcode = '55000';
  end if;
  delete from public.managed_storage_objects
  where id = p_object_id
    and lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.fail_managed_storage_cleanup(
  p_object_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.managed_storage_objects
  set
    status = 'cleanup_pending',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = left(coalesce(nullif(p_error_code, ''), 'storage_cleanup_failed'), 120),
    next_attempt_at = clock_timestamp() + make_interval(
      secs => least(3600, greatest(5, (2 ^ least(attempt_count, 10))::integer))
    ),
    updated_at = clock_timestamp()
  where id = p_object_id
    and status = 'cleanup_processing'
    and lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.begin_course_blueprint_managed_deletion(
  p_teacher_id uuid,
  p_blueprint_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform 1
  from public.course_blueprints blueprint
  where blueprint.id = p_blueprint_id
    and blueprint.teacher_id = p_teacher_id
    and blueprint.authority_mode = 'pika'
  for update;
  if not found then
    raise exception 'course_blueprint_not_deletable' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.course_blueprint_operations operation
    where operation.status = 'running'
      and (
        operation.source_blueprint_id = p_blueprint_id
        or operation.result_blueprint_id = p_blueprint_id
      )
  ) or exists (
    select 1 from public.course_blueprint_storage_copy_items item
    where (
      item.target_course_blueprint_id = p_blueprint_id
      or exists (
        select 1 from public.managed_storage_objects source
        where source.id = item.source_object_id
          and source.course_blueprint_id = p_blueprint_id
      )
    ) and item.status <> 'adopted'
  ) or exists (
    select 1
    from public.legacy_blueprint_classroom_storage_reconciliations reconciliation
    where reconciliation.blueprint_id = p_blueprint_id
  ) then
    raise exception 'course_blueprint_operation_active' using errcode = '55000';
  end if;

  update public.managed_storage_objects
  set
    status = 'cleanup_pending',
    upload_expires_at = null,
    lease_token = null,
    lease_expires_at = null,
    ready_at = null,
    next_attempt_at = clock_timestamp(),
    last_error_code = 'course_blueprint_deleted',
    updated_at = clock_timestamp()
  where course_blueprint_id = p_blueprint_id
    and status in ('pending_upload', 'ready', 'cleanup_pending');

  select count(*)::integer into v_count
  from public.managed_storage_objects
  where course_blueprint_id = p_blueprint_id;
  return v_count;
end;
$$;

create or replace function public.claim_course_blueprint_managed_cleanup(
  p_teacher_id uuid,
  p_blueprint_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns setof public.managed_storage_objects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate uuid;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'invalid_managed_storage_cleanup_claim' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.course_blueprints
    where id = p_blueprint_id and teacher_id = p_teacher_id
  ) then raise exception 'course_blueprint_not_found' using errcode = 'P0002'; end if;

  select object.id into v_candidate
  from public.managed_storage_objects object
  where object.course_blueprint_id = p_blueprint_id
    and object.next_attempt_at <= clock_timestamp()
    and (
      object.status = 'cleanup_pending'
      or (
        object.status = 'cleanup_processing'
        and object.lease_expires_at <= clock_timestamp()
      )
    )
  order by object.next_attempt_at, object.created_at, object.id
  for update skip locked
  limit 1;
  if not found then return; end if;

  return query
  update public.managed_storage_objects object
  set
    status = 'cleanup_processing',
    attempt_count = object.attempt_count + 1,
    lease_token = p_lease_token,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    last_error_code = null,
    updated_at = clock_timestamp()
  where object.id = v_candidate
  returning object.*;
end;
$$;

create or replace function public.finalize_course_blueprint_managed_deletion(
  p_teacher_id uuid,
  p_blueprint_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.course_blueprints
  where id = p_blueprint_id and teacher_id = p_teacher_id
  for update;
  if not found then return true; end if;
  if exists (
    select 1 from public.managed_storage_objects
    where course_blueprint_id = p_blueprint_id
  ) or exists (
    select 1
    from public.legacy_blueprint_classroom_storage_reconciliations reconciliation
    where reconciliation.blueprint_id = p_blueprint_id
  ) then return false; end if;
  delete from public.course_blueprints
  where id = p_blueprint_id and teacher_id = p_teacher_id;
  return found;
end;
$$;

create or replace function public.register_legacy_classroom_storage_object(
  p_object_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_purpose text,
  p_created_by_user_id uuid,
  p_data_subject_user_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_content_type text,
  p_byte_size bigint
)
returns public.managed_storage_objects
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_object public.managed_storage_objects;
begin
  perform public.classroom_purge_lock(p_classroom_id);
  if not exists (
    select 1 from public.classrooms
    where id = p_classroom_id and teacher_id = p_teacher_id
  ) then
    raise exception 'classroom_not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.classroom_purge_fences where classroom_id = p_classroom_id
  ) then
    raise exception 'classroom_purge_active' using errcode = '55000';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = p_storage_bucket
      and object.name = p_storage_path
  ) then
    raise exception 'legacy_storage_object_missing' using errcode = '55000';
  end if;

  insert into public.managed_storage_objects (
    id, storage_bucket, storage_path, classroom_id, purpose,
    status, created_by_user_id, data_subject_user_id, resource_type,
    resource_id, content_type, byte_size, ready_at
  ) values (
    p_object_id, p_storage_bucket, p_storage_path, p_classroom_id, p_purpose,
    'ready', p_created_by_user_id, p_data_subject_user_id,
    nullif(btrim(p_resource_type), ''), p_resource_id,
    nullif(btrim(p_content_type), ''), p_byte_size, clock_timestamp()
  )
  on conflict (storage_bucket, storage_path) do update
  set
    classroom_id = excluded.classroom_id,
    course_blueprint_id = null,
    purpose = excluded.purpose,
    created_by_user_id = coalesce(
      public.managed_storage_objects.created_by_user_id,
      excluded.created_by_user_id
    ),
    data_subject_user_id = coalesce(
      public.managed_storage_objects.data_subject_user_id,
      excluded.data_subject_user_id
    ),
    resource_type = coalesce(public.managed_storage_objects.resource_type, excluded.resource_type),
    resource_id = coalesce(public.managed_storage_objects.resource_id, excluded.resource_id),
    content_type = coalesce(public.managed_storage_objects.content_type, excluded.content_type),
    byte_size = coalesce(public.managed_storage_objects.byte_size, excluded.byte_size),
    updated_at = clock_timestamp()
  where public.managed_storage_objects.classroom_id = excluded.classroom_id
  returning * into v_object;

  if v_object.id is null then
    raise exception 'legacy_storage_object_owner_conflict' using errcode = '23505';
  end if;
  return v_object;
end;
$$;

create or replace function public.verify_classroom_managed_storage_coverage(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_source_revision bigint,
  p_reference_count integer,
  p_inventory_sha256 text
)
returns public.classroom_managed_storage_coverage
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coverage public.classroom_managed_storage_coverage;
  v_revision bigint;
  v_object_count integer;
begin
  if p_inventory_sha256 !~ '^[a-f0-9]{64}$' or p_reference_count < 0 then
    raise exception 'invalid_storage_coverage_evidence' using errcode = '22023';
  end if;
  perform public.classroom_purge_lock(p_classroom_id);
  select revision.revision into v_revision
  from public.classrooms classroom
  join public.classroom_archive_revisions revision
    on revision.classroom_id = classroom.id
  where classroom.id = p_classroom_id
    and classroom.teacher_id = p_teacher_id
  for update of classroom, revision;
  if not found then
    raise exception 'classroom_not_found' using errcode = 'P0002';
  end if;
  if v_revision <> p_source_revision then
    raise exception 'classroom_storage_coverage_revision_drift' using errcode = '40001';
  end if;
  if exists (
    select 1 from public.managed_storage_objects object
    where object.classroom_id = p_classroom_id
      and object.status <> 'ready'
  ) then
    raise exception 'classroom_storage_coverage_has_unsettled_objects' using errcode = '55000';
  end if;
  select count(*)::integer into v_object_count
  from public.managed_storage_objects object
  where object.classroom_id = p_classroom_id;
  if v_object_count <> p_reference_count then
    raise exception 'classroom_storage_coverage_count_mismatch' using errcode = '40001';
  end if;

  update public.classroom_managed_storage_coverage
  set
    status = 'verified',
    source_revision = p_source_revision,
    reference_count = p_reference_count,
    object_count = v_object_count,
    inventory_sha256 = p_inventory_sha256,
    error_code = null,
    verified_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where classroom_id = p_classroom_id
  returning * into v_coverage;
  return v_coverage;
end;
$$;

create or replace function public.attach_legacy_test_document_managed_object(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_test_id uuid,
  p_document_id text,
  p_reference_kind text,
  p_expected_reference text,
  p_managed_object_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test public.tests%rowtype;
  v_documents jsonb;
  v_document jsonb;
  v_index integer;
  v_key text;
  v_id_key text;
  v_prior_identity_mapping text := current_setting('pika.identity_mapping', true);
  v_prior_archive_compaction text := current_setting(
    'pika.classroom_archive_compaction',
    true
  );
begin
  if p_reference_kind not in ('teacher_upload', 'execution_snapshot') then
    raise exception 'invalid_legacy_test_document_reference' using errcode = '22023';
  end if;
  perform public.classroom_purge_lock(p_classroom_id);
  select test.* into v_test
  from public.tests test
  join public.classrooms classroom on classroom.id = test.classroom_id
  where test.id = p_test_id
    and test.classroom_id = p_classroom_id
    and classroom.teacher_id = p_teacher_id
  for update of test;
  if not found then raise exception 'test_not_found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.managed_storage_objects object
    where object.id = p_managed_object_id
      and object.classroom_id = p_classroom_id
      and object.storage_bucket = 'test-documents'
      and object.status = 'ready'
      and object.purpose = case p_reference_kind
        when 'teacher_upload' then 'teacher_test_material'
        else 'test_execution_snapshot'
      end
  ) then
    raise exception 'legacy_test_document_owner_mismatch' using errcode = '55000';
  end if;

  v_key := case p_reference_kind when 'teacher_upload' then 'url' else 'snapshot_path' end;
  v_id_key := case p_reference_kind
    when 'teacher_upload' then 'managed_object_id'
    else 'snapshot_managed_object_id'
  end;
  v_documents := coalesce(v_test.documents, '[]'::jsonb);
  select document.value, (document.ordinality - 1)::integer
  into v_document, v_index
  from jsonb_array_elements(v_documents) with ordinality document(value, ordinality)
  where document.value->>'id' = p_document_id
  limit 1;
  if v_document is null
    or v_document->>v_key is distinct from p_expected_reference
  then
    raise exception 'legacy_test_document_changed' using errcode = '40001';
  end if;
  if v_document->>v_id_key = p_managed_object_id::text then return true; end if;
  if nullif(v_document->>v_id_key, '') is not null then
    raise exception 'legacy_test_document_owner_conflict' using errcode = '23505';
  end if;

  v_documents := jsonb_set(
    v_documents,
    array[v_index::text],
    v_document || jsonb_build_object(v_id_key, p_managed_object_id),
    false
  );
  begin
    -- This is ownership metadata on an already-validated document reference,
    -- not a semantic classroom edit. Suppress both identity guards and archive
    -- revision churn for this exact UPDATE, then restore the caller's context.
    perform set_config('pika.identity_mapping', 'on', true);
    perform set_config('pika.classroom_archive_compaction', 'on', true);
    update public.tests set documents = v_documents where id = p_test_id;
  exception when others then
    perform set_config(
      'pika.classroom_archive_compaction',
      coalesce(v_prior_archive_compaction, 'off'),
      true
    );
    perform set_config(
      'pika.identity_mapping',
      coalesce(v_prior_identity_mapping, 'off'),
      true
    );
    raise;
  end;
  perform set_config(
    'pika.classroom_archive_compaction',
    coalesce(v_prior_archive_compaction, 'off'),
    true
  );
  perform set_config(
    'pika.identity_mapping',
    coalesce(v_prior_identity_mapping, 'off'),
    true
  );
  return true;
end;
$$;

create or replace function public.queue_removed_blueprint_test_document_files()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document jsonb;
  v_object_id uuid;
  v_blueprint_id uuid := old.course_blueprint_id;
begin
  -- Version snapshots are immutable and may still reference material removed
  -- from the mutable Blueprint. Retain all Blueprint-owned test material while
  -- any Version exists; Blueprint deletion owns the eventual physical cleanup.
  if exists (
    select 1 from public.course_blueprint_versions
    where course_blueprint_id = v_blueprint_id
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  for v_document in
    select value from jsonb_array_elements(coalesce(old.documents, '[]'::jsonb))
  loop
    v_object_id := public.managed_storage_uuid(v_document->>'managed_object_id');
    if v_object_id is null then continue; end if;
    if exists (
      select 1
      from public.course_blueprint_assessments assessment
      cross join lateral jsonb_array_elements(
        coalesce(assessment.documents, '[]'::jsonb)
      ) document(value)
      where assessment.course_blueprint_id = v_blueprint_id
        and document.value->>'managed_object_id' = v_object_id::text
    ) then
      continue;
    end if;
    update public.managed_storage_objects
    set
      status = 'cleanup_pending',
      upload_expires_at = null,
      lease_token = null,
      lease_expires_at = null,
      ready_at = null,
      next_attempt_at = clock_timestamp(),
      last_error_code = 'blueprint_test_material_removed',
      updated_at = clock_timestamp()
    where id = v_object_id
      and course_blueprint_id = v_blueprint_id
      and status in ('pending_upload', 'ready', 'cleanup_pending');
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger queue_removed_blueprint_test_document_files
after update of documents or delete on public.course_blueprint_assessments
for each row execute function public.queue_removed_blueprint_test_document_files();

create or replace function public.sync_test_document_snapshot_managed_atomic(
  p_teacher_id uuid,
  p_test_id uuid,
  p_document_id text,
  p_expected_url text,
  p_managed_object_id uuid,
  p_snapshot_path text,
  p_snapshot_content_type text,
  p_synced_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test public.tests%rowtype;
  v_classroom_id uuid;
  v_documents jsonb;
  v_document jsonb;
  v_document_index integer;
  v_previous_snapshot_path text;
  v_previous_managed_object_id uuid;
begin
  select test.*
  into v_test
  from public.tests test
  join public.classrooms classroom on classroom.id = test.classroom_id
  where test.id = p_test_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null
  for update of test, classroom;
  if not found then
    raise exception 'test_not_found_or_not_writable' using errcode = 'P0002';
  end if;
  v_classroom_id := v_test.classroom_id;
  perform public.classroom_purge_lock(v_classroom_id);
  if exists (
    select 1 from public.classroom_purge_fences where classroom_id = v_classroom_id
  ) then raise exception 'classroom_purge_active' using errcode = '55000'; end if;

  if not exists (
    select 1
    from public.managed_storage_objects object
    where object.id = p_managed_object_id
      and object.classroom_id = v_classroom_id
      and object.storage_bucket = 'test-documents'
      and object.storage_path = p_snapshot_path
      and object.purpose = 'test_execution_snapshot'
      and object.resource_type = 'test'
      and object.resource_id = p_test_id
      and object.status = 'ready'
  ) then
    raise exception 'snapshot_managed_owner_mismatch' using errcode = '55000';
  end if;

  v_documents := coalesce(v_test.documents, '[]'::jsonb);
  select document.value, (document.ordinality - 1)::integer
  into v_document, v_document_index
  from jsonb_array_elements(v_documents) with ordinality document(value, ordinality)
  where document.value ->> 'id' = p_document_id
  limit 1;
  if v_document is null
    or v_document ->> 'source' is distinct from 'link'
    or v_document ->> 'url' is distinct from p_expected_url
  then
    raise exception 'document_conflict' using errcode = '40001';
  end if;

  v_previous_snapshot_path := nullif(v_document ->> 'snapshot_path', '');
  begin
    v_previous_managed_object_id :=
      nullif(v_document ->> 'snapshot_managed_object_id', '')::uuid;
  exception when invalid_text_representation then
    v_previous_managed_object_id := null;
  end;

  v_document := (
    v_document
    - 'snapshot_path'
    - 'snapshot_managed_object_id'
    - 'snapshot_content_type'
    - 'synced_at'
  ) || jsonb_build_object(
    'snapshot_path', p_snapshot_path,
    'snapshot_managed_object_id', p_managed_object_id,
    'snapshot_content_type', p_snapshot_content_type,
    'synced_at', p_synced_at
  );
  v_documents := jsonb_set(
    v_documents,
    array[v_document_index::text],
    v_document,
    false
  );
  update public.tests
  set documents = v_documents
  where id = p_test_id
  returning * into strict v_test;

  if v_previous_managed_object_id is not null
    and v_previous_managed_object_id <> p_managed_object_id
  then
    perform public.queue_classroom_managed_storage_cleanup(
      v_previous_managed_object_id,
      v_classroom_id,
      'test-documents',
      v_previous_snapshot_path,
      'test_execution_snapshot',
      'test',
      p_test_id,
      'test_snapshot_replaced'
    );
  elsif v_previous_snapshot_path is not null
    and v_previous_snapshot_path <> p_snapshot_path
  then
    insert into public.test_document_snapshot_storage_cleanup as cleanup (
      storage_path, status, attempt_count, next_attempt_at,
      lease_token, lease_expires_at, last_error, updated_at
    ) values (
      v_previous_snapshot_path, 'pending', 0, clock_timestamp(),
      null, null, null, clock_timestamp()
    )
    on conflict (storage_path) do update
    set
      status = 'pending',
      next_attempt_at = clock_timestamp(),
      lease_token = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = clock_timestamp()
    where cleanup.status <> 'processing'
      or cleanup.lease_expires_at <= clock_timestamp();
  end if;

  return jsonb_build_object(
    'previous_snapshot_path', v_previous_snapshot_path,
    'previous_snapshot_managed_object_id', v_previous_managed_object_id,
    'test', to_jsonb(v_test)
  );
end;
$$;

-- Exact Storage enforcement. Before rollout enforcement is disabled, but a
-- permanent purge reservation is always honored so deleted keys cannot race
-- back into existence.
create or replace function public.enforce_managed_storage_object_ownership()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_bucket text := case when tg_op = 'DELETE' then old.bucket_id else new.bucket_id end;
  v_path text := case when tg_op = 'DELETE' then old.name else new.name end;
  v_object public.managed_storage_objects;
  v_enforce boolean;
begin
  if v_bucket not in ('assignment-artifacts', 'submission-images', 'test-documents') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  perform public.managed_storage_exact_lock(v_bucket, v_path);
  if tg_op <> 'DELETE' and exists (
    select 1
    from public.classroom_purge_objects purge_object
    where purge_object.storage_bucket = v_bucket
      and purge_object.storage_path_sha256 =
        public.managed_storage_identity_sha256(v_bucket, v_path)
  ) then
    raise exception 'storage_path_permanently_reserved' using errcode = '55000';
  end if;

  select * into v_object
  from public.managed_storage_objects object
  where object.storage_bucket = v_bucket
    and object.storage_path = v_path;

  if tg_op = 'DELETE' then
    if found
      and v_object.status not in ('cleanup_processing', 'purging')
      and not exists (
        select 1
        from public.classroom_archive_source_object_cleanup cleanup
        where cleanup.classroom_id = coalesce(
            v_object.classroom_id,
            v_object.cold_classroom_id
          )
          and (
            v_object.cold_archive_id is null
            or cleanup.archive_id = v_object.cold_archive_id
          )
          and cleanup.storage_bucket = v_bucket
          and cleanup.storage_path = v_path
          and cleanup.status = 'processing'
          and cleanup.ownership_verified is true
          and cleanup.lease_expires_at > clock_timestamp()
      )
    then
      raise exception 'managed_storage_delete_not_reserved' using errcode = '55000';
    end if;
    return old;
  end if;

  if found then
    if v_object.status not in ('pending_upload', 'ready') then
      raise exception 'managed_storage_write_not_allowed' using errcode = '55000';
    end if;
    if v_object.classroom_id is not null and exists (
      select 1 from public.classroom_purge_fences
      where classroom_id = v_object.classroom_id
    ) then
      raise exception 'classroom_purge_active' using errcode = '55000';
    end if;
    return new;
  end if;

  if exists (
    select 1
    from public.course_blueprint_storage_copy_items copy
    where copy.target_storage_bucket = v_bucket
      and copy.target_storage_path = v_path
      and copy.status in ('planned', 'copying', 'failed')
  ) or exists (
    select 1
    from public.classroom_archive_object_upload_cleanup cleanup
    join public.classroom_archive_operations operation
      on operation.id = cleanup.operation_id
    where cleanup.storage_bucket = v_bucket
      and cleanup.storage_path = v_path
      and operation.operation_type = 'restore'
      and cleanup.status in ('staged', 'pending', 'processing', 'failed')
  ) then
    return new;
  end if;

  select enforce_ownership into v_enforce
  from public.managed_storage_settings
  where singleton;
  if coalesce(v_enforce, false) then
    raise exception 'managed_storage_owner_required' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists managed_storage_object_ownership_guard on storage.objects;
create trigger managed_storage_object_ownership_guard
before insert or update or delete on storage.objects
for each row execute function public.enforce_managed_storage_object_ownership();

create or replace function public.complete_classroom_archive_source_object_cleanup(
  p_operation_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_cleanup public.classroom_archive_source_object_cleanup;
begin
  if p_operation_id is null
    or p_lease_token is null
    or p_storage_bucket not in (
      'assignment-artifacts', 'submission-images', 'test-documents'
    )
    or p_storage_path is null
    or btrim(p_storage_path) = ''
    or p_storage_path like '/%'
    or strpos(p_storage_path, E'\\') > 0
    or '..' = any(string_to_array(p_storage_path, '/'))
  then
    raise exception 'Invalid classroom archive source cleanup completion'
      using errcode = '22023';
  end if;

  select * into v_cleanup
  from public.classroom_archive_source_object_cleanup cleanup
  where cleanup.operation_id = p_operation_id
    and cleanup.storage_bucket = p_storage_bucket
    and cleanup.storage_path = p_storage_path
    and cleanup.ownership_verified is true
    and cleanup.ownership_verified_at is not null
    and cleanup.status = 'processing'
    and cleanup.lease_token = p_lease_token
    and cleanup.lease_expires_at > clock_timestamp()
    and exists (
      select 1
      from public.classroom_archive_source_object_reservations reservation
      where reservation.operation_id = cleanup.operation_id
        and reservation.storage_bucket = cleanup.storage_bucket
        and reservation.storage_path_sha256 =
          public.classroom_archive_source_object_path_sha256(
            cleanup.storage_bucket,
            cleanup.storage_path
          )
    )
  for update;
  if not found then return false; end if;

  perform public.managed_storage_exact_lock(p_storage_bucket, p_storage_path);
  if exists (
    select 1 from storage.objects object
    where object.bucket_id = p_storage_bucket and object.name = p_storage_path
  ) then
    raise exception 'Classroom archive source object is still present'
      using errcode = '55000';
  end if;

  delete from public.managed_storage_objects object
  where object.storage_bucket = p_storage_bucket
    and object.storage_path = p_storage_path
    and object.cold_classroom_id = v_cleanup.classroom_id
    and object.cold_archive_id = v_cleanup.archive_id;

  if found then
    update public.classroom_cold_managed_storage_coverage coverage
    set
      remaining_object_count = remaining_object_count - 1,
      updated_at = clock_timestamp()
    where coverage.classroom_id = v_cleanup.classroom_id
      and coverage.archive_id = v_cleanup.archive_id
      and coverage.remaining_object_count > 0;
    if not found then
      raise exception 'cold_managed_storage_cleanup_coverage_drift' using errcode = '40001';
    end if;
  end if;

  update public.classroom_archive_source_object_cleanup
  set
    status = 'deleted',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = null,
    deleted_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where operation_id = p_operation_id
    and storage_bucket = p_storage_bucket
    and storage_path = p_storage_path;
  return true;
end;
$$;

-- Migration 096 owns the assignment-artifact archive cleanup fence. Preserve
-- it, while recognizing an exact purge lease as an independent authorized
-- deletion owner.
create or replace function public.reject_reserved_classroom_archive_storage_path()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_bucket text;
  v_path text;
begin
  for v_bucket, v_path in
    select distinct candidate.bucket, candidate.path
    from (values
      (
        case when tg_op <> 'INSERT' then old.bucket_id end,
        case when tg_op <> 'INSERT' then old.name end
      ),
      (
        case when tg_op <> 'DELETE' then new.bucket_id end,
        case when tg_op <> 'DELETE' then new.name end
      )
    ) candidate(bucket, path)
    where candidate.bucket = 'assignment-artifacts'
      and candidate.path is not null
    order by candidate.bucket, candidate.path
  loop
    perform public.managed_storage_exact_lock(v_bucket, v_path);
  end loop;

  if tg_op <> 'DELETE'
    and new.bucket_id = 'assignment-artifacts'
    and exists (
      select 1
      from public.classroom_archive_source_object_reservations reservation
      where reservation.storage_bucket = new.bucket_id
        and reservation.storage_path_sha256 =
          public.classroom_archive_source_object_path_sha256(new.bucket_id, new.name)
    )
  then
    raise exception 'Storage path is reserved by a classroom archive'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE'
    and old.bucket_id = 'assignment-artifacts'
    and not exists (
      select 1
      from public.classroom_purge_objects purge_object
      join public.classroom_purge_operations purge_operation
        on purge_operation.id = purge_object.operation_id
      where purge_object.storage_bucket = old.bucket_id
        and purge_object.storage_path_sha256 =
          public.managed_storage_identity_sha256(old.bucket_id, old.name)
        and purge_object.status = 'processing'
        and purge_object.lease_expires_at > clock_timestamp()
        and purge_operation.status in ('deleting_objects', 'failed')
    )
    and exists (
      select 1
      from public.classroom_archive_source_object_cleanup cleanup
      where cleanup.storage_bucket = old.bucket_id
        and cleanup.storage_path = old.name
        and cleanup.status <> 'deleted'
        and not exists (
          select 1
          from public.classroom_archive_source_object_reservations reservation
          where reservation.storage_bucket = cleanup.storage_bucket
            and reservation.storage_path_sha256 =
              public.classroom_archive_source_object_path_sha256(
                cleanup.storage_bucket,
                cleanup.storage_path
              )
        )
    )
  then
    raise exception 'Storage deletion requires a classroom archive source reservation'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.reject_managed_storage_change_during_purge()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_classroom_id uuid := case when tg_op = 'INSERT' then null else old.classroom_id end;
  v_new_classroom_id uuid := case when tg_op = 'DELETE' then null else new.classroom_id end;
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on'
    or current_setting('pika.classroom_purge_begin', true) = 'on'
  then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_old_classroom_id is not null then
    perform public.classroom_purge_lock(v_old_classroom_id);
    if exists (
      select 1 from public.classroom_purge_fences
      where classroom_id = v_old_classroom_id
    ) then
      raise exception 'classroom_purge_active' using errcode = '55000';
    end if;
  end if;
  if v_new_classroom_id is not null and v_new_classroom_id is distinct from v_old_classroom_id then
    perform public.classroom_purge_lock(v_new_classroom_id);
    if exists (
      select 1 from public.classroom_purge_fences
      where classroom_id = v_new_classroom_id
    ) then
      raise exception 'classroom_purge_active' using errcode = '55000';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists managed_storage_classroom_purge_fence on public.managed_storage_objects;
create trigger managed_storage_classroom_purge_fence
before insert or update or delete on public.managed_storage_objects
for each row execute function public.reject_managed_storage_change_during_purge();

create or replace function public.queue_assignment_doc_managed_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on'
    or public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then return old; end if;
  update public.managed_storage_objects
  set
    status = 'cleanup_pending',
    ready_at = null,
    next_attempt_at = clock_timestamp(),
    last_error_code = 'assignment_doc_deleted',
    updated_at = clock_timestamp()
  where resource_type = 'assignment_doc'
    and resource_id = old.id
    and status in ('pending_upload', 'ready', 'cleanup_pending');
  return old;
end;
$$;

drop trigger if exists queue_assignment_doc_managed_storage_cleanup
  on public.assignment_docs;
create trigger queue_assignment_doc_managed_storage_cleanup
after delete on public.assignment_docs
for each row execute function public.queue_assignment_doc_managed_storage_cleanup();

create or replace function public.queue_test_managed_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on'
    or public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then return old; end if;
  update public.managed_storage_objects
  set
    status = 'cleanup_pending',
    ready_at = null,
    next_attempt_at = clock_timestamp(),
    last_error_code = 'test_deleted',
    updated_at = clock_timestamp()
  where resource_type = 'test'
    and resource_id = old.id
    and status in ('pending_upload', 'ready', 'cleanup_pending');
  return old;
end;
$$;

drop trigger if exists queue_test_managed_storage_cleanup on public.tests;
create trigger queue_test_managed_storage_cleanup
after delete on public.tests
for each row execute function public.queue_test_managed_storage_cleanup();

create or replace function public.classroom_purge_conflict(p_classroom_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
begin
  if exists (
    select 1 from public.classroom_archive_operations operation
    where operation.classroom_id = p_classroom_id
      and (
        (
          operation.status = 'snapshot_ready'
          and operation.snapshot_expires_at > clock_timestamp()
        )
        or (
          operation.status = 'failed'
          and operation.retryable is true
          and operation.snapshot_expires_at > clock_timestamp()
        )
      )
  ) then return 'classroom_archive_operation_active'; end if;

  if exists (
    select 1
    from public.classroom_archive_object_upload_cleanup cleanup
    join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
    where operation.classroom_id = p_classroom_id
      and cleanup.status = 'processing'
      and cleanup.lease_expires_at > clock_timestamp()
  ) or exists (
    select 1
    from public.classroom_gradex_extract_cleanup cleanup
    join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
    where operation.classroom_id = p_classroom_id
      and cleanup.status = 'processing'
      and cleanup.lease_expires_at > clock_timestamp()
  ) or exists (
    select 1
    from public.classroom_archive_source_object_cleanup cleanup
    where cleanup.classroom_id = p_classroom_id
      and cleanup.status = 'processing'
      and cleanup.lease_expires_at > clock_timestamp()
  ) or exists (
    select 1 from public.managed_storage_objects object
    where object.classroom_id = p_classroom_id
      and object.status = 'cleanup_processing'
      and object.lease_expires_at > clock_timestamp()
  ) then return 'classroom_storage_cleanup_active'; end if;

  if exists (
    select 1 from public.assignment_ai_grading_runs run
    join public.assignments assignment on assignment.id = run.assignment_id
    where assignment.classroom_id = p_classroom_id and run.status in ('queued', 'running')
  ) or exists (
    select 1 from public.assignment_repo_review_runs run
    join public.assignments assignment on assignment.id = run.assignment_id
    where assignment.classroom_id = p_classroom_id and run.status in ('queued', 'running')
  ) or exists (
    select 1 from public.test_ai_grading_runs run
    join public.tests test on test.id = run.test_id
    where test.classroom_id = p_classroom_id and run.status in ('queued', 'running')
  ) then return 'classroom_grading_operation_active'; end if;

  if exists (
    select 1 from public.course_blueprint_operations operation
    where (
        operation.status = 'running'
        or operation.storage_copy_status in ('copying', 'failed')
      )
      and (
        operation.source_classroom_id = p_classroom_id
        or operation.result_classroom_id = p_classroom_id
      )
  ) or exists (
    select 1
    from public.course_blueprint_storage_copy_items copy
    join public.managed_storage_objects source on source.id = copy.source_object_id
    where source.classroom_id = p_classroom_id
      and copy.status <> 'adopted'
  ) or exists (
    select 1 from public.legacy_blueprint_classroom_storage_reconciliations reconciliation
    where reconciliation.classroom_id = p_classroom_id
      and reconciliation.status <> 'adopted'
  ) or exists (
    select 1 from public.course_blueprint_change_proposals proposal
    where proposal.status in ('ready', 'needs_review', 'conflicted')
      and (
        proposal.source_classroom_id = p_classroom_id
        or proposal.target_classroom_id = p_classroom_id
      )
  ) or exists (
    select 1 from public.course_blueprint_editing_sessions session
    where session.status = 'ready'
      and session.expires_at > clock_timestamp()
      and session.classroom_id = p_classroom_id
  ) then return 'classroom_blueprint_operation_active'; end if;
  return null;
end;
$$;

-- Begin now snapshots exact managed files and operational objects inside the
-- same transaction that installs the classroom fence.
create or replace function public.begin_hot_archived_classroom_purge(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_request_sha256 text,
  p_impact_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.classroom_purge_operations;
  v_resource record;
  v_teacher_id uuid;
  v_title text;
  v_archived_at timestamptz;
  v_revision bigint;
  v_counts jsonb;
  v_storage_counts jsonb;
  v_conflict text;
  v_enabled boolean;
  v_enforced boolean;
begin
  if p_request_sha256 !~ '^[a-f0-9]{64}$'
    or p_impact_summary is null
    or jsonb_typeof(p_impact_summary) <> 'object'
  then raise exception 'invalid_classroom_purge_request' using errcode = '22023'; end if;

  select hot_classroom_purge_enabled, enforce_ownership
  into v_enabled, v_enforced
  from public.managed_storage_settings where singleton;
  if not coalesce(v_enabled, false) then
    return jsonb_build_object(
      'ok', false, 'status', 503, 'error_code', 'classroom_purge_disabled',
      'error', 'Permanent classroom deletion is not enabled'
    );
  end if;
  if not coalesce(v_enforced, false) then
    return jsonb_build_object(
      'ok', false, 'status', 503, 'error_code', 'managed_storage_enforcement_required',
      'error', 'Managed storage ownership enforcement is not enabled'
    );
  end if;

  perform public.classroom_purge_lock(p_classroom_id);
  select * into v_operation
  from public.classroom_purge_operations
  where id = p_operation_id
  for update;
  if found then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.request_sha256 <> p_request_sha256
    then
      return jsonb_build_object(
        'ok', false, 'status', 409, 'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different purge request'
      );
    end if;
    if v_operation.status = 'failed' and v_operation.retryable is true then
      update public.classroom_purge_operations
      set
        status = 'deleting_objects',
        attempt_count = attempt_count + 1,
        error_code = null,
        updated_at = clock_timestamp()
      where id = p_operation_id
      returning * into v_operation;
    end if;
    return jsonb_build_object(
      'ok', true,
      'status', case when v_operation.status = 'completed' then 200 else 202 end,
      'operation_id', v_operation.id,
      'operation_status', v_operation.status,
      'source_revision', v_operation.source_revision,
      'resource_counts', v_operation.resource_counts,
      'storage_object_counts', v_operation.storage_object_counts,
      'replayed', true
    );
  end if;

  select classroom.teacher_id, classroom.title, classroom.archived_at, revision.revision
  into v_teacher_id, v_title, v_archived_at, v_revision
  from public.classrooms classroom
  join public.classroom_archive_revisions revision on revision.classroom_id = classroom.id
  where classroom.id = p_classroom_id
  for update of classroom, revision;
  if not found or v_teacher_id <> p_teacher_id then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'classroom_not_found',
      'error', 'Classroom not found'
    );
  end if;
  if v_archived_at is null then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_not_hot_archived',
      'error', 'Only hot archived classrooms can be permanently deleted'
    );
  end if;
  if exists (
    select 1 from public.classroom_cold_tombstones where classroom_id = p_classroom_id
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_is_cold_archived',
      'error', 'Stored classroom deletion is not available yet'
    );
  end if;
  if not exists (
    select 1 from public.classroom_managed_storage_coverage coverage
    where coverage.classroom_id = p_classroom_id
      and coverage.status = 'verified'
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_storage_coverage_incomplete',
      'error', 'Classroom file ownership must be reconciled before deletion'
    );
  end if;
  if exists (
    select 1 from public.managed_storage_objects object
    where object.classroom_id = p_classroom_id
      and object.status not in ('ready', 'cleanup_pending', 'pending_upload')
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_storage_operation_active',
      'error', 'Finish the active classroom file operation before deleting permanently'
    );
  end if;
  v_conflict := public.classroom_purge_conflict(p_classroom_id);
  if v_conflict is not null then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', v_conflict,
      'error', 'Finish the active classroom operation before deleting permanently'
    );
  end if;

  insert into public.classroom_purge_operations (
    id, teacher_id, classroom_id, classroom_title, request_sha256,
    source_revision, impact_summary
  ) values (
    p_operation_id, p_teacher_id, p_classroom_id, v_title, p_request_sha256,
    v_revision, p_impact_summary
  );
  insert into public.classroom_purge_fences (classroom_id, operation_id, teacher_id)
  values (p_classroom_id, p_operation_id, p_teacher_id);
  perform set_config('pika.classroom_purge_begin', 'on', true);

  insert into public.classroom_purge_resources (operation_id, table_name, row_id)
  values (p_operation_id, 'classrooms', p_classroom_id);
  for v_resource in
    select table_name, primary_key_columns[1] primary_key_column, parent_table, parent_column
    from public.classroom_archive_resource_contract
    where table_name <> 'classrooms'
    order by export_position
  loop
    execute format(
      'insert into public.classroom_purge_resources (operation_id, table_name, row_id)
       select $1, $2, child.%I
       from public.%I child
       join public.classroom_purge_resources parent
         on parent.operation_id = $1
        and parent.table_name = $3
        and child.%I = parent.row_id
       on conflict do nothing',
      v_resource.primary_key_column,
      v_resource.table_name,
      v_resource.parent_column
    ) using p_operation_id, v_resource.table_name, v_resource.parent_table;
  end loop;

  insert into public.classroom_purge_objects (
    operation_id, storage_bucket, storage_path, storage_path_sha256,
    disposition, status, managed_storage_object_id
  )
  select
    p_operation_id,
    object.storage_bucket,
    object.storage_path,
    public.managed_storage_identity_sha256(object.storage_bucket, object.storage_path),
    'delete',
    'pending',
    object.id
  from public.managed_storage_objects object
  where object.classroom_id = p_classroom_id
  on conflict (operation_id, storage_bucket, storage_path_sha256) do nothing;

  insert into public.classroom_purge_objects (
    operation_id, storage_bucket, storage_path, storage_path_sha256,
    disposition, status
  )
  select
    p_operation_id,
    candidate.storage_bucket,
    candidate.storage_path,
    public.managed_storage_identity_sha256(candidate.storage_bucket, candidate.storage_path),
    'delete',
    'pending'
  from (
    select archive.storage_bucket, archive.storage_path
    from public.classroom_archives archive
    where archive.classroom_id = p_classroom_id
    union
    select extract.storage_bucket, extract.storage_path
    from public.classroom_gradex_extracts extract
    where extract.classroom_id = p_classroom_id
    union
    select operation.storage_bucket, operation.storage_path
    from public.classroom_archive_operations operation
    where operation.classroom_id = p_classroom_id
      and operation.storage_bucket is not null
      and operation.storage_path is not null
    union
    select cleanup.storage_bucket, cleanup.storage_path
    from public.classroom_archive_object_upload_cleanup cleanup
    join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
    where operation.classroom_id = p_classroom_id
      and cleanup.status <> 'deleted'
    union
    select cleanup.storage_bucket, cleanup.storage_path
    from public.classroom_gradex_extract_cleanup cleanup
    join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
    where operation.classroom_id = p_classroom_id
      and cleanup.status <> 'deleted'
  ) candidate
  on conflict (operation_id, storage_bucket, storage_path_sha256) do nothing;

  update public.managed_storage_objects object
  set
    status = 'purging',
    upload_expires_at = null,
    lease_token = null,
    lease_expires_at = null,
    ready_at = null,
    updated_at = clock_timestamp()
  where object.classroom_id = p_classroom_id;

  select jsonb_object_agg(
    contract.table_name,
    coalesce(resource_count.row_count, 0)
    order by contract.export_position
  ) into v_counts
  from public.classroom_archive_resource_contract contract
  left join (
    select table_name, count(*)::integer row_count
    from public.classroom_purge_resources
    where operation_id = p_operation_id
    group by table_name
  ) resource_count on resource_count.table_name = contract.table_name;

  select coalesce(jsonb_object_agg(storage_bucket, object_count), '{}'::jsonb)
  into v_storage_counts
  from (
    select storage_bucket, count(*)::integer object_count
    from public.classroom_purge_objects
    where operation_id = p_operation_id
    group by storage_bucket
  ) counts;

  update public.classroom_purge_operations
  set
    status = 'deleting_objects',
    resource_counts = v_counts,
    storage_object_counts = v_storage_counts,
    inventory_completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_operation_id;

  return jsonb_build_object(
    'ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', 'deleting_objects', 'source_revision', v_revision,
    'resource_counts', v_counts, 'storage_object_counts', v_storage_counts,
    'replayed', false
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_purge_active',
      'error', 'A permanent deletion is already active for this classroom'
    );
end;
$$;

create or replace function public.stage_classroom_purge_objects(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_objects jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Compatibility no-op: migration 117 snapshots exact ownership at begin.
  if not exists (
    select 1 from public.classroom_purge_operations
    where id = p_operation_id and teacher_id = p_teacher_id
  ) then raise exception 'classroom_purge_operation_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', 'deleting_objects', 'replayed', true
  );
end;
$$;

create or replace function public.seal_classroom_purge_inventory(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_expected_object_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.classroom_purge_objects object
  join public.classroom_purge_operations operation on operation.id = object.operation_id
  where object.operation_id = p_operation_id and operation.teacher_id = p_teacher_id;
  if v_count <> p_expected_object_count then
    raise exception 'classroom_purge_object_count_mismatch' using errcode = '40001';
  end if;
  return jsonb_build_object(
    'ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', 'deleting_objects', 'replayed', true
  );
end;
$$;

create or replace function public.claim_classroom_purge_object(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns setof public.classroom_purge_objects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.classroom_purge_objects;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'invalid_classroom_purge_lease' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.classroom_purge_operations
    where id = p_operation_id
      and teacher_id = p_teacher_id
      and status in ('deleting_objects', 'failed')
      and coalesce(retryable, true)
  ) then raise exception 'classroom_purge_operation_not_found' using errcode = 'P0002'; end if;

  update public.classroom_purge_operations
  set
    status = 'deleting_objects',
    attempt_count = attempt_count + 1,
    error_code = null,
    retryable = true,
    updated_at = clock_timestamp()
  where id = p_operation_id
    and teacher_id = p_teacher_id
    and status = 'failed'
    and coalesce(retryable, true);

  select * into v_candidate
  from public.classroom_purge_objects object
  where object.operation_id = p_operation_id
    and object.disposition = 'delete'
    and object.next_attempt_at <= clock_timestamp()
    and (
      object.status in ('pending', 'failed')
      or (object.status = 'processing' and object.lease_expires_at <= clock_timestamp())
    )
  order by object.next_attempt_at, object.created_at, object.id
  for update skip locked
  limit 1;
  if not found then return; end if;
  if v_candidate.storage_path is null then
    raise exception 'classroom_purge_object_path_redacted' using errcode = '55000';
  end if;
  perform public.managed_storage_exact_lock(
    v_candidate.storage_bucket,
    v_candidate.storage_path
  );
  if v_candidate.managed_storage_object_id is not null and not exists (
    select 1 from public.managed_storage_objects object
    where object.id = v_candidate.managed_storage_object_id
      and object.status = 'purging'
  ) then
    raise exception 'classroom_purge_storage_owner_drift' using errcode = '40001';
  end if;
  return query
  update public.classroom_purge_objects object
  set
    status = 'processing',
    attempt_count = object.attempt_count + 1,
    lease_token = p_lease_token,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    last_error_code = null,
    updated_at = clock_timestamp()
  where object.id = v_candidate.id
  returning object.*;
end;
$$;

create or replace function public.complete_classroom_purge_object(
  p_object_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_object public.classroom_purge_objects;
begin
  select object.* into v_object
  from public.classroom_purge_objects object
  join public.classroom_purge_operations operation on operation.id = object.operation_id
  where object.id = p_object_id
    and operation.teacher_id = p_teacher_id
    and object.status = 'processing'
    and object.lease_token = p_lease_token
    and object.lease_expires_at > clock_timestamp()
  for update of object;
  if not found then return false; end if;
  if exists (
    select 1 from storage.objects storage_object
    where storage_object.bucket_id = v_object.storage_bucket
      and storage_object.name = v_object.storage_path
  ) then
    raise exception 'classroom_purge_storage_object_still_present' using errcode = '55000';
  end if;
  update public.classroom_purge_objects
  set
    status = 'deleted',
    storage_path = null,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = null,
    deleted_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_object_id;
  return true;
end;
$$;

create or replace function public.fail_classroom_purge_object(
  p_object_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.classroom_purge_objects object
  set
    status = 'failed',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = left(coalesce(nullif(p_error_code, ''), 'storage_delete_failed'), 120),
    next_attempt_at = clock_timestamp() + make_interval(
      secs => least(3600, greatest(5, (2 ^ least(object.attempt_count, 10))::integer))
    ),
    updated_at = clock_timestamp()
  from public.classroom_purge_operations operation
  where object.id = p_object_id
    and operation.id = object.operation_id
    and operation.teacher_id = p_teacher_id
    and object.status = 'processing'
    and object.lease_token = p_lease_token;
  return found;
end;
$$;

-- Retain the already-reviewed relational/ledger finalizer from migration 115,
-- but wrap it with exact Storage absence and ownership reconciliation.
alter function public.finalize_hot_archived_classroom_purge(uuid, uuid)
  rename to finalize_hot_archived_classroom_purge_legacy_117;

create or replace function public.finalize_hot_archived_classroom_purge(
  p_operation_id uuid,
  p_teacher_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_operation public.classroom_purge_operations;
  v_result jsonb;
  v_error_code text;
  v_retryable boolean := true;
begin
  select * into v_operation
  from public.classroom_purge_operations
  where id = p_operation_id and teacher_id = p_teacher_id
  for update;
  if not found then
    raise exception 'classroom_purge_operation_not_found' using errcode = 'P0002';
  end if;
  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'ok', true, 'status', 200, 'operation_id', p_operation_id,
      'operation_status', 'completed', 'replayed', true
    );
  end if;
  if exists (
    select 1 from public.classroom_purge_objects object
    where object.operation_id = p_operation_id
      and object.status <> 'deleted'
  ) then
    return jsonb_build_object(
      'ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', 'deleting_objects', 'replayed', false
    );
  end if;
  if exists (
    select 1
    from public.classroom_purge_objects object
    join storage.objects storage_object
      on storage_object.bucket_id = object.storage_bucket
     and storage_object.name = object.storage_path
    where object.operation_id = p_operation_id
      and object.disposition = 'delete'
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'classroom_purge_storage_reappeared',
      'error', 'A classroom file is still present',
      'retryable', true
    );
  end if;

  begin
    perform set_config('pika.classroom_purge_finalize', 'on', true);
    delete from public.managed_storage_objects object
    using public.classroom_purge_objects purge_object
    where purge_object.operation_id = p_operation_id
      and purge_object.managed_storage_object_id = object.id
      and purge_object.status = 'deleted'
      and object.classroom_id = v_operation.classroom_id
      and object.status = 'purging';

    if exists (
      select 1 from public.managed_storage_objects
      where classroom_id = v_operation.classroom_id
    ) then
      raise exception 'classroom_purge_storage_owner_drift' using errcode = '40001';
    end if;
    delete from public.classroom_managed_storage_coverage
    where classroom_id = v_operation.classroom_id;

    v_result := public.finalize_hot_archived_classroom_purge_legacy_117(
      p_operation_id,
      p_teacher_id
    );
    if coalesce((v_result ->> 'ok')::boolean, false) is not true then
      v_error_code := coalesce(v_result ->> 'error_code', 'database_finalize_failed');
      v_retryable := coalesce((v_result ->> 'retryable')::boolean, true);
      raise exception '%', v_error_code using errcode = '40001';
    end if;
    return v_result;
  exception
    when others then
      update public.classroom_purge_operations
      set
        status = 'failed',
        error_code = coalesce(v_error_code, 'database_finalize_failed'),
        retryable = v_retryable,
        updated_at = clock_timestamp()
      where id = p_operation_id;
      return jsonb_build_object(
        'ok', false, 'status', 500,
        'error_code', coalesce(v_error_code, 'database_finalize_failed'),
        'error', 'Permanent deletion paused before database finalization',
        'retryable', v_retryable
      );
  end;
end;
$$;

-- The lifecycle graph remains authoritative for relational rows. This guard
-- proves no managed classroom file can be orphaned by an ordinary classroom
-- delete or by a finalizer that skipped explicit reconciliation.
create or replace function public.reject_classroom_delete_with_managed_storage()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.legacy_blueprint_classroom_storage_reconciliations reconciliation
    where reconciliation.classroom_id = old.id
  ) then
    raise exception 'classroom_blueprint_operation_active' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.managed_storage_objects object
    where object.classroom_id = old.id
  ) then
    -- The legacy compaction preflight deletes and restores the live graph in a
    -- rolled-back subtransaction before the tombstone trigger can transfer
    -- ownership. It is the only authorized exception: both transaction-local
    -- markers, a snapshot-ready operation, verified exact coverage, and the
    -- absence of a tombstone are required. The real delete runs after transfer
    -- and therefore has no hot managed owner to exempt.
    if current_setting('pika.classroom_archive_compaction', true) = 'on'
      and current_setting('pika.classroom_archive_compaction_dry_run', true) = 'on'
      and exists (
        select 1
        from public.classroom_archive_operations operation
        join public.classroom_managed_storage_coverage coverage
          on coverage.classroom_id = operation.classroom_id
        where operation.classroom_id = old.id
          and operation.id = nullif(
            current_setting(
              'pika.classroom_archive_compaction_operation_id',
              true
            ),
            ''
          )::uuid
          and operation.operation_type = 'compact'
          and operation.status = 'snapshot_ready'
          and coverage.status = 'verified'
          and coverage.source_revision = operation.source_revision
          and coverage.object_count = coverage.reference_count
          and coverage.object_count = (
            select count(*)::integer
            from public.managed_storage_objects object
            where object.classroom_id = old.id
          )
          and not exists (
            select 1 from public.classroom_cold_tombstones tombstone
            where tombstone.classroom_id = old.id
          )
      )
    then
      return old;
    end if;
    raise exception 'classroom_has_managed_storage_objects' using errcode = '55000';
  end if;
  return old;
end;
$$;

drop trigger if exists reject_classroom_delete_with_managed_storage on public.classrooms;
create trigger reject_classroom_delete_with_managed_storage
before delete on public.classrooms
for each row execute function public.reject_classroom_delete_with_managed_storage();

-- Remove the path/URL inference surface from the previous local draft of 117
-- when a developer replays this consolidated migration.
drop function if exists public.reconcile_classroom_purge_object_sharing(uuid, uuid);
drop function if exists public.classroom_purge_storage_path_has_external_operation_reference(uuid, text, text);
drop function if exists public.classroom_purge_url_candidates(text);
drop function if exists public.classroom_purge_normalize_special_url_path(text);
drop function if exists public.classroom_purge_jsonb_references_storage_path(jsonb, text);
drop function if exists public.classroom_purge_jsonb_text_values(jsonb);
drop function if exists public.classroom_purge_percent_decode(text);
drop function if exists public.classroom_purge_percent_encode_path(text);
drop function if exists public.classroom_purge_normalize_percent_escapes(text);

-- Registers an unshared legacy Blueprint source without copying it. Immutable
-- Version snapshots are validation evidence only; only live mutable assessment
-- documents receive the managed id in this transaction.
create or replace function public.register_legacy_blueprint_storage_object(
  p_object_id uuid, p_teacher_id uuid, p_blueprint_id uuid,
  p_storage_bucket text, p_storage_path text,
  p_mutable_blueprint_documents jsonb, p_immutable_blueprint_evidence jsonb
)
returns public.managed_storage_objects
language plpgsql security definer set search_path = public, storage as $$
declare
  v_object public.managed_storage_objects;
  v_assessment public.course_blueprint_assessments%rowtype;
  v_ref jsonb; v_documents jsonb; v_document jsonb; v_index integer;
begin
  if p_storage_bucket <> 'test-documents' or p_storage_path = ''
    or jsonb_typeof(p_mutable_blueprint_documents) <> 'array'
    or jsonb_typeof(p_immutable_blueprint_evidence) <> 'array'
    or (jsonb_array_length(p_mutable_blueprint_documents) = 0
      and jsonb_array_length(p_immutable_blueprint_evidence) = 0) then
    raise exception 'invalid_legacy_blueprint_registration' using errcode = '22023';
  end if;
  perform public.managed_storage_exact_lock(p_storage_bucket, p_storage_path);
  if not exists (
    select 1 from public.course_blueprints
    where id = p_blueprint_id and teacher_id = p_teacher_id
  ) then raise exception 'legacy_blueprint_registration_owner_mismatch' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = p_storage_bucket and name = p_storage_path
  ) then raise exception 'legacy_blueprint_registration_source_missing' using errcode = '55000'; end if;

  -- Validate every current mutable target before registering or rewriting one.
  for v_ref in select value from jsonb_array_elements(p_mutable_blueprint_documents) loop
    select * into v_assessment from public.course_blueprint_assessments
    where id = (v_ref->>'assessmentId')::uuid and course_blueprint_id = p_blueprint_id
    for update;
    if not found or not exists (
      select 1 from jsonb_array_elements(coalesce(v_assessment.documents, '[]'::jsonb)) document(value)
      where document.value->>'id' = v_ref->>'documentId'
        and document.value->>'source' = 'upload'
        and document.value->>'url' = v_ref->>'expectedReference'
        and coalesce(nullif(document.value->>'managed_object_id', ''), p_object_id::text) = p_object_id::text
    ) then raise exception 'legacy_blueprint_registration_mutable_changed' using errcode = '40001'; end if;
  end loop;
  -- Deliberately no UPDATE of course_blueprint_versions follows this check.
  for v_ref in select value from jsonb_array_elements(p_immutable_blueprint_evidence) loop
    if not exists (
      select 1 from public.course_blueprint_versions version
      cross join lateral jsonb_array_elements(coalesce(version.snapshot_json->'assessments', '[]'::jsonb)) assessment(value)
      cross join lateral jsonb_array_elements(coalesce(assessment.value->'documents', '[]'::jsonb)) document(value)
      where version.id = (v_ref->>'versionId')::uuid
        and version.course_blueprint_id = p_blueprint_id
        and document.value->>'source' = 'upload'
        and document.value->>'url' = v_ref->>'expectedReference'
    ) then raise exception 'legacy_blueprint_registration_immutable_evidence_changed' using errcode = '40001'; end if;
  end loop;

  insert into public.managed_storage_objects (
    id, storage_bucket, storage_path, course_blueprint_id, purpose, status,
    created_by_user_id, resource_type, resource_id, content_type, ready_at
  ) values (
    p_object_id, p_storage_bucket, p_storage_path, p_blueprint_id,
    'teacher_test_material', 'ready', p_teacher_id,
    'legacy_blueprint_test_material', null,
    (select nullif(metadata->>'mimetype', '') from storage.objects
      where bucket_id = p_storage_bucket and name = p_storage_path), clock_timestamp()
  ) on conflict (storage_bucket, storage_path) do update set updated_at = clock_timestamp()
    where public.managed_storage_objects.id = p_object_id
      and public.managed_storage_objects.course_blueprint_id = p_blueprint_id
      and public.managed_storage_objects.status = 'ready'
  returning * into v_object;
  if v_object.id is null then
    raise exception 'legacy_blueprint_registration_owner_conflict' using errcode = '23505';
  end if;
  for v_ref in select value from jsonb_array_elements(p_mutable_blueprint_documents) loop
    select * into v_assessment from public.course_blueprint_assessments
    where id = (v_ref->>'assessmentId')::uuid for update;
    v_documents := coalesce(v_assessment.documents, '[]'::jsonb);
    select value, (ordinality - 1)::integer into v_document, v_index
    from jsonb_array_elements(v_documents) with ordinality
    where value->>'id' = v_ref->>'documentId';
    if v_document->>'managed_object_id' = p_object_id::text then continue; end if;
    v_documents := jsonb_set(v_documents, array[v_index::text],
      v_document || jsonb_build_object('managed_object_id', p_object_id), false);
    update public.course_blueprint_assessments set documents = v_documents
    where id = v_assessment.id;
  end loop;
  return v_object;
end;
$$;

-- A legacy test document can predate managed ownership and be referenced by
-- exactly one Classroom and exactly one Blueprint (including immutable Version
-- snapshots).  The original bytes must remain at their old URL for Versions;
-- this durable ledger copies the Classroom reference to a new exact object and
-- atomically assigns the original to the Blueprint.  Versions are evidence
-- only: no function below updates course_blueprint_versions.
create table public.legacy_blueprint_classroom_storage_reconciliations (
  id uuid primary key,
  teacher_id uuid not null references public.users (id) on delete restrict,
  blueprint_id uuid not null references public.course_blueprints (id) on delete restrict,
  classroom_id uuid not null references public.classrooms (id) on delete restrict,
  source_object_id uuid not null unique,
  target_object_id uuid not null unique,
  source_storage_bucket text not null check (source_storage_bucket = 'test-documents'),
  source_storage_path text not null check (btrim(source_storage_path) <> ''),
  target_storage_bucket text not null check (target_storage_bucket = 'test-documents'),
  target_storage_path text not null check (btrim(target_storage_path) <> ''),
  classroom_documents jsonb not null check (jsonb_typeof(classroom_documents) = 'array'),
  mutable_blueprint_documents jsonb not null check (jsonb_typeof(mutable_blueprint_documents) = 'array'),
  immutable_blueprint_evidence jsonb not null check (jsonb_typeof(immutable_blueprint_evidence) = 'array'),
  target_public_url text,
  content_type text,
  expected_byte_size bigint check (expected_byte_size is null or expected_byte_size >= 0),
  expected_sha256 text check (expected_sha256 is null or expected_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'planned' check (status in ('planned', 'copying', 'copied', 'adopted', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (blueprint_id, classroom_id, source_storage_bucket, source_storage_path),
  unique (target_storage_bucket, target_storage_path),
  check ((status = 'copying') = (lease_token is not null and lease_expires_at is not null)),
  check ((status in ('copied', 'adopted')) = (target_public_url is not null))
);
alter table public.legacy_blueprint_classroom_storage_reconciliations enable row level security;
revoke all on table public.legacy_blueprint_classroom_storage_reconciliations from public, anon, authenticated;
grant select on table public.legacy_blueprint_classroom_storage_reconciliations to service_role;

create or replace function public.plan_legacy_blueprint_classroom_storage_reconciliation(
  p_reconciliation_id uuid, p_source_object_id uuid, p_target_object_id uuid,
  p_teacher_id uuid, p_blueprint_id uuid, p_classroom_id uuid,
  p_source_storage_bucket text, p_source_storage_path text,
  p_target_storage_bucket text, p_target_storage_path text,
  p_classroom_documents jsonb, p_mutable_blueprint_documents jsonb,
  p_immutable_blueprint_evidence jsonb
)
returns public.legacy_blueprint_classroom_storage_reconciliations
language plpgsql security definer set search_path = public, storage as $$
declare v_row public.legacy_blueprint_classroom_storage_reconciliations;
begin
  if p_source_storage_bucket <> 'test-documents' or p_target_storage_bucket <> 'test-documents'
    or p_source_storage_path = '' or p_target_storage_path = ''
    or p_source_storage_path = p_target_storage_path
    or jsonb_typeof(p_classroom_documents) <> 'array'
    or jsonb_typeof(p_mutable_blueprint_documents) <> 'array'
    or jsonb_typeof(p_immutable_blueprint_evidence) <> 'array'
    -- The classroom discovery collector admits one exact path per resource.
    -- A multi-test claim would make the single target ledger ambiguous.
    or jsonb_array_length(p_classroom_documents) <> 1 then
    raise exception 'invalid_legacy_blueprint_reconciliation_plan' using errcode = '22023';
  end if;
  perform public.classroom_purge_lock(p_classroom_id);
  perform public.managed_storage_exact_lock(p_source_storage_bucket, p_source_storage_path);
  if not exists (select 1 from public.classrooms where id = p_classroom_id and teacher_id = p_teacher_id)
    or not exists (select 1 from public.course_blueprints where id = p_blueprint_id and teacher_id = p_teacher_id) then
    raise exception 'legacy_blueprint_reconciliation_owner_mismatch' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.classroom_purge_fences where classroom_id = p_classroom_id)
    or not exists (select 1 from storage.objects where bucket_id = p_source_storage_bucket and name = p_source_storage_path) then
    raise exception 'legacy_blueprint_reconciliation_source_unavailable' using errcode = '55000';
  end if;
  select * into v_row from public.legacy_blueprint_classroom_storage_reconciliations where id = p_reconciliation_id for update;
  if found then
    if v_row.teacher_id <> p_teacher_id or v_row.blueprint_id <> p_blueprint_id
      or v_row.classroom_id <> p_classroom_id or v_row.source_object_id <> p_source_object_id
      or v_row.target_object_id <> p_target_object_id or v_row.source_storage_path <> p_source_storage_path
      or v_row.target_storage_path <> p_target_storage_path or v_row.classroom_documents <> p_classroom_documents
      or v_row.mutable_blueprint_documents <> p_mutable_blueprint_documents
      or v_row.immutable_blueprint_evidence <> p_immutable_blueprint_evidence then
      raise exception 'legacy_blueprint_reconciliation_plan_mismatch' using errcode = '23505';
    end if;
    return v_row;
  end if;
  insert into public.legacy_blueprint_classroom_storage_reconciliations (
    id, teacher_id, blueprint_id, classroom_id, source_object_id, target_object_id,
    source_storage_bucket, source_storage_path, target_storage_bucket, target_storage_path,
    classroom_documents, mutable_blueprint_documents, immutable_blueprint_evidence, content_type
  ) values (
    p_reconciliation_id, p_teacher_id, p_blueprint_id, p_classroom_id, p_source_object_id, p_target_object_id,
    p_source_storage_bucket, p_source_storage_path, p_target_storage_bucket, p_target_storage_path,
    p_classroom_documents, p_mutable_blueprint_documents, p_immutable_blueprint_evidence,
    (select nullif(metadata->>'mimetype', '') from storage.objects
      where bucket_id = p_source_storage_bucket and name = p_source_storage_path)
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.claim_legacy_blueprint_classroom_storage_reconciliation(
  p_reconciliation_id uuid, p_teacher_id uuid, p_lease_token uuid, p_lease_seconds integer
)
returns public.legacy_blueprint_classroom_storage_reconciliations
language plpgsql security definer set search_path = public as $$
declare v_row public.legacy_blueprint_classroom_storage_reconciliations;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 900 then raise exception 'invalid_legacy_reconciliation_lease' using errcode = '22023'; end if;
  update public.legacy_blueprint_classroom_storage_reconciliations row set
    status = 'copying', attempt_count = row.attempt_count + 1, lease_token = p_lease_token,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    last_error_code = null, updated_at = clock_timestamp()
  where row.id = p_reconciliation_id and row.teacher_id = p_teacher_id
    and (row.status in ('planned', 'failed') or (row.status = 'copying' and row.lease_expires_at <= clock_timestamp()))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.complete_legacy_blueprint_classroom_storage_reconciliation(
  p_reconciliation_id uuid, p_teacher_id uuid, p_lease_token uuid,
  p_target_public_url text, p_byte_size bigint, p_content_sha256 text
)
returns boolean
language plpgsql security definer set search_path = public, storage as $$
begin
  if p_target_public_url = '' or p_byte_size < 0 or p_content_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_legacy_reconciliation_completion' using errcode = '22023';
  end if;
  update public.legacy_blueprint_classroom_storage_reconciliations row set
    status = 'copied', target_public_url = p_target_public_url, expected_byte_size = p_byte_size,
    expected_sha256 = p_content_sha256, lease_token = null, lease_expires_at = null,
    updated_at = clock_timestamp()
  where row.id = p_reconciliation_id and row.teacher_id = p_teacher_id
    and row.status = 'copying' and row.lease_token = p_lease_token
    and row.lease_expires_at > clock_timestamp()
    and exists (select 1 from storage.objects where bucket_id = row.target_storage_bucket and name = row.target_storage_path);
  return found;
end;
$$;

create or replace function public.fail_legacy_blueprint_classroom_storage_reconciliation(
  p_reconciliation_id uuid, p_teacher_id uuid, p_lease_token uuid, p_error_code text
)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.legacy_blueprint_classroom_storage_reconciliations row set
    status = 'failed', lease_token = null, lease_expires_at = null,
    last_error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'legacy_reconciliation_failed'), 160),
    updated_at = clock_timestamp()
  where row.id = p_reconciliation_id and row.teacher_id = p_teacher_id
    and row.status = 'copying' and row.lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.adopt_legacy_blueprint_classroom_storage_reconciliation(
  p_reconciliation_id uuid, p_teacher_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare
  v_row public.legacy_blueprint_classroom_storage_reconciliations;
  v_ref jsonb; v_test public.tests%rowtype; v_docs jsonb; v_doc jsonb; v_index integer;
  v_assessment public.course_blueprint_assessments%rowtype; v_first_test_id uuid;
  v_prior_identity text := current_setting('pika.identity_mapping', true);
  v_prior_compaction text := current_setting('pika.classroom_archive_compaction', true);
begin
  select * into v_row from public.legacy_blueprint_classroom_storage_reconciliations
    where id = p_reconciliation_id and teacher_id = p_teacher_id for update;
  if not found then raise exception 'legacy_blueprint_reconciliation_not_found' using errcode = 'P0002'; end if;
  if v_row.status = 'adopted' then return jsonb_build_object('ok', true); end if;
  if v_row.status <> 'copied' then return jsonb_build_object('ok', false, 'error_code', 'legacy_blueprint_reconciliation_copy_incomplete'); end if;
  perform public.classroom_purge_lock(v_row.classroom_id);
  perform public.managed_storage_exact_lock(v_row.source_storage_bucket, v_row.source_storage_path);
  if exists (select 1 from public.classroom_purge_fences where classroom_id = v_row.classroom_id)
    or not exists (select 1 from storage.objects where bucket_id = v_row.source_storage_bucket and name = v_row.source_storage_path)
    or not exists (select 1 from storage.objects where bucket_id = v_row.target_storage_bucket and name = v_row.target_storage_path) then
    raise exception 'legacy_blueprint_reconciliation_storage_changed' using errcode = '40001';
  end if;
  -- Validate all exact live rewrite targets before changing either owner.
  for v_ref in select value from jsonb_array_elements(v_row.classroom_documents) loop
    select * into v_test from public.tests where id = (v_ref->>'testId')::uuid and classroom_id = v_row.classroom_id for update;
    if not found or not exists (select 1 from jsonb_array_elements(coalesce(v_test.documents, '[]'::jsonb)) d
      where d->>'id' = v_ref->>'documentId' and d->>'source' = 'upload'
        and d->>'url' = v_ref->>'expectedReference') then
      raise exception 'legacy_blueprint_reconciliation_classroom_changed' using errcode = '40001';
    end if;
    v_first_test_id := coalesce(v_first_test_id, v_test.id);
  end loop;
  for v_ref in select value from jsonb_array_elements(v_row.mutable_blueprint_documents) loop
    select * into v_assessment from public.course_blueprint_assessments
      where id = (v_ref->>'assessmentId')::uuid and course_blueprint_id = v_row.blueprint_id for update;
    if not found or not exists (select 1 from jsonb_array_elements(coalesce(v_assessment.documents, '[]'::jsonb)) d
      where d->>'id' = v_ref->>'documentId' and d->>'source' = 'upload'
        and d->>'url' = v_ref->>'expectedReference') then
      raise exception 'legacy_blueprint_reconciliation_blueprint_changed' using errcode = '40001';
    end if;
  end loop;
  for v_ref in select value from jsonb_array_elements(v_row.immutable_blueprint_evidence) loop
    if not exists (select 1 from public.course_blueprint_versions version
      cross join lateral jsonb_array_elements(coalesce(version.snapshot_json->'assessments', '[]'::jsonb)) assessment(value)
      cross join lateral jsonb_array_elements(coalesce(assessment.value->'documents', '[]'::jsonb)) document(value)
      where version.id = (v_ref->>'versionId')::uuid and version.course_blueprint_id = v_row.blueprint_id
        and document.value->>'url' = v_ref->>'expectedReference') then
      raise exception 'legacy_blueprint_reconciliation_immutable_evidence_changed' using errcode = '40001';
    end if;
  end loop;
  insert into public.managed_storage_objects (
    id, storage_bucket, storage_path, course_blueprint_id, purpose, status, created_by_user_id,
    resource_type, resource_id, content_type, byte_size, content_sha256, ready_at
  ) values (
    v_row.source_object_id, v_row.source_storage_bucket, v_row.source_storage_path, v_row.blueprint_id,
    'teacher_test_material', 'ready', v_row.teacher_id, 'legacy_blueprint_test_material', null,
    v_row.content_type, v_row.expected_byte_size, v_row.expected_sha256, clock_timestamp()
  ) on conflict (storage_bucket, storage_path) do update set
      classroom_id = null, course_blueprint_id = v_row.blueprint_id,
      purpose = 'teacher_test_material',
      resource_type = 'legacy_blueprint_test_material', resource_id = null,
      updated_at = clock_timestamp()
    where public.managed_storage_objects.id = v_row.source_object_id
      and public.managed_storage_objects.storage_bucket = v_row.source_storage_bucket
      and public.managed_storage_objects.storage_path = v_row.source_storage_path
      and public.managed_storage_objects.status = 'ready'
      and (
        public.managed_storage_objects.course_blueprint_id = v_row.blueprint_id
        or public.managed_storage_objects.classroom_id = v_row.classroom_id
      );
  if not found then raise exception 'legacy_blueprint_reconciliation_source_owner_conflict' using errcode = '23505'; end if;
  insert into public.managed_storage_objects (
    id, storage_bucket, storage_path, classroom_id, purpose, status, created_by_user_id,
    resource_type, resource_id, content_type, byte_size, content_sha256, ready_at
  ) values (
    v_row.target_object_id, v_row.target_storage_bucket, v_row.target_storage_path, v_row.classroom_id,
    'teacher_test_material', 'ready', v_row.teacher_id, 'test', v_first_test_id,
    v_row.content_type, v_row.expected_byte_size, v_row.expected_sha256, clock_timestamp()
  ) on conflict (storage_bucket, storage_path) do update set updated_at = clock_timestamp()
    where public.managed_storage_objects.id = v_row.target_object_id
      and public.managed_storage_objects.classroom_id = v_row.classroom_id
      and public.managed_storage_objects.status = 'ready';
  if not found then raise exception 'legacy_blueprint_reconciliation_target_owner_conflict' using errcode = '23505'; end if;
  for v_ref in select value from jsonb_array_elements(v_row.classroom_documents) loop
    select * into v_test from public.tests where id = (v_ref->>'testId')::uuid for update;
    v_docs := coalesce(v_test.documents, '[]'::jsonb);
    select value, (ordinality - 1)::integer into v_doc, v_index from jsonb_array_elements(v_docs) with ordinality
      where value->>'id' = v_ref->>'documentId';
    v_docs := jsonb_set(v_docs, array[v_index::text], v_doc || jsonb_build_object(
      'url', v_row.target_public_url, 'managed_object_id', v_row.target_object_id), false);
    perform set_config('pika.identity_mapping', 'on', true);
    perform set_config('pika.classroom_archive_compaction', 'on', true);
    update public.tests set documents = v_docs where id = v_test.id;
  end loop;
  for v_ref in select value from jsonb_array_elements(v_row.mutable_blueprint_documents) loop
    select * into v_assessment from public.course_blueprint_assessments where id = (v_ref->>'assessmentId')::uuid for update;
    v_docs := coalesce(v_assessment.documents, '[]'::jsonb);
    select value, (ordinality - 1)::integer into v_doc, v_index from jsonb_array_elements(v_docs) with ordinality
      where value->>'id' = v_ref->>'documentId';
    v_docs := jsonb_set(v_docs, array[v_index::text], v_doc || jsonb_build_object(
      'managed_object_id', v_row.source_object_id), false);
    update public.course_blueprint_assessments set documents = v_docs where id = v_assessment.id;
  end loop;
  perform set_config('pika.classroom_archive_compaction', coalesce(v_prior_compaction, 'off'), true);
  perform set_config('pika.identity_mapping', coalesce(v_prior_identity, 'off'), true);
  -- Adoption is the terminal transaction: after both registry owners and live
  -- references are committed there is no resumable work left. Removing the
  -- ledger lets normal Classroom/Blueprint lifecycles proceed, while the
  -- restrictive owner FKs protect every nonterminal copy state.
  delete from public.legacy_blueprint_classroom_storage_reconciliations
    where id = v_row.id and status = 'copied';
  if not found then
    raise exception 'legacy_blueprint_reconciliation_adoption_conflict'
      using errcode = '40001';
  end if;
  return jsonb_build_object('ok', true);
exception when others then
  perform set_config('pika.classroom_archive_compaction', coalesce(v_prior_compaction, 'off'), true);
  perform set_config('pika.identity_mapping', coalesce(v_prior_identity, 'off'), true);
  raise;
end;
$$;

-- Assignment content arrives through the service-role application, but its
-- managed-file evidence is still derived from an untrusted browser payload.
-- Lock and revalidate every exact claim in the same transaction as the legacy
-- save/submit RPC so a purge or cleanup cannot win between validation and write.
create or replace function public.lock_assignment_doc_managed_storage_claims(
  p_assignment_id uuid,
  p_student_id uuid,
  p_managed_storage_claims jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_classroom_id uuid;
  v_claim jsonb;
  v_object_id uuid;
  v_path text;
begin
  if p_assignment_id is null
    or p_student_id is null
    or jsonb_typeof(coalesce(p_managed_storage_claims, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_managed_storage_claims, '[]'::jsonb)) > 1000
  then
    raise exception 'invalid_assignment_doc_managed_storage_claims'
      using errcode = '22023';
  end if;

  select assignment.classroom_id into v_classroom_id
  from public.assignments assignment
  where assignment.id = p_assignment_id;
  if not found then raise exception 'assignment_not_found' using errcode = 'P0002'; end if;

  perform public.classroom_purge_lock(v_classroom_id);
  perform 1
  from public.assignments assignment
  join public.classrooms classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
    and assignment.classroom_id = v_classroom_id
    and classroom.archived_at is null
  for update of assignment, classroom;
  if not found then raise exception 'classroom_archived' using errcode = '55000'; end if;
  if exists (
    select 1 from public.classroom_purge_fences where classroom_id = v_classroom_id
  ) then
    raise exception 'classroom_purge_active' using errcode = '55000';
  end if;

  for v_claim in
    select value from jsonb_array_elements(coalesce(p_managed_storage_claims, '[]'::jsonb))
  loop
    v_object_id := public.managed_storage_uuid(v_claim->>'managed_object_id');
    v_path := nullif(v_claim->>'storage_path', '');
    if v_claim - 'managed_object_id' - 'storage_bucket' - 'storage_path' <> '{}'::jsonb
      or v_object_id is null
      or nullif(v_claim->>'storage_bucket', '') is null
      or v_path is null
      or v_path like '/%'
      or '' = any(string_to_array(v_path, '/'))
      or '.' = any(string_to_array(v_path, '/'))
      or '..' = any(string_to_array(v_path, '/'))
    then
      raise exception 'invalid_assignment_doc_managed_storage_claims'
        using errcode = '22023';
    end if;

    perform 1
    from public.managed_storage_objects object
    where object.id = v_object_id
      and object.classroom_id = v_classroom_id
      and object.cold_classroom_id is null
      and object.course_blueprint_id is null
      and object.storage_bucket = v_claim->>'storage_bucket'
      and object.storage_path = v_path
      and object.status = 'ready'
    for update;
    if not found then
      raise exception 'assignment_doc_managed_storage_owner_mismatch'
        using errcode = '55000';
    end if;
  end loop;
end;
$$;

-- Preserve the pre-117 implementations behind private names. The public legacy
-- signatures remain deployment-compatible only while ownership enforcement is
-- disabled; once enabled, stale application instances fail closed. Managed
-- wrappers call the private implementations after taking ownership locks.
alter function public.save_course_blueprint_version_atomic(
  uuid, uuid, bigint, integer, jsonb, text, text, jsonb
) rename to save_course_blueprint_version_atomic_legacy_117;

create or replace function public.save_course_blueprint_version_atomic(
  p_teacher_id uuid,
  p_blueprint_id uuid,
  p_expected_draft_revision bigint,
  p_snapshot_schema_version integer,
  p_snapshot jsonb,
  p_snapshot_sha256 text,
  p_source_kind text,
  p_source_metadata jsonb
)
returns public.course_blueprint_versions
language plpgsql security definer set search_path = public as $$
declare
  v_version public.course_blueprint_versions;
begin
  if exists (
    select 1
    from jsonb_array_elements(
      coalesce(p_snapshot->'assessments', '[]'::jsonb)
    ) assessment(value)
    cross join lateral jsonb_array_elements(
      coalesce(assessment.value->'documents', '[]'::jsonb)
    ) document(value)
    where document.value->>'source' = 'upload'
  ) then
    raise exception 'managed_blueprint_version_wrapper_required'
      using errcode = '55000';
  end if;

  v_version := public.save_course_blueprint_version_atomic_legacy_117(
    p_teacher_id,
    p_blueprint_id,
    p_expected_draft_revision,
    p_snapshot_schema_version,
    p_snapshot,
    p_snapshot_sha256,
    p_source_kind,
    p_source_metadata
  );
  return v_version;
end;
$$;

create or replace function public.save_course_blueprint_version_managed_atomic(
  p_teacher_id uuid,
  p_blueprint_id uuid,
  p_expected_draft_revision bigint,
  p_snapshot_schema_version integer,
  p_snapshot jsonb,
  p_snapshot_sha256 text,
  p_source_kind text,
  p_source_metadata jsonb,
  p_managed_storage_claims jsonb
)
returns public.course_blueprint_versions
language plpgsql security definer set search_path = public as $$
declare
  v_claim jsonb;
  v_claim_count integer;
  v_document jsonb;
  v_object_id uuid;
  v_path text;
  v_reference_count integer := 0;
  v_version public.course_blueprint_versions;
begin
  if jsonb_typeof(coalesce(p_managed_storage_claims, '[]'::jsonb)) <> 'array'
  then
    raise exception 'invalid_blueprint_version_managed_storage_claims'
      using errcode = '22023';
  end if;

  perform 1
  from public.course_blueprints blueprint
  where blueprint.id = p_blueprint_id
    and blueprint.teacher_id = p_teacher_id
    and blueprint.content_revision = p_expected_draft_revision
  for update;
  if not found then
    raise exception 'Blueprint Draft changed; rebuild the Version'
      using errcode = '40001';
  end if;

  for v_document in
    select document.value
    from jsonb_array_elements(
      coalesce(p_snapshot->'assessments', '[]'::jsonb)
    ) assessment(value)
    cross join lateral jsonb_array_elements(
      coalesce(assessment.value->'documents', '[]'::jsonb)
    ) document(value)
    where document.value->>'source' = 'upload'
  loop
    v_reference_count := v_reference_count + 1;
    v_object_id := public.managed_storage_uuid(
      v_document->>'managed_object_id'
    );
    if v_object_id is null then
      raise exception 'blueprint_teacher_material_ownership_required'
        using errcode = '55000';
    end if;

    v_claim_count := 0;
    for v_claim in
      select value
      from jsonb_array_elements(coalesce(p_managed_storage_claims, '[]'::jsonb))
      where value->>'document_id' = v_document->>'id'
        and value->>'reference_kind' = 'teacher_upload'
        and value->>'managed_object_id' = v_object_id::text
    loop
      v_claim_count := v_claim_count + 1;
      v_path := nullif(v_claim->>'storage_path', '');
      if v_claim - 'document_id' - 'reference_kind' - 'managed_object_id'
          - 'storage_bucket' - 'storage_path' - 'storage_url' - 'purpose' <> '{}'::jsonb
        or v_claim->>'storage_bucket' is distinct from 'test-documents'
        or v_claim->>'purpose' is distinct from 'teacher_test_material'
        or nullif(v_claim->>'storage_url', '') is null
        or v_claim->>'storage_url' is distinct from v_document->>'url'
        or v_path is null
        or v_path like '/%'
        or '' = any(string_to_array(v_path, '/'))
        or '.' = any(string_to_array(v_path, '/'))
        or '..' = any(string_to_array(v_path, '/'))
      then
        raise exception 'invalid_blueprint_version_managed_storage_claims'
          using errcode = '22023';
      end if;
    end loop;
    if v_claim_count <> 1 then
      raise exception 'blueprint_teacher_material_owner_mismatch'
        using errcode = '55000';
    end if;

    perform 1
    from public.managed_storage_objects object
    where object.id = v_object_id
      and object.classroom_id is null
      and object.cold_classroom_id is null
      and object.course_blueprint_id = p_blueprint_id
      and object.storage_bucket = 'test-documents'
      and object.storage_path = v_path
      and object.purpose = 'teacher_test_material'
      and object.status = 'ready'
    for update;
    if not found then
      raise exception 'blueprint_teacher_material_owner_mismatch'
        using errcode = '55000';
    end if;
  end loop;

  if v_reference_count
    <> jsonb_array_length(coalesce(p_managed_storage_claims, '[]'::jsonb))
  then
    raise exception 'blueprint_teacher_material_owner_mismatch'
      using errcode = '55000';
  end if;

  v_version := public.save_course_blueprint_version_atomic_legacy_117(
    p_teacher_id,
    p_blueprint_id,
    p_expected_draft_revision,
    p_snapshot_schema_version,
    p_snapshot,
    p_snapshot_sha256,
    p_source_kind,
    p_source_metadata
  );
  return v_version;
end;
$$;

alter function public.save_assignment_doc_atomic(
  uuid, uuid, jsonb, timestamptz, text, integer, integer, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid
) rename to save_assignment_doc_atomic_legacy_117;
alter function public.submit_assignment_doc_atomic(
  uuid, uuid, jsonb, timestamptz, integer, integer
) rename to submit_assignment_doc_atomic_legacy_117;
alter function public.submit_assignment_doc_with_pal_event_atomic(
  uuid, uuid, jsonb, timestamptz, integer, integer, jsonb
) rename to submit_assignment_doc_with_pal_event_atomic_legacy_117;

create or replace function public.prepare_legacy_assignment_doc_write_117(
  p_assignment_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_classroom_id uuid;
  v_assignment_found boolean;
begin
  select classroom_id into v_classroom_id
  from public.assignments
  where id = p_assignment_id;
  v_assignment_found := found;
  if v_assignment_found then
    perform public.classroom_purge_lock(v_classroom_id);
  end if;

  if exists (
    select 1 from public.managed_storage_settings
    where singleton and enforce_ownership
  ) then
    raise exception 'managed_assignment_wrapper_required' using errcode = '55000';
  end if;
  if not v_assignment_found then return; end if;

  -- During the migration-first window a stale application instance may still
  -- use this compatibility signature. Invalidate any completed readiness
  -- proof in the same transaction as its write so enforcement/purge cannot use
  -- a snapshot taken before the legacy payload changed.
  update public.classroom_managed_storage_coverage
  set
    status = 'pending',
    source_revision = null,
    inventory_sha256 = null,
    error_code = 'legacy_assignment_write_after_readiness',
    verified_at = null,
    updated_at = clock_timestamp()
  where classroom_id = v_classroom_id
    and status = 'verified';
end;
$$;

create or replace function public.save_assignment_doc_atomic(
  p_assignment_id uuid, p_student_id uuid, p_content jsonb,
  p_expected_updated_at timestamptz, p_trigger text,
  p_paste_word_count integer, p_keystroke_count integer,
  p_patch jsonb, p_snapshot jsonb, p_word_count integer, p_char_count integer,
  p_save_session_id uuid, p_save_sequence bigint, p_metric_session_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.prepare_legacy_assignment_doc_write_117(p_assignment_id);
  return public.save_assignment_doc_atomic_legacy_117(
    p_assignment_id, p_student_id, p_content, p_expected_updated_at, p_trigger,
    p_paste_word_count, p_keystroke_count, p_patch, p_snapshot,
    p_word_count, p_char_count, p_save_session_id, p_save_sequence, p_metric_session_id
  );
end;
$$;

create or replace function public.submit_assignment_doc_atomic(
  p_assignment_id uuid, p_student_id uuid, p_content jsonb,
  p_expected_updated_at timestamptz, p_word_count integer, p_char_count integer
)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.prepare_legacy_assignment_doc_write_117(p_assignment_id);
  return public.submit_assignment_doc_atomic_legacy_117(
    p_assignment_id, p_student_id, p_content, p_expected_updated_at,
    p_word_count, p_char_count
  );
end;
$$;

create or replace function public.submit_assignment_doc_with_pal_event_atomic(
  p_assignment_id uuid, p_student_id uuid, p_content jsonb,
  p_expected_updated_at timestamptz, p_word_count integer, p_char_count integer,
  p_pal_event jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform public.prepare_legacy_assignment_doc_write_117(p_assignment_id);
  return public.submit_assignment_doc_with_pal_event_atomic_legacy_117(
    p_assignment_id, p_student_id, p_content, p_expected_updated_at,
    p_word_count, p_char_count, p_pal_event
  );
end;
$$;

create or replace function public.save_assignment_doc_managed_atomic(
  p_assignment_id uuid, p_student_id uuid, p_content jsonb,
  p_expected_updated_at timestamptz, p_trigger text,
  p_paste_word_count integer, p_keystroke_count integer,
  p_patch jsonb, p_snapshot jsonb, p_word_count integer, p_char_count integer,
  p_save_session_id uuid, p_save_sequence bigint, p_metric_session_id uuid,
  p_managed_storage_claims jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.lock_assignment_doc_managed_storage_claims(
    p_assignment_id, p_student_id, p_managed_storage_claims
  );
  return public.save_assignment_doc_atomic_legacy_117(
    p_assignment_id, p_student_id, p_content, p_expected_updated_at, p_trigger,
    p_paste_word_count, p_keystroke_count, p_patch, p_snapshot,
    p_word_count, p_char_count, p_save_session_id, p_save_sequence, p_metric_session_id
  );
end;
$$;

create or replace function public.submit_assignment_doc_managed_atomic(
  p_assignment_id uuid, p_student_id uuid, p_content jsonb,
  p_expected_updated_at timestamptz, p_word_count integer, p_char_count integer,
  p_managed_storage_claims jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.lock_assignment_doc_managed_storage_claims(
    p_assignment_id, p_student_id, p_managed_storage_claims
  );
  return public.submit_assignment_doc_atomic_legacy_117(
    p_assignment_id, p_student_id, p_content, p_expected_updated_at,
    p_word_count, p_char_count
  );
end;
$$;

create or replace function public.submit_assignment_doc_with_pal_event_managed_atomic(
  p_assignment_id uuid, p_student_id uuid, p_content jsonb,
  p_expected_updated_at timestamptz, p_word_count integer, p_char_count integer,
  p_pal_event jsonb, p_managed_storage_claims jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform public.lock_assignment_doc_managed_storage_claims(
    p_assignment_id, p_student_id, p_managed_storage_claims
  );
  return public.submit_assignment_doc_with_pal_event_atomic_legacy_117(
    p_assignment_id, p_student_id, p_content, p_expected_updated_at,
    p_word_count, p_char_count, p_pal_event
  );
end;
$$;

revoke all on function public.managed_storage_identity_sha256(text, text)
  from public, anon, authenticated;
revoke all on function public.managed_storage_uuid(text)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_classroom_archive_restore_managed_v2(
  uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb,
  bigint, integer, integer, jsonb
) from public, anon, authenticated;
revoke all on function public.complete_classroom_archive_restore_legacy_117(
  uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.complete_classroom_archive_restore(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_classroom_archive_compaction_legacy_117(
  uuid, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.complete_classroom_archive_compaction(
  uuid, uuid, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.complete_classroom_archive_compaction_v2_legacy_117(
  uuid, uuid, jsonb, jsonb, integer
) from public, anon, authenticated, service_role;
revoke all on function public.complete_classroom_archive_compaction_v2(
  uuid, uuid, jsonb, jsonb, integer
) from public, anon, authenticated;
revoke all on function public.rewrite_managed_storage_document_owner(
  jsonb, uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.managed_storage_exact_lock(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.refresh_classroom_managed_storage_coverage(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.plan_course_blueprint_storage_copies()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_course_blueprint_storage_copy(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_course_blueprint_storage_copy(
  uuid, uuid, uuid, text, bigint, text
) from public, anon, authenticated;
revoke all on function public.fail_course_blueprint_storage_copy(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.adopt_course_blueprint_storage_copies(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.begin_managed_storage_upload(
  uuid, text, text, uuid, uuid, text, uuid, uuid, text, uuid, text, bigint
) from public, anon, authenticated;
revoke all on function public.adopt_managed_storage_upload(uuid, text)
  from public, anon, authenticated;
revoke all on function public.queue_managed_storage_cleanup(uuid, text)
  from public, anon, authenticated;
revoke all on function public.queue_classroom_managed_storage_cleanup(
  uuid, uuid, text, text, text, text, uuid, text
) from public, anon, authenticated;
revoke all on function public.queue_managed_storage_cleanup_path(text, text, text)
  from public, anon, authenticated;
revoke all on function public.update_test_documents_managed_atomic(
  uuid, uuid, text, jsonb, jsonb, jsonb, jsonb,
  boolean, text, boolean, text, boolean, boolean
) from public, anon, authenticated;
revoke all on function public.claim_managed_storage_cleanup(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_managed_storage_cleanup(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_managed_storage_cleanup(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.begin_course_blueprint_managed_deletion(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_course_blueprint_managed_cleanup(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke all on function public.finalize_course_blueprint_managed_deletion(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.register_legacy_classroom_storage_object(
  uuid, uuid, uuid, text, text, text, uuid, uuid, text, uuid, text, bigint
) from public, anon, authenticated;
revoke all on function public.verify_classroom_managed_storage_coverage(
  uuid, uuid, bigint, integer, text
) from public, anon, authenticated;
revoke all on function public.attach_legacy_test_document_managed_object(
  uuid, uuid, uuid, text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.sync_test_document_snapshot_managed_atomic(
  uuid, uuid, text, text, uuid, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.finalize_hot_archived_classroom_purge_legacy_117(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_hot_archived_classroom_purge(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.plan_legacy_blueprint_classroom_storage_reconciliation(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.claim_legacy_blueprint_classroom_storage_reconciliation(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;
revoke all on function public.complete_legacy_blueprint_classroom_storage_reconciliation(
  uuid, uuid, uuid, text, bigint, text
) from public, anon, authenticated;
revoke all on function public.fail_legacy_blueprint_classroom_storage_reconciliation(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.adopt_legacy_blueprint_classroom_storage_reconciliation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.register_legacy_blueprint_storage_object(
  uuid, uuid, uuid, text, text, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.lock_assignment_doc_managed_storage_claims(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.save_assignment_doc_managed_atomic(
  uuid, uuid, jsonb, timestamptz, text, integer, integer, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.submit_assignment_doc_managed_atomic(
  uuid, uuid, jsonb, timestamptz, integer, integer, jsonb
) from public, anon, authenticated;
revoke all on function public.submit_assignment_doc_with_pal_event_managed_atomic(
  uuid, uuid, jsonb, timestamptz, integer, integer, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.save_assignment_doc_atomic_legacy_117(
  uuid, uuid, jsonb, timestamptz, text, integer, integer, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.submit_assignment_doc_atomic_legacy_117(
  uuid, uuid, jsonb, timestamptz, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.submit_assignment_doc_with_pal_event_atomic_legacy_117(
  uuid, uuid, jsonb, timestamptz, integer, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.save_course_blueprint_version_atomic_legacy_117(
  uuid, uuid, bigint, integer, jsonb, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.save_course_blueprint_version_atomic(
  uuid, uuid, bigint, integer, jsonb, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.save_course_blueprint_version_managed_atomic(
  uuid, uuid, bigint, integer, jsonb, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.prepare_legacy_assignment_doc_write_117(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.save_assignment_doc_atomic(
  uuid, uuid, jsonb, timestamptz, text, integer, integer, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.submit_assignment_doc_atomic(
  uuid, uuid, jsonb, timestamptz, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.submit_assignment_doc_with_pal_event_atomic(
  uuid, uuid, jsonb, timestamptz, integer, integer, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.begin_managed_storage_upload(
  uuid, text, text, uuid, uuid, text, uuid, uuid, text, uuid, text, bigint
) to service_role;
grant execute on function public.begin_classroom_archive_restore_managed_v2(
  uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb,
  bigint, integer, integer, jsonb
) to service_role;
grant execute on function public.complete_classroom_archive_restore(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.complete_classroom_archive_compaction(
  uuid, uuid, jsonb, jsonb
) to service_role;
grant execute on function public.complete_classroom_archive_compaction_v2(
  uuid, uuid, jsonb, jsonb, integer
) to service_role;
grant execute on function public.claim_course_blueprint_storage_copy(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.complete_course_blueprint_storage_copy(
  uuid, uuid, uuid, text, bigint, text
) to service_role;
grant execute on function public.fail_course_blueprint_storage_copy(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.adopt_course_blueprint_storage_copies(uuid, uuid)
  to service_role;
grant execute on function public.adopt_managed_storage_upload(uuid, text)
  to service_role;
grant execute on function public.queue_managed_storage_cleanup(uuid, text)
  to service_role;
grant execute on function public.queue_classroom_managed_storage_cleanup(
  uuid, uuid, text, text, text, text, uuid, text
) to service_role;
grant execute on function public.queue_managed_storage_cleanup_path(text, text, text)
  to service_role;
grant execute on function public.update_test_documents_managed_atomic(
  uuid, uuid, text, jsonb, jsonb, jsonb, jsonb,
  boolean, text, boolean, text, boolean, boolean
) to service_role;
grant execute on function public.claim_managed_storage_cleanup(uuid, integer, integer)
  to service_role;
grant execute on function public.complete_managed_storage_cleanup(uuid, uuid)
  to service_role;
grant execute on function public.fail_managed_storage_cleanup(uuid, uuid, text)
  to service_role;
grant execute on function public.begin_course_blueprint_managed_deletion(uuid, uuid)
  to service_role;
grant execute on function public.claim_course_blueprint_managed_cleanup(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.finalize_course_blueprint_managed_deletion(uuid, uuid)
  to service_role;
grant execute on function public.register_legacy_classroom_storage_object(
  uuid, uuid, uuid, text, text, text, uuid, uuid, text, uuid, text, bigint
) to service_role;
grant execute on function public.verify_classroom_managed_storage_coverage(
  uuid, uuid, bigint, integer, text
) to service_role;
grant execute on function public.attach_legacy_test_document_managed_object(
  uuid, uuid, uuid, text, text, text, uuid
) to service_role;
grant execute on function public.sync_test_document_snapshot_managed_atomic(
  uuid, uuid, text, text, uuid, text, text, timestamptz
) to service_role;
grant execute on function public.finalize_hot_archived_classroom_purge(uuid, uuid)
  to service_role;
grant execute on function public.plan_legacy_blueprint_classroom_storage_reconciliation(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb
) to service_role;
grant execute on function public.claim_legacy_blueprint_classroom_storage_reconciliation(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.complete_legacy_blueprint_classroom_storage_reconciliation(
  uuid, uuid, uuid, text, bigint, text
) to service_role;
grant execute on function public.fail_legacy_blueprint_classroom_storage_reconciliation(
  uuid, uuid, uuid, text
) to service_role;
grant execute on function public.adopt_legacy_blueprint_classroom_storage_reconciliation(uuid, uuid)
  to service_role;
grant execute on function public.register_legacy_blueprint_storage_object(
  uuid, uuid, uuid, text, text, jsonb, jsonb
) to service_role;
grant execute on function public.save_assignment_doc_managed_atomic(
  uuid, uuid, jsonb, timestamptz, text, integer, integer, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid, jsonb
) to service_role;
grant execute on function public.submit_assignment_doc_managed_atomic(
  uuid, uuid, jsonb, timestamptz, integer, integer, jsonb
) to service_role;
grant execute on function public.submit_assignment_doc_with_pal_event_managed_atomic(
  uuid, uuid, jsonb, timestamptz, integer, integer, jsonb, jsonb
) to service_role;
grant execute on function public.save_assignment_doc_atomic(
  uuid, uuid, jsonb, timestamptz, text, integer, integer, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid
) to service_role;
grant execute on function public.submit_assignment_doc_atomic(
  uuid, uuid, jsonb, timestamptz, integer, integer
) to service_role;
grant execute on function public.submit_assignment_doc_with_pal_event_atomic(
  uuid, uuid, jsonb, timestamptz, integer, integer, jsonb
) to service_role;
grant execute on function public.save_course_blueprint_version_atomic(
  uuid, uuid, bigint, integer, jsonb, text, text, jsonb
) to service_role;
grant execute on function public.save_course_blueprint_version_managed_atomic(
  uuid, uuid, bigint, integer, jsonb, text, text, jsonb, jsonb
) to service_role;

comment on function public.begin_hot_archived_classroom_purge(uuid, uuid, uuid, text, jsonb) is
  'Begins exact-ownership purge only when operator gates and legacy coverage are verified.';
comment on function public.complete_classroom_purge_object(uuid, uuid, uuid) is
  'Completes an exact object lease only after authoritative storage.objects absence.';
comment on function public.finalize_hot_archived_classroom_purge(uuid, uuid) is
  'Atomically reconciles exact managed ownership before the migration-115 child-first finalizer.';
