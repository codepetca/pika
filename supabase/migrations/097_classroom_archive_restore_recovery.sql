-- Preserve fixed restore operation IDs across concurrent failure recording and expiry.

alter function private.complete_classroom_archive_restore(uuid, uuid, jsonb)
  rename to complete_classroom_archive_restore_v095;

create or replace function private.complete_classroom_archive_restore(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_verification jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_operation public.classroom_archive_operations;
begin
  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
    and teacher_id = p_teacher_id
    and operation_type = 'restore'
  for update;

  if v_operation.status = 'failed'
    and v_operation.retryable is true
    and v_operation.snapshot_expires_at > clock_timestamp()
  then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', v_operation.error_code,
      'error', 'Restore operation failed and can be retried',
      'retryable', true
    );
  end if;

  return private.complete_classroom_archive_restore_v095(
    p_operation_id,
    p_teacher_id,
    p_verification
  );
end;
$$;

revoke all on function private.complete_classroom_archive_restore_v095(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_classroom_archive_restore(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

alter function public.begin_classroom_archive_restore(
  uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, bigint
) set schema private;
alter function private.begin_classroom_archive_restore(
  uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, bigint
) rename to begin_classroom_archive_restore_v083;

revoke all on function private.begin_classroom_archive_restore_v083(
  uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, bigint
) from public, anon, authenticated, service_role;

create or replace function public.begin_classroom_archive_restore(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_archive_id uuid,
  p_request_sha256 text,
  p_target_schema_migration text,
  p_adapter_chain jsonb,
  p_resource_counts jsonb,
  p_storage_objects jsonb,
  p_database_budget_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.classroom_archive_operations;
  v_expected_objects_match boolean := false;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  perform public.cleanup_expired_classroom_archive_snapshots();
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;

  -- Fence the cleanup worker before deciding whether restored paths can be reused.
  perform 1
  from public.classroom_archive_object_upload_cleanup
  where operation_id = p_operation_id
  for update;

  if v_operation.id is not null
    and jsonb_typeof(p_storage_objects) = 'array'
    and jsonb_array_length(p_storage_objects) <= 10000
    and not exists (
      select 1
      from jsonb_array_elements(p_storage_objects) item
      where jsonb_typeof(item) <> 'object'
        or coalesce(item->>'expected_byte_size', '') !~ '^\d+$'
    )
  then
    select not exists (
      (select storage_bucket, storage_path, expected_sha256, expected_byte_size
       from public.classroom_archive_restore_expected_objects
       where operation_id = p_operation_id
       except
       select value->>'storage_bucket', value->>'storage_path',
         value->>'expected_sha256', (value->>'expected_byte_size')::bigint
       from jsonb_array_elements(p_storage_objects))
      union all
      (select value->>'storage_bucket', value->>'storage_path',
         value->>'expected_sha256', (value->>'expected_byte_size')::bigint
       from jsonb_array_elements(p_storage_objects)
       except
       select storage_bucket, storage_path, expected_sha256, expected_byte_size
       from public.classroom_archive_restore_expected_objects
       where operation_id = p_operation_id)
    ) into v_expected_objects_match;
  end if;

  if v_operation.teacher_id = p_teacher_id
    and v_operation.classroom_id = p_classroom_id
    and v_operation.archive_id = p_archive_id
    and v_operation.operation_type = 'restore'
    and v_operation.request_sha256 = p_request_sha256
    and v_operation.target_schema_migration = p_target_schema_migration
    and v_operation.adapter_chain = p_adapter_chain
    and v_operation.resource_counts = p_resource_counts
    and v_expected_objects_match
    and v_operation.status = 'failed'
    and v_operation.retryable is false
    and v_operation.error_code = 'archive_snapshot_expired'
  then
    if exists (
      select 1
      from public.classroom_archive_object_upload_cleanup
      where operation_id = p_operation_id and status = 'processing'
    ) then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'operation_id', p_operation_id,
        'error_code', 'restore_cleanup_in_progress',
        'error', 'Expired restore object cleanup is still in progress',
        'retryable', true
      );
    end if;

    begin
      delete from public.classroom_archive_restore_staging
      where operation_id = p_operation_id;

      delete from public.classroom_archive_object_upload_cleanup
      where operation_id = p_operation_id;

      update public.classroom_archive_operations
      set
        retryable = true,
        snapshot_expires_at = v_now + interval '24 hours',
        updated_at = v_now
      where id = p_operation_id;

      v_result := private.begin_classroom_archive_restore_v083(
        p_operation_id,
        p_teacher_id,
        p_classroom_id,
        p_archive_id,
        p_request_sha256,
        p_target_schema_migration,
        p_adapter_chain,
        p_resource_counts,
        p_storage_objects,
        p_database_budget_bytes
      );
      if coalesce((v_result->>'ok')::boolean, false) is not true then
        raise exception 'Restore rearm was rejected' using errcode = 'PRA01';
      end if;
    exception when sqlstate 'PRA01' then
      return v_result;
    end;

    return v_result;
  end if;

  return private.begin_classroom_archive_restore_v083(
    p_operation_id,
    p_teacher_id,
    p_classroom_id,
    p_archive_id,
    p_request_sha256,
    p_target_schema_migration,
    p_adapter_chain,
    p_resource_counts,
    p_storage_objects,
    p_database_budget_bytes
  );
end;
$$;

revoke all on function public.begin_classroom_archive_restore(
  uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, bigint
) from public, anon, authenticated;
grant execute on function public.begin_classroom_archive_restore(
  uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, bigint
) to service_role;
