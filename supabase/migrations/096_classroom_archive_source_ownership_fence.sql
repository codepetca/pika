-- Transactional ownership fencing for compacted classroom source objects.
--
-- Only assignment-artifacts are eligible in this rollout. Their authoritative
-- reference is assignment_submission_artifacts.storage_path, so PostgreSQL can
-- serialize reference writes with reservation creation. Buckets referenced from
-- embedded rich content remain preserved until they have an equivalent registry.

alter table public.classroom_archive_source_object_cleanup
  add column if not exists ownership_verified_at timestamptz;

-- A deleted row from the unfenced migration 086 contract cannot be proven safe
-- retroactively. Refuse rollout until an operator reconciles any such row.
do $$
begin
  if exists (
    select 1
    from public.classroom_archive_source_object_cleanup
    where status = 'deleted'
  ) then
    raise exception 'Migration 096 requires reconciliation of previously deleted source objects'
      using errcode = '55000';
  end if;
end;
$$;

-- Invalidate every pre-096 lease before revoking the old claim capability.
update public.classroom_archive_source_object_cleanup
set status = 'failed',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = 'ownership_fence_migration_required',
    next_attempt_at = clock_timestamp(),
    updated_at = clock_timestamp()
where status = 'processing';

-- Migration 086 deliberately had no verifier. Discard any manual boolean-only
-- marks before requiring durable evidence from this migration.
update public.classroom_archive_source_object_cleanup
set ownership_verified = false,
    ownership_verified_at = null,
    updated_at = clock_timestamp()
where ownership_verified is true
   or ownership_verified_at is not null;

alter table public.classroom_archive_source_object_cleanup
  drop constraint if exists classroom_archive_source_object_cleanup_ownership_check;
alter table public.classroom_archive_source_object_cleanup
  add constraint classroom_archive_source_object_cleanup_ownership_check check (
    ownership_verified = (ownership_verified_at is not null)
  );

create or replace function public.classroom_archive_source_object_path_sha256(
  p_storage_bucket text,
  p_storage_path text
)
returns text
language sql
immutable
strict
set search_path = public, extensions, pg_temp
as $$
  select encode(
    extensions.digest(
      convert_to(jsonb_build_array(p_storage_bucket, p_storage_path)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function public.classroom_archive_source_object_path_sha256(text, text)
  from public, anon, authenticated;
grant execute on function public.classroom_archive_source_object_path_sha256(text, text)
  to service_role;

create table if not exists public.classroom_archive_source_object_reservations (
  storage_bucket text not null,
  storage_path_sha256 text not null,
  operation_id uuid references public.classroom_archive_operations(id) on delete set null,
  reserved_at timestamptz not null default clock_timestamp(),
  primary key (storage_bucket, storage_path_sha256),
  unique (operation_id, storage_bucket, storage_path_sha256),
  constraint classroom_archive_source_object_reservations_bucket_check check (
    storage_bucket = 'assignment-artifacts'
  ),
  constraint classroom_archive_source_object_reservations_path_sha256_check check (
    storage_path_sha256 ~ '^[a-f0-9]{64}$'
  )
);

create index if not exists idx_classroom_archive_source_object_reservations_operation
  on public.classroom_archive_source_object_reservations (operation_id);

alter table public.classroom_archive_source_object_reservations enable row level security;
revoke all on table public.classroom_archive_source_object_reservations
  from public, anon, authenticated, service_role;
grant select on table public.classroom_archive_source_object_reservations to service_role;

revoke all on table public.classroom_archive_source_object_cleanup from service_role;
grant select on table public.classroom_archive_source_object_cleanup to service_role;

-- Compaction owns cleanup-ledger staging and state transitions. Preserve those
-- existing RPC contracts while removing service_role's direct table writes.
alter function public.begin_classroom_archive_compaction(
  uuid, uuid, uuid, uuid, text
) security definer;
alter function public.stage_classroom_archive_compaction_objects(
  uuid, uuid, jsonb
) security definer;
alter function public.complete_classroom_archive_compaction(
  uuid, uuid, jsonb, jsonb
) security definer;
alter function public.fail_classroom_archive_compaction(
  uuid, uuid, text, boolean
) security definer;
alter function public.cleanup_expired_classroom_archive_snapshots()
  security definer;

alter function public.begin_classroom_archive_compaction(
  uuid, uuid, uuid, uuid, text
) set search_path = public, pg_temp;
alter function public.stage_classroom_archive_compaction_objects(
  uuid, uuid, jsonb
) set search_path = public, pg_temp;
alter function public.complete_classroom_archive_compaction(
  uuid, uuid, jsonb, jsonb
) set search_path = public, pg_temp;
alter function public.fail_classroom_archive_compaction(
  uuid, uuid, text, boolean
) set search_path = public, pg_temp;
alter function public.cleanup_expired_classroom_archive_snapshots()
  set search_path = public, pg_temp;

-- A permanent reservation is intentional. Reusing a deleted source path could
-- otherwise attach new classroom data to an object identity already retired by
-- a completed archive operation.
create or replace function public.guard_classroom_archive_source_cleanup_path()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bucket text;
  v_path text;
begin
  for v_bucket, v_path in
    select distinct candidate.bucket, candidate.path
    from (values
      (
        case when tg_op <> 'INSERT' then old.storage_bucket end,
        case when tg_op <> 'INSERT' then old.storage_path end
      ),
      (
        case when tg_op <> 'DELETE' then new.storage_bucket end,
        case when tg_op <> 'DELETE' then new.storage_path end
      )
    ) as candidate(bucket, path)
    where candidate.bucket = 'assignment-artifacts'
      and candidate.path is not null
    order by candidate.bucket, candidate.path
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(jsonb_build_array(v_bucket, v_path)::text, 0)
    );
  end loop;

  if tg_op <> 'DELETE'
    and new.storage_bucket = 'assignment-artifacts'
    and exists (
      select 1
      from public.classroom_archive_source_object_reservations reservation
      where reservation.storage_bucket = new.storage_bucket
        and reservation.storage_path_sha256 =
          public.classroom_archive_source_object_path_sha256(
            new.storage_bucket, new.storage_path
          )
    )
  then
    raise exception 'Classroom archive source cleanup path is already reserved'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.guard_classroom_archive_source_cleanup_path()
  from public, anon, authenticated;

drop trigger if exists guard_classroom_archive_source_cleanup_path
  on public.classroom_archive_source_object_cleanup;
create trigger guard_classroom_archive_source_cleanup_path
  before insert or update of storage_bucket, storage_path or delete
  on public.classroom_archive_source_object_cleanup
  for each row
  execute function public.guard_classroom_archive_source_cleanup_path();

create or replace function public.reject_reserved_assignment_artifact_path()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_path text;
begin
  for v_path in
    select distinct candidate.path
    from (values
      (case when tg_op <> 'INSERT' then old.storage_path end),
      (case when tg_op <> 'DELETE' then new.storage_path end)
    ) as candidate(path)
    where candidate.path is not null
    order by candidate.path
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(jsonb_build_array('assignment-artifacts', v_path)::text, 0)
    );
  end loop;

  if tg_op <> 'DELETE'
    and new.storage_path is not null
    and exists (
    select 1
    from public.classroom_archive_source_object_reservations reservation
    where reservation.storage_bucket = 'assignment-artifacts'
      and reservation.storage_path_sha256 =
        public.classroom_archive_source_object_path_sha256(
          'assignment-artifacts', new.storage_path
        )
  ) then
    raise exception 'Assignment artifact storage path is reserved by a classroom archive'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.reject_reserved_assignment_artifact_path()
  from public, anon, authenticated;

drop trigger if exists reject_reserved_assignment_artifact_path
  on public.assignment_submission_artifacts;
create trigger reject_reserved_assignment_artifact_path
  before insert or update of storage_path or delete
  on public.assignment_submission_artifacts
  for each row
  execute function public.reject_reserved_assignment_artifact_path();

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
    ) as candidate(bucket, path)
    where candidate.bucket = 'assignment-artifacts'
      and candidate.path is not null
    order by candidate.bucket, candidate.path
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(jsonb_build_array(v_bucket, v_path)::text, 0)
    );
  end loop;

  if tg_op <> 'DELETE'
    and new.bucket_id = 'assignment-artifacts'
    and exists (
    select 1
    from public.classroom_archive_source_object_reservations reservation
    where reservation.storage_bucket = new.bucket_id
        and reservation.storage_path_sha256 =
          public.classroom_archive_source_object_path_sha256(
            new.bucket_id, new.name
          )
    )
  then
    raise exception 'Storage path is reserved by a classroom archive'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE'
    and old.bucket_id = 'assignment-artifacts'
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
                cleanup.storage_bucket, cleanup.storage_path
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

revoke all on function public.reject_reserved_classroom_archive_storage_path()
  from public, anon, authenticated;

drop trigger if exists reject_reserved_classroom_archive_storage_path
  on storage.objects;
create trigger reject_reserved_classroom_archive_storage_path
  before insert or update or delete
  on storage.objects
  for each row
  execute function public.reject_reserved_classroom_archive_storage_path();

create or replace function public.verify_and_reserve_classroom_archive_source_objects(
  p_operation_id uuid,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.classroom_archive_operations%rowtype;
  v_eligible_count integer;
  v_preserved_count integer;
  v_verified_count integer;
  v_previously_verified_count integer;
  v_deleted_verified_count integer;
  v_selected_paths text[];
  v_selected_count integer;
begin
  if p_operation_id is null
    or p_limit is null
    or p_limit < 1
    or p_limit > 100
  then
    raise exception 'Invalid classroom archive source ownership verification request'
      using errcode = '22023';
  end if;

  select operation.* into v_operation
  from public.classroom_archive_operations operation
  where operation.id = p_operation_id
  for update;

  if not found
    or v_operation.operation_type <> 'compact'
    or v_operation.status <> 'completed'
    or v_operation.archive_id is null
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_source_ownership_not_compacted',
      'error', 'Source ownership can only be verified for a completed cold compaction'
    );
  end if;

  select
    count(*) filter (where cleanup.storage_bucket = 'assignment-artifacts'),
    count(*) filter (where cleanup.storage_bucket <> 'assignment-artifacts'),
    count(*) filter (
      where cleanup.storage_bucket = 'assignment-artifacts'
        and cleanup.ownership_verified is true
        and cleanup.ownership_verified_at is not null
    ),
    count(*) filter (
      where cleanup.storage_bucket = 'assignment-artifacts'
        and cleanup.status = 'deleted'
        and cleanup.ownership_verified is true
        and cleanup.ownership_verified_at is not null
        and exists (
          select 1
          from public.classroom_archive_source_object_reservations reservation
          where reservation.operation_id = cleanup.operation_id
            and reservation.storage_bucket = cleanup.storage_bucket
            and reservation.storage_path_sha256 =
              public.classroom_archive_source_object_path_sha256(
                cleanup.storage_bucket, cleanup.storage_path
              )
        )
    )
  into
    v_eligible_count,
    v_preserved_count,
    v_previously_verified_count,
    v_deleted_verified_count
  from public.classroom_archive_source_object_cleanup cleanup
  where cleanup.operation_id = p_operation_id;

  -- Restore removes the cold tombstone. A later cleanup replay may report only
  -- already-completed work; it can never create reservations or claim new work.
  if v_deleted_verified_count = v_eligible_count then
    return jsonb_build_object(
      'ok', true,
      'status', 200,
      'operation_id', p_operation_id,
      'verified', v_deleted_verified_count,
      'preserved', v_preserved_count,
      'replayed', true
    );
  end if;

  if not exists (
    select 1
    from public.classroom_cold_tombstones tombstone
    where tombstone.classroom_id = v_operation.classroom_id
      and tombstone.archive_id = v_operation.archive_id
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_source_ownership_not_compacted',
      'error', 'Source ownership can only be verified for a completed cold compaction'
    );
  end if;

  select array_agg(candidate.storage_path order by candidate.storage_path)
  into v_selected_paths
  from (
    select cleanup.storage_path
    from public.classroom_archive_source_object_cleanup cleanup
    where cleanup.operation_id = p_operation_id
      and cleanup.storage_bucket = 'assignment-artifacts'
      and cleanup.next_attempt_at <= clock_timestamp()
      and (
        cleanup.status in ('pending', 'failed')
        or (
          cleanup.status = 'processing'
          and cleanup.lease_expires_at <= clock_timestamp()
        )
      )
    order by cleanup.next_attempt_at, cleanup.created_at, cleanup.storage_path
    for update skip locked
    limit p_limit
  ) candidate;

  v_selected_paths := coalesce(v_selected_paths, array[]::text[]);
  v_selected_count := cardinality(v_selected_paths);

  select count(*) into v_previously_verified_count
  from public.classroom_archive_source_object_cleanup cleanup
  where cleanup.operation_id = p_operation_id
    and cleanup.storage_bucket = 'assignment-artifacts'
    and cleanup.storage_path = any(v_selected_paths)
    and cleanup.ownership_verified is true
    and cleanup.ownership_verified_at is not null;

  -- Both this verifier and the authoritative reference trigger take the same
  -- exact-path lock. Sorted acquisition also prevents verifier/verifier deadlocks.
  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(cleanup.storage_bucket, cleanup.storage_path)::text,
      0
    )
  )
  from public.classroom_archive_source_object_cleanup cleanup
  where cleanup.operation_id = p_operation_id
    and cleanup.storage_bucket = 'assignment-artifacts'
    and cleanup.storage_path = any(v_selected_paths)
  order by cleanup.storage_path;

  if exists (
    select 1
    from public.classroom_archive_source_object_cleanup cleanup
    join public.assignment_submission_artifacts artifact
      on artifact.storage_path = cleanup.storage_path
    where cleanup.operation_id = p_operation_id
      and cleanup.storage_bucket = 'assignment-artifacts'
      and cleanup.storage_path = any(v_selected_paths)
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_source_object_still_referenced',
      'error', 'An assignment artifact source path is still referenced by hot classroom data'
    );
  end if;

  if exists (
    select 1
    from public.classroom_archive_source_object_cleanup cleanup
    join public.classroom_archive_source_object_cleanup competing
      on competing.storage_bucket = cleanup.storage_bucket
      and competing.storage_path = cleanup.storage_path
      and competing.operation_id <> cleanup.operation_id
    where cleanup.operation_id = p_operation_id
      and cleanup.storage_bucket = 'assignment-artifacts'
      and cleanup.storage_path = any(v_selected_paths)
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_source_object_competing_claim',
      'error', 'An assignment artifact source path is present in another cleanup inventory'
    );
  end if;

  if exists (
    select 1
    from public.classroom_archive_source_object_cleanup cleanup
    join public.classroom_archive_source_object_reservations reservation
      on reservation.storage_bucket = cleanup.storage_bucket
      and reservation.storage_path_sha256 =
        public.classroom_archive_source_object_path_sha256(
          cleanup.storage_bucket, cleanup.storage_path
        )
      and reservation.operation_id is distinct from cleanup.operation_id
    where cleanup.operation_id = p_operation_id
      and cleanup.storage_bucket = 'assignment-artifacts'
      and cleanup.storage_path = any(v_selected_paths)
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'classroom_archive_source_object_already_reserved',
      'error', 'An assignment artifact source path belongs to another archive operation'
    );
  end if;

  insert into public.classroom_archive_source_object_reservations (
    storage_bucket,
    storage_path_sha256,
    operation_id
  )
  select
    cleanup.storage_bucket,
    public.classroom_archive_source_object_path_sha256(
      cleanup.storage_bucket, cleanup.storage_path
    ),
    cleanup.operation_id
  from public.classroom_archive_source_object_cleanup cleanup
  where cleanup.operation_id = p_operation_id
    and cleanup.storage_bucket = 'assignment-artifacts'
    and cleanup.storage_path = any(v_selected_paths)
  on conflict (storage_bucket, storage_path_sha256) do nothing;

  update public.classroom_archive_source_object_cleanup cleanup
  set ownership_verified = true,
      ownership_verified_at = coalesce(cleanup.ownership_verified_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where cleanup.operation_id = p_operation_id
    and cleanup.storage_bucket = 'assignment-artifacts'
    and cleanup.storage_path = any(v_selected_paths)
    and exists (
      select 1
      from public.classroom_archive_source_object_reservations reservation
      where reservation.storage_bucket = cleanup.storage_bucket
        and reservation.storage_path_sha256 =
          public.classroom_archive_source_object_path_sha256(
            cleanup.storage_bucket, cleanup.storage_path
          )
        and reservation.operation_id = cleanup.operation_id
    );

  select count(*) into v_verified_count
  from public.classroom_archive_source_object_cleanup cleanup
  where cleanup.operation_id = p_operation_id
    and cleanup.storage_bucket = 'assignment-artifacts'
    and cleanup.storage_path = any(v_selected_paths)
    and cleanup.ownership_verified is true;

  if v_verified_count <> v_selected_count then
    raise exception 'Classroom archive source ownership reservation was incomplete'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 200,
    'operation_id', p_operation_id,
    'verified', v_verified_count,
    'preserved', v_preserved_count,
    'replayed', v_previously_verified_count = v_selected_count
  );
end;
$$;

revoke all on function public.verify_and_reserve_classroom_archive_source_objects(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.verify_and_reserve_classroom_archive_source_objects(uuid, integer)
  to service_role;

create or replace function public.claim_due_classroom_archive_source_object_cleanup_v2(
  p_lease_token uuid,
  p_operation_id uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns table (
  operation_id uuid,
  archive_id uuid,
  classroom_id uuid,
  storage_bucket text,
  storage_path text,
  expected_sha256 text,
  expected_byte_size bigint,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_lease_token is null
    or p_operation_id is null
    or p_limit is null
    or p_limit < 1
    or p_limit > 100
    or p_lease_seconds is null
    or p_lease_seconds < 30
    or p_lease_seconds > 1800
  then
    raise exception 'Invalid classroom archive source cleanup claim'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select cleanup.operation_id, cleanup.storage_bucket, cleanup.storage_path
    from public.classroom_archive_source_object_cleanup cleanup
    join public.classroom_archive_source_object_reservations reservation
      on reservation.operation_id = cleanup.operation_id
      and reservation.storage_bucket = cleanup.storage_bucket
      and reservation.storage_path_sha256 =
        public.classroom_archive_source_object_path_sha256(
          cleanup.storage_bucket, cleanup.storage_path
        )
    join public.classroom_archive_operations operation
      on operation.id = cleanup.operation_id
      and operation.operation_type = 'compact'
      and operation.status = 'completed'
      and operation.archive_id = cleanup.archive_id
      and operation.classroom_id = cleanup.classroom_id
    join public.classroom_cold_tombstones tombstone
      on tombstone.classroom_id = cleanup.classroom_id
      and tombstone.archive_id = cleanup.archive_id
    where cleanup.next_attempt_at <= clock_timestamp()
      and cleanup.operation_id = p_operation_id
      and cleanup.storage_bucket = 'assignment-artifacts'
      and cleanup.ownership_verified is true
      and cleanup.ownership_verified_at is not null
      and (
        cleanup.status in ('pending', 'failed')
        or (
          cleanup.status = 'processing'
          and cleanup.lease_expires_at <= clock_timestamp()
        )
      )
    order by cleanup.next_attempt_at, cleanup.created_at,
      cleanup.operation_id, cleanup.storage_bucket, cleanup.storage_path
    for update of cleanup skip locked
    limit p_limit
  ), claimed as (
    update public.classroom_archive_source_object_cleanup cleanup
    set
      status = 'processing',
      attempt_count = cleanup.attempt_count + 1,
      lease_token = p_lease_token,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      last_error_code = null,
      updated_at = clock_timestamp()
    from candidates
    where cleanup.operation_id = candidates.operation_id
      and cleanup.storage_bucket = candidates.storage_bucket
      and cleanup.storage_path = candidates.storage_path
    returning cleanup.*
  )
  select
    claimed.operation_id,
    claimed.archive_id,
    claimed.classroom_id,
    claimed.storage_bucket,
    claimed.storage_path,
    claimed.expected_sha256,
    claimed.expected_byte_size,
    claimed.attempt_count
  from claimed;
end;
$$;

revoke execute on function public.claim_due_classroom_archive_source_object_cleanup(
  uuid, uuid, integer, integer
) from service_role;

revoke all on function public.claim_due_classroom_archive_source_object_cleanup_v2(
  uuid, uuid, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_due_classroom_archive_source_object_cleanup_v2(
  uuid, uuid, integer, integer
) to service_role;

-- Every lease transition repeats the ownership-evidence and reservation check.
-- This invalidates a pre-096 worker even if it retained an old lease token.
create or replace function public.renew_classroom_archive_source_object_cleanup_lease(
  p_operation_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_lease_token uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated boolean;
begin
  if p_operation_id is null
    or p_lease_token is null
    or p_storage_bucket <> 'assignment-artifacts'
    or p_storage_path is null
    or p_storage_path = ''
    or p_storage_path like '/%'
    or p_storage_path like '%/'
    or p_storage_path like '%//%'
    or strpos(p_storage_path, E'\\') > 0
    or p_storage_path ~ '(^|/)\.{1,2}(/|$)'
    or p_lease_seconds is null
    or p_lease_seconds < 30
    or p_lease_seconds > 1800
  then
    raise exception 'Invalid classroom archive source cleanup lease renewal'
      using errcode = '22023';
  end if;

  update public.classroom_archive_source_object_cleanup cleanup
  set lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      updated_at = clock_timestamp()
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
            cleanup.storage_bucket, cleanup.storage_path
          )
    );
  v_updated := found;
  return v_updated;
end;
$$;

create or replace function public.complete_classroom_archive_source_object_cleanup(
  p_operation_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated boolean;
begin
  if p_operation_id is null
    or p_lease_token is null
    or p_storage_bucket <> 'assignment-artifacts'
    or p_storage_path is null
    or p_storage_path = ''
    or p_storage_path like '/%'
    or p_storage_path like '%/'
    or p_storage_path like '%//%'
    or strpos(p_storage_path, E'\\') > 0
    or p_storage_path ~ '(^|/)\.{1,2}(/|$)'
  then
    raise exception 'Invalid classroom archive source cleanup completion'
      using errcode = '22023';
  end if;

  update public.classroom_archive_source_object_cleanup cleanup
  set status = 'deleted',
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null,
      deleted_at = clock_timestamp(),
      updated_at = clock_timestamp()
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
            cleanup.storage_bucket, cleanup.storage_path
          )
    );
  v_updated := found;
  return v_updated;
end;
$$;

create or replace function public.fail_classroom_archive_source_object_cleanup(
  p_operation_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_lease_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated boolean;
begin
  if p_operation_id is null
    or p_lease_token is null
    or p_storage_bucket <> 'assignment-artifacts'
    or p_storage_path is null
    or p_storage_path = ''
    or p_storage_path like '/%'
    or p_storage_path like '%/'
    or p_storage_path like '%//%'
    or strpos(p_storage_path, E'\\') > 0
    or p_storage_path ~ '(^|/)\.{1,2}(/|$)'
    or p_error_code is null
    or p_error_code !~ '^[a-z0-9_]{3,80}$'
  then
    raise exception 'Invalid classroom archive source cleanup failure'
      using errcode = '22023';
  end if;

  update public.classroom_archive_source_object_cleanup cleanup
  set status = 'failed',
      lease_token = null,
      lease_expires_at = null,
      last_error_code = p_error_code,
      next_attempt_at = clock_timestamp() + make_interval(
        mins => least(
          1440,
          greatest(1, power(2, least(cleanup.attempt_count, 10))::integer)
        )
      ),
      updated_at = clock_timestamp()
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
            cleanup.storage_bucket, cleanup.storage_path
          )
    );
  v_updated := found;
  return v_updated;
end;
$$;

create or replace function public.get_classroom_archive_source_object_presence(
  p_storage_bucket text,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
begin
  if p_storage_bucket <> 'assignment-artifacts'
    or p_storage_path is null
    or p_storage_path = ''
    or p_storage_path like '/%'
    or p_storage_path like '%/'
    or p_storage_path like '%//%'
    or strpos(p_storage_path, E'\\') > 0
    or p_storage_path ~ '(^|/)\.{1,2}(/|$)'
  then
    raise exception 'Invalid classroom archive source object identity'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'bucket_exists', exists (
      select 1 from storage.buckets bucket where bucket.id = p_storage_bucket
    ),
    'object_exists', exists (
      select 1
      from storage.objects object
      where object.bucket_id = p_storage_bucket
        and object.name = p_storage_path
    )
  );
end;
$$;

revoke all on function public.get_classroom_archive_source_object_presence(text, text)
  from public, anon, authenticated;
grant execute on function public.get_classroom_archive_source_object_presence(text, text)
  to service_role;

comment on table public.classroom_archive_source_object_reservations is
  'Permanent de-identified exact-path reservations that fence verified classroom archive source deletion.';
comment on function public.verify_and_reserve_classroom_archive_source_objects(uuid, integer) is
  'Atomically reserves a bounded set of exclusively-owned assignment artifact paths for one completed cold compaction.';
