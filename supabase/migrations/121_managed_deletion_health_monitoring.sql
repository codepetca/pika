-- Privacy-safe, read-only monitoring for durable managed deletion operations
-- and managed-storage ownership drift. Applying this migration changes no
-- rollout setting, schedules no worker, and does not enable generic cleanup.

create or replace function public.get_managed_deletion_health_snapshot(
  p_stuck_after_seconds integer default 3600
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, storage
as $health$
declare
  v_generated_at timestamptz := statement_timestamp();
  v_stuck_before timestamptz;

  v_classroom_terminal_failures bigint;
  v_classroom_stale_operations bigint;
  v_classroom_stale_partial_operations bigint;
  v_classroom_expired_object_leases bigint;
  v_classroom_due_failed_objects bigint;
  v_classroom_fences_without_active_operation bigint;
  v_classroom_active_operations_without_fence bigint;
  v_classroom_deleted_objects_reappeared bigint;

  v_blueprint_terminal_failures bigint;
  v_blueprint_stale_operations bigint;
  v_blueprint_stale_partial_operations bigint;
  v_blueprint_expired_object_leases bigint;
  v_blueprint_due_failed_objects bigint;
  v_blueprint_fences_without_active_operation bigint;
  v_blueprint_active_operations_without_fence bigint;
  v_blueprint_deleted_objects_reappeared bigint;

  v_unregistered_storage_objects bigint;
  v_registered_objects_missing_storage bigint;
  v_referenced_objects_not_ready bigint;
  v_raw_references_missing_identity bigint;
  v_relational_identity_mismatches bigint;
  v_embedded_hosts_missing_registry bigint;
  v_embedded_ownership_mismatches bigint;
  v_objects_without_durable_owner bigint;
  v_settled_provisional_objects bigint;
  v_ready_objects_unreferenced bigint;
  v_expired_reservations bigint;
  v_expired_provisional_owners bigint;
  v_stale_cleanup_pending bigint;
  v_expired_cleanup_leases bigint;

  v_critical_count bigint;
  v_warning_count bigint;
begin
  if p_stuck_after_seconds is null
    or p_stuck_after_seconds < 300
    or p_stuck_after_seconds > 604800
  then
    raise exception using
      errcode = '22023',
      message = 'managed_deletion_health_stuck_threshold_invalid';
  end if;
  v_stuck_before := v_generated_at - make_interval(secs => p_stuck_after_seconds);

  select count(*) into v_classroom_terminal_failures
  from public.classroom_purge_operations
  where status = 'failed' and retryable is false;

  select count(*) into v_classroom_stale_operations
  from public.classroom_purge_operations
  where status <> 'completed' and updated_at <= v_stuck_before;

  select count(*) into v_classroom_stale_partial_operations
  from public.classroom_purge_operations operation
  where operation.status <> 'completed'
    and operation.updated_at <= v_stuck_before
    and exists (
      select 1 from public.classroom_purge_objects object
      where object.operation_id = operation.id and object.status = 'deleted'
    )
    and exists (
      select 1 from public.classroom_purge_objects object
      where object.operation_id = operation.id
        and object.status in ('pending', 'processing', 'failed')
    );

  select count(*) into v_classroom_expired_object_leases
  from public.classroom_purge_objects
  where status = 'processing' and lease_expires_at <= v_generated_at;

  select count(*) into v_classroom_due_failed_objects
  from public.classroom_purge_objects object
  join public.classroom_purge_operations operation on operation.id = object.operation_id
  where object.status = 'failed' and object.next_attempt_at <= v_generated_at
    and operation.status <> 'completed';

  select count(*) into v_classroom_fences_without_active_operation
  from public.classroom_purge_fences fence
  left join public.classroom_purge_operations operation on operation.id = fence.operation_id
  where operation.id is null or operation.status = 'completed';

  select count(*) into v_classroom_active_operations_without_fence
  from public.classroom_purge_operations operation
  left join public.classroom_purge_fences fence on fence.operation_id = operation.id
  where operation.status <> 'completed' and fence.operation_id is null;

  select count(*) into v_classroom_deleted_objects_reappeared
  from public.classroom_purge_objects object
  where object.status = 'deleted'
    and exists (
      select 1 from storage.objects stored
      where stored.bucket_id = object.storage_bucket
        and object.storage_path_sha256 = public.managed_storage_identity_sha256(
          stored.bucket_id, stored.name
        )
    );

  select count(*) into v_blueprint_terminal_failures
  from public.course_blueprint_purge_operations
  where status = 'failed' and retryable is false;

  select count(*) into v_blueprint_stale_operations
  from public.course_blueprint_purge_operations
  where status <> 'completed' and updated_at <= v_stuck_before;

  select count(*) into v_blueprint_stale_partial_operations
  from public.course_blueprint_purge_operations operation
  where operation.status <> 'completed'
    and operation.updated_at <= v_stuck_before
    and exists (
      select 1 from public.course_blueprint_purge_objects object
      where object.operation_id = operation.id and object.status = 'deleted'
    )
    and exists (
      select 1 from public.course_blueprint_purge_objects object
      where object.operation_id = operation.id
        and object.status in ('pending', 'processing', 'failed')
    );

  select count(*) into v_blueprint_expired_object_leases
  from public.course_blueprint_purge_objects
  where status = 'processing' and lease_expires_at <= v_generated_at;

  select count(*) into v_blueprint_due_failed_objects
  from public.course_blueprint_purge_objects object
  join public.course_blueprint_purge_operations operation on operation.id = object.operation_id
  where object.status = 'failed' and object.next_attempt_at <= v_generated_at
    and operation.status <> 'completed';

  select count(*) into v_blueprint_fences_without_active_operation
  from public.course_blueprint_purge_fences fence
  left join public.course_blueprint_purge_operations operation on operation.id = fence.operation_id
  where operation.id is null or operation.status = 'completed';

  select count(*) into v_blueprint_active_operations_without_fence
  from public.course_blueprint_purge_operations operation
  left join public.course_blueprint_purge_fences fence on fence.operation_id = operation.id
  where operation.status <> 'completed' and fence.operation_id is null;

  select count(*) into v_blueprint_deleted_objects_reappeared
  from public.course_blueprint_purge_objects object
  where object.status = 'deleted'
    and exists (
      select 1 from storage.objects stored
      where stored.bucket_id = object.storage_bucket
        and object.storage_path_sha256 = public.managed_storage_identity_sha256(
          stored.bucket_id, stored.name
        )
    );

  select count(*) into v_unregistered_storage_objects
  from storage.objects stored
  left join public.managed_storage_objects object
    on object.storage_bucket = stored.bucket_id and object.storage_path = stored.name
  where stored.bucket_id in (
    'assignment-artifacts', 'submission-images', 'test-documents',
    'classroom-archives', 'gradex-analytics-extracts'
  ) and object.id is null;

  select count(*) into v_registered_objects_missing_storage
  from public.managed_storage_objects object
  left join storage.objects stored
    on stored.bucket_id = object.storage_bucket and stored.name = object.storage_path
  where object.status in ('verified', 'ready') and stored.id is null;

  select count(*) into v_referenced_objects_not_ready
  from public.managed_storage_objects object
  where object.status <> 'ready'
    and public.managed_storage_object_is_referenced(object.id);

  select count(*) into v_raw_references_missing_identity
  from (
    select storage_path from public.assignment_submission_artifacts
    where storage_path is not null and managed_object_id is null
    union all
    select storage_path from public.classroom_archives
    where managed_object_id is null
    union all
    select storage_path from public.classroom_archive_operations
    where storage_path is not null and managed_object_id is null
    union all
    select storage_path from public.classroom_gradex_extracts
    where managed_object_id is null
    union all
    select storage_path from public.classroom_archive_object_upload_cleanup
    where status <> 'deleted' and managed_object_id is null
    union all
    select storage_path from public.classroom_archive_restore_expected_objects
    where managed_object_id is null
    union all
    select storage_path from public.classroom_archive_source_object_cleanup
    where status <> 'deleted' and managed_object_id is null
    union all
    select storage_path from public.classroom_gradex_extract_cleanup
    where status <> 'deleted' and managed_object_id is null
    union all
    select storage_path from public.assignment_artifact_storage_cleanup
    where managed_object_id is null
    union all
    select storage_path from public.test_document_snapshot_storage_cleanup
    where managed_object_id is null
  ) reference;

  select count(*) into v_relational_identity_mismatches
  from (
    select artifact.managed_object_id, 'assignment-artifacts'::text storage_bucket,
      artifact.storage_path, assignment.classroom_id expected_classroom_id
    from public.assignment_submission_artifacts artifact
    join public.assignment_docs document on document.id = artifact.assignment_doc_id
    join public.assignments assignment on assignment.id = document.assignment_id
    where artifact.storage_path is not null and artifact.managed_object_id is not null
    union all
    select managed_object_id, storage_bucket, storage_path, classroom_id
    from public.classroom_archives where managed_object_id is not null
    union all
    select managed_object_id, storage_bucket, storage_path, classroom_id
    from public.classroom_archive_operations
    where managed_object_id is not null and storage_path is not null
    union all
    select managed_object_id, storage_bucket, storage_path, classroom_id
    from public.classroom_gradex_extracts where managed_object_id is not null
    union all
    select cleanup.managed_object_id, cleanup.storage_bucket, cleanup.storage_path,
      operation.classroom_id
    from public.classroom_archive_object_upload_cleanup cleanup
    join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
    where cleanup.managed_object_id is not null and cleanup.status <> 'deleted'
    union all
    select expected.managed_object_id, expected.storage_bucket, expected.storage_path,
      operation.classroom_id
    from public.classroom_archive_restore_expected_objects expected
    join public.classroom_archive_operations operation on operation.id = expected.operation_id
    where expected.managed_object_id is not null
    union all
    select managed_object_id, storage_bucket, storage_path, classroom_id
    from public.classroom_archive_source_object_cleanup
    where managed_object_id is not null and status <> 'deleted'
    union all
    select cleanup.managed_object_id, cleanup.storage_bucket, cleanup.storage_path,
      operation.classroom_id
    from public.classroom_gradex_extract_cleanup cleanup
    join public.classroom_archive_operations operation on operation.id = cleanup.operation_id
    where cleanup.managed_object_id is not null and cleanup.status <> 'deleted'
    union all
    select managed_object_id, 'assignment-artifacts', storage_path, null::uuid
    from public.assignment_artifact_storage_cleanup where managed_object_id is not null
    union all
    select managed_object_id, 'test-documents', storage_path, null::uuid
    from public.test_document_snapshot_storage_cleanup where managed_object_id is not null
  ) reference
  left join public.managed_storage_objects object on object.id = reference.managed_object_id
  where object.id is null
    or object.storage_bucket is distinct from reference.storage_bucket
    or object.storage_path is distinct from reference.storage_path
    or (reference.expected_classroom_id is not null
      and object.classroom_id is distinct from reference.expected_classroom_id);

  select count(*) into v_embedded_hosts_missing_registry
  from (
    select 'assignment_doc'::text host_type, id host_id, content payload
    from public.assignment_docs
    union all
    select 'assignment_doc_history', id, coalesce(snapshot, patch)
    from public.assignment_doc_history
    union all
    select 'test', id, documents from public.tests
    union all
    select 'course_blueprint_assessment', id, documents
    from public.course_blueprint_assessments
    union all
    select 'course_blueprint_version', id, snapshot_json
    from public.course_blueprint_versions
    union all
    select 'course_blueprint_change_proposal', id, operations_json
    from public.course_blueprint_change_proposals
  ) host
  where exists (
    select 1
    from (
      select distinct storage_bucket, storage_path
      from public.managed_storage_payload_raw_references(host.payload)
    ) raw_reference
    where not exists (
      select 1 from public.managed_storage_json_references reference
      where reference.storage_bucket = raw_reference.storage_bucket
        and reference.storage_path = raw_reference.storage_path
        and (
          reference.assignment_doc_id = case
            when host.host_type = 'assignment_doc' then host.host_id end
          or reference.assignment_doc_history_id = case
            when host.host_type = 'assignment_doc_history' then host.host_id end
          or reference.test_id = case when host.host_type = 'test' then host.host_id end
          or reference.course_blueprint_assessment_id = case
            when host.host_type = 'course_blueprint_assessment' then host.host_id end
          or reference.course_blueprint_version_id = case
            when host.host_type = 'course_blueprint_version' then host.host_id end
          or reference.course_blueprint_change_proposal_id = case
            when host.host_type = 'course_blueprint_change_proposal' then host.host_id end
        )
    )
  );

  select count(*) into v_embedded_ownership_mismatches
  from (
    select distinct host.host_type, host.host_id
    from (
      select 'assignment_doc'::text host_type, document.id host_id,
        assignment.classroom_id, null::uuid course_blueprint_id,
        document.id assignment_doc_id, document.student_id data_subject_user_id
      from public.assignment_docs document
      join public.assignments assignment on assignment.id = document.assignment_id
      union all
      select 'assignment_doc_history', history.id, assignment.classroom_id, null::uuid,
        document.id, document.student_id
      from public.assignment_doc_history history
      join public.assignment_docs document on document.id = history.assignment_doc_id
      join public.assignments assignment on assignment.id = document.assignment_id
      union all
      select 'test', id, classroom_id, null::uuid, null::uuid, null::uuid
      from public.tests
      union all
      select 'course_blueprint_assessment', id, null::uuid, course_blueprint_id,
        null::uuid, null::uuid
      from public.course_blueprint_assessments
      union all
      select 'course_blueprint_version', id, null::uuid, course_blueprint_id,
        null::uuid, null::uuid
      from public.course_blueprint_versions
      union all
      select 'course_blueprint_change_proposal', id, null::uuid, course_blueprint_id,
        null::uuid, null::uuid
      from public.course_blueprint_change_proposals
    ) host
    join public.managed_storage_json_references reference on (
      reference.assignment_doc_id = case
        when host.host_type = 'assignment_doc' then host.host_id end
      or reference.assignment_doc_history_id = case
        when host.host_type = 'assignment_doc_history' then host.host_id end
      or reference.test_id = case when host.host_type = 'test' then host.host_id end
      or reference.course_blueprint_assessment_id = case
        when host.host_type = 'course_blueprint_assessment' then host.host_id end
      or reference.course_blueprint_version_id = case
        when host.host_type = 'course_blueprint_version' then host.host_id end
      or reference.course_blueprint_change_proposal_id = case
        when host.host_type = 'course_blueprint_change_proposal' then host.host_id end
    )
    join public.managed_storage_objects object on object.id = reference.managed_object_id
    where (host.classroom_id is not null
        and object.classroom_id is distinct from host.classroom_id)
      or (host.course_blueprint_id is not null
        and object.course_blueprint_id is distinct from host.course_blueprint_id)
      or (object.storage_bucket = 'submission-images' and (
        object.resource_type is distinct from 'assignment_doc'
        or object.resource_id is distinct from host.assignment_doc_id
        or object.data_subject_user_id is distinct from host.data_subject_user_id
      ))
  ) mismatch;

  select count(*) into v_objects_without_durable_owner
  from public.managed_storage_objects object
  where object.classroom_id is not null
    and (
      (exists (select 1 from public.classrooms classroom
        where classroom.id = object.classroom_id))::integer
      + (exists (select 1 from public.classroom_cold_tombstones tombstone
        where tombstone.classroom_id = object.classroom_id))::integer
    ) <> 1;

  select count(*) into v_settled_provisional_objects
  from public.managed_storage_objects object
  join public.managed_storage_provisional_owners owner
    on owner.id = object.provisional_owner_id
  where object.status <> 'deleted'
    and (owner.adopted_at is not null or owner.copy_closed_at is not null);

  select count(*) into v_ready_objects_unreferenced
  from public.managed_storage_objects object
  where object.status = 'ready'
    and not public.managed_storage_object_is_referenced(object.id);

  select count(*) into v_expired_reservations
  from public.managed_storage_objects object
  where object.status in ('reserved', 'verified')
    and object.reservation_expires_at <= v_generated_at;

  select count(*) into v_expired_provisional_owners
  from public.managed_storage_provisional_owners owner
  where owner.adopted_at is null and owner.copy_closed_at is null
    and owner.expires_at <= v_generated_at;

  select count(*) into v_stale_cleanup_pending
  from public.managed_storage_objects object
  where object.status = 'cleanup_pending' and object.updated_at <= v_stuck_before;

  select count(*) into v_expired_cleanup_leases
  from public.managed_storage_objects object
  where object.status = 'cleanup_processing'
    and object.lease_expires_at <= v_generated_at;

  v_critical_count :=
    v_classroom_terminal_failures + v_classroom_stale_operations
    + v_classroom_stale_partial_operations + v_classroom_expired_object_leases
    + v_classroom_fences_without_active_operation
    + v_classroom_active_operations_without_fence
    + v_classroom_deleted_objects_reappeared
    + v_blueprint_terminal_failures + v_blueprint_stale_operations
    + v_blueprint_stale_partial_operations + v_blueprint_expired_object_leases
    + v_blueprint_fences_without_active_operation
    + v_blueprint_active_operations_without_fence
    + v_blueprint_deleted_objects_reappeared
    + v_unregistered_storage_objects + v_registered_objects_missing_storage
    + v_referenced_objects_not_ready + v_raw_references_missing_identity
    + v_relational_identity_mismatches + v_embedded_hosts_missing_registry
    + v_embedded_ownership_mismatches + v_objects_without_durable_owner
    + v_settled_provisional_objects + v_expired_cleanup_leases;

  v_warning_count :=
    v_classroom_due_failed_objects + v_blueprint_due_failed_objects
    + v_ready_objects_unreferenced + v_expired_reservations
    + v_expired_provisional_owners + v_stale_cleanup_pending;

  return jsonb_build_object(
    'version', 1,
    'generated_at', v_generated_at,
    'stuck_after_seconds', p_stuck_after_seconds,
    'healthy', v_critical_count = 0,
    'critical_count', v_critical_count,
    'warning_count', v_warning_count,
    'operations', jsonb_build_object(
      'classroom', jsonb_build_object(
        'terminal_failures', v_classroom_terminal_failures,
        'stale_operations', v_classroom_stale_operations,
        'stale_partial_operations', v_classroom_stale_partial_operations,
        'expired_object_leases', v_classroom_expired_object_leases,
        'due_failed_objects', v_classroom_due_failed_objects,
        'fences_without_active_operation', v_classroom_fences_without_active_operation,
        'active_operations_without_fence', v_classroom_active_operations_without_fence,
        'deleted_objects_reappeared', v_classroom_deleted_objects_reappeared
      ),
      'course_blueprint', jsonb_build_object(
        'terminal_failures', v_blueprint_terminal_failures,
        'stale_operations', v_blueprint_stale_operations,
        'stale_partial_operations', v_blueprint_stale_partial_operations,
        'expired_object_leases', v_blueprint_expired_object_leases,
        'due_failed_objects', v_blueprint_due_failed_objects,
        'fences_without_active_operation', v_blueprint_fences_without_active_operation,
        'active_operations_without_fence', v_blueprint_active_operations_without_fence,
        'deleted_objects_reappeared', v_blueprint_deleted_objects_reappeared
      )
    ),
    'managed_storage', jsonb_build_object(
      'unregistered_storage_objects', v_unregistered_storage_objects,
      'registered_objects_missing_storage', v_registered_objects_missing_storage,
      'referenced_objects_not_ready', v_referenced_objects_not_ready,
      'raw_references_missing_identity', v_raw_references_missing_identity,
      'relational_identity_mismatches', v_relational_identity_mismatches,
      'embedded_hosts_missing_registry', v_embedded_hosts_missing_registry,
      'embedded_ownership_mismatches', v_embedded_ownership_mismatches,
      'objects_without_durable_owner', v_objects_without_durable_owner,
      'settled_provisional_objects', v_settled_provisional_objects,
      'ready_objects_unreferenced', v_ready_objects_unreferenced,
      'expired_reservations', v_expired_reservations,
      'expired_provisional_owners', v_expired_provisional_owners,
      'stale_cleanup_pending', v_stale_cleanup_pending,
      'expired_cleanup_leases', v_expired_cleanup_leases
    )
  );
end;
$health$;

revoke all on function public.get_managed_deletion_health_snapshot(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_managed_deletion_health_snapshot(integer) to service_role;

comment on function public.get_managed_deletion_health_snapshot(integer) is
  'Read-only aggregate monitoring for purge liveness and managed-storage drift; returns no object identities.';
