-- Lease-based deletion of source objects after an atomic classroom compaction.
-- Rows remain ineligible until a separate ownership verifier records exclusive ownership.

alter table public.classroom_archive_source_object_cleanup
  add column if not exists ownership_verified boolean not null default false;

create unique index if not exists uq_classroom_archive_source_cleanup_owned_object
  on public.classroom_archive_source_object_cleanup (storage_bucket, storage_path)
  where ownership_verified is true and status <> 'deleted';

alter table public.classroom_archive_source_object_cleanup
  drop constraint if exists classroom_archive_source_object_cleanup_status_check;
alter table public.classroom_archive_source_object_cleanup
  drop constraint if exists classroom_archive_source_object_cleanup_check;
alter table public.classroom_archive_source_object_cleanup
  drop constraint if exists classroom_archive_source_object_cleanup_check1;

alter table public.classroom_archive_source_object_cleanup
  add constraint classroom_archive_source_object_cleanup_status_check check (
    status in ('staged', 'pending', 'processing', 'failed', 'deleted')
  ),
  add constraint classroom_archive_source_object_cleanup_lease_check check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  ),
  add constraint classroom_archive_source_object_cleanup_state_check check (
    (
      status in ('staged', 'pending')
      and lease_token is null
      and lease_expires_at is null
      and last_error_code is null
      and deleted_at is null
    )
    or (
      status = 'processing'
      and lease_token is not null
      and lease_expires_at is not null
      and last_error_code is null
      and deleted_at is null
    )
    or (
      status = 'failed'
      and lease_token is null
      and lease_expires_at is null
      and last_error_code is not null
      and deleted_at is null
    )
    or (
      status = 'deleted'
      and lease_token is null
      and lease_expires_at is null
      and last_error_code is null
      and deleted_at is not null
    )
  );

drop index if exists public.idx_classroom_archive_source_object_cleanup_due;
create index idx_classroom_archive_source_object_cleanup_due
  on public.classroom_archive_source_object_cleanup (
    next_attempt_at,
    lease_expires_at,
    created_at
  )
  where status in ('pending', 'failed', 'processing');

create or replace function public.claim_due_classroom_archive_source_object_cleanup(
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
set search_path = public
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
    select
      cleanup.operation_id,
      cleanup.storage_bucket,
      cleanup.storage_path
    from public.classroom_archive_source_object_cleanup cleanup
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
      and cleanup.ownership_verified is true
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

create or replace function public.renew_classroom_archive_source_object_cleanup_lease(
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
declare
  v_updated boolean;
begin
  if p_operation_id is null
    or p_lease_token is null
    or p_storage_bucket not in (
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
    or p_lease_seconds is null
    or p_lease_seconds < 30
    or p_lease_seconds > 1800
  then
    raise exception 'Invalid classroom archive source cleanup lease renewal'
      using errcode = '22023';
  end if;

  update public.classroom_archive_source_object_cleanup
  set
    lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    updated_at = clock_timestamp()
  where operation_id = p_operation_id
    and storage_bucket = p_storage_bucket
    and storage_path = p_storage_path
    and ownership_verified is true
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp();
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
set search_path = public
as $$
declare
  v_updated boolean;
begin
  if p_operation_id is null
    or p_lease_token is null
    or p_storage_bucket is null
    or p_storage_bucket not in (
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
  then
    raise exception 'Invalid classroom archive source cleanup completion'
      using errcode = '22023';
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
    and storage_path = p_storage_path
    and status = 'processing'
    and lease_token = p_lease_token
    and lease_expires_at > clock_timestamp();
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
set search_path = public
as $$
declare
  v_updated boolean;
begin
  if p_operation_id is null
    or p_lease_token is null
    or p_storage_bucket is null
    or p_storage_bucket not in (
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
    or p_error_code is null
    or p_error_code !~ '^[a-z0-9_]{3,80}$'
  then
    raise exception 'Invalid classroom archive source cleanup failure'
      using errcode = '22023';
  end if;

  update public.classroom_archive_source_object_cleanup
  set
    status = 'failed',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = p_error_code,
    next_attempt_at = clock_timestamp() + make_interval(
      mins => least(
        1440,
        greatest(1, power(2, least(attempt_count, 10))::integer)
      )
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

revoke all on table public.classroom_archive_source_object_cleanup
  from public, anon, authenticated;
grant select on table public.classroom_archive_source_object_cleanup to service_role;

revoke all on function public.claim_due_classroom_archive_source_object_cleanup(uuid, uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.renew_classroom_archive_source_object_cleanup_lease(uuid, text, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_classroom_archive_source_object_cleanup(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_classroom_archive_source_object_cleanup(uuid, text, text, uuid, text)
  from public, anon, authenticated;

grant execute on function public.claim_due_classroom_archive_source_object_cleanup(uuid, uuid, integer, integer)
  to service_role;
grant execute on function public.renew_classroom_archive_source_object_cleanup_lease(uuid, text, text, uuid, integer)
  to service_role;
grant execute on function public.complete_classroom_archive_source_object_cleanup(uuid, text, text, uuid)
  to service_role;
grant execute on function public.fail_classroom_archive_source_object_cleanup(uuid, text, text, uuid, text)
  to service_role;

comment on function public.claim_due_classroom_archive_source_object_cleanup(uuid, uuid, integer, integer) is
  'Leases source-object deletion for one approved operation after compaction, tombstone, and exclusive ownership verification.';
comment on function public.complete_classroom_archive_source_object_cleanup(uuid, text, text, uuid) is
  'Records exact-key source-object absence for the current unexpired cleanup lease.';
