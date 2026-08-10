-- Durable, resumable permanent deletion for teacher-owned cold archived Classrooms.
--
-- This scope is deliberately independent from hot-Classroom deletion, individual-
-- student purging, and generic orphan cleanup. Applying this migration leaves the
-- cold purge rollout disabled and does not schedule or invoke any deletion.

alter table public.classroom_purge_operations
  add column purge_scope text not null default 'hot_classroom'
    check (purge_scope in ('hot_classroom', 'cold_classroom')),
  add column cold_archive_id uuid,
  add constraint classroom_purge_operations_cold_archive_check check (
    (purge_scope = 'cold_classroom' and cold_archive_id is not null)
    or (purge_scope = 'hot_classroom' and cold_archive_id is null)
  );

alter table public.classroom_purge_objects
  add column delete_priority smallint not null default 50
    check (delete_priority between 0 and 100);

-- Migration 118 predated purge scopes. Keep its established implementation,
-- but put a scope guard in front of both worker entry points so a cold
-- operation can never be advanced through the hot API or safety net.
alter function public.claim_classroom_purge_object(uuid, uuid, uuid, integer)
  rename to claim_classroom_purge_object_v118;

create function public.claim_classroom_purge_object(
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
  if not exists (
    select 1 from public.classroom_purge_operations operation
    where operation.id = p_operation_id
      and operation.teacher_id = p_teacher_id
      and operation.purge_scope = 'hot_classroom'
  ) then
    raise exception using errcode = 'P0002',
      message = 'hot_classroom_purge_operation_not_found';
  end if;
  return query
  select * from public.claim_classroom_purge_object_v118(
    p_operation_id, p_teacher_id, p_lease_token, p_lease_seconds
  );
end;
$$;

alter function public.finalize_hot_archived_classroom_purge(uuid, uuid)
  rename to finalize_hot_archived_classroom_purge_v118;

create function public.finalize_hot_archived_classroom_purge(
  p_operation_id uuid,
  p_teacher_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.classroom_purge_operations operation
    where operation.id = p_operation_id
      and operation.teacher_id = p_teacher_id
      and operation.purge_scope = 'hot_classroom'
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'purge_not_found',
      'error', 'Permanent deletion not found'
    );
  end if;
  return public.finalize_hot_archived_classroom_purge_v118(
    p_operation_id, p_teacher_id
  );
end;
$$;

revoke all on function public.claim_classroom_purge_object_v118(
  uuid, uuid, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function public.finalize_hot_archived_classroom_purge_v118(
  uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.claim_classroom_purge_object(
  uuid, uuid, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function public.finalize_hot_archived_classroom_purge(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.claim_classroom_purge_object(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.finalize_hot_archived_classroom_purge(
  uuid, uuid
) to service_role;

create table public.cold_classroom_purge_settings (
  singleton boolean primary key default true check (singleton),
  rollout_mode text not null default 'disabled'
    check (rollout_mode in ('disabled', 'canary', 'enabled')),
  canary_teacher_id uuid references public.users (id) on delete restrict,
  canary_classroom_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (rollout_mode = 'canary' and canary_teacher_id is not null
      and canary_classroom_id is not null)
    or (rollout_mode <> 'canary' and canary_teacher_id is null
      and canary_classroom_id is null)
  )
);

insert into public.cold_classroom_purge_settings (singleton) values (true);

create table public.cold_classroom_purge_fences (
  classroom_id uuid primary key
    references public.classroom_cold_tombstones (classroom_id) on delete restrict,
  operation_id uuid not null unique
    references public.classroom_purge_operations (id) on delete cascade,
  teacher_id uuid not null references public.users (id) on delete restrict,
  archive_id uuid not null references public.classroom_archives (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create table public.cold_classroom_purge_resources (
  operation_id uuid not null
    references public.classroom_purge_operations (id) on delete cascade,
  resource_type text not null check (resource_type in (
    'cold_tombstone',
    'cold_actor',
    'archive_operation',
    'archive',
    'archive_object_upload_cleanup',
    'archive_snapshot_resource',
    'archive_snapshot_actor',
    'archive_restore_staging',
    'archive_restore_expected_object',
    'archive_source_object_cleanup',
    'archive_source_object_reservation',
    'gradex_extract',
    'gradex_extract_cleanup',
    'assignment_artifact_cleanup',
    'test_document_cleanup',
    'managed_storage_object',
    'managed_storage_provisional_owner'
  )),
  resource_id uuid,
  identity_sha256 text not null check (identity_sha256 ~ '^[a-f0-9]{64}$'),
  primary key (operation_id, resource_type, identity_sha256)
);

create index cold_classroom_purge_resources_operation_type
  on public.cold_classroom_purge_resources (operation_id, resource_type);

alter table public.cold_classroom_purge_settings enable row level security;
alter table public.cold_classroom_purge_fences enable row level security;
alter table public.cold_classroom_purge_resources enable row level security;

revoke all on table public.cold_classroom_purge_settings,
  public.cold_classroom_purge_fences,
  public.cold_classroom_purge_resources
  from public, anon, authenticated, service_role;
grant select on table public.cold_classroom_purge_settings,
  public.cold_classroom_purge_fences,
  public.cold_classroom_purge_resources
  to service_role;

create or replace function public.cold_classroom_purge_rollout_allows(
  p_teacher_id uuid,
  p_classroom_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case settings.rollout_mode
    when 'enabled' then true
    when 'canary' then settings.canary_teacher_id = p_teacher_id
      and settings.canary_classroom_id = p_classroom_id
    else false
  end
  from public.cold_classroom_purge_settings settings
  where settings.singleton
$$;

-- Return only privacy-safe exact row identities. Composite keys and Storage
-- paths are hashed before they leave this function; raw content is never stored
-- in the purge snapshot.
create or replace function public.cold_classroom_purge_resource_inventory(
  p_classroom_id uuid
)
returns table (
  resource_type text,
  resource_id uuid,
  identity_sha256 text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with operation_ids as (
    select operation.id
    from public.classroom_archive_operations operation
    where operation.classroom_id = p_classroom_id
  ), owned_objects as (
    select object.id
    from public.managed_storage_objects object
    left join public.managed_storage_provisional_owners provisional
      on provisional.id = object.provisional_owner_id
    where object.classroom_id = p_classroom_id
      or provisional.target_classroom_id = p_classroom_id
  ), inventory(resource_type, resource_id, identity_key) as (
    select 'cold_tombstone', tombstone.classroom_id,
      jsonb_build_array(tombstone.classroom_id, tombstone.archive_id,
        tombstone.teacher_id, tombstone.source_revision)
    from public.classroom_cold_tombstones tombstone
    where tombstone.classroom_id = p_classroom_id

    union all
    select 'cold_actor', actor.actor_id,
      jsonb_build_array(actor.classroom_id, actor.actor_id, actor.actor_role)
    from public.classroom_cold_archive_actors actor
    where actor.classroom_id = p_classroom_id

    union all
    select 'archive_operation', operation.id,
      jsonb_build_array(operation.id, operation.operation_type, operation.archive_id,
        operation.status, operation.managed_object_id)
    from public.classroom_archive_operations operation
    where operation.classroom_id = p_classroom_id

    union all
    select 'archive', archive.id,
      jsonb_build_array(archive.id, archive.operation_id, archive.managed_object_id,
        archive.artifact_sha256)
    from public.classroom_archives archive
    where archive.classroom_id = p_classroom_id

    union all
    select 'archive_object_upload_cleanup', cleanup.managed_object_id,
      jsonb_build_array(cleanup.operation_id, cleanup.storage_bucket,
        cleanup.storage_path, cleanup.managed_object_id, cleanup.status)
    from public.classroom_archive_object_upload_cleanup cleanup
    where cleanup.operation_id in (select id from operation_ids)

    union all
    select 'archive_snapshot_resource', snapshot.row_id,
      jsonb_build_array(snapshot.operation_id, snapshot.table_name, snapshot.row_id)
    from public.classroom_archive_snapshot_resources snapshot
    where snapshot.operation_id in (select id from operation_ids)

    union all
    select 'archive_snapshot_actor', snapshot.actor_id,
      jsonb_build_array(snapshot.operation_id, snapshot.actor_id)
    from public.classroom_archive_snapshot_actors snapshot
    where snapshot.operation_id in (select id from operation_ids)

    union all
    select 'archive_restore_staging', staging.row_id,
      jsonb_build_array(staging.operation_id, staging.restore_contract_version,
        staging.table_name, staging.row_id)
    from public.classroom_archive_restore_staging staging
    where staging.operation_id in (select id from operation_ids)

    union all
    select 'archive_restore_expected_object', expected.managed_object_id,
      jsonb_build_array(expected.operation_id, expected.storage_bucket,
        expected.storage_path, expected.managed_object_id)
    from public.classroom_archive_restore_expected_objects expected
    where expected.operation_id in (select id from operation_ids)

    union all
    select 'archive_source_object_cleanup', cleanup.managed_object_id,
      jsonb_build_array(cleanup.operation_id, cleanup.storage_bucket,
        cleanup.storage_path, cleanup.managed_object_id, cleanup.status)
    from public.classroom_archive_source_object_cleanup cleanup
    where cleanup.classroom_id = p_classroom_id

    union all
    select 'archive_source_object_reservation', reservation.operation_id,
      jsonb_build_array(reservation.operation_id, reservation.storage_bucket,
        reservation.storage_path_sha256)
    from public.classroom_archive_source_object_reservations reservation
    where reservation.operation_id in (select id from operation_ids)

    union all
    select 'gradex_extract', extract.id,
      jsonb_build_array(extract.id, extract.operation_id, extract.source_archive_id,
        extract.managed_object_id, extract.artifact_sha256)
    from public.classroom_gradex_extracts extract
    where extract.classroom_id = p_classroom_id

    union all
    select 'gradex_extract_cleanup', cleanup.managed_object_id,
      jsonb_build_array(cleanup.operation_id, cleanup.extract_id,
        cleanup.managed_object_id, cleanup.status)
    from public.classroom_gradex_extract_cleanup cleanup
    where cleanup.operation_id in (select id from operation_ids)

    union all
    select 'assignment_artifact_cleanup', cleanup.managed_object_id,
      jsonb_build_array(cleanup.managed_object_id, cleanup.storage_path, cleanup.status)
    from public.assignment_artifact_storage_cleanup cleanup
    where cleanup.managed_object_id in (select id from owned_objects)

    union all
    select 'test_document_cleanup', cleanup.managed_object_id,
      jsonb_build_array(cleanup.managed_object_id, cleanup.storage_path, cleanup.status)
    from public.test_document_snapshot_storage_cleanup cleanup
    where cleanup.managed_object_id in (select id from owned_objects)

    union all
    select 'managed_storage_object', object.id,
      jsonb_build_array(object.id, object.storage_bucket, object.storage_path,
        object.classroom_id, object.provisional_owner_id, object.status)
    from public.managed_storage_objects object
    where object.id in (select id from owned_objects)

    union all
    select 'managed_storage_provisional_owner', provisional.id,
      jsonb_build_array(provisional.id, provisional.target_classroom_id,
        provisional.adopted_at, provisional.copy_closed_at)
    from public.managed_storage_provisional_owners provisional
    where provisional.target_classroom_id = p_classroom_id
  )
  select inventory.resource_type, inventory.resource_id,
    encode(extensions.digest(
      convert_to(jsonb_build_array(
        inventory.resource_type, inventory.identity_key
      )::text, 'UTF8'),
      'sha256'
    ), 'hex')
  from inventory
$$;

create or replace function public.cold_classroom_purge_resource_inventory_sha256(
  p_classroom_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(extensions.digest(convert_to(coalesce(string_agg(
    jsonb_build_array(resource_type, resource_id, identity_sha256)::text,
    E'\n' order by resource_type, identity_sha256
  ), ''), 'UTF8'), 'sha256'), 'hex')
  from public.cold_classroom_purge_resource_inventory(p_classroom_id)
$$;

create or replace function public.get_cold_archived_classroom_purge_inventory(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_archive_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_tombstone public.classroom_cold_tombstones;
  v_archive public.classroom_archives;
  v_mode text;
  v_conflict text;
  v_storage_digest text;
  v_resource_digest text;
  v_managed_count integer;
  v_managed_bytes bigint;
  v_missing_count integer;
  v_non_ready_count integer;
  v_archive_count integer;
  v_gradex_count integer;
  v_student_count integer;
  v_unmanaged_reference_count integer;
  v_storage_counts jsonb;
  v_resource_counts jsonb;
  v_allowed boolean;
begin
  select * into v_tombstone
  from public.classroom_cold_tombstones tombstone
  where tombstone.classroom_id = p_classroom_id
    and tombstone.teacher_id = p_teacher_id
    and tombstone.archive_id = p_archive_id;
  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'cold_classroom_not_found',
      'error', 'Stored classroom not found'
    );
  end if;

  select * into v_archive
  from public.classroom_archives archive
  where archive.id = v_tombstone.archive_id
    and archive.classroom_id = v_tombstone.classroom_id
    and archive.teacher_id = v_tombstone.teacher_id;
  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'cold_classroom_archive_missing',
      'error', 'Stored classroom recovery metadata is incomplete'
    );
  end if;

  select mode into strict v_mode
  from public.managed_storage_settings where singleton;
  v_allowed := public.cold_classroom_purge_rollout_allows(
    p_teacher_id, p_classroom_id
  );
  v_conflict := public.classroom_purge_conflict(p_classroom_id);
  v_storage_digest := public.classroom_purge_storage_inventory_sha256(p_classroom_id);
  v_resource_digest := public.cold_classroom_purge_resource_inventory_sha256(
    p_classroom_id
  );

  with inventory as (
    select object.*
    from public.managed_storage_objects object
    left join public.managed_storage_provisional_owners provisional
      on provisional.id = object.provisional_owner_id
    where object.classroom_id = p_classroom_id
      or provisional.target_classroom_id = p_classroom_id
  )
  select count(*)::integer,
    coalesce(sum(coalesce(inventory.byte_size, 0)), 0)::bigint,
    count(*) filter (where stored.id is null)::integer,
    count(*) filter (where inventory.status not in ('ready', 'deleted'))::integer
  into v_managed_count, v_managed_bytes, v_missing_count, v_non_ready_count
  from inventory
  left join storage.objects stored
    on stored.bucket_id = inventory.storage_bucket
   and stored.name = inventory.storage_path;

  select count(*)::integer into v_archive_count
  from public.classroom_archives where classroom_id = p_classroom_id;
  select count(*)::integer into v_gradex_count
  from public.classroom_gradex_extracts where classroom_id = p_classroom_id;
  select count(*)::integer into v_student_count
  from public.classroom_cold_archive_actors
  where classroom_id = p_classroom_id and actor_role = 'student';

  with operation_ids as (
    select id from public.classroom_archive_operations
    where classroom_id = p_classroom_id
  ), unmanaged as (
    select 1 from public.classroom_archives
    where classroom_id = p_classroom_id and managed_object_id is null
    union all
    select 1 from public.classroom_archive_operations
    where classroom_id = p_classroom_id and storage_path is not null
      and managed_object_id is null
    union all
    select 1 from public.classroom_gradex_extracts
    where classroom_id = p_classroom_id and managed_object_id is null
    union all
    select 1 from public.classroom_archive_object_upload_cleanup
    where operation_id in (select id from operation_ids)
      and status <> 'deleted' and managed_object_id is null
    union all
    select 1 from public.classroom_archive_restore_expected_objects
    where operation_id in (select id from operation_ids)
      and managed_object_id is null
    union all
    select 1 from public.classroom_archive_source_object_cleanup
    where classroom_id = p_classroom_id and status <> 'deleted'
      and managed_object_id is null
    union all
    select 1 from public.classroom_gradex_extract_cleanup
    where operation_id in (select id from operation_ids)
      and status <> 'deleted' and managed_object_id is null
  )
  select count(*)::integer into v_unmanaged_reference_count from unmanaged;

  select coalesce(jsonb_object_agg(counts.storage_bucket, counts.object_count),
    '{}'::jsonb)
  into v_storage_counts
  from (
    select object.storage_bucket, count(*)::integer object_count
    from public.managed_storage_objects object
    left join public.managed_storage_provisional_owners provisional
      on provisional.id = object.provisional_owner_id
    where object.classroom_id = p_classroom_id
      or provisional.target_classroom_id = p_classroom_id
    group by object.storage_bucket
  ) counts;

  select coalesce(jsonb_object_agg(counts.resource_type, counts.resource_count),
    '{}'::jsonb)
  into v_resource_counts
  from (
    select resource_type, count(*)::integer resource_count
    from public.cold_classroom_purge_resource_inventory(p_classroom_id)
    group by resource_type
  ) counts;

  return jsonb_build_object(
    'ok', true,
    'status', 200,
    'classroom_id', p_classroom_id,
    'archive_id', p_archive_id,
    'classroom_title', v_tombstone.title,
    'source_revision', v_tombstone.source_revision,
    'storage_inventory_sha256', v_storage_digest,
    'cold_resource_inventory_sha256', v_resource_digest,
    'cold_resource_count', (
      select count(*)::integer
      from public.cold_classroom_purge_resource_inventory(p_classroom_id)
    ),
    'student_count', v_student_count,
    'managed_file_count', v_managed_count,
    'managed_file_bytes', v_managed_bytes,
    'missing_file_count', v_missing_count,
    'non_ready_file_count', v_non_ready_count,
    'unmanaged_reference_count', v_unmanaged_reference_count,
    'archive_count', v_archive_count,
    'gradex_extract_count', v_gradex_count,
    'storage_counts', v_storage_counts,
    'resource_counts', v_resource_counts,
    'retention', v_archive.retention,
    'conflicting_operation', v_conflict,
    'deletion_available', v_mode = 'enforced' and v_allowed
      and v_conflict is null and v_unmanaged_reference_count = 0,
    'unavailable_reason', case
      when v_mode <> 'enforced' then 'Managed storage ownership is not ready.'
      when not v_allowed then 'Stored classroom deletion is not enabled.'
      when v_conflict is not null then
        'Finish the active classroom operation before deleting permanently.'
      when v_unmanaged_reference_count > 0 then
        'Stored classroom files are missing managed ownership.'
      else null
    end
  );
end;
$$;

create or replace function public.begin_cold_archived_classroom_purge(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_archive_id uuid,
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
  v_tombstone public.classroom_cold_tombstones;
  v_archive public.classroom_archives;
  v_conflict text;
  v_storage_digest text;
  v_resource_digest text;
  v_counts jsonb;
  v_storage_counts jsonb;
  v_inventory jsonb;
begin
  if p_request_sha256 !~ '^[a-f0-9]{64}$'
    or p_impact_summary is null
    or jsonb_typeof(p_impact_summary) <> 'object'
  then
    raise exception using errcode = '22023', message = 'invalid_cold_classroom_purge_request';
  end if;
  if not public.lock_managed_storage_protocol() then
    return jsonb_build_object(
      'ok', false, 'status', 503,
      'error_code', 'managed_storage_enforcement_required',
      'error', 'Managed storage ownership enforcement is not enabled'
    );
  end if;
  perform 1 from public.cold_classroom_purge_settings where singleton for share;
  perform public.classroom_purge_lock(p_classroom_id);

  select * into v_operation
  from public.classroom_purge_operations
  where id = p_operation_id
  for update;
  if found then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.request_sha256 <> p_request_sha256
      or v_operation.purge_scope <> 'cold_classroom'
      or v_operation.cold_archive_id <> p_archive_id
    then
      return jsonb_build_object(
        'ok', false, 'status', 409, 'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different deletion request'
      );
    end if;
    if v_operation.status = 'failed' and v_operation.retryable is true then
      update public.classroom_purge_operations
      set status = 'deleting_objects', attempt_count = attempt_count + 1,
          error_code = null, updated_at = clock_timestamp()
      where id = p_operation_id returning * into v_operation;
    end if;
    return jsonb_build_object(
      'ok', true,
      'status', case when v_operation.status = 'completed' then 200 else 202 end,
      'operation_id', p_operation_id,
      'operation_status', v_operation.status,
      'replayed', true
    );
  end if;

  select * into v_tombstone
  from public.classroom_cold_tombstones tombstone
  where tombstone.classroom_id = p_classroom_id
    and tombstone.teacher_id = p_teacher_id
    and tombstone.archive_id = p_archive_id
  for update;
  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'cold_classroom_not_found',
      'error', 'Stored classroom not found'
    );
  end if;

  select * into v_archive
  from public.classroom_archives archive
  where archive.id = p_archive_id
    and archive.classroom_id = p_classroom_id
    and archive.teacher_id = p_teacher_id
  for update;
  if not found then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'cold_classroom_archive_missing',
      'error', 'Stored classroom recovery metadata is incomplete'
    );
  end if;
  if not public.cold_classroom_purge_rollout_allows(p_teacher_id, p_classroom_id) then
    return jsonb_build_object(
      'ok', false, 'status', 503, 'error_code', 'cold_classroom_purge_disabled',
      'error', 'Stored classroom deletion is not enabled'
    );
  end if;
  if exists (
    select 1 from public.classrooms where id = p_classroom_id
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_is_hot_archived',
      'error', 'Stored classroom state changed before deletion'
    );
  end if;

  perform 1
  from public.managed_storage_objects object
  left join public.managed_storage_provisional_owners provisional
    on provisional.id = object.provisional_owner_id
  where object.classroom_id = p_classroom_id
    or provisional.target_classroom_id = p_classroom_id
  order by object.id
  for update of object;

  v_inventory := public.get_cold_archived_classroom_purge_inventory(
    p_teacher_id, p_classroom_id, p_archive_id
  );
  if coalesce((v_inventory->>'ok')::boolean, false) is not true
    or coalesce((v_inventory->>'deletion_available')::boolean, false) is not true
  then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', coalesce(v_inventory->>'error_code',
        'cold_classroom_purge_not_ready'),
      'error', coalesce(v_inventory->>'unavailable_reason',
        v_inventory->>'error', 'Stored classroom deletion is not ready')
    );
  end if;
  v_storage_digest := v_inventory->>'storage_inventory_sha256';
  v_resource_digest := v_inventory->>'cold_resource_inventory_sha256';
  if v_tombstone.source_revision is distinct from
      (p_impact_summary->>'source_revision')::bigint
    or v_storage_digest is distinct from p_impact_summary->>'storage_inventory_sha256'
    or v_resource_digest is distinct from
      p_impact_summary->>'cold_resource_inventory_sha256'
  then
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'cold_classroom_purge_inventory_changed',
      'error', 'Stored classroom data changed after the deletion impact was confirmed'
    );
  end if;

  v_conflict := public.classroom_purge_conflict(p_classroom_id);
  if v_conflict is not null then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', v_conflict,
      'error', 'Finish the active classroom operation before deleting permanently'
    );
  end if;
  if exists (
    select 1 from public.cold_classroom_purge_fences
    where classroom_id = p_classroom_id
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'cold_classroom_purge_active',
      'error', 'Permanent deletion is already active for this stored classroom'
    );
  end if;

  insert into public.classroom_purge_operations (
    id, teacher_id, classroom_id, classroom_title, request_sha256,
    status, source_revision, impact_summary, purge_scope, cold_archive_id
  ) values (
    p_operation_id, p_teacher_id, p_classroom_id, v_tombstone.title,
    p_request_sha256, 'inventorying', v_tombstone.source_revision,
    p_impact_summary, 'cold_classroom', p_archive_id
  );
  insert into public.cold_classroom_purge_fences (
    classroom_id, operation_id, teacher_id, archive_id
  ) values (
    p_classroom_id, p_operation_id, p_teacher_id, p_archive_id
  );
  perform set_config('pika.classroom_purge_begin', 'on', true);

  insert into public.cold_classroom_purge_resources (
    operation_id, resource_type, resource_id, identity_sha256
  )
  select p_operation_id, resource_type, resource_id, identity_sha256
  from public.cold_classroom_purge_resource_inventory(p_classroom_id);

  insert into public.classroom_purge_objects (
    operation_id, storage_bucket, storage_path, storage_path_sha256,
    disposition, status, managed_storage_object_id, delete_priority
  )
  select p_operation_id, object.storage_bucket, object.storage_path,
    public.managed_storage_identity_sha256(object.storage_bucket, object.storage_path),
    'delete', 'pending', object.id,
    case
      when object.id = v_archive.managed_object_id then 100
      when object.storage_bucket = 'classroom-archives' then 90
      else 10
    end
  from public.managed_storage_objects object
  left join public.managed_storage_provisional_owners provisional
    on provisional.id = object.provisional_owner_id
  where object.classroom_id = p_classroom_id
    or provisional.target_classroom_id = p_classroom_id;

  select coalesce(jsonb_object_agg(counts.resource_type, counts.resource_count),
    '{}'::jsonb)
  into v_counts
  from (
    select resource_type, count(*)::integer resource_count
    from public.cold_classroom_purge_resources
    where operation_id = p_operation_id
    group by resource_type
  ) counts;

  select coalesce(jsonb_object_agg(counts.storage_bucket, counts.object_count),
    '{}'::jsonb)
  into v_storage_counts
  from (
    select storage_bucket, count(*)::integer object_count
    from public.classroom_purge_objects
    where operation_id = p_operation_id
    group by storage_bucket
  ) counts;

  update public.classroom_purge_operations
  set status = 'deleting_objects', resource_counts = v_counts,
      storage_object_counts = v_storage_counts,
      inventory_completed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_operation_id;

  return jsonb_build_object(
    'ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', 'deleting_objects', 'source_revision', v_tombstone.source_revision,
    'resource_counts', v_counts, 'storage_object_counts', v_storage_counts,
    'replayed', false
  );
exception when unique_violation then
  return jsonb_build_object(
    'ok', false, 'status', 409, 'error_code', 'cold_classroom_purge_active',
    'error', 'Permanent deletion is already active for this stored classroom'
  );
end;
$$;

create or replace function public.claim_cold_classroom_purge_object(
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
  v_operation public.classroom_purge_operations;
  v_object_id uuid;
begin
  if p_lease_token is null or p_lease_seconds not between 15 and 300 then
    raise exception using errcode = '22023', message = 'invalid_cold_classroom_purge_lease';
  end if;
  if not public.lock_managed_storage_protocol() then
    raise exception using errcode = '55000', message = 'managed_storage_enforcement_required';
  end if;
  perform 1 from public.cold_classroom_purge_settings where singleton for share;
  select * into v_operation
  from public.classroom_purge_operations operation
  where operation.id = p_operation_id
    and operation.teacher_id = p_teacher_id
    and operation.purge_scope = 'cold_classroom';
  if not found then
    raise exception using errcode = 'P0002', message = 'cold_classroom_purge_operation_not_found';
  end if;
  if not public.cold_classroom_purge_rollout_allows(
    p_teacher_id, v_operation.classroom_id
  ) then
    raise exception using errcode = '55000', message = 'cold_classroom_purge_disabled';
  end if;

  perform public.classroom_purge_lock(v_operation.classroom_id);
  perform 1 from public.classroom_cold_tombstones tombstone
  where tombstone.classroom_id = v_operation.classroom_id
    and tombstone.teacher_id = p_teacher_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'cold_classroom_purge_tombstone_not_found';
  end if;
  perform 1 from public.classroom_purge_operations operation
  where operation.id = p_operation_id
    and operation.teacher_id = p_teacher_id
    and operation.purge_scope = 'cold_classroom'
    and (
      operation.status = 'deleting_objects'
      or (operation.status = 'failed' and operation.retryable is true)
    )
    and exists (
      select 1 from public.cold_classroom_purge_fences fence
      where fence.operation_id = operation.id
        and fence.classroom_id = operation.classroom_id
    )
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'cold_classroom_purge_operation_not_found';
  end if;

  if exists (
    select 1 from storage.objects stored
    join public.classroom_purge_objects purge_object
      on purge_object.operation_id = p_operation_id
     and purge_object.status = 'deleted'
     and purge_object.storage_bucket = stored.bucket_id
     and purge_object.storage_path_sha256 =
       public.managed_storage_identity_sha256(stored.bucket_id, stored.name)
  ) then
    update public.classroom_purge_operations
    set status = 'failed', error_code = 'classroom_purge_storage_reappeared',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return;
  end if;

  select purge_object.id into v_object_id
  from public.classroom_purge_objects purge_object
  join public.managed_storage_objects object
    on object.id = purge_object.managed_storage_object_id
  left join public.managed_storage_provisional_owners provisional
    on provisional.id = object.provisional_owner_id
  where purge_object.operation_id = p_operation_id
    and (object.classroom_id = v_operation.classroom_id
      or provisional.target_classroom_id = v_operation.classroom_id)
    and purge_object.storage_path is not null
    and purge_object.next_attempt_at <= clock_timestamp()
    and (purge_object.status in ('pending', 'failed')
      or (purge_object.status = 'processing'
        and purge_object.lease_expires_at <= clock_timestamp()))
    and not exists (
      select 1 from public.classroom_purge_objects earlier
      where earlier.operation_id = p_operation_id
        and earlier.status <> 'deleted'
        and earlier.delete_priority < purge_object.delete_priority
    )
  order by purge_object.delete_priority, purge_object.next_attempt_at,
    purge_object.created_at, purge_object.id
  for update of purge_object skip locked
  limit 1;
  if not found then return; end if;

  update public.classroom_purge_operations
  set status = 'deleting_objects', error_code = null, retryable = null,
      updated_at = clock_timestamp()
  where id = p_operation_id;

  return query
  update public.classroom_purge_objects purge_object
  set status = 'processing', attempt_count = purge_object.attempt_count + 1,
      lease_token = p_lease_token,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      last_error_code = null, updated_at = clock_timestamp()
  where purge_object.id = v_object_id
  returning purge_object.*;
end;
$$;

create or replace function public.finalize_cold_archived_classroom_purge(
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
  v_tombstone public.classroom_cold_tombstones;
  v_error_code text;
  v_retryable boolean;
begin
  if not public.lock_managed_storage_protocol() then
    return jsonb_build_object(
      'ok', false, 'status', 503,
      'error_code', 'managed_storage_enforcement_required',
      'error', 'Managed storage ownership enforcement is not enabled'
    );
  end if;
  perform 1 from public.cold_classroom_purge_settings where singleton for share;
  select * into v_operation
  from public.classroom_purge_operations operation
  where operation.id = p_operation_id
    and operation.teacher_id = p_teacher_id
    and operation.purge_scope = 'cold_classroom';
  if not found then
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
  if not public.cold_classroom_purge_rollout_allows(
    p_teacher_id, v_operation.classroom_id
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 503, 'error_code', 'cold_classroom_purge_disabled',
      'error', 'Stored classroom deletion is not enabled'
    );
  end if;

  perform public.classroom_purge_lock(v_operation.classroom_id);
  select * into v_tombstone
  from public.classroom_cold_tombstones tombstone
  where tombstone.classroom_id = v_operation.classroom_id
    and tombstone.teacher_id = p_teacher_id
    and tombstone.source_revision = v_operation.source_revision
  for update;
  if not found then
    update public.classroom_purge_operations
    set status = 'failed', error_code = 'cold_classroom_purge_owner_or_state_drift',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'cold_classroom_purge_owner_or_state_drift',
      'error', 'Stored classroom ownership or recovery state changed during deletion',
      'retryable', false
    );
  end if;
  select * into v_operation
  from public.classroom_purge_operations operation
  where operation.id = p_operation_id and operation.teacher_id = p_teacher_id
  for update;
  if not exists (
    select 1 from public.cold_classroom_purge_fences fence
    where fence.operation_id = p_operation_id
      and fence.classroom_id = v_operation.classroom_id
      and fence.teacher_id = p_teacher_id
      and fence.archive_id = v_tombstone.archive_id
  ) then
    update public.classroom_purge_operations
    set status = 'failed', error_code = 'cold_classroom_purge_fence_missing',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'cold_classroom_purge_fence_missing',
      'error', 'Permanent deletion stopped because its cold recovery fence is missing',
      'retryable', false
    );
  end if;
  if exists (
    select 1 from storage.objects stored
    join public.classroom_purge_objects purge_object
      on purge_object.operation_id = p_operation_id
     and purge_object.status = 'deleted'
     and purge_object.storage_bucket = stored.bucket_id
     and purge_object.storage_path_sha256 =
       public.managed_storage_identity_sha256(stored.bucket_id, stored.name)
  ) then
    update public.classroom_purge_operations
    set status = 'failed', error_code = 'classroom_purge_storage_reappeared',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'classroom_purge_storage_reappeared',
      'error', 'A stored classroom file reappeared after verified deletion',
      'retryable', false
    );
  end if;
  if exists (
    select 1 from public.classroom_purge_objects
    where operation_id = p_operation_id and status <> 'deleted'
  ) then
    return jsonb_build_object(
      'ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', v_operation.status,
      'retryable', v_operation.retryable,
      'waiting_for_storage', true, 'replayed', false
    );
  end if;

  begin
    update public.classroom_purge_operations
    set status = 'finalizing', updated_at = clock_timestamp()
    where id = p_operation_id;
    perform set_config('pika.classroom_purge_finalize', 'on', true);

    if exists (
      (
        select resource_type, resource_id, identity_sha256
        from public.cold_classroom_purge_resource_inventory(v_operation.classroom_id)
        except
        select resource_type, resource_id, identity_sha256
        from public.cold_classroom_purge_resources
        where operation_id = p_operation_id
      )
      union all
      (
        select resource_type, resource_id, identity_sha256
        from public.cold_classroom_purge_resources
        where operation_id = p_operation_id
        except
        select resource_type, resource_id, identity_sha256
        from public.cold_classroom_purge_resource_inventory(v_operation.classroom_id)
      )
    ) then
      raise exception using errcode = '40001',
        message = 'cold_classroom_purge_resource_inventory_drift';
    end if;

    if exists (
      select 1
      from public.managed_storage_objects object
      left join public.managed_storage_provisional_owners provisional
        on provisional.id = object.provisional_owner_id
      left join public.classroom_purge_objects purge_object
        on purge_object.operation_id = p_operation_id
       and purge_object.managed_storage_object_id = object.id
       and purge_object.status = 'deleted'
      where (object.classroom_id = v_operation.classroom_id
          or provisional.target_classroom_id = v_operation.classroom_id)
        and purge_object.id is null
    ) then
      raise exception using errcode = '40001',
        message = 'cold_classroom_purge_storage_owner_drift';
    end if;

    delete from public.assignment_artifact_storage_cleanup cleanup
    where cleanup.managed_object_id in (
      select managed_storage_object_id from public.classroom_purge_objects
      where operation_id = p_operation_id and managed_storage_object_id is not null
    );
    delete from public.test_document_snapshot_storage_cleanup cleanup
    where cleanup.managed_object_id in (
      select managed_storage_object_id from public.classroom_purge_objects
      where operation_id = p_operation_id and managed_storage_object_id is not null
    );

    delete from public.classroom_archive_restore_staging staging
    where staging.operation_id in (
      select resource_id from public.cold_classroom_purge_resources
      where operation_id = p_operation_id and resource_type = 'archive_operation'
    );
    delete from public.classroom_archive_restore_expected_objects expected
    where expected.operation_id in (
      select resource_id from public.cold_classroom_purge_resources
      where operation_id = p_operation_id and resource_type = 'archive_operation'
    );
    delete from public.classroom_archive_object_upload_cleanup cleanup
    where cleanup.operation_id in (
      select resource_id from public.cold_classroom_purge_resources
      where operation_id = p_operation_id and resource_type = 'archive_operation'
    );
    delete from public.classroom_archive_snapshot_resources snapshot
    where snapshot.operation_id in (
      select resource_id from public.cold_classroom_purge_resources
      where operation_id = p_operation_id and resource_type = 'archive_operation'
    );
    delete from public.classroom_archive_snapshot_actors snapshot
    where snapshot.operation_id in (
      select resource_id from public.cold_classroom_purge_resources
      where operation_id = p_operation_id and resource_type = 'archive_operation'
    );
    delete from public.classroom_gradex_extract_cleanup cleanup
    where cleanup.operation_id in (
      select resource_id from public.cold_classroom_purge_resources
      where operation_id = p_operation_id and resource_type = 'archive_operation'
    );
    delete from public.classroom_archive_source_object_cleanup cleanup
    where cleanup.operation_id in (
      select resource_id from public.cold_classroom_purge_resources
      where operation_id = p_operation_id and resource_type = 'archive_operation'
    );
    delete from public.classroom_archive_source_object_reservations reservation
    where reservation.operation_id in (
      select resource_id from public.cold_classroom_purge_resources
      where operation_id = p_operation_id and resource_type = 'archive_operation'
    );
    delete from public.classroom_gradex_extracts extract
    where extract.id in (
      select resource_id from public.cold_classroom_purge_resources
      where operation_id = p_operation_id and resource_type = 'gradex_extract'
    );

    delete from public.classroom_cold_archive_actors actor
    where actor.classroom_id = v_operation.classroom_id;
    delete from public.cold_classroom_purge_fences fence
    where fence.operation_id = p_operation_id;
    delete from public.classroom_cold_tombstones tombstone
    where tombstone.classroom_id = v_operation.classroom_id;

    delete from public.classroom_archives archive
    where archive.id in (
      select resource_id from public.cold_classroom_purge_resources
      where operation_id = p_operation_id and resource_type = 'archive'
    );
    delete from public.classroom_archive_operations operation
    where operation.id in (
      select resource_id from public.cold_classroom_purge_resources
      where operation_id = p_operation_id and resource_type = 'archive_operation'
    );

    delete from public.managed_storage_objects object
    using public.classroom_purge_objects purge_object
    where purge_object.operation_id = p_operation_id
      and purge_object.managed_storage_object_id = object.id
      and purge_object.status = 'deleted';
    if exists (
      select 1 from public.managed_storage_objects object
      left join public.managed_storage_provisional_owners provisional
        on provisional.id = object.provisional_owner_id
      where object.classroom_id = v_operation.classroom_id
        or provisional.target_classroom_id = v_operation.classroom_id
    ) then
      raise exception using errcode = '40001',
        message = 'cold_classroom_purge_storage_owner_drift';
    end if;
    delete from public.managed_storage_provisional_owners provisional
    where provisional.target_classroom_id = v_operation.classroom_id;

    if exists (
      select 1
      from public.cold_classroom_purge_resource_inventory(v_operation.classroom_id)
    ) then
      raise exception using errcode = '40001',
        message = 'cold_classroom_purge_resource_delete_incomplete';
    end if;

    update public.classroom_purge_operations
    set status = 'completed', classroom_title = null,
        impact_summary = jsonb_build_object(
          'cold_resources_deleted',
            (select coalesce(sum(value::text::integer), 0)
             from jsonb_each(resource_counts)),
          'managed_files_deleted',
            (select count(*) from public.classroom_purge_objects
             where operation_id = p_operation_id),
          'cold_recovery_deleted', true
        ),
        retryable = false, error_code = null,
        completed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_operation_id;
    delete from public.cold_classroom_purge_resources
    where operation_id = p_operation_id;

    return jsonb_build_object(
      'ok', true, 'status', 200, 'operation_id', p_operation_id,
      'operation_status', 'completed', 'replayed', false
    );
  exception when others then
    v_error_code := case
      when sqlstate = '40001' then left(sqlerrm, 120)
      when sqlstate like '23%' then 'cold_classroom_purge_constraint_drift'
      else 'cold_classroom_database_finalize_failed'
    end;
    v_retryable := sqlstate <> '40001' and sqlstate not like '23%';
    update public.classroom_purge_operations
    set status = 'failed', error_code = v_error_code, retryable = v_retryable,
        updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 500, 'error_code', v_error_code,
      'error', 'Permanent deletion paused before cold recovery finalization',
      'retryable', v_retryable
    );
  end;
end;
$$;

-- Extend the common lifecycle fence to cover both mutually exclusive owner
-- representations. Trigger-level writers keep using a nonblocking advisory lock.
create or replace function public.guard_classroom_purge_lifecycle(p_classroom_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_classroom_id is null then return; end if;
  if not public.classroom_purge_try_lock(p_classroom_id) then
    raise exception using errcode = '40001', message = 'classroom_operation_busy';
  end if;
  if exists (
    select 1 from public.classroom_purge_fences where classroom_id = p_classroom_id
  ) or exists (
    select 1 from public.cold_classroom_purge_fences where classroom_id = p_classroom_id
  ) then
    raise exception using errcode = '55000', message = 'classroom_purge_active';
  end if;
end;
$$;

create or replace function public.reject_cold_tombstone_change_during_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'INSERT' then v_old_classroom_id := old.classroom_id; end if;
  if tg_op <> 'DELETE' then v_new_classroom_id := new.classroom_id; end if;
  perform public.guard_classroom_purge_lifecycle(v_old_classroom_id);
  if v_new_classroom_id is distinct from v_old_classroom_id then
    perform public.guard_classroom_purge_lifecycle(v_new_classroom_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists classroom_purge_fence_cold_tombstones
  on public.classroom_cold_tombstones;
create trigger classroom_purge_fence_cold_tombstones
before insert or update or delete on public.classroom_cold_tombstones
for each row execute function public.reject_cold_tombstone_change_during_purge();

-- Storage deletion remains authorized only by an exact live purge lease or the
-- independent managed-cleanup lease. Cold and hot fences are checked separately.
create or replace function public.enforce_managed_storage_object_delete()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_enforced boolean;
  v_object public.managed_storage_objects;
  v_referenced boolean;
begin
  if old.bucket_id not in (
    'assignment-artifacts', 'submission-images', 'test-documents',
    'classroom-archives', 'gradex-analytics-extracts'
  ) then return old; end if;
  v_enforced := public.lock_managed_storage_protocol();
  select * into v_object from public.managed_storage_objects object
  where object.storage_bucket = old.bucket_id and object.storage_path = old.name
  for update;
  perform public.managed_storage_exact_lock(old.bucket_id, old.name);
  if v_object.id is not null and (
    exists (
      select 1 from public.classroom_purge_objects purge_object
      join public.classroom_purge_operations operation
        on operation.id = purge_object.operation_id
      where purge_object.managed_storage_object_id = v_object.id
        and purge_object.status = 'processing'
        and purge_object.lease_expires_at > clock_timestamp()
        and operation.status in ('deleting_objects', 'failed')
        and (
          exists (
            select 1 from public.classroom_purge_fences fence
            where fence.operation_id = operation.id
              and fence.classroom_id = operation.classroom_id
              and operation.purge_scope = 'hot_classroom'
          )
          or exists (
            select 1 from public.cold_classroom_purge_fences fence
            where fence.operation_id = operation.id
              and fence.classroom_id = operation.classroom_id
              and operation.purge_scope = 'cold_classroom'
          )
        )
    ) or exists (
      select 1 from public.course_blueprint_purge_objects purge_object
      join public.course_blueprint_purge_operations operation
        on operation.id = purge_object.operation_id
      join public.course_blueprint_purge_fences fence
        on fence.operation_id = operation.id
       and fence.course_blueprint_id = operation.course_blueprint_id
      where purge_object.managed_storage_object_id = v_object.id
        and purge_object.status = 'processing'
        and purge_object.lease_expires_at > clock_timestamp()
        and (operation.status = 'deleting_objects'
          or (operation.status = 'failed' and operation.retryable is true))
    )
  ) then return old; end if;
  if v_object.id is null then
    if not v_enforced then return old; end if;
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_authority_required';
  end if;
  if v_object.status <> 'cleanup_processing' then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_authority_required';
  end if;
  v_referenced := public.managed_storage_object_is_referenced(v_object.id)
    or case v_object.storage_bucket
      when 'assignment-artifacts' then exists (
        select 1 from public.assignment_submission_artifacts reference
        where reference.storage_path = v_object.storage_path
      )
      when 'test-documents' then
        public.test_document_snapshot_path_is_referenced(v_object.storage_path)
      else false
    end;
  if v_referenced then
    raise exception using errcode = '55000', message = 'managed_storage_cleanup_referenced';
  end if;
  return old;
end;
$$;

-- Migration 121's aggregate remains the stable response contract. Wrap it so a
-- valid cold fence satisfies the shared Classroom operation finding, while a
-- stale cold fence is counted alongside a stale hot fence.
alter function public.get_managed_deletion_health_snapshot(integer)
  rename to get_managed_deletion_health_snapshot_v121;

create function public.get_managed_deletion_health_snapshot(
  p_stuck_after_seconds integer default 3600
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_valid_cold_fences bigint;
  v_orphan_cold_fences bigint;
  v_active_without_fence bigint;
  v_fences_without_active bigint;
  v_critical_count bigint;
begin
  v_snapshot := public.get_managed_deletion_health_snapshot_v121(
    p_stuck_after_seconds
  );
  select count(*) into v_valid_cold_fences
  from public.classroom_purge_operations operation
  join public.cold_classroom_purge_fences fence
    on fence.operation_id = operation.id
   and fence.classroom_id = operation.classroom_id
  where operation.status <> 'completed'
    and operation.purge_scope = 'cold_classroom';
  select count(*) into v_orphan_cold_fences
  from public.cold_classroom_purge_fences fence
  left join public.classroom_purge_operations operation
    on operation.id = fence.operation_id
  where operation.id is null or operation.status = 'completed'
    or operation.purge_scope <> 'cold_classroom';

  v_active_without_fence := greatest(0,
    (v_snapshot #>> '{operations,classroom,active_operations_without_fence}')::bigint
      - v_valid_cold_fences
  );
  v_fences_without_active :=
    (v_snapshot #>> '{operations,classroom,fences_without_active_operation}')::bigint
      + v_orphan_cold_fences;
  v_critical_count := greatest(0,
    (v_snapshot->>'critical_count')::bigint
      - v_valid_cold_fences + v_orphan_cold_fences
  );

  v_snapshot := jsonb_set(v_snapshot,
    '{operations,classroom,active_operations_without_fence}',
    to_jsonb(v_active_without_fence));
  v_snapshot := jsonb_set(v_snapshot,
    '{operations,classroom,fences_without_active_operation}',
    to_jsonb(v_fences_without_active));
  v_snapshot := jsonb_set(v_snapshot, '{critical_count}', to_jsonb(v_critical_count));
  v_snapshot := jsonb_set(v_snapshot, '{healthy}', to_jsonb(v_critical_count = 0));
  return v_snapshot;
end;
$$;

revoke all on function public.cold_classroom_purge_rollout_allows(uuid, uuid),
  public.cold_classroom_purge_resource_inventory(uuid),
  public.cold_classroom_purge_resource_inventory_sha256(uuid),
  public.get_cold_archived_classroom_purge_inventory(uuid, uuid, uuid),
  public.begin_cold_archived_classroom_purge(uuid, uuid, uuid, uuid, text, jsonb),
  public.claim_cold_classroom_purge_object(uuid, uuid, uuid, integer),
  public.finalize_cold_archived_classroom_purge(uuid, uuid),
  public.get_managed_deletion_health_snapshot(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_managed_deletion_health_snapshot_v121(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.reject_cold_tombstone_change_during_purge()
  from public, anon, authenticated, service_role;

grant execute on function public.get_cold_archived_classroom_purge_inventory(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.begin_cold_archived_classroom_purge(
  uuid, uuid, uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.claim_cold_classroom_purge_object(
  uuid, uuid, uuid, integer
) to service_role;
grant execute on function public.finalize_cold_archived_classroom_purge(
  uuid, uuid
) to service_role;
grant execute on function public.get_managed_deletion_health_snapshot(integer)
  to service_role;

comment on table public.cold_classroom_purge_settings is
  'Independent disabled-by-default rollout gate for cold archived Classroom deletion.';
comment on table public.cold_classroom_purge_fences is
  'Cold tombstone lifecycle fence retained until exact-object deletion finalizes.';
comment on table public.cold_classroom_purge_resources is
  'Privacy-safe exact operational identity snapshot for cold Classroom deletion.';
comment on function public.finalize_cold_archived_classroom_purge(uuid, uuid) is
  'Explicit cold metadata finalizer; runs only after every exact managed object is absent.';
