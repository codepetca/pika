-- Migration 119: permanent deletion for teacher-owned hot archived classrooms.
--
-- Migration 117 is the sole managed-file ownership authority. This migration
-- adds only the deletion state machine: exact ownership snapshots, leases,
-- storage-delete authority, relational reconciliation, and disabled-by-default
-- rollout gates. It deliberately contains no path discovery or backfill logic.

create table public.classroom_purge_settings (
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

insert into public.classroom_purge_settings (singleton) values (true);
alter table public.classroom_purge_settings enable row level security;
revoke all on table public.classroom_purge_settings
  from public, anon, authenticated, service_role;
grant select on table public.classroom_purge_settings to service_role;

-- Migration 115 was deployed before exact managed-object ownership existed.
-- Never reinterpret an unfinished path-ledger operation as a managed-ID purge:
-- an operator must reconcile it under the migration-115 runbook first.
do $$
begin
  if exists (
    select 1 from public.classroom_purge_operations where status <> 'completed'
  ) then
    raise exception using
      errcode = '55000',
      message = 'unfinished_legacy_classroom_purge_operations';
  end if;
end;
$$;

-- These ledgers constitute deletion authority. The application may inspect
-- them with service_role, but only security-definer purge RPCs may mutate them.
revoke all on table public.classroom_purge_operations
  from service_role;
revoke all on table public.classroom_purge_resources
  from service_role;
revoke all on table public.classroom_purge_objects
  from service_role;
revoke all on table public.classroom_purge_fences
  from service_role;
grant select on table public.classroom_purge_operations to service_role;
grant select on table public.classroom_purge_resources to service_role;
grant select on table public.classroom_purge_objects to service_role;
grant select on table public.classroom_purge_fences to service_role;

alter table public.classroom_purge_objects
  add column managed_storage_object_id uuid
    references public.managed_storage_objects (id) on delete set null;

create unique index classroom_purge_objects_exact_managed_object
  on public.classroom_purge_objects (operation_id, managed_storage_object_id)
  where managed_storage_object_id is not null;

create index classroom_purge_objects_path_reservation
  on public.classroom_purge_objects (storage_bucket, storage_path_sha256);

-- Trigger-level writers may already hold a row lock before their BEFORE
-- trigger runs. They must never wait for the lifecycle lock that purge startup
-- takes before row locks; fail retryably instead and release the row.
create or replace function public.classroom_purge_try_lock(p_classroom_id uuid)
returns boolean
language sql
set search_path = ''
as $$
  select pg_try_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || p_classroom_id::text, 0)
  )
$$;

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
  ) then
    raise exception using errcode = '55000', message = 'classroom_purge_active';
  end if;
end;
$$;

create or replace function public.reject_classroom_resource_change_during_purge()
returns trigger
language plpgsql
security definer
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
  end if;
  perform public.guard_classroom_purge_lifecycle(v_old_classroom_id);
  if v_new_classroom_id is distinct from v_old_classroom_id then
    perform public.guard_classroom_purge_lifecycle(v_new_classroom_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.reject_classroom_operation_during_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_classroom_id uuid;
  v_classroom_ids uuid[];
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'classroom_archive_operations' then
    v_classroom_ids := array[
      case when tg_op <> 'INSERT' then old.classroom_id end,
      case when tg_op <> 'DELETE' then new.classroom_id end
    ];
  elsif tg_table_name = 'course_blueprint_operations' then
    v_classroom_ids := array[
      case when tg_op <> 'INSERT' then old.source_classroom_id end,
      case when tg_op <> 'INSERT' then old.result_classroom_id end,
      case when tg_op <> 'DELETE' then new.source_classroom_id end,
      case when tg_op <> 'DELETE' then new.result_classroom_id end
    ];
  elsif tg_table_name = 'course_blueprint_change_proposals' then
    v_classroom_ids := array[
      case when tg_op <> 'INSERT' then old.source_classroom_id end,
      case when tg_op <> 'INSERT' then old.target_classroom_id end,
      case when tg_op <> 'DELETE' then new.source_classroom_id end,
      case when tg_op <> 'DELETE' then new.target_classroom_id end
    ];
  elsif tg_table_name = 'course_blueprint_editing_sessions' then
    v_classroom_ids := array[
      case when tg_op <> 'INSERT' then old.classroom_id end,
      case when tg_op <> 'DELETE' then new.classroom_id end
    ];
  elsif tg_table_name in (
    'classroom_archives', 'classroom_gradex_extracts',
    'classroom_archive_source_object_cleanup'
  ) then
    v_classroom_ids := array[
      case when tg_op <> 'INSERT' then old.classroom_id end,
      case when tg_op <> 'DELETE' then new.classroom_id end
    ];
  elsif tg_table_name in (
    'classroom_archive_object_upload_cleanup',
    'classroom_archive_snapshot_resources',
    'classroom_archive_snapshot_actors',
    'classroom_archive_restore_staging',
    'classroom_archive_restore_expected_objects',
    'classroom_archive_source_object_reservations',
    'classroom_gradex_extract_cleanup'
  ) then
    select array_agg(distinct operation.classroom_id order by operation.classroom_id)
    into v_classroom_ids
    from public.classroom_archive_operations operation
    where operation.id = any(array[
      case when tg_op <> 'INSERT' then old.operation_id end,
      case when tg_op <> 'DELETE' then new.operation_id end
    ]);
  end if;
  for v_classroom_id in
    select distinct candidate from unnest(coalesce(v_classroom_ids, array[]::uuid[])) candidate
    where candidate is not null order by candidate
  loop
    perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists classroom_purge_fence_archive_operations
  on public.classroom_archive_operations;
drop trigger if exists classroom_purge_fence_blueprint_operations
  on public.course_blueprint_operations;
drop trigger if exists classroom_purge_fence_blueprint_proposals
  on public.course_blueprint_change_proposals;
drop trigger if exists classroom_purge_fence_blueprint_sessions
  on public.course_blueprint_editing_sessions;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'classroom_archive_operations',
    'course_blueprint_operations',
    'course_blueprint_change_proposals',
    'course_blueprint_editing_sessions',
    'classroom_archives',
    'classroom_gradex_extracts',
    'classroom_archive_object_upload_cleanup',
    'classroom_archive_snapshot_resources',
    'classroom_archive_snapshot_actors',
    'classroom_archive_restore_staging',
    'classroom_archive_restore_expected_objects',
    'classroom_archive_source_object_reservations',
    'classroom_gradex_extract_cleanup',
    'classroom_archive_source_object_cleanup'
  ]
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      'classroom_purge_fence_' || v_table, v_table
    );
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      || 'for each row execute function public.reject_classroom_operation_during_purge()',
      'classroom_purge_fence_' || v_table, v_table
    );
  end loop;
end;
$$;

-- Save-operation telemetry is classroom-owned but intentionally excluded from
-- the portable archive format. Make its ownership structural before deletion
-- is enabled so it cannot survive its assignment document.
delete from public.assignment_doc_save_operations operation
where not exists (
  select 1 from public.assignment_docs document
  where document.id = operation.assignment_doc_id
);

alter table public.assignment_doc_save_operations
  drop constraint if exists assignment_doc_save_operations_assignment_doc_id_fkey;
alter table public.assignment_doc_save_operations
  add constraint assignment_doc_save_operations_assignment_doc_id_fkey
  foreign key (assignment_doc_id)
  references public.assignment_docs (id)
  on delete cascade;

create index if not exists idx_assignment_doc_save_operations_assignment_doc
  on public.assignment_doc_save_operations (assignment_doc_id);

create or replace function public.guard_assignment_doc_save_operation_during_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document_id uuid;
  v_classroom_id uuid;
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  for v_document_id in
    select distinct candidate
    from unnest(array[
      case when tg_op <> 'INSERT' then old.assignment_doc_id end,
      case when tg_op <> 'DELETE' then new.assignment_doc_id end
    ]) candidate
    where candidate is not null
  loop
    select assignment.classroom_id into v_classroom_id
    from public.assignment_docs document
    join public.assignments assignment on assignment.id = document.assignment_id
    where document.id = v_document_id;
    if not found then
      if tg_op = 'DELETE' then continue; end if;
      raise exception using errcode = '23503', message = 'assignment_doc_not_found';
    end if;
    perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger assignment_doc_save_operation_purge_fence
before insert or update or delete on public.assignment_doc_save_operations
for each row execute function public.guard_assignment_doc_save_operation_during_purge();

create or replace function public.guard_managed_cleanup_ledger_during_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_classroom_id uuid;
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  for v_classroom_id in
    select distinct coalesce(object.classroom_id, provisional.target_classroom_id)
    from public.managed_storage_objects object
    left join public.managed_storage_provisional_owners provisional
      on provisional.id = object.provisional_owner_id
    where object.id = any(array[
      case when tg_op <> 'INSERT' then old.managed_object_id end,
      case when tg_op <> 'DELETE' then new.managed_object_id end
    ])
      and coalesce(object.classroom_id, provisional.target_classroom_id) is not null
    order by coalesce(object.classroom_id, provisional.target_classroom_id)
  loop
    perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger assignment_artifact_cleanup_purge_fence
before insert or update or delete on public.assignment_artifact_storage_cleanup
for each row execute function public.guard_managed_cleanup_ledger_during_purge();
create trigger test_document_cleanup_purge_fence
before insert or update or delete on public.test_document_snapshot_storage_cleanup
for each row execute function public.guard_managed_cleanup_ledger_during_purge();

create or replace function public.classroom_purge_rollout_allows(
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
  from public.classroom_purge_settings settings
  where settings.singleton
$$;

create or replace function public.classroom_purge_storage_inventory_sha256(
  p_classroom_id uuid
)
returns text
language sql
stable
set search_path = public
as $$
  select encode(extensions.digest(convert_to(coalesce(jsonb_agg(
    jsonb_build_array(
      inventory.id,
      inventory.storage_bucket,
      inventory.storage_path,
      inventory.status,
      inventory.classroom_id,
      inventory.provisional_owner_id
    ) order by inventory.id
  ), '[]'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
  from (
    select object.id, object.storage_bucket, object.storage_path, object.status,
      object.classroom_id, object.provisional_owner_id
    from public.managed_storage_objects object
    left join public.managed_storage_provisional_owners provisional
      on provisional.id = object.provisional_owner_id
    where object.classroom_id = p_classroom_id
      or provisional.target_classroom_id = p_classroom_id
  ) inventory
$$;

create or replace function public.classroom_purge_conflict(p_classroom_id uuid)
returns text
language plpgsql
volatile
set search_path = public
as $$
begin
  if exists (
    select 1 from public.classroom_archive_operations operation
    where operation.classroom_id = p_classroom_id
      and (
        (operation.status = 'snapshot_ready'
          and operation.snapshot_expires_at > clock_timestamp())
        or (operation.status = 'failed' and operation.retryable is true
          and operation.snapshot_expires_at > clock_timestamp())
      )
  ) then return 'classroom_archive_operation_active'; end if;

  if exists (
    select 1 from public.classroom_archive_object_upload_cleanup cleanup
    join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
    where operation.classroom_id = p_classroom_id
      and cleanup.status = 'processing'
      and cleanup.lease_expires_at > clock_timestamp()
  ) or exists (
    select 1 from public.classroom_gradex_extract_cleanup cleanup
    join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
    where operation.classroom_id = p_classroom_id
      and cleanup.status = 'processing'
      and cleanup.lease_expires_at > clock_timestamp()
  ) or exists (
    select 1 from public.classroom_archive_source_object_cleanup cleanup
    where cleanup.classroom_id = p_classroom_id
      and cleanup.status = 'processing'
      and cleanup.lease_expires_at > clock_timestamp()
  ) or exists (
    select 1 from public.managed_storage_objects object
    left join public.managed_storage_provisional_owners provisional
      on provisional.id = object.provisional_owner_id
    where (object.classroom_id = p_classroom_id
        or provisional.target_classroom_id = p_classroom_id)
      and (
        (object.status = 'cleanup_processing'
          and object.lease_expires_at > clock_timestamp())
        or (object.status in ('reserved', 'verified')
          and object.reservation_expires_at > clock_timestamp())
      )
  ) or exists (
    select 1 from public.managed_storage_provisional_owners provisional
    where provisional.target_classroom_id = p_classroom_id
      and provisional.adopted_at is null
      and provisional.expires_at > clock_timestamp()
  ) then return 'classroom_storage_operation_active'; end if;

  if exists (
    select 1 from public.assignment_ai_grading_runs run
    join public.assignments assignment on assignment.id = run.assignment_id
    where assignment.classroom_id = p_classroom_id
      and run.status in ('queued', 'running')
  ) or exists (
    select 1 from public.assignment_repo_review_runs run
    join public.assignments assignment on assignment.id = run.assignment_id
    where assignment.classroom_id = p_classroom_id
      and run.status in ('queued', 'running')
  ) or exists (
    select 1 from public.test_ai_grading_runs run
    join public.tests test on test.id = run.test_id
    where test.classroom_id = p_classroom_id
      and run.status in ('queued', 'running')
  ) then return 'classroom_grading_operation_active'; end if;

  if exists (
    select 1 from public.course_blueprint_operations operation
    where operation.status = 'running'
      and (operation.source_classroom_id = p_classroom_id
        or operation.result_classroom_id = p_classroom_id)
  ) or exists (
    select 1 from public.course_blueprint_change_proposals proposal
    where proposal.status in ('ready', 'needs_review', 'conflicted')
      and (proposal.source_classroom_id = p_classroom_id
        or proposal.target_classroom_id = p_classroom_id)
  ) or exists (
    select 1 from public.course_blueprint_editing_sessions session
    where session.status = 'ready'
      and session.expires_at > clock_timestamp()
      and session.classroom_id = p_classroom_id
  ) then return 'classroom_blueprint_operation_active'; end if;

  return null;
end;
$$;

create or replace function public.get_hot_archived_classroom_purge_inventory(
  p_teacher_id uuid,
  p_classroom_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_teacher_id uuid;
  v_title text;
  v_archived_at timestamptz;
  v_revision bigint;
  v_mode text;
  v_conflict text;
  v_digest text;
  v_count integer;
  v_bytes bigint;
  v_missing integer;
  v_archives integer;
  v_gradex integer;
  v_interrupted integer;
  v_storage_counts jsonb;
  v_operational_counts jsonb;
  v_operational_digest text;
  v_allowed boolean;
begin
  select classroom.teacher_id, classroom.title, classroom.archived_at, revision.revision
  into v_teacher_id, v_title, v_archived_at, v_revision
  from public.classrooms classroom
  join public.classroom_archive_revisions revision on revision.classroom_id = classroom.id
  where classroom.id = p_classroom_id;
  if not found or v_teacher_id <> p_teacher_id then
    return jsonb_build_object(
      'ok', false, 'status', 404, 'error_code', 'classroom_not_found',
      'error', 'Classroom not found'
    );
  end if;
  if v_archived_at is null then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_not_hot_archived',
      'error', 'Only archived classrooms stored in Pika can be permanently deleted'
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

  select mode into strict v_mode from public.managed_storage_settings where singleton;
  v_allowed := public.classroom_purge_rollout_allows(p_teacher_id, p_classroom_id);
  v_conflict := public.classroom_purge_conflict(p_classroom_id);
  v_digest := public.classroom_purge_storage_inventory_sha256(p_classroom_id);

  with inventory as (
    select object.*
    from public.managed_storage_objects object
    left join public.managed_storage_provisional_owners provisional
      on provisional.id = object.provisional_owner_id
    where object.classroom_id = p_classroom_id
      or provisional.target_classroom_id = p_classroom_id
  )
  select
    count(*)::integer,
    coalesce(sum(coalesce(inventory.byte_size, 0)), 0)::bigint,
    count(*) filter (where stored.id is null)::integer,
    count(*) filter (where inventory.storage_bucket = 'classroom-archives')::integer,
    count(*) filter (where inventory.storage_bucket = 'gradex-analytics-extracts')::integer,
    count(*) filter (where inventory.status <> 'ready')::integer
  into v_count, v_bytes, v_missing, v_archives, v_gradex, v_interrupted
  from inventory
  left join storage.objects stored
    on stored.bucket_id = inventory.storage_bucket
   and stored.name = inventory.storage_path;

  select coalesce(jsonb_object_agg(counts.storage_bucket, counts.object_count), '{}'::jsonb)
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

  with operation_ids as (
    select id from public.classroom_archive_operations
    where classroom_id = p_classroom_id
  ), owned_objects as (
    select object.id
    from public.managed_storage_objects object
    left join public.managed_storage_provisional_owners provisional
      on provisional.id = object.provisional_owner_id
    where object.classroom_id = p_classroom_id
      or provisional.target_classroom_id = p_classroom_id
  ), counts(table_name, row_count) as (
    select 'classroom_archive_operations', count(*)::integer from operation_ids
    union all select 'classroom_archive_object_upload_cleanup', count(*)::integer
      from public.classroom_archive_object_upload_cleanup
      where operation_id in (select id from operation_ids)
    union all select 'classroom_archive_snapshot_resources', count(*)::integer
      from public.classroom_archive_snapshot_resources
      where operation_id in (select id from operation_ids)
    union all select 'classroom_archive_snapshot_actors', count(*)::integer
      from public.classroom_archive_snapshot_actors
      where operation_id in (select id from operation_ids)
    union all select 'classroom_archive_restore_staging', count(*)::integer
      from public.classroom_archive_restore_staging
      where operation_id in (select id from operation_ids)
    union all select 'classroom_archive_restore_expected_objects', count(*)::integer
      from public.classroom_archive_restore_expected_objects
      where operation_id in (select id from operation_ids)
    union all select 'classroom_archive_source_object_cleanup', count(*)::integer
      from public.classroom_archive_source_object_cleanup
      where classroom_id = p_classroom_id
    union all select 'classroom_archive_source_object_reservations', count(*)::integer
      from public.classroom_archive_source_object_reservations
      where operation_id in (select id from operation_ids)
    union all select 'classroom_archives', count(*)::integer
      from public.classroom_archives where classroom_id = p_classroom_id
    union all select 'classroom_gradex_extracts', count(*)::integer
      from public.classroom_gradex_extracts where classroom_id = p_classroom_id
    union all select 'classroom_gradex_extract_cleanup', count(*)::integer
      from public.classroom_gradex_extract_cleanup
      where operation_id in (select id from operation_ids)
    union all select 'assignment_artifact_storage_cleanup', count(*)::integer
      from public.assignment_artifact_storage_cleanup
      where managed_object_id in (select id from owned_objects)
    union all select 'test_document_snapshot_storage_cleanup', count(*)::integer
      from public.test_document_snapshot_storage_cleanup
      where managed_object_id in (select id from owned_objects)
  )
  select coalesce(
    jsonb_object_agg(table_name, row_count order by table_name), '{}'::jsonb
  ) into v_operational_counts from counts;
  v_operational_digest := encode(extensions.digest(
    convert_to(v_operational_counts::text, 'UTF8'), 'sha256'
  ), 'hex');

  return jsonb_build_object(
    'ok', true,
    'status', 200,
    'classroom_id', p_classroom_id,
    'classroom_title', v_title,
    'source_revision', v_revision,
    'storage_inventory_sha256', v_digest,
    'managed_file_count', v_count,
    'managed_file_bytes', v_bytes,
    'missing_file_count', v_missing,
    'archive_count', v_archives,
    'gradex_extract_count', v_gradex,
    'interrupted_upload_count', v_interrupted,
    'storage_counts', v_storage_counts,
    'operational_counts', v_operational_counts,
    'operational_inventory_sha256', v_operational_digest,
    'conflicting_operation', v_conflict,
    'deletion_available', v_mode = 'enforced' and v_allowed and v_conflict is null,
    'unavailable_reason', case
      when v_mode <> 'enforced' then 'Managed file ownership enforcement is not enabled.'
      when not v_allowed then 'Permanent classroom deletion is not enabled.'
      when v_conflict is not null then 'Finish the active classroom operation before deleting permanently.'
      else null
    end
  );
end;
$$;

-- Serialize managed-object creation, owner adoption, and generic cleanup with
-- the classroom purge fence. Provisional restore/copy owners are included.
create or replace function public.reject_managed_storage_change_during_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_classroom_id uuid;
  v_new_classroom_id uuid;
begin
  if current_setting('pika.classroom_purge_begin', true) = 'on'
    or current_setting('pika.classroom_purge_finalize', true) = 'on'
  then return case when tg_op = 'DELETE' then old else new end; end if;

  if tg_op <> 'DELETE' and exists (
    select 1 from public.classroom_purge_objects purge_object
    where purge_object.storage_bucket = new.storage_bucket
      and purge_object.storage_path_sha256 =
        public.managed_storage_identity_sha256(new.storage_bucket, new.storage_path)
  ) then
    raise exception using errcode = '55000', message = 'classroom_purge_path_reserved';
  end if;

  if tg_op <> 'INSERT' then
    v_old_classroom_id := old.classroom_id;
    if v_old_classroom_id is null and old.provisional_owner_id is not null then
      select target_classroom_id into v_old_classroom_id
      from public.managed_storage_provisional_owners
      where id = old.provisional_owner_id;
    end if;
  end if;
  if tg_op <> 'DELETE' then
    v_new_classroom_id := new.classroom_id;
    if v_new_classroom_id is null and new.provisional_owner_id is not null then
      select target_classroom_id into v_new_classroom_id
      from public.managed_storage_provisional_owners
      where id = new.provisional_owner_id;
    end if;
  end if;

  if v_old_classroom_id is not null then
    perform public.guard_classroom_purge_lifecycle(v_old_classroom_id);
  end if;
  if v_new_classroom_id is not null
    and v_new_classroom_id is distinct from v_old_classroom_id
  then
    perform public.guard_classroom_purge_lifecycle(v_new_classroom_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger managed_storage_classroom_purge_fence
before insert or update or delete on public.managed_storage_objects
for each row execute function public.reject_managed_storage_change_during_purge();

create or replace function public.reject_provisional_owner_change_during_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_classroom_id uuid;
begin
  if current_setting('pika.classroom_purge_begin', true) = 'on'
    or current_setting('pika.classroom_purge_finalize', true) = 'on'
  then return case when tg_op = 'DELETE' then old else new end; end if;
  for v_classroom_id in
    select distinct candidate from unnest(array[
      case when tg_op <> 'INSERT' then old.target_classroom_id end,
      case when tg_op <> 'DELETE' then new.target_classroom_id end
    ]) candidate where candidate is not null
  loop
    perform public.guard_classroom_purge_lifecycle(v_classroom_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger managed_storage_provisional_owner_purge_fence
before insert or update or delete on public.managed_storage_provisional_owners
for each row execute function public.reject_provisional_owner_change_during_purge();

-- Reserve every purged identity permanently. A deleted classroom path cannot
-- be recreated under a new owner after its managed row is removed.
create or replace function public.enforce_managed_storage_object_write()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_enforced boolean;
  v_object public.managed_storage_objects;
begin
  if new.bucket_id not in (
    'assignment-artifacts', 'submission-images', 'test-documents',
    'classroom-archives', 'gradex-analytics-extracts'
  ) then return new; end if;
  v_enforced := public.lock_managed_storage_protocol();
  perform public.managed_storage_exact_lock(new.bucket_id, new.name);
  if exists (
    select 1 from public.classroom_purge_objects purge_object
    where purge_object.storage_bucket = new.bucket_id
      and purge_object.storage_path_sha256 =
        public.managed_storage_identity_sha256(new.bucket_id, new.name)
  ) then
    raise exception using errcode = '55000', message = 'classroom_purge_path_reserved';
  end if;
  select * into v_object from public.managed_storage_objects
  where storage_bucket = new.bucket_id and storage_path = new.name
  for update;
  if not v_enforced then
    if v_object.id is not null
      and v_object.status in ('cleanup_pending', 'cleanup_processing', 'deleted')
    then
      raise exception using errcode = '55000', message = 'managed_storage_cleanup_in_progress';
    end if;
    return new;
  end if;
  if v_object.id is null or v_object.status not in ('reserved', 'verified', 'ready') then
    raise exception using errcode = '55000', message = 'managed_storage_reservation_required';
  end if;
  if tg_op = 'UPDATE' and (old.bucket_id, old.name) is distinct from (new.bucket_id, new.name) then
    raise exception using errcode = '55000', message = 'managed_storage_identity_immutable';
  end if;
  return new;
end;
$$;

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
  if v_object.id is not null and exists (
    select 1 from public.classroom_purge_objects purge_object
    join public.classroom_purge_operations operation
      on operation.id = purge_object.operation_id
    join public.classroom_purge_fences fence
      on fence.operation_id = operation.id
     and fence.classroom_id = operation.classroom_id
    where purge_object.managed_storage_object_id = v_object.id
      and purge_object.status = 'processing'
      and purge_object.lease_expires_at > clock_timestamp()
      and operation.status in ('deleting_objects', 'failed')
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
  v_digest text;
  v_counts jsonb;
  v_storage_counts jsonb;
  v_operational_counts jsonb;
  v_operational_digest text;
  v_conflict text;
  v_enforced boolean;
begin
  if p_request_sha256 !~ '^[a-f0-9]{64}$'
    or p_impact_summary is null
    or jsonb_typeof(p_impact_summary) <> 'object'
    or not coalesce(p_impact_summary->>'source_revision' ~ '^[1-9][0-9]{0,17}$', false)
    or not coalesce(p_impact_summary->>'storage_inventory_sha256' ~ '^[a-f0-9]{64}$', false)
    or not coalesce(p_impact_summary->>'operational_inventory_sha256' ~ '^[a-f0-9]{64}$', false)
  then raise exception using errcode = '22023', message = 'invalid_classroom_purge_request'; end if;

  v_enforced := public.lock_managed_storage_protocol();
  perform 1 from public.classroom_purge_settings where singleton for share;
  if not v_enforced then
    return jsonb_build_object(
      'ok', false, 'status', 503,
      'error_code', 'managed_storage_enforcement_required',
      'error', 'Managed storage ownership enforcement is not enabled'
    );
  end if;
  if not public.classroom_purge_rollout_allows(p_teacher_id, p_classroom_id) then
    return jsonb_build_object(
      'ok', false, 'status', 503, 'error_code', 'classroom_purge_disabled',
      'error', 'Permanent classroom deletion is not enabled'
    );
  end if;

  select * into v_operation from public.classroom_purge_operations
  where id = p_operation_id;
  if found and v_operation.status = 'completed' then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.request_sha256 <> p_request_sha256
    then
      return jsonb_build_object(
        'ok', false, 'status', 409, 'error_code', 'idempotency_conflict',
        'error', 'Idempotency key was already used for a different deletion request'
      );
    end if;
    return jsonb_build_object(
      'ok', true, 'status', 200, 'operation_id', p_operation_id,
      'operation_status', 'completed', 'replayed', true
    );
  end if;

  perform public.classroom_purge_lock(p_classroom_id);
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

  select * into v_operation from public.classroom_purge_operations
  where id = p_operation_id for update;
  if found then
    if v_operation.teacher_id <> p_teacher_id
      or v_operation.classroom_id <> p_classroom_id
      or v_operation.request_sha256 <> p_request_sha256
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
      'ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', v_operation.status, 'replayed', true
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

  v_digest := public.classroom_purge_storage_inventory_sha256(p_classroom_id);
  if v_revision <> (p_impact_summary->>'source_revision')::bigint
    or v_digest <> p_impact_summary->>'storage_inventory_sha256'
  then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_purge_inventory_changed',
      'error', 'Classroom data changed after the deletion impact was confirmed'
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
    select 1 from public.classroom_purge_fences where classroom_id = p_classroom_id
  ) then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_purge_active',
      'error', 'Permanent deletion is already active for this classroom'
    );
  end if;

  v_operational_counts := public.get_hot_archived_classroom_purge_inventory(
    p_teacher_id, p_classroom_id
  )->'operational_counts';
  v_operational_digest := encode(extensions.digest(
    convert_to(v_operational_counts::text, 'UTF8'), 'sha256'
  ), 'hex');
  if v_operational_digest <> p_impact_summary->>'operational_inventory_sha256' then
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_purge_inventory_changed',
      'error', 'Classroom operations changed after the deletion impact was confirmed'
    );
  end if;

  insert into public.classroom_purge_operations (
    id, teacher_id, classroom_id, classroom_title, request_sha256,
    status, source_revision, impact_summary
  ) values (
    p_operation_id, p_teacher_id, p_classroom_id, v_title, p_request_sha256,
    'inventorying', v_revision, p_impact_summary
  );
  insert into public.classroom_purge_fences (classroom_id, operation_id, teacher_id)
  values (p_classroom_id, p_operation_id, p_teacher_id);
  perform set_config('pika.classroom_purge_begin', 'on', true);

  insert into public.classroom_purge_resources (operation_id, table_name, row_id)
  values (p_operation_id, 'classrooms', p_classroom_id);
  for v_resource in
    select table_name, primary_key_columns[1] primary_key_column,
      parent_table, parent_column
    from public.classroom_archive_resource_contract
    where table_name <> 'classrooms'
    order by export_position
  loop
    execute format(
      'insert into public.classroom_purge_resources (operation_id, table_name, row_id)
       select $1, $2, child.%I
       from public.%I child
       join public.classroom_purge_resources parent
         on parent.operation_id = $1 and parent.table_name = $3
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
  select p_operation_id, object.storage_bucket, object.storage_path,
    public.managed_storage_identity_sha256(object.storage_bucket, object.storage_path),
    'delete', 'pending', object.id
  from public.managed_storage_objects object
  left join public.managed_storage_provisional_owners provisional
    on provisional.id = object.provisional_owner_id
  where object.classroom_id = p_classroom_id
    or provisional.target_classroom_id = p_classroom_id;

  select jsonb_object_agg(
    catalog.table_name, coalesce(counts.row_count, 0) order by catalog.export_position
  ) into v_counts
  from (
    select table_name, export_position from public.classroom_archive_resource_contract
  ) catalog
  left join (
    select table_name, count(*)::integer row_count
    from public.classroom_purge_resources
    where operation_id = p_operation_id group by table_name
  ) counts on counts.table_name = catalog.table_name;
  v_counts := v_counts || jsonb_build_object(
    'assignment_doc_save_operations',
    (
      select count(*)::integer
      from public.assignment_doc_save_operations operation
      join public.classroom_purge_resources document
        on document.operation_id = p_operation_id
       and document.table_name = 'assignment_docs'
       and document.row_id = operation.assignment_doc_id
    )
  );
  v_counts := v_counts || v_operational_counts;

  select coalesce(jsonb_object_agg(storage_bucket, object_count), '{}'::jsonb)
  into v_storage_counts
  from (
    select storage_bucket, count(*)::integer object_count
    from public.classroom_purge_objects
    where operation_id = p_operation_id group by storage_bucket
  ) counts;

  update public.classroom_purge_operations
  set status = 'deleting_objects', resource_counts = v_counts,
      storage_object_counts = v_storage_counts,
      inventory_completed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_operation_id;
  return jsonb_build_object(
    'ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', 'deleting_objects', 'source_revision', v_revision,
    'resource_counts', v_counts, 'storage_object_counts', v_storage_counts,
    'replayed', false
  );
exception when unique_violation then
  return jsonb_build_object(
    'ok', false, 'status', 409, 'error_code', 'classroom_purge_active',
    'error', 'Permanent deletion is already active for this classroom'
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
  v_operation public.classroom_purge_operations;
  v_object_id uuid;
begin
  if p_lease_token is null or p_lease_seconds not between 15 and 300 then
    raise exception using errcode = '22023', message = 'invalid_classroom_purge_lease';
  end if;
  if not public.lock_managed_storage_protocol() then
    raise exception using errcode = '55000', message = 'managed_storage_enforcement_required';
  end if;
  perform 1 from public.classroom_purge_settings where singleton for share;
  select * into v_operation from public.classroom_purge_operations
  where id = p_operation_id and teacher_id = p_teacher_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'classroom_purge_operation_not_found';
  end if;
  if not public.classroom_purge_rollout_allows(p_teacher_id, v_operation.classroom_id) then
    raise exception using errcode = '55000', message = 'classroom_purge_disabled';
  end if;
  perform public.classroom_purge_lock(v_operation.classroom_id);
  perform 1 from public.classrooms where id = v_operation.classroom_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'classroom_purge_classroom_not_found';
  end if;
  perform 1 from public.classroom_purge_operations operation
  where operation.id = p_operation_id and operation.teacher_id = p_teacher_id
    and (
      operation.status = 'deleting_objects'
      or (operation.status = 'failed' and operation.retryable is true)
    )
    and exists (
      select 1 from public.classroom_purge_fences fence
      where fence.operation_id = operation.id
        and fence.classroom_id = operation.classroom_id
    )
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'classroom_purge_operation_not_found';
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
  order by purge_object.next_attempt_at, purge_object.created_at, purge_object.id
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
  v_classroom_id uuid;
begin
  select purge_object.* into v_object
  from public.classroom_purge_objects purge_object
  join public.classroom_purge_operations operation on operation.id = purge_object.operation_id
  where purge_object.id = p_object_id
    and operation.teacher_id = p_teacher_id
    and purge_object.status = 'processing'
    and purge_object.lease_token = p_lease_token;
  if not found then return false; end if;
  select classroom_id into v_classroom_id
  from public.classroom_purge_operations
  where id = v_object.operation_id and teacher_id = p_teacher_id;
  if not found then return false; end if;
  perform public.classroom_purge_lock(v_classroom_id);
  select purge_object.* into v_object
  from public.classroom_purge_objects purge_object
  join public.classroom_purge_operations operation on operation.id = purge_object.operation_id
  where purge_object.id = p_object_id
    and operation.teacher_id = p_teacher_id
    and operation.classroom_id = v_classroom_id
    and purge_object.status = 'processing'
    and purge_object.lease_token = p_lease_token
    and purge_object.lease_expires_at > clock_timestamp()
  for update of purge_object;
  if not found then return false; end if;
  perform public.managed_storage_exact_lock(v_object.storage_bucket, v_object.storage_path);
  if exists (
    select 1 from storage.objects stored
    where stored.bucket_id = v_object.storage_bucket
      and stored.name = v_object.storage_path
  ) then
    raise exception using errcode = '55000', message = 'classroom_purge_storage_object_still_present';
  end if;
  update public.classroom_purge_objects
  set status = 'deleted', storage_path = null, lease_token = null,
      lease_expires_at = null, last_error_code = null,
      deleted_at = clock_timestamp(), updated_at = clock_timestamp()
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
  update public.classroom_purge_objects purge_object
  set status = 'failed', lease_token = null, lease_expires_at = null,
      last_error_code = left(coalesce(nullif(btrim(p_error_code), ''),
        'storage_delete_failed'), 120),
      next_attempt_at = clock_timestamp() + make_interval(
        secs => least(3600, greatest(5, (2 ^ least(purge_object.attempt_count, 10))::integer))
      ),
      updated_at = clock_timestamp()
  from public.classroom_purge_operations operation
  where purge_object.id = p_object_id
    and operation.id = purge_object.operation_id
    and operation.teacher_id = p_teacher_id
    and purge_object.status = 'processing'
    and purge_object.lease_token = p_lease_token;
  if found then
    update public.classroom_purge_operations
    set status = 'failed', error_code = 'storage_delete_failed', retryable = true,
        updated_at = clock_timestamp()
    where id = (select operation_id from public.classroom_purge_objects where id = p_object_id);
  end if;
  return found;
end;
$$;

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
  v_resource record;
  v_revision bigint;
  v_expected_count integer;
  v_actual_count integer;
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
  perform 1 from public.classroom_purge_settings where singleton for share;
  select * into v_operation from public.classroom_purge_operations
  where id = p_operation_id and teacher_id = p_teacher_id;
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
  if not public.classroom_purge_rollout_allows(p_teacher_id, v_operation.classroom_id) then
    return jsonb_build_object(
      'ok', false, 'status', 503, 'error_code', 'classroom_purge_disabled',
      'error', 'Permanent classroom deletion is not enabled'
    );
  end if;

  perform public.classroom_purge_lock(v_operation.classroom_id);
  perform 1 from public.classrooms classroom
  where classroom.id = v_operation.classroom_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is not null
  for update;
  if not found then
    update public.classroom_purge_operations
    set status = 'failed', error_code = 'classroom_purge_owner_or_state_drift',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409,
      'error_code', 'classroom_purge_owner_or_state_drift',
      'error', 'Classroom ownership or archive state changed during deletion',
      'retryable', false
    );
  end if;
  select revision into v_revision from public.classroom_archive_revisions
  where classroom_id = v_operation.classroom_id for update;
  if v_revision is null or v_revision <> v_operation.source_revision then
    update public.classroom_purge_operations
    set status = 'failed', error_code = 'classroom_changed_during_purge',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_changed_during_purge',
      'error', 'Classroom data changed while deletion was in progress',
      'retryable', false
    );
  end if;
  select * into v_operation from public.classroom_purge_operations
  where id = p_operation_id and teacher_id = p_teacher_id for update;
  if not exists (
    select 1 from public.classroom_purge_fences fence
    where fence.operation_id = p_operation_id
      and fence.classroom_id = v_operation.classroom_id
      and fence.teacher_id = p_teacher_id
  ) then
    update public.classroom_purge_operations
    set status = 'failed', error_code = 'classroom_purge_fence_missing',
        retryable = false, updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 409, 'error_code', 'classroom_purge_fence_missing',
      'error', 'Permanent deletion stopped because its safety fence is missing',
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
      'error', 'A classroom file reappeared after verified deletion', 'retryable', false
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
      select 1 from public.managed_storage_objects object
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
      raise exception using errcode = '40001', message = 'classroom_purge_storage_owner_drift';
    end if;

    -- Preserve Course Blueprints and users; remove only workflow lineage to the classroom.
    update public.course_blueprint_change_proposals
    set source_classroom_id = null, updated_at = clock_timestamp()
    where source_classroom_id = v_operation.classroom_id;
    delete from public.course_blueprint_change_proposals
    where target_classroom_id = v_operation.classroom_id;
    update public.course_blueprint_editing_sessions set classroom_id = null
    where classroom_id = v_operation.classroom_id;
    update public.course_blueprint_operations set source_classroom_id = null
    where source_classroom_id = v_operation.classroom_id;
    update public.course_blueprint_operations set result_classroom_id = null
    where result_classroom_id = v_operation.classroom_id;

    -- Delete every catalogued classroom row explicitly in reverse graph order.
    for v_resource in
      select table_name, primary_key_columns[1] primary_key_column
      from public.classroom_archive_resource_contract
      order by export_position desc
    loop
      select count(*)::integer into v_expected_count
      from public.classroom_purge_resources
      where operation_id = p_operation_id and table_name = v_resource.table_name;
      execute format(
        'with deleted as (
           delete from public.%I source
           using public.classroom_purge_resources snapshot
           where snapshot.operation_id = $1 and snapshot.table_name = $2
             and source.%I = snapshot.row_id
           returning 1
         ) select count(*)::integer from deleted',
        v_resource.table_name, v_resource.primary_key_column
      ) into v_actual_count using p_operation_id, v_resource.table_name;
      if v_actual_count <> v_expected_count then
        raise exception using errcode = '40001',
          message = 'classroom_purge_membership_drift_' || v_resource.table_name;
      end if;
    end loop;

    -- Reconcile operational ledgers after deleting durable host references.
    -- In particular, an expired generic-cleanup lease can only complete safely
    -- once assignment/test references no longer report the object as live.
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
    delete from public.classroom_gradex_extract_cleanup cleanup
    using public.classroom_archive_operations operation
    where cleanup.operation_id = operation.id
      and operation.classroom_id = v_operation.classroom_id;
    delete from public.classroom_gradex_extracts
    where classroom_id = v_operation.classroom_id;
    delete from public.classroom_archive_source_object_cleanup
    where classroom_id = v_operation.classroom_id;
    delete from public.classroom_archive_source_object_reservations reservation
    using public.classroom_archive_operations operation
    where reservation.operation_id = operation.id
      and operation.classroom_id = v_operation.classroom_id;
    delete from public.classroom_archives
    where classroom_id = v_operation.classroom_id;
    delete from public.classroom_archive_operations
    where classroom_id = v_operation.classroom_id;

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
      raise exception using errcode = '40001', message = 'classroom_purge_storage_owner_drift';
    end if;
    delete from public.managed_storage_provisional_owners
    where target_classroom_id = v_operation.classroom_id;

    update public.classroom_purge_operations
    set status = 'completed', classroom_title = null,
        impact_summary = jsonb_build_object(
          'relational_rows_deleted',
          (select coalesce(sum(value::text::integer), 0) from jsonb_each(resource_counts)),
          'managed_files_deleted',
          (select count(*) from public.classroom_purge_objects
            where operation_id = p_operation_id)
        ),
        retryable = false, error_code = null,
        completed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_operation_id;
    delete from public.classroom_purge_resources where operation_id = p_operation_id;
    delete from public.classroom_purge_fences where operation_id = p_operation_id;
    return jsonb_build_object(
      'ok', true, 'status', 200, 'operation_id', p_operation_id,
      'operation_status', 'completed', 'replayed', false
    );
  exception when others then
    v_error_code := case
      when sqlstate = '40001' then left(sqlerrm, 120)
      when sqlstate like '23%' then 'classroom_purge_constraint_drift'
      else 'database_finalize_failed' end;
    v_retryable := sqlstate <> '40001' and sqlstate not like '23%';
    update public.classroom_purge_operations
    set status = 'failed', error_code = v_error_code, retryable = v_retryable,
        updated_at = clock_timestamp()
    where id = p_operation_id;
    return jsonb_build_object(
      'ok', false, 'status', 500, 'error_code', v_error_code,
      'error', 'Permanent deletion paused before database finalization',
      'retryable', v_retryable
    );
  end;
end;
$$;

-- Host-row deletion during finalization must not hand the same exact objects
-- to the generic cleanup worker. The purge ledger already owns that work.
create or replace function public.enqueue_deleted_assignment_artifact_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on'
    or (tg_op = 'UPDATE' and old.storage_path is not distinct from new.storage_path)
    or old.storage_path is null or btrim(old.storage_path) = ''
    or public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then return case when tg_op = 'DELETE' then old else new end; end if;
  insert into public.assignment_artifact_storage_cleanup as existing_cleanup (
    storage_path, managed_object_id, status, attempt_count, next_attempt_at,
    lease_token, lease_expires_at, last_error, updated_at
  ) values (
    old.storage_path, old.managed_object_id, 'pending', 0, clock_timestamp(),
    null, null, null, clock_timestamp()
  ) on conflict (storage_path) do update
  set managed_object_id = coalesce(existing_cleanup.managed_object_id,
        excluded.managed_object_id),
      status = 'pending', next_attempt_at = clock_timestamp(),
      lease_token = null, lease_expires_at = null, last_error = null,
      updated_at = clock_timestamp()
  where existing_cleanup.status <> 'processing'
    or existing_cleanup.lease_expires_at <= clock_timestamp();
  if old.managed_object_id is not null then
    perform public.queue_managed_storage_cleanup(
      old.managed_object_id, 'assignment_artifact_reference_removed'
    );
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.enqueue_obsolete_test_document_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived_at timestamptz;
  v_new_documents jsonb;
  v_document jsonb;
  v_object_id uuid;
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    select archived_at into v_archived_at from public.classrooms where id = old.classroom_id;
    if not found or v_archived_at is not null then return old; end if;
    v_new_documents := '[]'::jsonb;
  else
    v_new_documents := coalesce(new.documents, '[]'::jsonb);
  end if;
  for v_document in
    select value from jsonb_array_elements(coalesce(old.documents, '[]'::jsonb))
  loop
    if nullif(v_document->>'snapshot_path', '') is null
      or exists (
        select 1 from jsonb_array_elements(v_new_documents) current_document(value)
        where current_document.value->>'snapshot_path' = v_document->>'snapshot_path'
      )
    then continue; end if;
    begin
      v_object_id := nullif(v_document->>'snapshot_managed_object_id', '')::uuid;
    exception when invalid_text_representation then v_object_id := null;
    end;
    insert into public.test_document_snapshot_storage_cleanup as existing_cleanup (
      storage_path, managed_object_id, status, attempt_count, next_attempt_at,
      lease_token, lease_expires_at, last_error, updated_at
    ) values (
      v_document->>'snapshot_path', v_object_id, 'pending', 0, clock_timestamp(),
      null, null, null, clock_timestamp()
    ) on conflict (storage_path) do update
    set managed_object_id = coalesce(existing_cleanup.managed_object_id,
          excluded.managed_object_id),
        status = 'pending', next_attempt_at = clock_timestamp(),
        lease_token = null, lease_expires_at = null, last_error = null,
        updated_at = clock_timestamp()
    where existing_cleanup.status <> 'processing'
      or existing_cleanup.lease_expires_at <= clock_timestamp();
    if v_object_id is not null then
      perform public.queue_managed_storage_cleanup(
        v_object_id, 'test_snapshot_reference_removed'
      );
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- The old path-staging surface remains deployed history but is never callable.
revoke all on function public.classroom_purge_try_lock(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.guard_classroom_purge_lifecycle(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reject_classroom_resource_change_during_purge()
  from public, anon, authenticated, service_role;
revoke all on function public.reject_classroom_operation_during_purge()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_assignment_doc_save_operation_during_purge()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_managed_cleanup_ledger_during_purge()
  from public, anon, authenticated, service_role;
revoke all on function public.reject_managed_storage_change_during_purge()
  from public, anon, authenticated, service_role;
revoke all on function public.reject_provisional_owner_change_during_purge()
  from public, anon, authenticated, service_role;

revoke all on function public.stage_classroom_purge_objects(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.seal_classroom_purge_inventory(uuid, uuid, integer)
  from public, anon, authenticated, service_role;

revoke all on function public.classroom_purge_rollout_allows(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_storage_inventory_sha256(uuid)
  from public, anon, authenticated;
revoke all on function public.classroom_purge_conflict(uuid)
  from public, anon, authenticated;
revoke all on function public.get_hot_archived_classroom_purge_inventory(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.begin_hot_archived_classroom_purge(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_classroom_purge_object(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_classroom_purge_object(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_classroom_purge_object(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.finalize_hot_archived_classroom_purge(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.classroom_purge_conflict(uuid) to service_role;
grant execute on function public.get_hot_archived_classroom_purge_inventory(uuid, uuid)
  to service_role;
grant execute on function public.begin_hot_archived_classroom_purge(uuid, uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.claim_classroom_purge_object(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.complete_classroom_purge_object(uuid, uuid, uuid)
  to service_role;
grant execute on function public.fail_classroom_purge_object(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.finalize_hot_archived_classroom_purge(uuid, uuid)
  to service_role;

comment on table public.classroom_purge_settings is
  'Disabled-by-default rollout gate for irreversible hot-classroom deletion.';
comment on column public.classroom_purge_objects.managed_storage_object_id is
  'Exact migration-117 ownership identity; raw path is transient worker evidence only.';
