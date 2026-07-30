-- Keep managed-file reservations live until relational purge finalization and
-- make archive/Gradex operational writers participate in the same barrier.

do $$
begin
  if exists (
    select 1
    from public.classroom_purge_objects object
    join public.classroom_purge_operations operation
      on operation.id = object.operation_id
    where object.disposition = 'delete'
      and object.status = 'deleted'
      and object.storage_path is null
      and operation.status <> 'completed'
  ) then
    raise exception
      'Cannot install purge reservation lifetime guard with unredactable active deleted objects'
      using errcode = '55000';
  end if;
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
    -- Retain the path only while the purge is active so every reference writer
    -- remains fenced after Storage deletion and before relational finalization.
    storage_path = object.storage_path,
    lease_token = null,
    lease_expires_at = null,
    deleted_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where object.id = p_object_id
    and object.status = 'processing'
    and object.lease_token = p_lease_token
    and object.storage_path is not null
    and exists (
      select 1 from public.classroom_purge_operations operation
      where operation.id = object.operation_id
        and operation.teacher_id = p_teacher_id
        and operation.status in ('deleting_objects', 'failed')
    );
  get diagnostics v_updated = row_count;
  return v_updated = 1;
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

  perform pg_advisory_xact_lock_shared(
    hashtextextended('pika-classroom-purge-storage-references', 0)
  );
  v_payload := to_jsonb(new)::text;

  if exists (
    select 1
    from public.classroom_purge_objects object
    join public.classroom_purge_operations operation
      on operation.id = object.operation_id
    where object.disposition = 'delete'
      and object.status in ('pending', 'processing', 'failed', 'deleted')
      and operation.status <> 'completed'
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
      'course_blueprint_operations',
      'classroom_archives',
      'classroom_gradex_extracts',
      'classroom_archive_operations',
      'classroom_archive_object_upload_cleanup',
      'classroom_gradex_extract_cleanup'
    ])
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      'classroom_purge_storage_reservation_' || v_table,
      v_table
    );
    execute format(
      'drop trigger if exists %I on public.%I',
      'classroom_purge_00_storage_reservation_' || v_table,
      v_table
    );
    execute format(
      'create trigger %I
       before insert or update on public.%I
       for each row execute function public.reject_reserved_classroom_purge_storage_reference()',
      'classroom_purge_00_storage_reservation_' || v_table,
      v_table
    );
  end loop;
end;
$$;

create or replace function public.redact_classroom_purge_paths_on_completion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.classroom_purge_objects
    set
      storage_path = null,
      updated_at = clock_timestamp()
    where operation_id = new.id
      and storage_path is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists classroom_purge_redact_paths_on_completion
  on public.classroom_purge_operations;
create trigger classroom_purge_redact_paths_on_completion
before update of status on public.classroom_purge_operations
for each row execute function public.redact_classroom_purge_paths_on_completion();

revoke all on function public.reject_reserved_classroom_purge_storage_reference()
  from public, anon, authenticated;
revoke all on function public.redact_classroom_purge_paths_on_completion()
  from public, anon, authenticated;

comment on function public.complete_classroom_purge_object(uuid, uuid, uuid) is
  'Marks a leased managed object deleted while retaining its path reservation until atomic purge finalization.';
comment on function public.reject_reserved_classroom_purge_storage_reference() is
  'Serializes classroom, Blueprint, archive, and Gradex path writers and rejects references reserved by an active purge.';
comment on function public.redact_classroom_purge_paths_on_completion() is
  'Atomically redacts managed paths from the purge ledger at the operation completion linearization point.';
