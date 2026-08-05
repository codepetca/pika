-- Permit migration-117 reconciliation to attach an exact managed identity to
-- archive metadata that predates managed storage. All verified archive fields
-- remain immutable; only one validated NULL -> managed_object_id transition is
-- accepted while the managed-storage protocol is in compatibility mode.

create or replace function public.reject_classroom_archive_metadata_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_object public.managed_storage_objects;
  v_operation public.classroom_archive_operations;
  v_enforced boolean;
begin
  if old.managed_object_id is null
    and new.managed_object_id is not null
    and (to_jsonb(new) - 'managed_object_id')
      is not distinct from (to_jsonb(old) - 'managed_object_id')
  then
    v_enforced := public.lock_managed_storage_protocol();
    select * into v_operation
    from public.classroom_archive_operations operation
    where operation.id = new.operation_id
    for key share;
    select * into v_object
    from public.managed_storage_objects object
    where object.id = new.managed_object_id
    for key share;

    if not v_enforced
      and v_object.id is not null
      and v_object.id = public.managed_storage_legacy_object_id(
        new.storage_bucket, new.storage_path
      )
      and v_object.storage_bucket = new.storage_bucket
      and v_object.storage_path = new.storage_path
      and v_object.classroom_id = new.classroom_id
      and v_object.course_blueprint_id is null
      and v_object.provisional_owner_id is null
      and v_object.purpose = 'classroom_archive'
      and v_object.status = 'ready'
      and v_object.created_by_user_id = new.teacher_id
      and v_object.data_subject_user_id is null
      and v_object.resource_type = 'classroom_archive_operation'
      and v_object.resource_id = new.operation_id
      and v_object.content_type = 'application/gzip'
      and v_object.byte_size = new.compressed_byte_size
      and v_object.content_sha256 = new.artifact_sha256
      and v_operation.id is not null
      and v_operation.teacher_id = new.teacher_id
      and v_operation.classroom_id = new.classroom_id
      and v_operation.operation_type = 'export'
      and v_operation.managed_object_id = v_object.id
      and v_operation.storage_bucket = new.storage_bucket
      and v_operation.storage_path = new.storage_path
    then
      return new;
    end if;
  end if;

  raise exception 'Verified classroom archive metadata is immutable'
    using errcode = '55000';
end;
$$;

revoke all on function public.reject_classroom_archive_metadata_update()
  from public, anon, authenticated, service_role;

comment on function public.reject_classroom_archive_metadata_update() is
  'Rejects verified archive changes except a validated one-time legacy managed-object binding in compatibility mode.';
