-- Independent-review hardening for permanent hot archived classroom deletion.
-- Close storage-reference races, fence operational cleanup workers, and keep
-- interrupted archive/Gradex upload evidence available until purge completion.

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
    from public.classroom_archive_object_upload_cleanup cleanup
    join public.classroom_archive_operations operation
      on operation.id = cleanup.operation_id
    where operation.classroom_id = p_classroom_id
      and cleanup.status = 'processing'
      and cleanup.lease_expires_at > clock_timestamp()
  ) or exists (
    select 1
    from public.classroom_gradex_extract_cleanup cleanup
    join public.classroom_archive_operations operation
      on operation.id = cleanup.operation_id
    where operation.classroom_id = p_classroom_id
      and cleanup.status = 'processing'
      and cleanup.lease_expires_at > clock_timestamp()
  ) then
    return 'classroom_storage_cleanup_active';
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

create or replace function public.classroom_purge_storage_path_has_external_operation_reference(
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
  v_classroom_id uuid;
begin
  select classroom_id into v_classroom_id
  from public.classroom_purge_operations
  where id = p_operation_id;

  if v_classroom_id is null then
    return true;
  end if;

  return exists (
    select 1
    from public.classroom_archives archive
    where archive.storage_bucket = p_storage_bucket
      and archive.storage_path = p_storage_path
      and archive.classroom_id <> v_classroom_id
  ) or exists (
    select 1
    from public.classroom_gradex_extracts extract
    where extract.storage_bucket = p_storage_bucket
      and extract.storage_path = p_storage_path
      and extract.classroom_id <> v_classroom_id
  ) or exists (
    select 1
    from public.classroom_archive_operations operation
    where operation.storage_bucket = p_storage_bucket
      and operation.storage_path = p_storage_path
      and operation.classroom_id <> v_classroom_id
  ) or exists (
    select 1
    from public.classroom_archive_object_upload_cleanup cleanup
    join public.classroom_archive_operations operation
      on operation.id = cleanup.operation_id
    where cleanup.storage_bucket = p_storage_bucket
      and cleanup.storage_path = p_storage_path
      and operation.classroom_id <> v_classroom_id
  ) or exists (
    select 1
    from public.classroom_gradex_extract_cleanup cleanup
    join public.classroom_archive_operations operation
      on operation.id = cleanup.operation_id
    where cleanup.storage_bucket = p_storage_bucket
      and cleanup.storage_path = p_storage_path
      and operation.classroom_id <> v_classroom_id
  );
end;
$$;

create or replace function public.reconcile_classroom_purge_object_sharing(
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
  v_object public.classroom_purge_objects;
  v_counts jsonb;
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
  if v_operation.inventory_completed_at is not null then
    return jsonb_build_object(
      'ok', true, 'status', 202, 'operation_id', p_operation_id,
      'operation_status', v_operation.status, 'replayed', true
    );
  end if;

  -- All managed-reference writers take the matching shared transaction lock.
  -- This exclusive barrier waits for earlier writers and blocks later writers
  -- until every staged path has been rechecked against committed references.
  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-purge-storage-references', 0)
  );

  for v_object in
    select *
    from public.classroom_purge_objects
    where operation_id = p_operation_id
    order by id
    for update
  loop
    if v_object.storage_path is null then
      continue;
    end if;
    if v_object.disposition = 'preserve_shared'
      or public.classroom_purge_storage_path_is_shared(
        p_operation_id,
        v_object.storage_bucket,
        v_object.storage_path
      )
      or public.classroom_purge_storage_path_has_external_operation_reference(
        p_operation_id,
        v_object.storage_bucket,
        v_object.storage_path
      )
    then
      update public.classroom_purge_objects
      set
        disposition = 'preserve_shared',
        status = 'preserved',
        storage_path = null,
        lease_token = null,
        lease_expires_at = null,
        last_error_code = null,
        updated_at = clock_timestamp()
      where id = v_object.id
        and status not in ('processing', 'deleted');
    end if;
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
    updated_at = clock_timestamp()
  where id = p_operation_id;

  return jsonb_build_object(
    'ok', true, 'status', 202, 'operation_id', p_operation_id,
    'operation_status', v_operation.status, 'replayed', false
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

  select * into v_candidate
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
  limit 1;

  if not found then
    return;
  end if;
  if v_candidate.storage_path is null then
    raise exception 'Classroom purge object path was redacted before deletion'
      using errcode = '55000';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-purge-storage-references', 0)
  );
  if public.classroom_purge_storage_path_is_shared(
    p_operation_id,
    v_candidate.storage_bucket,
    v_candidate.storage_path
  ) or public.classroom_purge_storage_path_has_external_operation_reference(
    p_operation_id,
    v_candidate.storage_bucket,
    v_candidate.storage_path
  ) then
    update public.classroom_purge_objects
    set
      disposition = 'preserve_shared',
      status = 'preserved',
      storage_path = null,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null,
      updated_at = clock_timestamp()
    where id = v_candidate.id;
    return;
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

create or replace function public.reject_reserved_classroom_purge_storage_reference()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_payload text;
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return new;
  end if;

  -- Shared locks allow unrelated writes to proceed concurrently while
  -- serializing all reference writers against purge reconciliation/claim.
  perform pg_advisory_xact_lock_shared(
    hashtextextended('pika-classroom-purge-storage-references', 0)
  );
  v_payload := to_jsonb(new)::text;

  if exists (
    select 1
    from public.classroom_purge_objects object
    where object.disposition = 'delete'
      and object.status in ('pending', 'processing', 'failed')
      and object.storage_path is not null
      and strpos(v_payload, object.storage_path) > 0
  ) then
    raise exception 'A managed file referenced by this content is being permanently deleted'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  for v_table in
    select table_name
    from public.classroom_archive_resource_contract
    union
    select unnest(array[
      'course_blueprints',
      'course_blueprint_assignments',
      'course_blueprint_assessments',
      'course_blueprint_lesson_templates',
      'course_blueprint_materials',
      'course_blueprint_surveys',
      'course_blueprint_versions',
      'course_blueprint_change_proposals',
      'course_blueprint_editing_sessions',
      'course_blueprint_operations'
    ])
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      'classroom_purge_storage_reservation_' || v_table,
      v_table
    );
    execute format(
      'create trigger %I
       before insert or update on public.%I
       for each row execute function public.reject_reserved_classroom_purge_storage_reference()',
      'classroom_purge_storage_reservation_' || v_table,
      v_table
    );
  end loop;
end;
$$;

create or replace function public.reject_classroom_cleanup_change_during_purge()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_operation_id uuid;
  v_classroom_id uuid;
begin
  if current_setting('pika.classroom_purge_finalize', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_operation_id := case
    when tg_op = 'DELETE' then old.operation_id
    else new.operation_id
  end;
  select classroom_id into v_classroom_id
  from public.classroom_archive_operations
  where id = v_operation_id;
  if v_classroom_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  perform public.classroom_purge_lock(v_classroom_id);
  if exists (
    select 1
    from public.classroom_purge_fences
    where classroom_id = v_classroom_id
  ) then
    raise exception 'Classroom permanent deletion owns this storage cleanup'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists classroom_purge_fence_archive_upload_cleanup
  on public.classroom_archive_object_upload_cleanup;
create trigger classroom_purge_fence_archive_upload_cleanup
before insert or update or delete on public.classroom_archive_object_upload_cleanup
for each row execute function public.reject_classroom_cleanup_change_during_purge();

drop trigger if exists classroom_purge_fence_gradex_cleanup
  on public.classroom_gradex_extract_cleanup;
create trigger classroom_purge_fence_gradex_cleanup
before insert or update or delete on public.classroom_gradex_extract_cleanup
for each row execute function public.reject_classroom_cleanup_change_during_purge();

update public.classroom_purge_objects
set storage_path = null, updated_at = clock_timestamp()
where disposition = 'preserve_shared'
  and status = 'preserved'
  and storage_path is not null;

revoke all on function public.classroom_purge_storage_path_has_external_operation_reference(
  uuid, text, text
) from public, anon, authenticated;
revoke all on function public.reconcile_classroom_purge_object_sharing(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reject_reserved_classroom_purge_storage_reference()
  from public, anon, authenticated;
revoke all on function public.reject_classroom_cleanup_change_during_purge()
  from public, anon, authenticated;

grant execute on function public.reconcile_classroom_purge_object_sharing(uuid, uuid)
  to service_role;

comment on function public.reconcile_classroom_purge_object_sharing(uuid, uuid) is
  'Exclusive pre-seal barrier that converts newly shared managed paths to redacted preservation.';
comment on function public.reject_reserved_classroom_purge_storage_reference() is
  'Prevents content and Blueprint writers from acquiring a path reserved for permanent deletion.';
comment on function public.reject_classroom_cleanup_change_during_purge() is
  'Hands interrupted archive and Gradex cleanup rows to the active classroom purge.';
