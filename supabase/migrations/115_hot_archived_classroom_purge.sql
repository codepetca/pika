-- Durable, resumable permanent deletion for teacher-owned hot archived classrooms.
-- Storage deletion is performed by the application worker; database finalization
-- is allowed only after every staged object has been deleted or explicitly kept.

create table public.classroom_purge_operations (
  id uuid primary key,
  teacher_id uuid not null references public.users (id) on delete restrict,
  classroom_id uuid not null,
  classroom_title text,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'inventorying'
    check (status in (
      'inventorying', 'deleting_objects', 'finalizing', 'completed', 'failed'
    )),
  source_revision bigint not null check (source_revision > 0),
  impact_summary jsonb not null,
  resource_counts jsonb not null default '{}'::jsonb,
  storage_object_counts jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 1 check (attempt_count > 0),
  error_code text,
  retryable boolean,
  started_at timestamptz not null default clock_timestamp(),
  inventory_completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);

create unique index classroom_purge_operations_one_active_per_classroom
  on public.classroom_purge_operations (classroom_id)
  where status <> 'completed';
create index classroom_purge_operations_teacher_started
  on public.classroom_purge_operations (teacher_id, started_at desc);

create table public.classroom_purge_resources (
  operation_id uuid not null
    references public.classroom_purge_operations (id) on delete cascade,
  table_name text not null
    references public.classroom_archive_resource_contract (table_name),
  row_id uuid not null,
  primary key (operation_id, table_name, row_id)
);

create index classroom_purge_resources_operation_table
  on public.classroom_purge_resources (operation_id, table_name, row_id);

create table public.classroom_purge_objects (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null
    references public.classroom_purge_operations (id) on delete cascade,
  storage_bucket text not null check (storage_bucket in (
    'assignment-artifacts',
    'submission-images',
    'test-documents',
    'classroom-archives',
    'gradex-analytics-extracts'
  )),
  storage_path text,
  storage_path_sha256 text not null check (storage_path_sha256 ~ '^[a-f0-9]{64}$'),
  disposition text not null check (disposition in ('delete', 'preserve_shared')),
  status text not null check (status in (
    'pending', 'processing', 'failed', 'deleted', 'preserved'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (operation_id, storage_bucket, storage_path_sha256),
  check (
    storage_path is null
    or (
      storage_path <> ''
      and storage_path not like '/%'
      and strpos(storage_path, E'\\') = 0
      and not ('..' = any(string_to_array(storage_path, '/')))
    )
  ),
  check (
    (status = 'processing' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'processing' and lease_token is null and lease_expires_at is null)
  ),
  check (
    (status = 'deleted' and disposition = 'delete' and deleted_at is not null)
    or (status <> 'deleted' and deleted_at is null)
  ),
  check (
    (disposition = 'preserve_shared' and status = 'preserved')
    or (disposition = 'delete' and status <> 'preserved')
  )
);

create index classroom_purge_objects_due
  on public.classroom_purge_objects (next_attempt_at, created_at)
  where status in ('pending', 'failed', 'processing');

create table public.classroom_purge_fences (
  classroom_id uuid primary key references public.classrooms (id) on delete cascade,
  operation_id uuid not null unique
    references public.classroom_purge_operations (id) on delete cascade,
  teacher_id uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.classroom_purge_operations enable row level security;
alter table public.classroom_purge_resources enable row level security;
alter table public.classroom_purge_objects enable row level security;
alter table public.classroom_purge_fences enable row level security;

revoke all on table public.classroom_purge_operations from public, anon, authenticated;
revoke all on table public.classroom_purge_resources from public, anon, authenticated;
revoke all on table public.classroom_purge_objects from public, anon, authenticated;
revoke all on table public.classroom_purge_fences from public, anon, authenticated;
grant select on table public.classroom_purge_operations to service_role;
grant select on table public.classroom_purge_resources to service_role;
grant select on table public.classroom_purge_objects to service_role;
grant select on table public.classroom_purge_fences to service_role;

create or replace function public.classroom_purge_lock(p_classroom_id uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || p_classroom_id::text, 0)
  )
$$;

create or replace function public.classroom_purge_conflict(p_classroom_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.classroom_archive_operations operation
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
  ) then
    return 'classroom_archive_operation_active';
  end if;

  if exists (
    select 1
    from public.assignment_ai_grading_runs run
    join public.assignments assignment on assignment.id = run.assignment_id
    where assignment.classroom_id = p_classroom_id
      and run.status in ('queued', 'running')
  ) or exists (
    select 1
    from public.assignment_repo_review_runs run
    join public.assignments assignment on assignment.id = run.assignment_id
    where assignment.classroom_id = p_classroom_id
      and run.status in ('queued', 'running')
  ) or exists (
    select 1
    from public.test_ai_grading_runs run
    join public.tests test on test.id = run.test_id
    where test.classroom_id = p_classroom_id
      and run.status in ('queued', 'running')
  ) then
    return 'classroom_grading_operation_active';
  end if;

  if exists (
    select 1
    from public.course_blueprint_operations operation
    where operation.status = 'running'
      and (
        operation.source_classroom_id = p_classroom_id
        or operation.result_classroom_id = p_classroom_id
      )
  ) or exists (
    select 1
    from public.course_blueprint_change_proposals proposal
    where proposal.status in ('ready', 'needs_review', 'conflicted')
      and (
        proposal.source_classroom_id = p_classroom_id
        or proposal.target_classroom_id = p_classroom_id
      )
  ) or exists (
    select 1
    from public.course_blueprint_editing_sessions session
    where session.status = 'ready'
      and session.expires_at > clock_timestamp()
      and session.classroom_id = p_classroom_id
  ) then
    return 'classroom_blueprint_operation_active';
  end if;

  return null;
end;
$$;

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
  v_conflict text;
begin
  if p_request_sha256 !~ '^[a-f0-9]{64}$'
    or p_impact_summary is null
    or jsonb_typeof(p_impact_summary) <> 'object'
  then
    raise exception 'Invalid classroom purge request'
      using errcode = '22023';
  end if;

  perform public.classroom_purge_lock(p_classroom_id);

  select *
  into v_operation
  from public.classroom_purge_operations
  where id = p_operation_id
  for update;

  if found then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.request_sha256 <> p_request_sha256
    then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different purge request'
      );
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
  join public.classroom_archive_revisions revision
    on revision.classroom_id = classroom.id
  where classroom.id = p_classroom_id
  for update of classroom, revision;

  if not found or v_teacher_id <> p_teacher_id then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'error_code', 'classroom_not_found',
      'error', 'Classroom not found'
    );
  end if;
  if v_archived_at is null then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'error_code', 'classroom_not_hot_archived',
      'error', 'Only archived classrooms stored in Pika can be permanently deleted'
    );
  end if;
  if exists (
    select 1 from public.classroom_cold_tombstones
    where classroom_id = p_classroom_id
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'error_code', 'classroom_is_cold_archived',
      'error', 'Stored classroom deletion is not available yet'
    );
  end if;
  if exists (
    select 1 from public.classroom_purge_fences
    where classroom_id = p_classroom_id
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'error_code', 'classroom_purge_active',
      'error', 'A permanent deletion is already active for this classroom'
    );
  end if;

  v_conflict := public.classroom_purge_conflict(p_classroom_id);
  if v_conflict is not null then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'error_code', v_conflict,
      'error', 'Finish the active classroom operation before deleting permanently'
    );
  end if;

  insert into public.classroom_purge_operations (
    id,
    teacher_id,
    classroom_id,
    classroom_title,
    request_sha256,
    source_revision,
    impact_summary
  ) values (
    p_operation_id,
    p_teacher_id,
    p_classroom_id,
    v_title,
    p_request_sha256,
    v_revision,
    p_impact_summary
  );

  insert into public.classroom_purge_fences (
    classroom_id,
    operation_id,
    teacher_id
  ) values (
    p_classroom_id,
    p_operation_id,
    p_teacher_id
  );

  insert into public.classroom_purge_resources (operation_id, table_name, row_id)
  values (p_operation_id, 'classrooms', p_classroom_id);

  for v_resource in
    select
      table_name,
      primary_key_columns[1] as primary_key_column,
      parent_table,
      parent_column
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
    )
    using p_operation_id, v_resource.table_name, v_resource.parent_table;
  end loop;

  select jsonb_object_agg(
    contract.table_name,
    coalesce(resource_count.row_count, 0)
    order by contract.export_position
  )
  into v_counts
  from public.classroom_archive_resource_contract contract
  left join (
    select table_name, count(*)::integer as row_count
    from public.classroom_purge_resources
    where operation_id = p_operation_id
    group by table_name
  ) resource_count on resource_count.table_name = contract.table_name;

  update public.classroom_purge_operations
  set resource_counts = v_counts, updated_at = clock_timestamp()
  where id = p_operation_id;

  return jsonb_build_object(
    'ok', true,
    'status', 202,
    'operation_id', p_operation_id,
      'operation_status', 'inventorying',
      'source_revision', v_revision,
    'resource_counts', v_counts,
    'storage_object_counts', '{}'::jsonb,
    'replayed', false
  );
exception
  when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'error_code', 'classroom_purge_active',
      'error', 'A permanent deletion is already active for this classroom'
    );
end;
$$;

create or replace function public.classroom_purge_storage_path_is_shared(
  p_operation_id uuid,
  p_storage_bucket text,
  p_storage_path text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_resource record;
  v_shared boolean;
  v_needle text := p_storage_path;
begin
  -- Exact relational ownership for assignment artifacts.
  if p_storage_bucket = 'assignment-artifacts' and exists (
    select 1
    from public.assignment_submission_artifacts artifact
    where artifact.storage_path = p_storage_path
      and not exists (
        select 1
        from public.classroom_purge_resources snapshot
        where snapshot.operation_id = p_operation_id
          and snapshot.table_name = 'assignment_submission_artifacts'
          and snapshot.row_id = artifact.id
      )
  ) then
    return true;
  end if;

  -- Embedded managed URLs can appear in rich text and JSON. Search outside the
  -- exact purge membership. False positives preserve an object, which is the
  -- fail-safe direction.
  for v_resource in
    select table_name, primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
  loop
    execute format(
      'select exists (
         select 1
         from public.%I source
         where to_jsonb(source)::text like $1
           and not exists (
             select 1
             from public.classroom_purge_resources snapshot
             where snapshot.operation_id = $2
               and snapshot.table_name = $3
               and snapshot.row_id = source.%I
           )
       )',
      v_resource.table_name,
      v_resource.primary_key_column
    )
    into v_shared
    using '%' || v_needle || '%', p_operation_id, v_resource.table_name;
    if v_shared then return true; end if;
  end loop;

  -- Course Blueprint content is reusable and must never be purged with a
  -- classroom. Cover both immutable snapshots and mutable draft tables.
  select exists (
    select 1 from public.course_blueprints row
    where to_jsonb(row)::text like '%' || v_needle || '%'
  ) or exists (
    select 1 from public.course_blueprint_versions row
    where to_jsonb(row)::text like '%' || v_needle || '%'
  ) or exists (
    select 1 from public.course_blueprint_assignments row
    where to_jsonb(row)::text like '%' || v_needle || '%'
  ) or exists (
    select 1 from public.course_blueprint_assessments row
    where to_jsonb(row)::text like '%' || v_needle || '%'
  ) or exists (
    select 1 from public.course_blueprint_lesson_templates row
    where to_jsonb(row)::text like '%' || v_needle || '%'
  ) or exists (
    select 1 from public.course_blueprint_materials row
    where to_jsonb(row)::text like '%' || v_needle || '%'
  ) or exists (
    select 1 from public.course_blueprint_surveys row
    where to_jsonb(row)::text like '%' || v_needle || '%'
  ) or exists (
    select 1 from public.course_blueprint_change_proposals row
    where to_jsonb(row)::text like '%' || v_needle || '%'
  ) or exists (
    select 1 from public.course_blueprint_editing_sessions row
    where to_jsonb(row)::text like '%' || v_needle || '%'
  )
  into v_shared;

  return coalesce(v_shared, false);
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
set search_path = public, extensions
as $$
declare
  v_operation public.classroom_purge_operations;
  v_object jsonb;
  v_bucket text;
  v_path text;
  v_disposition text;
  v_path_sha256 text;
  v_counts jsonb;
begin
  if p_objects is null or jsonb_typeof(p_objects) <> 'array' then
    raise exception 'Invalid classroom purge objects'
      using errcode = '22023';
  end if;

  select * into v_operation
  from public.classroom_purge_operations
  where id = p_operation_id
  for update;

  if not found or v_operation.teacher_id <> p_teacher_id then
    raise exception 'Classroom purge operation not found' using errcode = 'P0002';
  end if;
  if v_operation.status not in ('inventorying', 'failed') then
    raise exception 'Classroom purge operation cannot accept objects'
      using errcode = '55000';
  end if;

  for v_object in select value from jsonb_array_elements(p_objects)
  loop
    if jsonb_typeof(v_object) <> 'object'
      or v_object - 'bucket' - 'path' - 'disposition' <> '{}'::jsonb
    then
      raise exception 'Invalid classroom purge object'
        using errcode = '22023';
    end if;
    v_bucket := v_object->>'bucket';
    v_path := v_object->>'path';
    v_disposition := v_object->>'disposition';
    if v_bucket not in (
      'assignment-artifacts',
      'submission-images',
      'test-documents',
      'classroom-archives',
      'gradex-analytics-extracts'
    ) or v_path is null
      or v_path = ''
      or v_path like '/%'
      or strpos(v_path, E'\\') > 0
      or '..' = any(string_to_array(v_path, '/'))
      or v_disposition not in ('delete', 'preserve_shared')
    then
      raise exception 'Invalid classroom purge storage object'
        using errcode = '22023';
    end if;

    v_disposition := case
      when public.classroom_purge_storage_path_is_shared(
        p_operation_id, v_bucket, v_path
      ) then 'preserve_shared'
      else 'delete'
    end;

    v_path_sha256 := encode(
      extensions.digest(
        convert_to(jsonb_build_array(v_bucket, v_path)::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    insert into public.classroom_purge_objects (
      operation_id,
      storage_bucket,
      storage_path,
      storage_path_sha256,
      disposition,
      status
    ) values (
      p_operation_id,
      v_bucket,
      v_path,
      v_path_sha256,
      v_disposition,
      case when v_disposition = 'preserve_shared' then 'preserved' else 'pending' end
    )
    on conflict (operation_id, storage_bucket, storage_path_sha256) do nothing;
  end loop;

  select coalesce(jsonb_object_agg(status, object_count), '{}'::jsonb)
  into v_counts
  from (
    select status, count(*)::integer object_count
    from public.classroom_purge_objects
    where operation_id = p_operation_id
    group by status
  ) counts;

  update public.classroom_purge_operations
  set
    storage_object_counts = v_counts,
    error_code = null,
    retryable = null,
    updated_at = clock_timestamp()
  where id = p_operation_id;

  return v_counts;
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
  v_operation public.classroom_purge_operations;
  v_actual_count integer;
  v_counts jsonb;
begin
  if p_expected_object_count < 0 then
    raise exception 'Invalid classroom purge object count' using errcode = '22023';
  end if;
  select * into v_operation
  from public.classroom_purge_operations
  where id = p_operation_id
  for update;
  if not found or v_operation.teacher_id <> p_teacher_id then
    raise exception 'Classroom purge operation not found' using errcode = 'P0002';
  end if;
  if v_operation.inventory_completed_at is not null then
    return jsonb_build_object(
      'ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', v_operation.status, 'replayed', true
    );
  end if;

  select count(*)::integer into v_actual_count
  from public.classroom_purge_objects
  where operation_id = p_operation_id;
  if v_actual_count <> p_expected_object_count then
    raise exception 'Classroom purge object inventory is incomplete'
      using errcode = '40001';
  end if;
  select coalesce(jsonb_object_agg(status, object_count), '{}'::jsonb)
  into v_counts
  from (
    select status, count(*)::integer object_count
    from public.classroom_purge_objects
    where operation_id = p_operation_id
    group by status
  ) counts;

  update public.classroom_purge_operations
  set
    status = 'deleting_objects',
    inventory_completed_at = clock_timestamp(),
    storage_object_counts = v_counts,
    updated_at = clock_timestamp()
  where id = p_operation_id;

  return jsonb_build_object(
    'ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', 'deleting_objects', 'replayed', false
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
begin
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'Invalid classroom purge lease' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.classroom_purge_operations
    where id = p_operation_id
      and teacher_id = p_teacher_id
      and status in ('deleting_objects', 'failed')
  ) then
    raise exception 'Classroom purge operation not found' using errcode = 'P0002';
  end if;

  return query
  with candidate as (
    select object.id
    from public.classroom_purge_objects object
    where object.operation_id = p_operation_id
      and object.disposition = 'delete'
      and object.next_attempt_at <= clock_timestamp()
      and (
        object.status in ('pending', 'failed')
        or (
          object.status = 'processing'
          and object.lease_expires_at <= clock_timestamp()
        )
      )
    order by object.next_attempt_at, object.created_at, object.id
    for update skip locked
    limit 1
  )
  update public.classroom_purge_objects object
  set
    status = 'processing',
    attempt_count = object.attempt_count + 1,
    lease_token = p_lease_token,
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    last_error_code = null,
    updated_at = clock_timestamp()
  from candidate
  where object.id = candidate.id
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
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.classroom_purge_objects object
  set
    status = 'deleted',
    storage_path = null,
    lease_token = null,
    lease_expires_at = null,
    deleted_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where object.id = p_object_id
    and object.status = 'processing'
    and object.lease_token = p_lease_token
    and exists (
      select 1 from public.classroom_purge_operations operation
      where operation.id = object.operation_id
        and operation.teacher_id = p_teacher_id
    );
  get diagnostics v_updated = row_count;
  return v_updated = 1;
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
declare
  v_updated integer;
begin
  update public.classroom_purge_objects object
  set
    status = 'failed',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = left(coalesce(nullif(p_error_code, ''), 'storage_delete_failed'), 120),
    next_attempt_at = clock_timestamp()
      + least(interval '1 hour', make_interval(secs => power(2, least(object.attempt_count, 10))::integer)),
    updated_at = clock_timestamp()
  where object.id = p_object_id
    and object.status = 'processing'
    and object.lease_token = p_lease_token
    and exists (
      select 1 from public.classroom_purge_operations operation
      where operation.id = object.operation_id
        and operation.teacher_id = p_teacher_id
    );
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.finalize_hot_archived_classroom_purge(
  p_operation_id uuid,
  p_teacher_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.classroom_purge_operations;
  v_resource record;
  v_revision bigint;
  v_actual_count integer;
  v_expected_count integer;
  v_conflict text;
begin
  select * into v_operation
  from public.classroom_purge_operations
  where id = p_operation_id
  for update;

  if not found or v_operation.teacher_id <> p_teacher_id then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'purge_not_found',
      'error', 'Permanent deletion not found'
    );
  end if;
  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'ok', true, 'status', 200, 'operation_id', p_operation_id,
      'operation_status', 'completed', 'replayed', true
    );
  end if;

  perform public.classroom_purge_lock(v_operation.classroom_id);

  if exists (
    select 1 from public.classroom_purge_objects
    where operation_id = p_operation_id
      and status not in ('deleted', 'preserved')
  ) then
    return jsonb_build_object(
      'ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', 'deleting_objects', 'replayed', false
    );
  end if;
  if v_operation.inventory_completed_at is null then
    return jsonb_build_object(
      'ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', 'inventorying', 'replayed', false
    );
  end if;

  select revision into v_revision
  from public.classroom_archive_revisions
  where classroom_id = v_operation.classroom_id
  for update;

  if v_revision is null or v_revision <> v_operation.source_revision then
    update public.classroom_purge_operations
    set
      status = 'failed',
      error_code = 'classroom_changed_during_purge',
      retryable = false,
      updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'classroom_changed_during_purge',
      'error', 'Classroom data changed while deletion was in progress'
    );
  end if;

  v_conflict := public.classroom_purge_conflict(v_operation.classroom_id);
  if v_conflict is not null then
    update public.classroom_purge_operations
    set
      status = 'failed',
      error_code = v_conflict,
      retryable = true,
      updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', v_conflict,
      'error', 'A conflicting classroom operation is active'
    );
  end if;

  update public.classroom_purge_operations
  set status = 'finalizing', updated_at = clock_timestamp()
  where id = p_operation_id;

  perform set_config('pika.classroom_purge_finalize', 'on', true);

  -- Preserve reusable Blueprints and their versions. Reconcile only workflow
  -- references that point at the soon-to-be-deleted classroom.
  update public.course_blueprint_change_proposals
  set source_classroom_id = null, updated_at = clock_timestamp()
  where source_classroom_id = v_operation.classroom_id;
  delete from public.course_blueprint_change_proposals
  where target_classroom_id = v_operation.classroom_id;
  update public.course_blueprint_editing_sessions
  set classroom_id = null
  where classroom_id = v_operation.classroom_id;
  update public.course_blueprint_operations
  set source_classroom_id = null
  where source_classroom_id = v_operation.classroom_id;
  update public.course_blueprint_operations
  set result_classroom_id = null
  where result_classroom_id = v_operation.classroom_id;

  -- Operational archive/extract rows are outside the relational resource graph.
  delete from public.classroom_gradex_extract_cleanup cleanup
  using public.classroom_gradex_extracts extract
  where cleanup.extract_id = extract.id
    and extract.classroom_id = v_operation.classroom_id;
  delete from public.classroom_gradex_extracts
  where classroom_id = v_operation.classroom_id;
  delete from public.classroom_gradex_extract_cleanup cleanup
  using public.classroom_archive_operations operation
  where cleanup.operation_id = operation.id
    and operation.classroom_id = v_operation.classroom_id;
  delete from public.classroom_archive_source_object_cleanup
  where classroom_id = v_operation.classroom_id;
  delete from public.classroom_archive_source_object_reservations reservation
  using public.classroom_archive_operations operation
  where reservation.operation_id = operation.id
    and operation.classroom_id = v_operation.classroom_id;
  delete from public.assignment_artifact_storage_cleanup cleanup
  where exists (
    select 1
    from public.classroom_purge_objects object
    where object.operation_id = p_operation_id
      and object.storage_bucket = 'assignment-artifacts'
      and object.disposition = 'delete'
      and object.status = 'deleted'
      and object.storage_path_sha256 = encode(
        extensions.digest(
          convert_to(
            jsonb_build_array(
              'assignment-artifacts',
              cleanup.storage_path
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )
  );
  delete from public.test_document_snapshot_storage_cleanup cleanup
  where exists (
    select 1
    from public.classroom_purge_objects object
    where object.operation_id = p_operation_id
      and object.storage_bucket = 'test-documents'
      and object.disposition = 'delete'
      and object.status = 'deleted'
      and object.storage_path_sha256 = encode(
        extensions.digest(
          convert_to(
            jsonb_build_array('test-documents', cleanup.storage_path)::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )
  );
  delete from public.classroom_archives
  where classroom_id = v_operation.classroom_id;
  delete from public.classroom_archive_operations
  where classroom_id = v_operation.classroom_id;

  for v_resource in
    select
      table_name,
      primary_key_columns[1] as primary_key_column
    from public.classroom_archive_resource_contract
    order by export_position desc
  loop
    select count(*)::integer into v_expected_count
    from public.classroom_purge_resources
    where operation_id = p_operation_id
      and table_name = v_resource.table_name;

    execute format(
      'with deleted as (
         delete from public.%I source
         using public.classroom_purge_resources snapshot
         where snapshot.operation_id = $1
           and snapshot.table_name = $2
           and source.%I = snapshot.row_id
         returning 1
       )
       select count(*)::integer from deleted',
      v_resource.table_name,
      v_resource.primary_key_column
    )
    into v_actual_count
    using p_operation_id, v_resource.table_name;

    if v_actual_count <> v_expected_count then
      raise exception 'Classroom purge membership drift for %', v_resource.table_name
        using errcode = '40001';
    end if;
  end loop;

  update public.classroom_purge_operations
  set
    status = 'completed',
    classroom_title = null,
    impact_summary = jsonb_build_object(
      'relational_rows_deleted',
      (select coalesce(sum(value::text::integer), 0)
       from jsonb_each(resource_counts))
    ),
    retryable = false,
    error_code = null,
    completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_operation_id;

  delete from public.classroom_purge_resources
  where operation_id = p_operation_id;
  delete from public.classroom_purge_fences
  where operation_id = p_operation_id;

  return jsonb_build_object(
    'ok', true, 'status', 200, 'operation_id', p_operation_id,
    'operation_status', 'completed', 'replayed', false
  );
exception
  when others then
    update public.classroom_purge_operations
    set
      status = 'failed',
      error_code = case
        when sqlstate = '40001' then 'classroom_membership_drift'
        else 'database_finalize_failed'
      end,
      retryable = true,
      updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 500,
      'error_code', case
        when sqlstate = '40001' then 'classroom_membership_drift'
        else 'database_finalize_failed'
      end,
      'error', 'Permanent deletion could not be finalized',
      'retryable', true
    );
end;
$$;

-- Freeze every classroom-owned row once the purge fence exists. The shared
-- advisory lock makes "start operation" and "start purge" races serialize.
create or replace function public.reject_classroom_resource_change_during_purge()
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
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'classrooms' then
    if tg_op <> 'INSERT' then v_old_classroom_id := old.id; end if;
    if tg_op <> 'DELETE' then v_new_classroom_id := new.id; end if;
  else
    if tg_op <> 'INSERT' then
      v_old_parent_id := nullif(to_jsonb(old)->>v_parent_column, '')::uuid;
      v_old_classroom_id :=
        public.resolve_classroom_archive_resource_classroom_id(
          v_parent_table, v_old_parent_id
        );
    end if;
    if tg_op <> 'DELETE' then
      v_new_parent_id := nullif(to_jsonb(new)->>v_parent_column, '')::uuid;
      v_new_classroom_id :=
        public.resolve_classroom_archive_resource_classroom_id(
          v_parent_table, v_new_parent_id
        );
    end if;
  end if;

  if v_old_classroom_id is not null then
    perform public.classroom_purge_lock(v_old_classroom_id);
    if exists (
      select 1 from public.classroom_purge_fences
      where classroom_id = v_old_classroom_id
    ) then
      raise exception 'Classroom permanent deletion is in progress'
        using errcode = '55000';
    end if;
  end if;
  if v_new_classroom_id is not null
    and v_new_classroom_id is distinct from v_old_classroom_id
  then
    perform public.classroom_purge_lock(v_new_classroom_id);
    if exists (
      select 1 from public.classroom_purge_fences
      where classroom_id = v_new_classroom_id
    ) then
      raise exception 'Classroom permanent deletion is in progress'
        using errcode = '55000';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  v_resource record;
begin
  for v_resource in
    select table_name, parent_table, parent_column
    from public.classroom_archive_resource_contract
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      'classroom_purge_fence_' || v_resource.table_name,
      v_resource.table_name
    );
    execute format(
      'create trigger %I
       before insert or update or delete on public.%I
       for each row execute function public.reject_classroom_resource_change_during_purge(%L, %L)',
      'classroom_purge_fence_' || v_resource.table_name,
      v_resource.table_name,
      coalesce(v_resource.parent_table, ''),
      coalesce(v_resource.parent_column, '')
    );
  end loop;
end;
$$;

create or replace function public.reject_classroom_operation_during_purge()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_classroom_id uuid;
  v_classroom_ids uuid[];
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return new;
  end if;
  if tg_table_name = 'classroom_archive_operations' then
    v_classroom_ids := array[
      case when tg_op = 'UPDATE' then old.classroom_id else null end,
      new.classroom_id
    ];
  elsif tg_table_name = 'course_blueprint_operations' then
    v_classroom_ids := array[
      case when tg_op = 'UPDATE' then old.source_classroom_id else null end,
      case when tg_op = 'UPDATE' then old.result_classroom_id else null end,
      new.source_classroom_id,
      new.result_classroom_id
    ];
  elsif tg_table_name = 'course_blueprint_change_proposals' then
    v_classroom_ids := array[
      case when tg_op = 'UPDATE' then old.source_classroom_id else null end,
      case when tg_op = 'UPDATE' then old.target_classroom_id else null end,
      new.source_classroom_id,
      new.target_classroom_id
    ];
  elsif tg_table_name = 'course_blueprint_editing_sessions' then
    v_classroom_ids := array[
      case when tg_op = 'UPDATE' then old.classroom_id else null end,
      new.classroom_id
    ];
  end if;

  for v_classroom_id in
    select distinct candidate
    from unnest(v_classroom_ids) candidate
    where candidate is not null
  loop
    perform public.classroom_purge_lock(v_classroom_id);
    if exists (
      select 1 from public.classroom_purge_fences
      where classroom_id = v_classroom_id
    ) then
      raise exception 'Classroom permanent deletion is in progress'
        using errcode = '55000';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists classroom_purge_fence_archive_operations
  on public.classroom_archive_operations;
create trigger classroom_purge_fence_archive_operations
  before insert or update on public.classroom_archive_operations
  for each row execute function public.reject_classroom_operation_during_purge();

drop trigger if exists classroom_purge_fence_blueprint_operations
  on public.course_blueprint_operations;
create trigger classroom_purge_fence_blueprint_operations
  before insert or update on public.course_blueprint_operations
  for each row execute function public.reject_classroom_operation_during_purge();

drop trigger if exists classroom_purge_fence_blueprint_proposals
  on public.course_blueprint_change_proposals;
create trigger classroom_purge_fence_blueprint_proposals
  before insert or update on public.course_blueprint_change_proposals
  for each row execute function public.reject_classroom_operation_during_purge();

drop trigger if exists classroom_purge_fence_blueprint_sessions
  on public.course_blueprint_editing_sessions;
create trigger classroom_purge_fence_blueprint_sessions
  before insert or update on public.course_blueprint_editing_sessions
  for each row execute function public.reject_classroom_operation_during_purge();

revoke all on function public.classroom_purge_lock(uuid)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_conflict(uuid)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_storage_path_is_shared(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.begin_hot_archived_classroom_purge(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.stage_classroom_purge_objects(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.seal_classroom_purge_inventory(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.claim_classroom_purge_object(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_classroom_purge_object(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_classroom_purge_object(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.finalize_hot_archived_classroom_purge(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.begin_hot_archived_classroom_purge(uuid, uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.classroom_purge_conflict(uuid)
  to service_role;
grant execute on function public.stage_classroom_purge_objects(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.seal_classroom_purge_inventory(uuid, uuid, integer)
  to service_role;
grant execute on function public.claim_classroom_purge_object(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.complete_classroom_purge_object(uuid, uuid, uuid)
  to service_role;
grant execute on function public.fail_classroom_purge_object(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.finalize_hot_archived_classroom_purge(uuid, uuid)
  to service_role;

comment on table public.classroom_purge_operations is
  'Minimal durable ledger for resumable permanent deletion of hot archived classrooms.';
comment on table public.classroom_purge_resources is
  'Exact immutable classroom-owned relational membership captured before purge.';
comment on table public.classroom_purge_objects is
  'Exact managed-storage deletion ledger; terminal rows redact raw object paths.';
comment on table public.classroom_purge_fences is
  'Cross-workflow write fence held while classroom permanent deletion is active.';
