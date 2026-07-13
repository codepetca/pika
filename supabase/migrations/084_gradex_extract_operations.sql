-- Durable, canary-gated Gradex extract generation and retention cleanup.

create table public.classroom_gradex_resource_contract (
  table_name text primary key references public.classroom_archive_resource_contract (table_name)
);

insert into public.classroom_gradex_resource_contract (table_name)
values
  ('assignments'),
  ('assignment_ai_grading_runs'),
  ('assignment_ai_grading_run_items'),
  ('assignment_docs'),
  ('assignment_feedback_entries'),
  ('assignment_repo_review_runs'),
  ('assignment_repo_review_results'),
  ('assignment_submission_requirements'),
  ('tests'),
  ('test_ai_grading_runs'),
  ('test_ai_grading_run_items'),
  ('test_questions'),
  ('test_responses');

create table public.classroom_gradex_extracts (
  id uuid primary key,
  operation_id uuid not null unique references public.classroom_archive_operations (id),
  source_archive_id uuid not null references public.classroom_archives (id),
  classroom_id uuid not null,
  teacher_id uuid not null,
  format text not null check (format = 'pika.gradex-classroom-extract'),
  format_version integer not null check (format_version = 1),
  source_archive_sha256 text not null check (source_archive_sha256 ~ '^[a-f0-9]{64}$'),
  storage_bucket text not null check (storage_bucket = 'gradex-analytics-extracts'),
  storage_path text not null unique,
  artifact_sha256 text not null check (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  compressed_byte_size bigint not null check (compressed_byte_size > 0),
  uncompressed_byte_size bigint not null check (uncompressed_byte_size > 0),
  resource_counts jsonb not null,
  verification jsonb not null,
  generated_at timestamptz not null,
  verified_at timestamptz not null,
  delete_after timestamptz not null,
  check (verified_at >= generated_at),
  check (delete_after > generated_at),
  check (delete_after <= generated_at + interval '90 days')
);

create index idx_classroom_gradex_extracts_archive_generated
  on public.classroom_gradex_extracts (source_archive_id, generated_at desc);
create index idx_classroom_gradex_extracts_classroom_generated
  on public.classroom_gradex_extracts (classroom_id, generated_at desc);

create table public.classroom_gradex_extract_cleanup (
  extract_id uuid primary key references public.classroom_gradex_extracts (id),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'failed', 'deleted')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  superseded_by_extract_id uuid references public.classroom_gradex_extracts (id),
  deleted_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (status = 'processing' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'processing' and lease_token is null and lease_expires_at is null)
  ),
  check ((status = 'deleted') = (deleted_at is not null))
);

create index idx_classroom_gradex_extract_cleanup_due
  on public.classroom_gradex_extract_cleanup (status, next_attempt_at);

alter table public.classroom_gradex_resource_contract enable row level security;
alter table public.classroom_gradex_extracts enable row level security;
alter table public.classroom_gradex_extract_cleanup enable row level security;

create or replace function public.begin_classroom_gradex_extract(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_source_archive_id uuid,
  p_request_sha256 text,
  p_delete_after timestamptz
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_archive public.classroom_archives;
  v_extract public.classroom_gradex_extracts;
  v_now timestamptz := clock_timestamp();
  v_storage_path text;
  v_replayed boolean := false;
begin
  if p_request_sha256 !~ '^[a-f0-9]{64}$'
    or p_delete_after <= v_now
    or p_delete_after > v_now + interval '90 days'
  then
    raise exception 'Invalid Gradex extract request' using errcode = '22023';
  end if;

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;
  v_replayed := found;

  if found then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.archive_id <> p_source_archive_id
      or v_operation.operation_type <> 'gradex_extract'
      or v_operation.request_sha256 <> p_request_sha256
      or (v_operation.retention->>'delete_after')::timestamptz is distinct from p_delete_after
    then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different Gradex extract request',
        'retryable', false
      );
    end if;
    if v_operation.status = 'completed' then
      select * into v_extract
      from public.classroom_gradex_extracts where operation_id = p_operation_id;
      if v_extract.id is null then
        raise exception 'Completed Gradex operation is missing immutable metadata'
          using errcode = '40001';
      end if;
      return jsonb_build_object(
        'ok', true,
        'status', 200,
        'operation_id', p_operation_id,
        'extract_id', v_extract.id,
        'operation_status', 'completed',
        'replayed', true,
        'source_archive_id', v_extract.source_archive_id,
        'storage_bucket', v_extract.storage_bucket,
        'storage_path', v_extract.storage_path,
        'artifact_sha256', v_extract.artifact_sha256,
        'content_sha256', v_extract.content_sha256,
        'compressed_byte_size', v_extract.compressed_byte_size,
        'uncompressed_byte_size', v_extract.uncompressed_byte_size,
        'resource_counts', v_extract.resource_counts,
        'verification', v_extract.verification,
        'generated_at', v_extract.generated_at,
        'delete_after', v_extract.delete_after
      );
    end if;
    if v_operation.status = 'failed' and v_operation.retryable is false then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', v_operation.error_code,
        'error', 'Gradex extract operation failed and requires a new idempotency key',
        'retryable', false
      );
    end if;
    if v_operation.snapshot_created_at >= p_delete_after then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'gradex_retention_expired',
        'error', 'Gradex extract retention expired before generation completed',
        'retryable', false
      );
    end if;
  end if;

  select * into v_archive
  from public.classroom_archives
  where id = p_source_archive_id
  for update;
  if v_archive.id is null
    or v_archive.teacher_id <> p_teacher_id
    or v_archive.classroom_id <> p_classroom_id
  then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_not_found',
      'error', 'Verified source archive not found',
      'retryable', false
    );
  end if;

  if exists (
    select 1 from public.classroom_archive_operations active_operation
    where active_operation.archive_id = p_source_archive_id
      and active_operation.operation_type = 'gradex_extract'
      and active_operation.id <> p_operation_id
      and active_operation.snapshot_expires_at > v_now
      and (
        active_operation.status = 'snapshot_ready'
        or (active_operation.status = 'failed' and active_operation.retryable is true)
      )
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'gradex_extract_already_in_progress',
      'error', 'Another Gradex extract operation is already in progress',
      'retryable', true
    );
  end if;

  v_storage_path := format(
    '%s/%s/%s/gradex-v1.tar.gz',
    p_teacher_id,
    p_classroom_id,
    p_operation_id
  );
  if v_operation.id is null then
    insert into public.classroom_archive_operations (
      id, teacher_id, classroom_id, operation_type, request_sha256, status,
      source_revision, source_schema_migration, source_app_commit, retention,
      archive_id, storage_bucket, storage_path, snapshot_created_at, snapshot_expires_at
    ) values (
      p_operation_id, p_teacher_id, p_classroom_id, 'gradex_extract', p_request_sha256,
      'snapshot_ready', v_archive.source_revision, v_archive.source_schema_migration,
      v_archive.source_app_commit,
      jsonb_build_object('mode', 'scheduled', 'delete_after', p_delete_after),
      p_source_archive_id, 'gradex-analytics-extracts', v_storage_path, v_now,
      least(v_now + interval '24 hours', p_delete_after)
    ) returning * into v_operation;
  else
    update public.classroom_archive_operations
    set status = 'snapshot_ready',
        attempt_count = case when status = 'failed' then attempt_count + 1 else attempt_count end,
        error_code = null,
        retryable = null,
        snapshot_expires_at = least(v_now + interval '24 hours', p_delete_after),
        updated_at = v_now
    where id = p_operation_id
    returning * into v_operation;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 202,
    'operation_id', p_operation_id,
    'extract_id', p_operation_id,
    'operation_status', 'snapshot_ready',
    'replayed', v_replayed,
    'source_archive_id', p_source_archive_id,
    'source_archive_sha256', v_archive.artifact_sha256,
    'storage_bucket', 'gradex-analytics-extracts',
    'storage_path', v_storage_path,
    'generated_at', v_operation.snapshot_created_at,
    'snapshot_expires_at', v_operation.snapshot_expires_at,
    'delete_after', p_delete_after
  );
end;
$$;

create or replace function public.complete_classroom_gradex_extract(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_artifact_sha256 text,
  p_content_sha256 text,
  p_compressed_byte_size bigint,
  p_uncompressed_byte_size bigint,
  p_resource_counts jsonb,
  p_verification jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_archive public.classroom_archives;
  v_extract public.classroom_gradex_extracts;
  v_now timestamptz := clock_timestamp();
  v_verified_at timestamptz;
  v_contract_count integer;
begin
  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;
  if v_operation.id is null
    or v_operation.teacher_id <> p_teacher_id
    or v_operation.operation_type <> 'gradex_extract'
  then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'operation_id', p_operation_id,
      'error_code', 'gradex_operation_not_found',
      'error', 'Gradex extract operation not found', 'retryable', false
    );
  end if;
  if v_operation.status = 'completed' then
    select * into v_extract
    from public.classroom_gradex_extracts where operation_id = p_operation_id;
    if v_extract.id is null then
      raise exception 'Completed Gradex operation is missing immutable metadata'
        using errcode = '40001';
    end if;
    if p_artifact_sha256 is distinct from v_extract.artifact_sha256
      or p_content_sha256 is distinct from v_extract.content_sha256
      or p_compressed_byte_size is distinct from v_extract.compressed_byte_size
      or p_uncompressed_byte_size is distinct from v_extract.uncompressed_byte_size
      or p_resource_counts is distinct from v_extract.resource_counts
    then
      return jsonb_build_object(
        'ok', false, 'status', 409, 'operation_id', p_operation_id,
        'extract_id', v_extract.id, 'operation_status', 'completed', 'replayed', true,
        'error_code', 'gradex_finalization_conflict',
        'error', 'Gradex extract was already finalized with different artifact metadata',
        'retryable', false
      );
    end if;
    return jsonb_build_object(
      'ok', true, 'status', 200, 'operation_id', p_operation_id,
      'extract_id', v_extract.id, 'operation_status', 'completed', 'replayed', true,
      'source_archive_id', v_extract.source_archive_id,
      'storage_bucket', v_extract.storage_bucket, 'storage_path', v_extract.storage_path,
      'artifact_sha256', v_extract.artifact_sha256,
      'content_sha256', v_extract.content_sha256,
      'compressed_byte_size', v_extract.compressed_byte_size,
      'uncompressed_byte_size', v_extract.uncompressed_byte_size,
      'resource_counts', v_extract.resource_counts, 'verification', v_extract.verification,
      'generated_at', v_extract.generated_at, 'delete_after', v_extract.delete_after
    );
  end if;
  if v_operation.status <> 'snapshot_ready' or v_operation.snapshot_expires_at <= v_now then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'operation_id', p_operation_id,
      'error_code', 'gradex_operation_not_ready',
      'error', 'Gradex extract operation is not ready for finalization', 'retryable', false
    );
  end if;
  if p_artifact_sha256 !~ '^[a-f0-9]{64}$'
    or p_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_compressed_byte_size <= 0
    or p_compressed_byte_size > 52428800
    or p_uncompressed_byte_size <= 0
    or p_resource_counts is null
    or jsonb_typeof(p_resource_counts) <> 'object'
  then
    raise exception 'Invalid Gradex extract finalization' using errcode = '22023';
  end if;
  select count(*) into v_contract_count from public.classroom_gradex_resource_contract;
  if (select count(*) from jsonb_object_keys(p_resource_counts)) <> v_contract_count
    or exists (
      select 1 from public.classroom_gradex_resource_contract contract
      where not p_resource_counts ? contract.table_name
    )
    or exists (
      select 1 from jsonb_each(p_resource_counts) item
      where jsonb_typeof(item.value) <> 'number'
        or (item.value #>> '{}') !~ '^\d+$'
        or (item.value #>> '{}')::numeric > 2147483647
    )
  then
    raise exception 'Gradex resource counts do not match the resource contract'
      using errcode = '22023';
  end if;
  if p_verification is null
    or jsonb_typeof(p_verification) <> 'object'
    or (select count(*) from jsonb_object_keys(p_verification)) <> 11
    or p_verification - 'source_archive_checksum_verified'
      - 'source_archive_manifest_verified'
      - 'resource_checksums_verified'
      - 'resource_counts_verified'
      - 'deidentification_verified'
      - 'pseudonym_relationships_verified'
      - 'storage_objects_excluded'
      - 'read_back_verified'
      - 'artifact_checksum_verified'
      - 'direct_identifier_findings'
      - 'verified_at' <> '{}'::jsonb
  then
    raise exception 'Gradex extract verification evidence is incomplete'
      using errcode = '22023';
  end if;
  if exists (
      select 1
      from (values
        ('source_archive_checksum_verified'),
        ('source_archive_manifest_verified'),
        ('resource_checksums_verified'),
        ('resource_counts_verified'),
        ('deidentification_verified'),
        ('pseudonym_relationships_verified'),
        ('storage_objects_excluded'),
        ('read_back_verified'),
        ('artifact_checksum_verified')
      ) required(key)
      where jsonb_typeof(p_verification->required.key) <> 'boolean'
    )
    or jsonb_typeof(p_verification->'direct_identifier_findings') <> 'number'
    or (p_verification->>'direct_identifier_findings') !~ '^\d+$'
    or (p_verification->>'direct_identifier_findings')::numeric > 2147483647
    or jsonb_typeof(p_verification->'verified_at') <> 'string'
  then
    raise exception 'Gradex extract verification evidence has invalid types'
      using errcode = '22023';
  end if;
  v_verified_at := (p_verification->>'verified_at')::timestamptz;
  if coalesce((p_verification->>'source_archive_checksum_verified')::boolean, false) is not true
    or coalesce((p_verification->>'source_archive_manifest_verified')::boolean, false) is not true
    or coalesce((p_verification->>'resource_checksums_verified')::boolean, false) is not true
    or coalesce((p_verification->>'resource_counts_verified')::boolean, false) is not true
    or coalesce((p_verification->>'deidentification_verified')::boolean, false) is not true
    or coalesce((p_verification->>'pseudonym_relationships_verified')::boolean, false) is not true
    or coalesce((p_verification->>'storage_objects_excluded')::boolean, false) is not true
    or coalesce((p_verification->>'read_back_verified')::boolean, false) is not true
    or coalesce((p_verification->>'artifact_checksum_verified')::boolean, false) is not true
    or coalesce((p_verification->>'direct_identifier_findings')::integer, -1) <> 0
    or v_verified_at < v_operation.snapshot_created_at
    or v_verified_at > v_now + interval '5 minutes'
    or v_verified_at >= (v_operation.retention->>'delete_after')::timestamptz
  then
    raise exception 'Gradex extract verification evidence is incomplete'
      using errcode = '22023';
  end if;

  select * into v_archive from public.classroom_archives where id = v_operation.archive_id;
  if v_archive.id is null then
    raise exception 'Gradex source archive disappeared' using errcode = '40001';
  end if;

  insert into public.classroom_gradex_extracts (
    id, operation_id, source_archive_id, classroom_id, teacher_id, format, format_version,
    source_archive_sha256, storage_bucket, storage_path, artifact_sha256, content_sha256,
    compressed_byte_size, uncompressed_byte_size, resource_counts, verification,
    generated_at, verified_at, delete_after
  ) values (
    p_operation_id, p_operation_id, v_archive.id, v_operation.classroom_id,
    v_operation.teacher_id, 'pika.gradex-classroom-extract', 1,
    v_archive.artifact_sha256, 'gradex-analytics-extracts', v_operation.storage_path,
    p_artifact_sha256, p_content_sha256, p_compressed_byte_size,
    p_uncompressed_byte_size, p_resource_counts, p_verification,
    v_operation.snapshot_created_at, v_verified_at,
    (v_operation.retention->>'delete_after')::timestamptz
  ) returning * into v_extract;

  insert into public.classroom_gradex_extract_cleanup (extract_id, next_attempt_at)
  values (v_extract.id, v_extract.delete_after);
  update public.classroom_gradex_extract_cleanup cleanup
  set next_attempt_at = least(cleanup.next_attempt_at, v_now),
      superseded_by_extract_id = v_extract.id,
      updated_at = v_now
  from public.classroom_gradex_extracts prior
  where cleanup.extract_id = prior.id
    and prior.source_archive_id = v_extract.source_archive_id
    and prior.id <> v_extract.id
    and cleanup.status in ('pending', 'failed');

  update public.classroom_archive_operations
  set status = 'completed', artifact_sha256 = p_artifact_sha256,
      content_sha256 = p_content_sha256,
      compressed_byte_size = p_compressed_byte_size,
      uncompressed_byte_size = p_uncompressed_byte_size,
      resource_counts = p_resource_counts, storage_object_counts = '{}'::jsonb,
      verification = p_verification, error_code = null, retryable = null,
      completed_at = v_now, updated_at = v_now
  where id = p_operation_id;

  return jsonb_build_object(
    'ok', true, 'status', 201, 'operation_id', p_operation_id,
    'extract_id', v_extract.id, 'operation_status', 'completed', 'replayed', false,
    'source_archive_id', v_extract.source_archive_id,
    'storage_bucket', v_extract.storage_bucket, 'storage_path', v_extract.storage_path,
    'artifact_sha256', v_extract.artifact_sha256, 'content_sha256', v_extract.content_sha256,
    'compressed_byte_size', v_extract.compressed_byte_size,
    'uncompressed_byte_size', v_extract.uncompressed_byte_size,
    'resource_counts', v_extract.resource_counts, 'verification', v_extract.verification,
    'generated_at', v_extract.generated_at, 'delete_after', v_extract.delete_after
  );
end;
$$;

create or replace function public.fail_classroom_gradex_extract(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_error_code text,
  p_retryable boolean
)
returns boolean
language plpgsql
set search_path = public
as $$
declare v_updated boolean;
begin
  if p_error_code is null
    or p_error_code !~ '^[a-z0-9_]{3,80}$'
    or p_retryable is null
  then
    raise exception 'Invalid Gradex extract error code' using errcode = '22023';
  end if;
  update public.classroom_archive_operations
  set status = 'failed', error_code = p_error_code, retryable = p_retryable,
      updated_at = clock_timestamp()
  where id = p_operation_id and teacher_id = p_teacher_id
    and operation_type = 'gradex_extract' and status <> 'completed';
  v_updated := found;
  return v_updated;
end;
$$;

create or replace function public.claim_due_classroom_gradex_extract_cleanup(
  p_lease_token uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns table (
  extract_id uuid,
  storage_bucket text,
  storage_path text,
  attempt_count integer
)
language plpgsql
set search_path = public
as $$
begin
  if p_lease_token is null
    or p_limit is null
    or p_limit < 1
    or p_limit > 100
    or p_lease_seconds is null
    or p_lease_seconds < 30
    or p_lease_seconds > 1800
  then
    raise exception 'Invalid Gradex cleanup claim' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select cleanup.extract_id
    from public.classroom_gradex_extract_cleanup cleanup
    where cleanup.next_attempt_at <= clock_timestamp()
      and (
        cleanup.status in ('pending', 'failed')
        or (cleanup.status = 'processing' and cleanup.lease_expires_at <= clock_timestamp())
      )
    order by cleanup.next_attempt_at, cleanup.extract_id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.classroom_gradex_extract_cleanup cleanup
    set status = 'processing', attempt_count = cleanup.attempt_count + 1,
        lease_token = p_lease_token,
        lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
        last_error_code = null, updated_at = clock_timestamp()
    from candidates
    where cleanup.extract_id = candidates.extract_id
    returning cleanup.extract_id, cleanup.attempt_count
  )
  select claimed.extract_id, extract.storage_bucket, extract.storage_path, claimed.attempt_count
  from claimed
  join public.classroom_gradex_extracts extract on extract.id = claimed.extract_id;
end;
$$;

create or replace function public.complete_classroom_gradex_extract_cleanup(
  p_extract_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
set search_path = public
as $$
declare v_updated boolean;
begin
  update public.classroom_gradex_extract_cleanup
  set status = 'deleted', lease_token = null, lease_expires_at = null,
      deleted_at = clock_timestamp(), last_error_code = null,
      updated_at = clock_timestamp()
  where extract_id = p_extract_id and status = 'processing' and lease_token = p_lease_token;
  v_updated := found;
  return v_updated;
end;
$$;

create or replace function public.fail_classroom_gradex_extract_cleanup(
  p_extract_id uuid,
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
    raise exception 'Invalid Gradex cleanup error code' using errcode = '22023';
  end if;
  update public.classroom_gradex_extract_cleanup
  set status = 'failed', lease_token = null, lease_expires_at = null,
      last_error_code = p_error_code,
      next_attempt_at = clock_timestamp() + make_interval(
        mins => least(1440, greatest(1, power(2, least(attempt_count, 10))::integer))
      ),
      updated_at = clock_timestamp()
  where extract_id = p_extract_id and status = 'processing' and lease_token = p_lease_token;
  v_updated := found;
  return v_updated;
end;
$$;

create or replace function public.reject_classroom_gradex_extract_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Verified Gradex extract metadata is immutable' using errcode = '55000';
end;
$$;

create trigger classroom_gradex_extracts_immutable
  before update on public.classroom_gradex_extracts
  for each row execute function public.reject_classroom_gradex_extract_update();

revoke all on table public.classroom_gradex_resource_contract from public, anon, authenticated;
revoke all on table public.classroom_gradex_extracts from public, anon, authenticated;
revoke all on table public.classroom_gradex_extract_cleanup from public, anon, authenticated;
grant select on table public.classroom_gradex_resource_contract to service_role;
grant select on table public.classroom_gradex_extracts to service_role;
grant select on table public.classroom_gradex_extract_cleanup to service_role;

revoke all on function public.begin_classroom_gradex_extract(uuid, uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_classroom_gradex_extract(uuid, uuid, text, text, bigint, bigint, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fail_classroom_gradex_extract(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.claim_due_classroom_gradex_extract_cleanup(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_classroom_gradex_extract_cleanup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_classroom_gradex_extract_cleanup(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.begin_classroom_gradex_extract(uuid, uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.complete_classroom_gradex_extract(uuid, uuid, text, text, bigint, bigint, jsonb, jsonb) to service_role;
grant execute on function public.fail_classroom_gradex_extract(uuid, uuid, text, boolean) to service_role;
grant execute on function public.claim_due_classroom_gradex_extract_cleanup(uuid, integer, integer) to service_role;
grant execute on function public.complete_classroom_gradex_extract_cleanup(uuid, uuid) to service_role;
grant execute on function public.fail_classroom_gradex_extract_cleanup(uuid, uuid, text) to service_role;

comment on table public.classroom_gradex_extracts is
  'Immutable metadata for read-back-verified, deidentified Gradex classroom extracts.';
comment on table public.classroom_gradex_extract_cleanup is
  'Mutable lease and retry ledger for deleting retained Gradex extract objects.';
