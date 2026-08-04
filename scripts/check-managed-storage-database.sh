#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${MANAGED_STORAGE_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

do $privileges$
begin
  if has_function_privilege('anon', 'public.lock_managed_storage_protocol()', 'execute')
    or has_function_privilege(
      'authenticated', 'public.lock_managed_storage_protocol()', 'execute'
    )
    or has_function_privilege(
      'service_role', 'public.lock_managed_storage_protocol()', 'execute'
    )
  then
    raise exception 'Managed protocol lock helper is externally executable';
  end if;
end;
$privileges$;

insert into public.users (id, email, role) values
  ('a1100000-0000-4000-8000-000000000001', 'managed-teacher@example.test', 'teacher'),
  ('a1100000-0000-4000-8000-000000000002', 'managed-student@example.test', 'student');
insert into public.classrooms (id, teacher_id, title, class_code) values (
  'a1100000-0000-4000-8000-000000000003',
  'a1100000-0000-4000-8000-000000000001',
  'Managed storage fixture',
  'MSO119'
);
insert into public.classroom_enrollments (classroom_id, student_id) values (
  'a1100000-0000-4000-8000-000000000003',
  'a1100000-0000-4000-8000-000000000002'
);

-- Compatibility readiness must settle abandoned uploads without deleting
-- their bytes. Activation may then proceed, after which explicitly enabled
-- cleanup can claim the durable work and leave terminal tombstones.
select public.begin_managed_storage_upload(
  'a1100000-0000-4000-8000-000000000070',
  'submission-images', 'managed-fixture/expired-reserved.png',
  'a1100000-0000-4000-8000-000000000003', null, null,
  'student_inline_image',
  'a1100000-0000-4000-8000-000000000002',
  'a1100000-0000-4000-8000-000000000002',
  'assignment_doc', null, 'image/png', 4
);
select public.begin_managed_storage_provisional_owner(
  'a1100000-0000-4000-8000-000000000071',
  'course_blueprint_copy',
  'a1100000-0000-4000-8000-000000000072',
  'a1100000-0000-4000-8000-000000000001',
  null, null
);
select public.begin_managed_storage_upload(
  'a1100000-0000-4000-8000-000000000073',
  'test-documents', 'managed-fixture/expired-provisional.pdf',
  null, null, 'a1100000-0000-4000-8000-000000000071',
  'teacher_test_material',
  'a1100000-0000-4000-8000-000000000001', null,
  'course_blueprint_operation',
  'a1100000-0000-4000-8000-000000000072',
  'application/pdf', 4
);
insert into storage.objects (bucket_id, name) values (
  'test-documents', 'managed-fixture/expired-provisional.pdf'
);
select public.verify_managed_storage_upload(
  'a1100000-0000-4000-8000-000000000073', repeat('7', 64)
);
select public.queue_managed_storage_cleanup(
  'a1100000-0000-4000-8000-000000000073',
  'fixture_blueprint_downstream_failure'
);
select public.begin_managed_storage_provisional_owner(
  'a1100000-0000-4000-8000-000000000071',
  'course_blueprint_copy',
  'a1100000-0000-4000-8000-000000000072',
  'a1100000-0000-4000-8000-000000000001',
  null, null
);
select public.begin_managed_storage_upload(
  'a1100000-0000-4000-8000-000000000073',
  'test-documents', 'managed-fixture/expired-provisional.pdf',
  null, null, 'a1100000-0000-4000-8000-000000000071',
  'teacher_test_material',
  'a1100000-0000-4000-8000-000000000001', null,
  'course_blueprint_operation',
  'a1100000-0000-4000-8000-000000000072',
  'application/pdf', 4
);
do $blueprint_retry$
begin
  if (select status from public.managed_storage_objects
    where id = 'a1100000-0000-4000-8000-000000000073') <> 'verified'
  then raise exception 'Blueprint retry did not resume verified cleanup bytes'; end if;
end;
$blueprint_retry$;
update public.managed_storage_objects
set reservation_expires_at = clock_timestamp() - interval '1 second'
where id in (
  'a1100000-0000-4000-8000-000000000070',
  'a1100000-0000-4000-8000-000000000073'
);
update public.managed_storage_provisional_owners
set expires_at = clock_timestamp() - interval '1 second'
where id = 'a1100000-0000-4000-8000-000000000071';

do $expired_uploads$
declare
  v_run public.managed_storage_readiness_runs;
  v_claim public.managed_storage_objects;
  v_claim_count integer := 0;
begin
  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then
    raise exception 'Expired uploads blocked compatibility readiness with % findings',
      v_run.finding_count;
  end if;
  if exists (
    select 1 from public.managed_storage_objects
    where id in (
      'a1100000-0000-4000-8000-000000000070',
      'a1100000-0000-4000-8000-000000000073'
    ) and status <> 'cleanup_pending'
  ) then raise exception 'Expired uploads did not become cleanup work'; end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'test-documents'
      and name = 'managed-fixture/expired-provisional.pdf'
  ) then raise exception 'Readiness deleted expired provisional bytes'; end if;

  perform public.activate_managed_storage_enforcement(
    v_run.generation, v_run.inventory_digest
  );
  perform set_config('storage.allow_delete_query', 'true', true);
  for v_claim in
    select * from public.claim_managed_storage_cleanup(
      'a1100000-0000-4000-8000-000000000074', 25, 30
    )
  loop
    if v_claim.id not in (
      'a1100000-0000-4000-8000-000000000070',
      'a1100000-0000-4000-8000-000000000073'
    ) then continue; end if;
    v_claim_count := v_claim_count + 1;
    delete from storage.objects
    where bucket_id = v_claim.storage_bucket and name = v_claim.storage_path;
    if not public.complete_managed_storage_cleanup(
      v_claim.id, v_claim.lease_token
    ) then raise exception 'Expired upload cleanup did not complete'; end if;
  end loop;
  if v_claim_count <> 2 or exists (
    select 1 from public.managed_storage_objects
    where id in (
      'a1100000-0000-4000-8000-000000000070',
      'a1100000-0000-4000-8000-000000000073'
    ) and status <> 'deleted'
  ) then raise exception 'Expired upload cleanup did not leave tombstones'; end if;
  perform public.pause_managed_storage_enforcement();
end;
$expired_uploads$;
delete from public.managed_storage_objects where id in (
  'a1100000-0000-4000-8000-000000000070',
  'a1100000-0000-4000-8000-000000000073'
);
delete from public.managed_storage_provisional_owners
where id = 'a1100000-0000-4000-8000-000000000071';

-- Reserving an operational object must not attach it before the operation has
-- durably staged the matching bucket/path. The application binds all three
-- identity fields atomically after staging the intent.
insert into public.classroom_archive_operations (
  id, teacher_id, classroom_id, operation_type, request_sha256, status,
  source_revision, source_schema_migration, source_app_commit, retention,
  archive_id, snapshot_created_at, snapshot_expires_at
) values (
  'a1100000-0000-4000-8000-000000000008',
  'a1100000-0000-4000-8000-000000000001',
  'a1100000-0000-4000-8000-000000000003',
  'export', repeat('8', 64), 'snapshot_ready', 1,
  '107_classroom_archive_v2_direct_source', 'deadbee',
  '{"mode":"teacher_managed","delete_after":null}'::jsonb,
  'a1100000-0000-4000-8000-000000000008',
  clock_timestamp(), clock_timestamp() + interval '24 hours'
);
select public.begin_managed_storage_upload(
  'a1100000-0000-4000-8000-000000000009',
  'classroom-archives', 'managed-fixture/reserved-archive.tar.gz',
  'a1100000-0000-4000-8000-000000000003', null, null,
  'classroom_archive',
  'a1100000-0000-4000-8000-000000000001', null,
  'classroom_archive_operation',
  'a1100000-0000-4000-8000-000000000008',
  'application/gzip', 4
);
do $operation_reservation$
begin
  if exists (
    select 1 from public.classroom_archive_operations
    where id = 'a1100000-0000-4000-8000-000000000008'
      and (managed_object_id is not null or storage_path is not null)
  ) then
    raise exception 'Operational reservation attached before intent staging';
  end if;
end;
$operation_reservation$;
delete from public.managed_storage_objects
where id = 'a1100000-0000-4000-8000-000000000009';
delete from public.classroom_archive_operations
where id = 'a1100000-0000-4000-8000-000000000008';

insert into public.assignments (id, classroom_id, title, due_at, created_by) values (
  'a1100000-0000-4000-8000-000000000004',
  'a1100000-0000-4000-8000-000000000003',
  'Managed assignment',
  clock_timestamp() + interval '1 day',
  'a1100000-0000-4000-8000-000000000001'
);
insert into public.assignment_docs (id, assignment_id, student_id) values (
  'a1100000-0000-4000-8000-000000000005',
  'a1100000-0000-4000-8000-000000000004',
  'a1100000-0000-4000-8000-000000000002'
);
insert into public.assignment_submission_requirements (
  id, assignment_id, type, label, required, position
) values (
  'a1100000-0000-4000-8000-000000000006',
  'a1100000-0000-4000-8000-000000000004',
  'image', 'Evidence', true, 0
);

select public.begin_managed_storage_upload(
  'a1100000-0000-4000-8000-000000000010',
  'assignment-artifacts',
  'managed-fixture/attached.png',
  'a1100000-0000-4000-8000-000000000003',
  null, null,
  'student_assignment_artifact',
  'a1100000-0000-4000-8000-000000000002',
  'a1100000-0000-4000-8000-000000000002',
  'assignment_doc',
  'a1100000-0000-4000-8000-000000000005',
  'image/png', 4
);
insert into storage.objects (bucket_id, name)
values ('assignment-artifacts', 'managed-fixture/attached.png');
select public.verify_managed_storage_upload(
  'a1100000-0000-4000-8000-000000000010', null
);
insert into public.assignment_submission_artifacts (
  id, assignment_doc_id, requirement_id, student_id, type,
  storage_path, managed_object_id
) values (
  'a1100000-0000-4000-8000-000000000011',
  'a1100000-0000-4000-8000-000000000005',
  'a1100000-0000-4000-8000-000000000006',
  'a1100000-0000-4000-8000-000000000002',
  'image', 'managed-fixture/attached.png',
  'a1100000-0000-4000-8000-000000000010'
);

insert into storage.objects (bucket_id, name) values (
  'test-documents', 'managed-fixture/legacy-blueprint-copy.pdf'
);
insert into public.tests (
  id, classroom_id, title, status, created_by, documents
) values (
  'a1100000-0000-4000-8000-000000000007',
  'a1100000-0000-4000-8000-000000000003',
  'Legacy Blueprint copy source', 'draft',
  'a1100000-0000-4000-8000-000000000001',
  '[{
    "id":"legacy-copy-document",
    "title":"Legacy copy",
    "source":"upload",
    "url":"https://fixture.invalid/storage/v1/object/public/test-documents/managed-fixture/legacy-blueprint-copy.pdf"
  }]'::jsonb
);

do $fixture$
declare
  v_run public.managed_storage_readiness_runs;
  v_claim public.managed_storage_objects;
  v_artifact_cleanup public.assignment_artifact_storage_cleanup;
  v_snapshot_cleanup public.test_document_snapshot_storage_cleanup;
  v_compat_cleanup_id uuid;
  v_assignment_cancel_id uuid;
  v_snapshot_cancel_id uuid;
  v_referenced_missing_id uuid;
  v_legacy_id uuid;
  v_blueprint_source public.managed_storage_objects;
  v_object_status text;
begin
  if (select status from public.managed_storage_objects
      where id = 'a1100000-0000-4000-8000-000000000010') <> 'ready'
  then raise exception 'Relational attach did not atomically adopt the object'; end if;
  if public.queue_managed_storage_cleanup(
    'a1100000-0000-4000-8000-000000000010',
    'fixture_replayed_copy_not_adopted'
  ) then
    raise exception 'Replay cleanup queued a concurrently adopted object';
  end if;
  if (select status from public.managed_storage_objects
      where id = 'a1100000-0000-4000-8000-000000000010') <> 'ready'
  then raise exception 'Replay cleanup changed a concurrently adopted object'; end if;

  -- Compatibility readiness must not be evaluated while this deliberate raw
  -- Blueprint source is still ownerless. Resolve it through the same atomic
  -- adoption path used by the application before any ready-state assertion.
  select * into v_blueprint_source
  from public.resolve_managed_storage_blueprint_copy_source(
    'a1100000-0000-4000-8000-000000000001',
    'managed-fixture/legacy-blueprint-copy.pdf',
    'a1100000-0000-4000-8000-000000000003', null, null
  );
  if v_blueprint_source.status <> 'ready'
    or v_blueprint_source.classroom_id is distinct from
      'a1100000-0000-4000-8000-000000000003'
    or v_blueprint_source.storage_path <> 'managed-fixture/legacy-blueprint-copy.pdf'
  then
    raise exception 'Blueprint legacy source was not atomically registered';
  end if;
  perform public.reconcile_managed_storage_json_references();

  -- Both raw-only cleanup tables must remain writable by migration-116 code
  -- while the protocol is in compatibility mode.
  insert into public.assignment_artifact_storage_cleanup (storage_path)
  values ('managed-fixture/compatibility-assignment.png');
  insert into public.test_document_snapshot_storage_cleanup (storage_path)
  values (
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/compatibility'
  );
  delete from public.assignment_artifact_storage_cleanup
  where storage_path = 'managed-fixture/compatibility-assignment.png';
  delete from public.test_document_snapshot_storage_cleanup
  where storage_path =
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/compatibility';

  -- Once an exact managed object exists, even a migration-116 cleanup writer
  -- is bound to managed authority while the protocol remains compatible.
  insert into storage.objects (bucket_id, name)
  values ('assignment-artifacts', 'managed-fixture/compatibility-managed.png');
  v_compat_cleanup_id := public.managed_storage_legacy_object_id(
    'assignment-artifacts', 'managed-fixture/compatibility-managed.png'
  );
  perform public.register_legacy_managed_storage_object(
    v_compat_cleanup_id,
    'assignment-artifacts', 'managed-fixture/compatibility-managed.png',
    'a1100000-0000-4000-8000-000000000003', null,
    'student_assignment_artifact',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000002',
    'assignment_doc', 'a1100000-0000-4000-8000-000000000005',
    'image/png', 4, repeat('c', 64)
  );
  insert into public.assignment_artifact_storage_cleanup (storage_path)
  values ('managed-fixture/compatibility-managed.png')
  returning * into v_artifact_cleanup;
  if v_artifact_cleanup.managed_object_id is distinct from v_compat_cleanup_id then
    raise exception 'Compatibility cleanup was not bound to managed authority';
  end if;
  select * into v_artifact_cleanup
  from public.claim_assignment_artifact_storage_cleanup(
    'a1100000-0000-4000-8000-000000000041', 1, 30
  );
  if v_artifact_cleanup.managed_object_id is distinct from v_compat_cleanup_id
    or (select status from public.managed_storage_objects
      where id = v_compat_cleanup_id) <> 'cleanup_processing'
  then raise exception 'Compatibility cleanup lease was not mirrored'; end if;
  begin
    update storage.objects set name = name
    where bucket_id = 'assignment-artifacts'
      and name = 'managed-fixture/compatibility-managed.png';
    raise exception 'Compatibility writer overtook a managed cleanup lease';
  exception when sqlstate '55000' then
    if sqlerrm not like '%managed_storage_cleanup_in_progress%' then raise; end if;
  end;
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
  where bucket_id = 'assignment-artifacts'
    and name = 'managed-fixture/compatibility-managed.png';
  if exists (
    select 1 from storage.objects
    where bucket_id = 'assignment-artifacts'
      and name = 'managed-fixture/compatibility-managed.png'
  ) then raise exception 'Compatibility cleanup did not remove Storage bytes'; end if;
  if public.managed_storage_object_is_referenced(v_compat_cleanup_id) then
    raise exception 'Compatibility cleanup incorrectly retained a live reference';
  end if;
  if exists (
    select 1 from public.assignment_submission_artifacts reference
    where reference.storage_path = 'managed-fixture/compatibility-managed.png'
  ) then raise exception 'Compatibility cleanup unexpectedly retained a raw reference'; end if;
  if not coalesce(public.complete_assignment_artifact_storage_cleanup(
    v_artifact_cleanup.id, v_artifact_cleanup.lease_token
  ), false) then raise exception 'Compatibility cleanup RPC did not complete'; end if;
  select status into v_object_status from public.managed_storage_objects
  where id = v_compat_cleanup_id;
  if v_object_status is distinct from 'deleted' then
    raise exception 'Compatibility cleanup lifecycle state was %', v_object_status;
  end if;
  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then
    raise exception 'Compatibility cleanup left managed readiness blocked';
  end if;

  -- Migration-116 workers use completion to cancel a cleanup if a reference
  -- appears after claim. Preserve the bytes and restore managed readiness.
  insert into storage.objects (bucket_id, name)
  values ('assignment-artifacts', 'managed-fixture/compatibility-cancelled.png');
  v_assignment_cancel_id := public.managed_storage_legacy_object_id(
    'assignment-artifacts', 'managed-fixture/compatibility-cancelled.png'
  );
  perform public.register_legacy_managed_storage_object(
    v_assignment_cancel_id,
    'assignment-artifacts', 'managed-fixture/compatibility-cancelled.png',
    'a1100000-0000-4000-8000-000000000003', null,
    'student_assignment_artifact',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000002',
    'assignment_doc', 'a1100000-0000-4000-8000-000000000005',
    'image/png', 4, repeat('d', 64)
  );
  insert into public.assignment_artifact_storage_cleanup (storage_path)
  values ('managed-fixture/compatibility-cancelled.png');
  select * into v_artifact_cleanup
  from public.claim_assignment_artifact_storage_cleanup(
    'a1100000-0000-4000-8000-000000000042', 1, 30
  );
  if (select attempt_count from public.managed_storage_objects
    where id = v_assignment_cancel_id) <> 1
  then raise exception 'Initial managed cleanup attempt was not counted'; end if;
  update public.assignment_artifact_storage_cleanup
  set lease_expires_at = clock_timestamp() + interval '60 seconds'
  where id = v_artifact_cleanup.id;
  if (select attempt_count from public.managed_storage_objects
    where id = v_assignment_cancel_id) <> 1
  then raise exception 'Same-token lease renewal changed managed attempts'; end if;
  update public.assignment_artifact_storage_cleanup
  set lease_expires_at = clock_timestamp() - interval '1 second'
  where id = v_artifact_cleanup.id;
  select * into v_artifact_cleanup
  from public.claim_assignment_artifact_storage_cleanup(
    'a1100000-0000-4000-8000-000000000043', 1, 30
  );
  if (select attempt_count from public.managed_storage_objects
    where id = v_assignment_cancel_id) <> 2
  then raise exception 'Expired lease reclaim was not counted'; end if;
  if not coalesce(public.fail_assignment_artifact_storage_cleanup(
    v_artifact_cleanup.id, v_artifact_cleanup.lease_token, 'fixture_retry'
  ), false) then raise exception 'Operational cleanup failure RPC did not complete'; end if;
  select status into v_object_status from public.managed_storage_objects
  where id = v_assignment_cancel_id;
  if v_object_status is distinct from 'cleanup_pending' then
    raise exception 'Operational cleanup failure lifecycle state was %', v_object_status;
  end if;
  update public.assignment_artifact_storage_cleanup
  set next_attempt_at = clock_timestamp() - interval '1 second'
  where id = v_artifact_cleanup.id;
  select * into v_artifact_cleanup
  from public.claim_assignment_artifact_storage_cleanup(
    'a1100000-0000-4000-8000-000000000044', 1, 30
  );
  if (select attempt_count from public.managed_storage_objects
    where id = v_assignment_cancel_id) <> 3
  then raise exception 'Managed cleanup retry was not counted'; end if;
  insert into public.assignment_submission_requirements (
    id, assignment_id, type, label, required, position
  ) values (
    'a1100000-0000-4000-8000-000000000007',
    'a1100000-0000-4000-8000-000000000004',
    'image', 'Cancellation evidence', false, 1
  );
  insert into public.assignment_submission_artifacts (
    id, assignment_doc_id, requirement_id, student_id, type, storage_path
  ) values (
    'a1100000-0000-4000-8000-000000000050',
    'a1100000-0000-4000-8000-000000000005',
    'a1100000-0000-4000-8000-000000000007',
    'a1100000-0000-4000-8000-000000000002',
    'image', 'managed-fixture/compatibility-cancelled.png'
  );
  if (select managed_object_id from public.assignment_submission_artifacts
    where id = 'a1100000-0000-4000-8000-000000000050')
      is distinct from v_assignment_cancel_id
  then raise exception 'Assignment cancellation writer did not adopt managed identity'; end if;
  if not coalesce(public.complete_assignment_artifact_storage_cleanup(
    v_artifact_cleanup.id, v_artifact_cleanup.lease_token
  ), false) then raise exception 'Assignment cleanup cancellation RPC did not complete'; end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'assignment-artifacts'
      and name = 'managed-fixture/compatibility-cancelled.png'
  ) then raise exception 'Assignment cleanup cancellation removed Storage bytes'; end if;
  select status into v_object_status from public.managed_storage_objects
  where id = v_assignment_cancel_id;
  if v_object_status is distinct from 'ready' then
    raise exception 'Assignment cleanup cancellation lifecycle state was %', v_object_status;
  end if;
  perform public.reconcile_managed_storage_relational_references();
  if (select managed_object_id from public.assignment_submission_artifacts
    where id = 'a1100000-0000-4000-8000-000000000050')
      is distinct from v_assignment_cancel_id
  then raise exception 'Cancelled assignment reference was not reconciled'; end if;

  insert into storage.objects (bucket_id, name) values (
    'test-documents',
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/compatibility-cancelled'
  );
  v_snapshot_cancel_id := public.managed_storage_legacy_object_id(
    'test-documents',
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/compatibility-cancelled'
  );
  perform public.register_legacy_managed_storage_object(
    v_snapshot_cancel_id,
    'test-documents',
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/compatibility-cancelled',
    'a1100000-0000-4000-8000-000000000003', null,
    'test_execution_snapshot',
    'a1100000-0000-4000-8000-000000000001', null,
    'test', 'a1100000-0000-4000-8000-000000000051',
    'text/html', 4, repeat('e', 64)
  );
  insert into public.test_document_snapshot_storage_cleanup (storage_path)
  values (
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/compatibility-cancelled'
  );
  select * into v_snapshot_cleanup
  from public.claim_test_document_snapshot_storage_cleanup(
    'a1100000-0000-4000-8000-000000000045', 1, 30
  );
  insert into public.tests (
    id, classroom_id, title, status, created_by, documents
  ) values (
    'a1100000-0000-4000-8000-000000000051',
    'a1100000-0000-4000-8000-000000000003',
    'Compatibility cancellation test', 'draft',
    'a1100000-0000-4000-8000-000000000001',
    '[{
      "id":"cancel-doc",
      "title":"Cancellation reference",
      "source":"link",
      "url":"https://example.test/cancel",
      "snapshot_path":"link-docs/a1100000-0000-4000-8000-000000000001/snapshots/compatibility-cancelled",
      "snapshot_content_type":"text/html",
      "synced_at":"2026-08-03T00:00:00Z"
    }]'::jsonb
  );
  if not coalesce(public.complete_test_document_snapshot_storage_cleanup(
    v_snapshot_cleanup.id, v_snapshot_cleanup.lease_token
  ), false) then raise exception 'Snapshot cleanup cancellation RPC did not complete'; end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'test-documents'
      and name = 'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/compatibility-cancelled'
  ) then raise exception 'Snapshot cleanup cancellation removed Storage bytes'; end if;
  select status into v_object_status from public.managed_storage_objects
  where id = v_snapshot_cancel_id;
  if v_object_status is distinct from 'ready' then
    raise exception 'Snapshot cleanup cancellation lifecycle state was %', v_object_status;
  end if;
  perform public.reconcile_managed_storage_json_references();
  if not exists (
    select 1 from public.managed_storage_json_references
    where test_id = 'a1100000-0000-4000-8000-000000000051'
      and managed_object_id = v_snapshot_cancel_id
  ) then raise exception 'Cancelled snapshot reference was not reconciled'; end if;

  -- Completion must fail closed when persistent metadata references an object
  -- whose bytes are already absent, even if a faulty worker reached that state.
  insert into storage.objects (bucket_id, name) values (
    'test-documents',
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/referenced-missing'
  );
  v_referenced_missing_id := public.managed_storage_legacy_object_id(
    'test-documents',
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/referenced-missing'
  );
  perform public.register_legacy_managed_storage_object(
    v_referenced_missing_id,
    'test-documents',
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/referenced-missing',
    'a1100000-0000-4000-8000-000000000003', null,
    'test_execution_snapshot',
    'a1100000-0000-4000-8000-000000000001', null,
    'test', 'a1100000-0000-4000-8000-000000000051',
    'text/html', 4, repeat('f', 64)
  );
  insert into public.test_document_snapshot_storage_cleanup (storage_path)
  values (
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/referenced-missing'
  );
  select * into v_snapshot_cleanup
  from public.claim_test_document_snapshot_storage_cleanup(
    'a1100000-0000-4000-8000-000000000046', 1, 30
  );
  delete from storage.objects
  where bucket_id = 'test-documents'
    and name =
      'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/referenced-missing';
  insert into public.managed_storage_json_references (
    managed_object_id, storage_bucket, storage_path, test_id,
    reference_role, evidence_sha256
  ) values (
    v_referenced_missing_id, 'test-documents',
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/referenced-missing',
    'a1100000-0000-4000-8000-000000000051',
    'execution_snapshot', repeat('f', 64)
  );
  begin
    perform public.complete_test_document_snapshot_storage_cleanup(
      v_snapshot_cleanup.id, v_snapshot_cleanup.lease_token
    );
    raise exception 'Referenced-but-absent cleanup completed';
  exception when sqlstate '55000' then
    if sqlerrm not like '%managed_storage_cleanup_referenced_missing%' then raise; end if;
  end;
  delete from public.managed_storage_json_references
  where managed_object_id = v_referenced_missing_id;
  if not coalesce(public.complete_test_document_snapshot_storage_cleanup(
    v_snapshot_cleanup.id, v_snapshot_cleanup.lease_token
  ), false) then raise exception 'Referenced-missing cleanup recovery RPC failed'; end if;
  select status into v_object_status from public.managed_storage_objects
  where id = v_referenced_missing_id;
  if v_object_status is distinct from 'deleted' then
    raise exception 'Referenced-missing cleanup recovery state was %', v_object_status;
  end if;

  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then
    raise exception 'Cleanup cancellation left managed readiness blocked';
  end if;

  insert into storage.objects (bucket_id, name)
  values ('assignment-artifacts', 'managed-fixture/legacy-replay.png');
  v_legacy_id := public.managed_storage_legacy_object_id(
    'assignment-artifacts', 'managed-fixture/legacy-replay.png'
  );
  perform public.register_legacy_managed_storage_object(
    v_legacy_id, 'assignment-artifacts', 'managed-fixture/legacy-replay.png',
    'a1100000-0000-4000-8000-000000000003', null,
    'student_assignment_artifact',
    'a1100000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000002',
    'assignment_doc', 'a1100000-0000-4000-8000-000000000005',
    'image/png', 4, repeat('a', 64)
  );
  begin
    perform public.register_legacy_managed_storage_object(
      v_legacy_id, 'assignment-artifacts', 'managed-fixture/legacy-replay.png',
      'a1100000-0000-4000-8000-000000000003', null,
      'student_assignment_artifact',
      'a1100000-0000-4000-8000-000000000001',
      'a1100000-0000-4000-8000-000000000001',
      'assignment_doc', 'a1100000-0000-4000-8000-000000000005',
      'image/png', 4, repeat('a', 64)
    );
    raise exception 'Legacy subject conflict was accepted';
  exception when sqlstate '23505' then null;
  end;
  begin
    perform public.register_legacy_managed_storage_object(
      v_legacy_id, 'assignment-artifacts', 'managed-fixture/legacy-replay.png',
      'a1100000-0000-4000-8000-000000000003', null,
      'student_assignment_artifact',
      'a1100000-0000-4000-8000-000000000001',
      'a1100000-0000-4000-8000-000000000002',
      'assignment_doc', 'a1100000-0000-4000-8000-000000000099',
      'image/png', 4, repeat('a', 64)
    );
    raise exception 'Legacy resource conflict was accepted';
  exception when sqlstate '23505' then null;
  end;
  begin
    perform public.register_legacy_managed_storage_object(
      v_legacy_id, 'assignment-artifacts', 'managed-fixture/legacy-replay.png',
      'a1100000-0000-4000-8000-000000000003', null,
      'student_assignment_artifact',
      'a1100000-0000-4000-8000-000000000001',
      'a1100000-0000-4000-8000-000000000002',
      'assignment_doc', 'a1100000-0000-4000-8000-000000000005',
      'image/png', 4, repeat('b', 64)
    );
    raise exception 'Legacy checksum conflict was accepted';
  exception when sqlstate '23505' then null;
  end;
  perform public.queue_managed_storage_cleanup(v_legacy_id, 'fixture_legacy_replay');

  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then
    raise exception 'Expected ready managed inventory, found % findings', v_run.finding_count;
  end if;
  perform public.activate_managed_storage_enforcement(v_run.generation, v_run.inventory_digest);
  if (select mode from public.managed_storage_settings where singleton)
      is distinct from 'enforced'
  then raise exception 'Managed-storage activation did not persist enforced mode'; end if;
  if not public.lock_managed_storage_protocol() then
    raise exception 'Managed-storage protocol lock did not observe enforcement';
  end if;
  begin
    perform public.resolve_managed_storage_blueprint_copy_source(
      'a1100000-0000-4000-8000-000000000001',
      'managed-fixture/legacy-after-enforcement.pdf',
      'a1100000-0000-4000-8000-000000000003', null, null
    );
    raise exception 'Blueprint lazy registration remained available after enforcement';
  exception when sqlstate '55000' then
    if sqlerrm not like '%managed_storage_blueprint_copy_source_invalid%' then raise; end if;
  end;

  begin
    update public.assignment_submission_artifacts
    set managed_object_id = null
    where id = 'a1100000-0000-4000-8000-000000000011';
    raise exception 'Managed identity removal was not rejected';
  exception when sqlstate '55000' then
    if sqlerrm not like '%assignment_artifact_managed%' then raise; end if;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('submission-images', 'managed-fixture/unreserved.png');
    raise exception 'Legacy Storage writer was not rejected';
  exception when sqlstate '55000' then null;
  end;

  perform public.pause_managed_storage_enforcement();
  begin
    perform public.claim_managed_storage_cleanup(
      'a1100000-0000-4000-8000-000000000021', 1, 30
    );
    raise exception 'Compatibility-mode cleanup claim was not rejected';
  exception when sqlstate '55000' then
    if sqlerrm not like '%managed_storage_cleanup_requires_enforcement%' then raise; end if;
  end;
  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then
    raise exception 'Expected ready inventory before cleanup activation';
  end if;
  perform public.activate_managed_storage_enforcement(v_run.generation, v_run.inventory_digest);
  perform public.begin_managed_storage_upload(
    'a1100000-0000-4000-8000-000000000020',
    'submission-images', 'managed-fixture/interrupted.png',
    'a1100000-0000-4000-8000-000000000003', null, null,
    'student_inline_image',
    'a1100000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002',
    'assignment_doc', 'a1100000-0000-4000-8000-000000000005',
    'image/png', 4
  );
  insert into storage.objects (bucket_id, name)
  values ('submission-images', 'managed-fixture/interrupted.png');
  update public.managed_storage_objects
  set reservation_expires_at = clock_timestamp() - interval '1 second'
  where id = 'a1100000-0000-4000-8000-000000000020';
  select claimed.* into v_claim
  from public.claim_managed_storage_cleanup(
    'a1100000-0000-4000-8000-000000000021', 25, 30
  ) claimed
  where claimed.id = 'a1100000-0000-4000-8000-000000000020';
  if v_claim.id is distinct from 'a1100000-0000-4000-8000-000000000020' then
    raise exception 'Interrupted upload was not claimed for cleanup';
  end if;
  delete from storage.objects
  where bucket_id = v_claim.storage_bucket and name = v_claim.storage_path;
  if not public.complete_managed_storage_cleanup(v_claim.id, v_claim.lease_token) then
    raise exception 'Cleanup completion failed';
  end if;
  if not public.complete_managed_storage_cleanup(v_claim.id, v_claim.lease_token) then
    raise exception 'Cleanup completion replay was not idempotent';
  end if;
  if (select status from public.managed_storage_objects where id = v_claim.id) <> 'deleted' then
    raise exception 'Cleanup did not preserve a terminal managed-object tombstone';
  end if;

  perform public.begin_managed_storage_upload(
    'a1100000-0000-4000-8000-000000000022',
    'assignment-artifacts', 'managed-fixture/legacy-worker.png',
    'a1100000-0000-4000-8000-000000000003', null, null,
    'student_assignment_artifact',
    'a1100000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002',
    'assignment_doc', 'a1100000-0000-4000-8000-000000000005',
    'image/png', 4
  );
  insert into storage.objects (bucket_id, name)
  values ('assignment-artifacts', 'managed-fixture/legacy-worker.png');
  perform public.verify_managed_storage_upload(
    'a1100000-0000-4000-8000-000000000022', null
  );
  insert into public.assignment_artifact_storage_cleanup (
    storage_path, managed_object_id
  ) values (
    'managed-fixture/legacy-worker.png',
    'a1100000-0000-4000-8000-000000000022'
  );
  select * into v_artifact_cleanup
  from public.claim_assignment_artifact_storage_cleanup(
    'a1100000-0000-4000-8000-000000000023', 1, 30
  );
  delete from storage.objects
  where bucket_id = 'assignment-artifacts'
    and name = 'managed-fixture/legacy-worker.png';
  if not coalesce(public.complete_assignment_artifact_storage_cleanup(
    v_artifact_cleanup.id, v_artifact_cleanup.lease_token
  ), false) then raise exception 'Assignment cleanup RPC did not complete'; end if;
  select status into v_object_status from public.managed_storage_objects
  where id = 'a1100000-0000-4000-8000-000000000022';
  if v_object_status is distinct from 'deleted' then
    raise exception 'Assignment cleanup authority state was %', v_object_status;
  end if;

  perform public.begin_managed_storage_upload(
    'a1100000-0000-4000-8000-000000000024',
    'test-documents',
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/legacy-worker',
    'a1100000-0000-4000-8000-000000000003', null, null,
    'test_execution_snapshot',
    'a1100000-0000-4000-8000-000000000001', null,
    'test', null, 'application/pdf', 4
  );
  insert into storage.objects (bucket_id, name) values (
    'test-documents',
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/legacy-worker'
  );
  perform public.verify_managed_storage_upload(
    'a1100000-0000-4000-8000-000000000024', null
  );
  insert into public.test_document_snapshot_storage_cleanup (
    storage_path, managed_object_id
  ) values (
    'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/legacy-worker',
    'a1100000-0000-4000-8000-000000000024'
  );
  select * into v_snapshot_cleanup
  from public.claim_test_document_snapshot_storage_cleanup(
    'a1100000-0000-4000-8000-000000000025', 1, 30
  );
  delete from storage.objects
  where bucket_id = 'test-documents'
    and name = 'link-docs/a1100000-0000-4000-8000-000000000001/snapshots/legacy-worker';
  if not coalesce(public.complete_test_document_snapshot_storage_cleanup(
    v_snapshot_cleanup.id, v_snapshot_cleanup.lease_token
  ), false) then raise exception 'Snapshot cleanup RPC did not complete'; end if;
  select status into v_object_status from public.managed_storage_objects
  where id = 'a1100000-0000-4000-8000-000000000024';
  if v_object_status is distinct from 'deleted' then
    raise exception 'Snapshot cleanup authority state was %', v_object_status;
  end if;

  perform public.begin_managed_storage_upload(
    'a1100000-0000-4000-8000-000000000030',
    'submission-images', 'managed-fixture/wrong-resource.png',
    'a1100000-0000-4000-8000-000000000003', null, null,
    'student_inline_image',
    'a1100000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002',
    'assignment_doc', 'a1100000-0000-4000-8000-000000000099',
    'image/png', 4
  );
  insert into storage.objects (bucket_id, name)
  values ('submission-images', 'managed-fixture/wrong-resource.png');
  perform public.verify_managed_storage_upload(
    'a1100000-0000-4000-8000-000000000030', null
  );
  begin
    update public.assignment_docs set content = jsonb_build_object(
      'type', 'image', 'attrs', jsonb_build_object(
        'src', 'https://fixture.invalid/storage/v1/object/public/submission-images/managed-fixture/wrong-resource.png',
        'managed_object_id', 'a1100000-0000-4000-8000-000000000030'
      )
    ) where id = 'a1100000-0000-4000-8000-000000000005';
    raise exception 'Assignment-document resource mismatch was not rejected';
  exception when sqlstate '55000' then
    if sqlerrm not like '%managed_storage_embedded_resource_mismatch%' then raise; end if;
  end;
  perform public.queue_managed_storage_cleanup(
    'a1100000-0000-4000-8000-000000000030', 'fixture_wrong_resource'
  );

  perform public.begin_managed_storage_upload(
    'a1100000-0000-4000-8000-000000000031',
    'submission-images', 'managed-fixture/exact.png',
    'a1100000-0000-4000-8000-000000000003', null, null,
    'student_inline_image',
    'a1100000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002',
    'assignment_doc', 'a1100000-0000-4000-8000-000000000005',
    'image/png', 4
  );
  insert into storage.objects (bucket_id, name)
  values ('submission-images', 'managed-fixture/exact.png');
  perform public.verify_managed_storage_upload(
    'a1100000-0000-4000-8000-000000000031', null
  );
  begin
    update public.assignment_docs set content = jsonb_build_object(
      'type', 'image', 'attrs', jsonb_build_object(
        'src', 'https://fixture.invalid/storage/v1/object/public/test-documents/managed-fixture/exact.png',
        'managed_object_id', 'a1100000-0000-4000-8000-000000000031'
      )
    ) where id = 'a1100000-0000-4000-8000-000000000005';
    raise exception 'Managed UUID and bucket/path mismatch was not rejected';
  exception when sqlstate '55000' then
    if sqlerrm not like '%managed_storage_embedded_owner_mismatch%' then raise; end if;
  end;
  update public.assignment_docs set content = jsonb_build_object(
    'type', 'image', 'attrs', jsonb_build_object(
      'src', 'https://fixture.invalid/storage/v1/object/public/submission-images/managed-fixture/exact.png',
      'managed_object_id', 'a1100000-0000-4000-8000-000000000031'
    )
  ) where id = 'a1100000-0000-4000-8000-000000000005';
  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then
    raise exception 'Exact embedded identity did not produce ready evidence';
  end if;
  update public.assignment_docs set content = '{}'::jsonb
  where id = 'a1100000-0000-4000-8000-000000000005';
  begin
    perform public.activate_managed_storage_enforcement(v_run.generation, v_run.inventory_digest);
    raise exception 'Reference removal did not invalidate readiness evidence';
  exception when sqlstate '55000' then
    if sqlerrm not like '%managed_storage_readiness_stale%' then raise; end if;
  end;
end;
$fixture$;

rollback;
SQL

echo "Managed-storage database contract checks passed."

# Prove that activation cannot overtake a writer which observed compatibility
# mode. The writer holds the shared protocol lock, then advances the revision
# and commits. Activation waits for that transaction and must reject the stale
# readiness evidence rather than enabling enforcement.
concurrency_dir="$(mktemp -d)"
trap 'rm -r -- "$concurrency_dir"' EXIT
readiness_evidence="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -q -A -t -F '|' -v ON_ERROR_STOP=1 <<'SQL'
insert into public.users (id, email, role) values (
  'a1200000-0000-4000-8000-000000000001',
  'managed-concurrency@example.test',
  'teacher'
);
insert into public.classrooms (id, teacher_id, title, class_code) values (
  'a1200000-0000-4000-8000-000000000002',
  'a1200000-0000-4000-8000-000000000001',
  'Managed concurrency fixture',
  'MSOACT'
);
select generation, inventory_digest
from public.refresh_managed_storage_readiness();
SQL
)"
readiness_generation="${readiness_evidence%%|*}"
readiness_digest="${readiness_evidence##*|}"
if [[ ! "$readiness_generation" =~ ^[0-9]+$ || ! "$readiness_digest" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Managed-storage concurrency readiness evidence was invalid." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/writer.out" 2>"$concurrency_dir/writer.err" <<'SQL' &
set application_name = 'managed-storage-activation-writer';
begin;
select public.begin_managed_storage_upload(
  'a1200000-0000-4000-8000-000000000003',
  'submission-images', 'managed-fixture/concurrent.png',
  'a1200000-0000-4000-8000-000000000002', null, null,
  'student_inline_image',
  'a1200000-0000-4000-8000-000000000001', null,
  'assignment_doc', null, 'image/png', 4
);
select pg_sleep(3);
insert into storage.objects (bucket_id, name)
values ('submission-images', 'managed-fixture/concurrent.png');
commit;
SQL
writer_pid=$!

writer_waiting=false
for _ in $(seq 1 50); do
  active_writer="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -A -t -c \
    "select count(*) from pg_stat_activity where application_name = 'managed-storage-activation-writer' and state = 'active' and query like '%pg_sleep%';")"
  if [[ "$active_writer" = "1" ]]; then
    writer_waiting=true
    break
  fi
  sleep 0.1
done
if [[ "$writer_waiting" != "true" ]]; then
  wait "$writer_pid" || true
  echo "Managed-storage concurrency writer did not reach the activation fence." >&2
  exit 1
fi

set +e
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c \
  "select public.activate_managed_storage_enforcement(${readiness_generation}, '${readiness_digest}');" \
  >"$concurrency_dir/activation.out" 2>"$concurrency_dir/activation.err"
activation_status=$?
set -e
wait "$writer_pid"
if [[ "$activation_status" -eq 0 ]] \
  || ! grep -q 'managed_storage_readiness_stale' "$concurrency_dir/activation.err"; then
  echo "Managed-storage activation overtook a pre-enforcement writer (status ${activation_status})." >&2
  sed -n '1,80p' "$concurrency_dir/activation.err" >&2
  sed -n '1,40p' "$concurrency_dir/activation.out" >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
select set_config('storage.allow_delete_query', 'true', true);
do $fixture$
begin
  if (select mode from public.managed_storage_settings where singleton) <> 'compatibility'
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'submission-images' and name = 'managed-fixture/concurrent.png'
    )
  then
    raise exception 'Concurrent writer/activation postcondition failed';
  end if;
end;
$fixture$;
delete from public.managed_storage_objects
where id = 'a1200000-0000-4000-8000-000000000003';
delete from storage.objects
where bucket_id = 'submission-images' and name = 'managed-fixture/concurrent.png';
delete from public.classrooms where id = 'a1200000-0000-4000-8000-000000000002';
delete from public.users where id = 'a1200000-0000-4000-8000-000000000001';
commit;
SQL

echo "Managed-storage activation concurrency checks passed."

# Prove that atomic compatibility adoption and a late raw cross-owner writer
# share the exact-path fence. The writer starts while the path is still
# ownerless, waits for the resolver to register Classroom A, then must recheck
# and reject attaching that path to Classroom B.
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
insert into public.users (id, email, role) values
  ('a1400000-0000-4000-8000-000000000001', 'managed-adopt-a@example.test', 'teacher'),
  ('a1400000-0000-4000-8000-000000000002', 'managed-adopt-b@example.test', 'teacher');
insert into public.classrooms (id, teacher_id, title, class_code) values
  (
    'a1400000-0000-4000-8000-000000000003',
    'a1400000-0000-4000-8000-000000000001',
    'Managed adoption source', 'MSOADA'
  ),
  (
    'a1400000-0000-4000-8000-000000000004',
    'a1400000-0000-4000-8000-000000000002',
    'Managed adoption contender', 'MSOADB'
  );
insert into storage.objects (bucket_id, name) values (
  'test-documents', 'managed-race/blueprint-adoption.pdf'
);
insert into public.tests (
  id, classroom_id, title, status, created_by, documents
) values
  (
    'a1400000-0000-4000-8000-000000000005',
    'a1400000-0000-4000-8000-000000000003',
    'Managed adoption source Test', 'draft',
    'a1400000-0000-4000-8000-000000000001',
    '[{
      "id":"adoption-source",
      "source":"upload",
      "url":"https://fixture.invalid/storage/v1/object/public/test-documents/managed-race/blueprint-adoption.pdf"
    }]'::jsonb
  ),
  (
    'a1400000-0000-4000-8000-000000000006',
    'a1400000-0000-4000-8000-000000000004',
    'Managed adoption contender Test', 'draft',
    'a1400000-0000-4000-8000-000000000002', '[]'::jsonb
  ),
  (
    'a1400000-0000-4000-8000-000000000007',
    'a1400000-0000-4000-8000-000000000003',
    'Managed raw lock-order Test', 'draft',
    'a1400000-0000-4000-8000-000000000001', '[]'::jsonb
  ),
  (
    'a1400000-0000-4000-8000-000000000008',
    'a1400000-0000-4000-8000-000000000003',
    'Managed previous-identity Test', 'draft',
    'a1400000-0000-4000-8000-000000000001', '[]'::jsonb
  );
select public.begin_managed_storage_upload(
  'a1400000-0000-4000-8000-000000000010',
  'test-documents', 'managed-race/z-uuid-first.pdf',
  'a1400000-0000-4000-8000-000000000003', null, null,
  'teacher_test_material',
  'a1400000-0000-4000-8000-000000000001', null,
  'test', 'a1400000-0000-4000-8000-000000000007',
  'application/pdf', 4
);
select public.begin_managed_storage_upload(
  'a1400000-0000-4000-8000-000000000011',
  'test-documents', 'managed-race/a-uuid-second.pdf',
  'a1400000-0000-4000-8000-000000000003', null, null,
  'teacher_test_material',
  'a1400000-0000-4000-8000-000000000001', null,
  'test', 'a1400000-0000-4000-8000-000000000007',
  'application/pdf', 4
);
select public.begin_managed_storage_upload(
  'a1400000-0000-4000-8000-000000000012',
  'test-documents', 'managed-race/previous-identity.pdf',
  'a1400000-0000-4000-8000-000000000003', null, null,
  'teacher_test_material',
  'a1400000-0000-4000-8000-000000000001', null,
  'test', 'a1400000-0000-4000-8000-000000000008',
  'application/pdf', 4
);
insert into storage.objects (bucket_id, name) values
  ('test-documents', 'managed-race/z-uuid-first.pdf'),
  ('test-documents', 'managed-race/a-uuid-second.pdf'),
  ('test-documents', 'managed-race/previous-identity.pdf');
select public.verify_managed_storage_upload(id, null)
from public.managed_storage_objects
where id in (
  'a1400000-0000-4000-8000-000000000010',
  'a1400000-0000-4000-8000-000000000011',
  'a1400000-0000-4000-8000-000000000012'
)
order by id;
update public.tests
set documents = '[{
  "id":"previous-managed-identity",
  "source":"upload",
  "url":"https://fixture.invalid/storage/v1/object/public/test-documents/managed-race/previous-identity.pdf",
  "managed_object_id":"a1400000-0000-4000-8000-000000000012"
}]'::jsonb
where id = 'a1400000-0000-4000-8000-000000000008';
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/blueprint-adoption.out" \
  2>"$concurrency_dir/blueprint-adoption.err" <<'SQL' &
set application_name = 'managed-storage-blueprint-adoption';
begin;
select public.lock_managed_storage_protocol();
select public.managed_storage_exact_lock(
  'test-documents', 'managed-race/blueprint-adoption.pdf'
);
select pg_sleep(3);
select public.resolve_managed_storage_blueprint_copy_source(
  'a1400000-0000-4000-8000-000000000001',
  'managed-race/blueprint-adoption.pdf',
  'a1400000-0000-4000-8000-000000000003', null, null
);
commit;
SQL
blueprint_adoption_pid=$!

adoption_waiting=false
for _ in $(seq 1 50); do
  active_adoption="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -A -t -c \
    "select count(*) from pg_stat_activity where application_name = 'managed-storage-blueprint-adoption' and state = 'active' and query like '%pg_sleep%';")"
  if [[ "$active_adoption" = "1" ]]; then adoption_waiting=true; break; fi
  sleep 0.1
done
if [[ "$adoption_waiting" != "true" ]]; then
  wait "$blueprint_adoption_pid" || true
  echo "Blueprint adoption did not reach the exact-path fence." >&2
  exit 1
fi

set +e
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/blueprint-late-raw.out" \
  2>"$concurrency_dir/blueprint-late-raw.err" <<'SQL'
update public.tests
set documents = '[{
  "id":"late-cross-owner-reference",
  "source":"upload",
  "url":"https://fixture.invalid/storage/v1/object/public/test-documents/managed-race/blueprint-adoption.pdf"
}]'::jsonb
where id = 'a1400000-0000-4000-8000-000000000006';
SQL
blueprint_late_raw_status=$?
set -e
wait "$blueprint_adoption_pid"
if [[ "$blueprint_late_raw_status" -eq 0 ]] \
  || ! grep -q 'managed_storage_reference_retry' \
    "$concurrency_dir/blueprint-late-raw.err"; then
  echo "Blueprint adoption did not retry a late raw reference safely." >&2
  sed -n '1,80p' "$concurrency_dir/blueprint-late-raw.err" >&2
  exit 1
fi

# Once the newly registered identity is visible at statement start, retrying
# the same cross-owner write must reject the actual ownership mismatch.
set +e
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/blueprint-late-raw-retry.out" \
  2>"$concurrency_dir/blueprint-late-raw-retry.err" <<'SQL'
update public.tests
set documents = '[{
  "id":"late-cross-owner-reference",
  "source":"upload",
  "url":"https://fixture.invalid/storage/v1/object/public/test-documents/managed-race/blueprint-adoption.pdf"
}]'::jsonb
where id = 'a1400000-0000-4000-8000-000000000006';
SQL
blueprint_late_raw_retry_status=$?
set -e
if [[ "$blueprint_late_raw_retry_status" -eq 0 ]] \
  || ! grep -q 'managed_storage_embedded_owner_mismatch' \
    "$concurrency_dir/blueprint-late-raw-retry.err"; then
  echo "Blueprint adoption was overtaken by a retried cross-owner raw reference." >&2
  sed -n '1,80p' "$concurrency_dir/blueprint-late-raw-retry.err" >&2
  exit 1
fi

# An explicit UUID/path mismatch must fail before trying to lock the untrusted
# caller path. Holding that wrong-path lock turns the old ordering into a
# statement timeout and proves the corrected ordering returns immediately.
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/blueprint-wrong-path-lock.out" \
  2>"$concurrency_dir/blueprint-wrong-path-lock.err" <<'SQL' &
set application_name = 'managed-storage-blueprint-wrong-path-lock';
begin;
select public.managed_storage_exact_lock(
  'test-documents', 'managed-race/caller-mismatch.pdf'
);
select pg_sleep(3);
commit;
SQL
blueprint_wrong_path_pid=$!

wrong_path_waiting=false
for _ in $(seq 1 50); do
  active_wrong_path="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -A -t -c \
    "select count(*) from pg_stat_activity where application_name = 'managed-storage-blueprint-wrong-path-lock' and state = 'active' and query like '%pg_sleep%';")"
  if [[ "$active_wrong_path" = "1" ]]; then wrong_path_waiting=true; break; fi
  sleep 0.1
done
if [[ "$wrong_path_waiting" != "true" ]]; then
  wait "$blueprint_wrong_path_pid" || true
  echo "Blueprint wrong-path holder did not reach the exact-path fence." >&2
  exit 1
fi

set +e
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/blueprint-explicit-mismatch.out" \
  2>"$concurrency_dir/blueprint-explicit-mismatch.err" <<'SQL'
set statement_timeout = '1s';
select public.resolve_managed_storage_blueprint_copy_source(
  'a1400000-0000-4000-8000-000000000001',
  'managed-race/caller-mismatch.pdf',
  'a1400000-0000-4000-8000-000000000003', null,
  (
    select id from public.managed_storage_objects
    where storage_bucket = 'test-documents'
      and storage_path = 'managed-race/blueprint-adoption.pdf'
  )
);
SQL
blueprint_explicit_mismatch_status=$?
set -e
wait "$blueprint_wrong_path_pid"
if [[ "$blueprint_explicit_mismatch_status" -eq 0 ]] \
  || ! grep -q 'managed_storage_blueprint_copy_source_invalid' \
    "$concurrency_dir/blueprint-explicit-mismatch.err" \
  || grep -q 'statement timeout' \
    "$concurrency_dir/blueprint-explicit-mismatch.err"; then
  echo "Blueprint explicit mismatch tried to lock the caller-supplied path." >&2
  sed -n '1,80p' "$concurrency_dir/blueprint-explicit-mismatch.err" >&2
  exit 1
fi

# Existing raw references must acquire managed rows in the same UUID order as
# explicit identities. These paths deliberately sort opposite their UUIDs;
# the explicit-order holder takes the first UUID, while the raw host update
# starts concurrently. Both transactions must complete without deadlock.
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/raw-uuid-order-holder.out" \
  2>"$concurrency_dir/raw-uuid-order-holder.err" <<'SQL' &
set application_name = 'managed-storage-raw-uuid-order-holder';
begin;
select public.lock_managed_storage_protocol();
select id from public.managed_storage_objects
where id = 'a1400000-0000-4000-8000-000000000010'
for update;
select public.managed_storage_exact_lock(
  'test-documents', 'managed-race/z-uuid-first.pdf'
);
select pg_sleep(3);
select id from public.managed_storage_objects
where id = 'a1400000-0000-4000-8000-000000000011'
for update;
select public.managed_storage_exact_lock(
  'test-documents', 'managed-race/a-uuid-second.pdf'
);
commit;
SQL
raw_uuid_order_holder_pid=$!

raw_uuid_order_waiting=false
for _ in $(seq 1 50); do
  active_raw_uuid_order="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -A -t -c \
    "select count(*) from pg_stat_activity where application_name = 'managed-storage-raw-uuid-order-holder' and state = 'active' and query like '%pg_sleep%';")"
  if [[ "$active_raw_uuid_order" = "1" ]]; then
    raw_uuid_order_waiting=true
    break
  fi
  sleep 0.1
done
if [[ "$raw_uuid_order_waiting" != "true" ]]; then
  wait "$raw_uuid_order_holder_pid" || true
  echo "Raw UUID-order holder did not reach the managed-row fence." >&2
  exit 1
fi

set +e
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/raw-inverse-path-writer.out" \
  2>"$concurrency_dir/raw-inverse-path-writer.err" <<'SQL'
set statement_timeout = '10s';
update public.tests
set documents = '[
  {
    "id":"path-first-but-uuid-second",
    "source":"upload",
    "url":"https://fixture.invalid/storage/v1/object/public/test-documents/managed-race/a-uuid-second.pdf"
  },
  {
    "id":"path-second-but-uuid-first",
    "source":"upload",
    "url":"https://fixture.invalid/storage/v1/object/public/test-documents/managed-race/z-uuid-first.pdf"
  }
]'::jsonb
where id = 'a1400000-0000-4000-8000-000000000007';
SQL
raw_inverse_path_status=$?
wait "$raw_uuid_order_holder_pid"
raw_uuid_order_holder_status=$?
set -e
if [[ "$raw_inverse_path_status" -ne 0 || "$raw_uuid_order_holder_status" -ne 0 ]]; then
  echo "Raw and explicit managed-object lock orders deadlocked." >&2
  sed -n '1,80p' "$concurrency_dir/raw-inverse-path-writer.err" >&2
  sed -n '1,80p' "$concurrency_dir/raw-uuid-order-holder.err" >&2
  exit 1
fi

# Removed identities belong in the same initial UUID prelock. The holder
# emulates a writer which already owns the previous object row and will request
# a new absent path. Replacing that object with the same absent path must wait
# on the row before acquiring the path; the old path-then-previous-row ordering
# deadlocks these two sessions.
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/previous-identity-holder.out" \
  2>"$concurrency_dir/previous-identity-holder.err" <<'SQL' &
set application_name = 'managed-storage-previous-identity-holder';
begin;
select public.lock_managed_storage_protocol();
select id from public.managed_storage_objects
where id = 'a1400000-0000-4000-8000-000000000012'
for update;
select public.managed_storage_exact_lock(
  'test-documents', 'managed-race/previous-identity.pdf'
);
select pg_sleep(3);
select public.managed_storage_exact_lock(
  'test-documents', 'managed-race/replacement-absent.pdf'
);
commit;
SQL
previous_identity_holder_pid=$!

previous_identity_waiting=false
for _ in $(seq 1 50); do
  active_previous_identity="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -A -t -c \
    "select count(*) from pg_stat_activity where application_name = 'managed-storage-previous-identity-holder' and state = 'active' and query like '%pg_sleep%';")"
  if [[ "$active_previous_identity" = "1" ]]; then
    previous_identity_waiting=true
    break
  fi
  sleep 0.1
done
if [[ "$previous_identity_waiting" != "true" ]]; then
  wait "$previous_identity_holder_pid" || true
  echo "Previous-identity holder did not reach the managed-row fence." >&2
  exit 1
fi

set +e
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/previous-identity-replacement.out" \
  2>"$concurrency_dir/previous-identity-replacement.err" <<'SQL'
set statement_timeout = '10s';
update public.tests
set documents = '[{
  "id":"replacement-absent-path",
  "source":"upload",
  "url":"https://fixture.invalid/storage/v1/object/public/test-documents/managed-race/replacement-absent.pdf"
}]'::jsonb
where id = 'a1400000-0000-4000-8000-000000000008';
SQL
previous_identity_replacement_status=$?
wait "$previous_identity_holder_pid"
previous_identity_holder_status=$?
set -e
if [[ "$previous_identity_replacement_status" -ne 0 \
  || "$previous_identity_holder_status" -ne 0 ]]; then
  echo "Previous identity and absent replacement path deadlocked." >&2
  sed -n '1,80p' "$concurrency_dir/previous-identity-replacement.err" >&2
  sed -n '1,80p' "$concurrency_dir/previous-identity-holder.err" >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
select set_config('storage.allow_delete_query', 'true', true);
do $fixture$
declare
  v_object public.managed_storage_objects;
begin
  select * into v_object from public.managed_storage_objects
  where storage_bucket = 'test-documents'
    and storage_path = 'managed-race/blueprint-adoption.pdf';
  if v_object.status <> 'ready'
    or v_object.classroom_id is distinct from
      'a1400000-0000-4000-8000-000000000003'
    or v_object.course_blueprint_id is not null
    or (select documents from public.tests
      where id = 'a1400000-0000-4000-8000-000000000006') <> '[]'::jsonb
    or (select count(*) from public.managed_storage_json_references
      where test_id = 'a1400000-0000-4000-8000-000000000007') <> 2
    or exists (
      select 1 from public.managed_storage_json_references
      where test_id = 'a1400000-0000-4000-8000-000000000008'
    )
    or not exists (
      select 1
      from public.managed_storage_payload_raw_references(
        (select documents from public.tests
          where id = 'a1400000-0000-4000-8000-000000000008')
      ) reference
      where reference.storage_bucket = 'test-documents'
        and reference.storage_path = 'managed-race/replacement-absent.pdf'
    )
  then
    raise exception 'Blueprint adoption/raw-writer postcondition failed';
  end if;
end;
$fixture$;
delete from public.tests where id in (
  'a1400000-0000-4000-8000-000000000005',
  'a1400000-0000-4000-8000-000000000006',
  'a1400000-0000-4000-8000-000000000007',
  'a1400000-0000-4000-8000-000000000008'
);
delete from public.managed_storage_objects
where storage_bucket = 'test-documents'
  and storage_path in (
    'managed-race/blueprint-adoption.pdf',
    'managed-race/z-uuid-first.pdf',
    'managed-race/a-uuid-second.pdf',
    'managed-race/previous-identity.pdf'
  );
delete from storage.objects
where bucket_id = 'test-documents'
  and name in (
    'managed-race/blueprint-adoption.pdf',
    'managed-race/z-uuid-first.pdf',
    'managed-race/a-uuid-second.pdf',
    'managed-race/previous-identity.pdf'
  );
delete from public.classrooms where id in (
  'a1400000-0000-4000-8000-000000000003',
  'a1400000-0000-4000-8000-000000000004'
);
delete from public.users where id in (
  'a1400000-0000-4000-8000-000000000001',
  'a1400000-0000-4000-8000-000000000002'
);
commit;
SQL

echo "Managed-storage Blueprint adoption concurrency checks passed."

# Prove that compatibility references and cleanup deletion share one lifecycle
# fence. A reference which holds the managed row first cancels cleanup; a
# Storage deletion which holds it first makes the late reference fail closed.
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
insert into public.users (id, email, role) values
  ('a1300000-0000-4000-8000-000000000001', 'managed-race-teacher@example.test', 'teacher'),
  ('a1300000-0000-4000-8000-000000000002', 'managed-race-student@example.test', 'student');
insert into public.classrooms (id, teacher_id, title, class_code) values (
  'a1300000-0000-4000-8000-000000000003',
  'a1300000-0000-4000-8000-000000000001',
  'Managed lifecycle race fixture', 'MSORAC'
);
insert into public.classroom_enrollments (classroom_id, student_id) values (
  'a1300000-0000-4000-8000-000000000003',
  'a1300000-0000-4000-8000-000000000002'
);
insert into public.assignments (id, classroom_id, title, due_at, created_by) values (
  'a1300000-0000-4000-8000-000000000004',
  'a1300000-0000-4000-8000-000000000003',
  'Managed race assignment', clock_timestamp() + interval '1 day',
  'a1300000-0000-4000-8000-000000000001'
);
insert into public.assignment_docs (id, assignment_id, student_id) values (
  'a1300000-0000-4000-8000-000000000005',
  'a1300000-0000-4000-8000-000000000004',
  'a1300000-0000-4000-8000-000000000002'
);
insert into public.assignment_submission_requirements (
  id, assignment_id, type, label, required, position
) values
  (
    'a1300000-0000-4000-8000-000000000006',
    'a1300000-0000-4000-8000-000000000004',
    'image', 'Reference wins', false, 0
  ),
  (
    'a1300000-0000-4000-8000-000000000007',
    'a1300000-0000-4000-8000-000000000004',
    'image', 'Deletion wins', false, 1
  );

insert into storage.objects (bucket_id, name) values
  ('assignment-artifacts', 'managed-race/assignment-reference-first.png'),
  ('assignment-artifacts', 'managed-race/assignment-deletion-first.png'),
  (
    'test-documents',
    'link-docs/a1300000-0000-4000-8000-000000000001/snapshots/reference-first'
  ),
  (
    'test-documents',
    'link-docs/a1300000-0000-4000-8000-000000000001/snapshots/deletion-first'
  );
select public.begin_managed_storage_upload(
  'a1300000-0000-4000-8000-000000000010',
  'assignment-artifacts', 'managed-race/assignment-reference-first.png',
  'a1300000-0000-4000-8000-000000000003', null, null,
  'student_assignment_artifact',
  'a1300000-0000-4000-8000-000000000001',
  'a1300000-0000-4000-8000-000000000002',
  'assignment_doc', 'a1300000-0000-4000-8000-000000000005',
  'image/png', 4
);
select public.begin_managed_storage_upload(
  'a1300000-0000-4000-8000-000000000011',
  'assignment-artifacts', 'managed-race/assignment-deletion-first.png',
  'a1300000-0000-4000-8000-000000000003', null, null,
  'student_assignment_artifact',
  'a1300000-0000-4000-8000-000000000001',
  'a1300000-0000-4000-8000-000000000002',
  'assignment_doc', 'a1300000-0000-4000-8000-000000000005',
  'image/png', 4
);
select public.begin_managed_storage_upload(
  'a1300000-0000-4000-8000-000000000012',
  'test-documents',
  'link-docs/a1300000-0000-4000-8000-000000000001/snapshots/reference-first',
  'a1300000-0000-4000-8000-000000000003', null, null,
  'test_execution_snapshot',
  'a1300000-0000-4000-8000-000000000001', null,
  'test', 'a1300000-0000-4000-8000-000000000050',
  'text/html', 4
);
select public.begin_managed_storage_upload(
  'a1300000-0000-4000-8000-000000000013',
  'test-documents',
  'link-docs/a1300000-0000-4000-8000-000000000001/snapshots/deletion-first',
  'a1300000-0000-4000-8000-000000000003', null, null,
  'test_execution_snapshot',
  'a1300000-0000-4000-8000-000000000001', null,
  'test', 'a1300000-0000-4000-8000-000000000051',
  'text/html', 4
);
select public.verify_managed_storage_upload(id, null)
from public.managed_storage_objects
where id in (
  'a1300000-0000-4000-8000-000000000010',
  'a1300000-0000-4000-8000-000000000011',
  'a1300000-0000-4000-8000-000000000012',
  'a1300000-0000-4000-8000-000000000013'
)
order by id;

insert into public.assignment_artifact_storage_cleanup (
  id, storage_path
) values
  (
    'a1300000-0000-4000-8000-000000000020',
    'managed-race/assignment-reference-first.png'
  ),
  (
    'a1300000-0000-4000-8000-000000000021',
    'managed-race/assignment-deletion-first.png'
  );
insert into public.test_document_snapshot_storage_cleanup (
  id, storage_path
) values
  (
    'a1300000-0000-4000-8000-000000000022',
    'link-docs/a1300000-0000-4000-8000-000000000001/snapshots/reference-first'
  ),
  (
    'a1300000-0000-4000-8000-000000000023',
    'link-docs/a1300000-0000-4000-8000-000000000001/snapshots/deletion-first'
  );
update public.assignment_artifact_storage_cleanup
set status = 'processing', lease_token = case id
    when 'a1300000-0000-4000-8000-000000000020' then
      'a1300000-0000-4000-8000-000000000030'::uuid
    else 'a1300000-0000-4000-8000-000000000031'::uuid
  end,
  lease_expires_at = clock_timestamp() + interval '2 minutes'
where id in (
  'a1300000-0000-4000-8000-000000000020',
  'a1300000-0000-4000-8000-000000000021'
);
update public.test_document_snapshot_storage_cleanup
set status = 'processing', lease_token = case id
    when 'a1300000-0000-4000-8000-000000000022' then
      'a1300000-0000-4000-8000-000000000032'::uuid
    else 'a1300000-0000-4000-8000-000000000033'::uuid
  end,
  lease_expires_at = clock_timestamp() + interval '2 minutes'
where id in (
  'a1300000-0000-4000-8000-000000000022',
  'a1300000-0000-4000-8000-000000000023'
);
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/assignment-reference.out" \
  2>"$concurrency_dir/assignment-reference.err" <<'SQL' &
set application_name = 'managed-storage-assignment-reference-first';
begin;
insert into public.assignment_submission_artifacts (
  id, assignment_doc_id, requirement_id, student_id, type, storage_path
) values (
  'a1300000-0000-4000-8000-000000000040',
  'a1300000-0000-4000-8000-000000000005',
  'a1300000-0000-4000-8000-000000000006',
  'a1300000-0000-4000-8000-000000000002',
  'image', 'managed-race/assignment-reference-first.png'
);
select pg_sleep(3);
commit;
SQL
assignment_reference_pid=$!

reference_waiting=false
for _ in $(seq 1 50); do
  active_reference="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -A -t -c \
    "select count(*) from pg_stat_activity where application_name = 'managed-storage-assignment-reference-first' and state = 'active' and query like '%pg_sleep%';")"
  if [[ "$active_reference" = "1" ]]; then reference_waiting=true; break; fi
  sleep 0.1
done
if [[ "$reference_waiting" != "true" ]]; then
  wait "$assignment_reference_pid" || true
  echo "Assignment reference did not reach the lifecycle fence." >&2
  exit 1
fi
set +e
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/assignment-reference-delete.out" \
  2>"$concurrency_dir/assignment-reference-delete.err" <<'SQL'
begin;
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'assignment-artifacts'
  and name = 'managed-race/assignment-reference-first.png';
commit;
SQL
assignment_reference_delete_status=$?
set -e
wait "$assignment_reference_pid"
if [[ "$assignment_reference_delete_status" -eq 0 ]] \
  || ! grep -q 'managed_storage_cleanup_referenced' \
    "$concurrency_dir/assignment-reference-delete.err"; then
  echo "Late assignment reference did not stop Storage deletion." >&2
  exit 1
fi
assignment_reference_failure_result="$(docker exec "$DB_CONTAINER" \
  psql -U postgres -d postgres -X -A -t -v ON_ERROR_STOP=1 -c \
  "select public.fail_assignment_artifact_storage_cleanup('a1300000-0000-4000-8000-000000000020', 'a1300000-0000-4000-8000-000000000030', 'managed_storage_cleanup_referenced');")"
if [[ "$assignment_reference_failure_result" != "t" ]]; then
  echo "Late assignment reference cleanup failure did not settle." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/test-reference.out" \
  2>"$concurrency_dir/test-reference.err" <<'SQL' &
set application_name = 'managed-storage-test-reference-first';
begin;
insert into public.tests (
  id, classroom_id, title, status, created_by, documents
) values (
  'a1300000-0000-4000-8000-000000000050',
  'a1300000-0000-4000-8000-000000000003',
  'Reference-first Test', 'draft',
  'a1300000-0000-4000-8000-000000000001',
  '[{
    "id":"reference-first",
    "source":"link",
    "url":"https://example.test/reference-first",
    "snapshot_path":"link-docs/a1300000-0000-4000-8000-000000000001/snapshots/reference-first"
  }]'::jsonb
);
select pg_sleep(3);
commit;
SQL
test_reference_pid=$!

reference_waiting=false
for _ in $(seq 1 50); do
  active_reference="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -A -t -c \
    "select count(*) from pg_stat_activity where application_name = 'managed-storage-test-reference-first' and state = 'active' and query like '%pg_sleep%';")"
  if [[ "$active_reference" = "1" ]]; then reference_waiting=true; break; fi
  sleep 0.1
done
if [[ "$reference_waiting" != "true" ]]; then
  wait "$test_reference_pid" || true
  echo "Test reference did not reach the lifecycle fence." >&2
  exit 1
fi
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c \
  "select public.complete_test_document_snapshot_storage_cleanup('a1300000-0000-4000-8000-000000000022', 'a1300000-0000-4000-8000-000000000032');" \
  >"$concurrency_dir/test-reference-complete.out" \
  2>"$concurrency_dir/test-reference-complete.err"
wait "$test_reference_pid"

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/assignment-delete.out" \
  2>"$concurrency_dir/assignment-delete.err" <<'SQL' &
set application_name = 'managed-storage-assignment-deletion-first';
begin;
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'assignment-artifacts'
  and name = 'managed-race/assignment-deletion-first.png';
select pg_sleep(3);
commit;
SQL
assignment_delete_pid=$!

delete_waiting=false
for _ in $(seq 1 50); do
  active_delete="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -A -t -c \
    "select count(*) from pg_stat_activity where application_name = 'managed-storage-assignment-deletion-first' and state = 'active' and query like '%pg_sleep%';")"
  if [[ "$active_delete" = "1" ]]; then delete_waiting=true; break; fi
  sleep 0.1
done
if [[ "$delete_waiting" != "true" ]]; then
  wait "$assignment_delete_pid" || true
  echo "Assignment deletion did not reach the lifecycle fence." >&2
  exit 1
fi
set +e
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/assignment-late-reference.out" \
  2>"$concurrency_dir/assignment-late-reference.err" <<'SQL'
insert into public.assignment_submission_artifacts (
  id, assignment_doc_id, requirement_id, student_id, type, storage_path
) values (
  'a1300000-0000-4000-8000-000000000041',
  'a1300000-0000-4000-8000-000000000005',
  'a1300000-0000-4000-8000-000000000007',
  'a1300000-0000-4000-8000-000000000002',
  'image', 'managed-race/assignment-deletion-first.png'
);
SQL
assignment_late_status=$?
set -e
wait "$assignment_delete_pid"
if [[ "$assignment_late_status" -eq 0 ]] \
  || ! grep -q 'assignment_artifact_managed_owner_mismatch' \
    "$concurrency_dir/assignment-late-reference.err"; then
  echo "Assignment deletion was overtaken by a late compatibility reference." >&2
  exit 1
fi
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c \
  "select public.complete_assignment_artifact_storage_cleanup('a1300000-0000-4000-8000-000000000021', 'a1300000-0000-4000-8000-000000000031');"

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/test-delete.out" \
  2>"$concurrency_dir/test-delete.err" <<'SQL' &
set application_name = 'managed-storage-test-deletion-first';
begin;
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'test-documents'
  and name =
    'link-docs/a1300000-0000-4000-8000-000000000001/snapshots/deletion-first';
select pg_sleep(3);
commit;
SQL
test_delete_pid=$!

delete_waiting=false
for _ in $(seq 1 50); do
  active_delete="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -A -t -c \
    "select count(*) from pg_stat_activity where application_name = 'managed-storage-test-deletion-first' and state = 'active' and query like '%pg_sleep%';")"
  if [[ "$active_delete" = "1" ]]; then delete_waiting=true; break; fi
  sleep 0.1
done
if [[ "$delete_waiting" != "true" ]]; then
  wait "$test_delete_pid" || true
  echo "Test deletion did not reach the lifecycle fence." >&2
  exit 1
fi
set +e
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  >"$concurrency_dir/test-late-reference.out" \
  2>"$concurrency_dir/test-late-reference.err" <<'SQL'
insert into public.tests (
  id, classroom_id, title, status, created_by, documents
) values (
  'a1300000-0000-4000-8000-000000000051',
  'a1300000-0000-4000-8000-000000000003',
  'Deletion-first Test', 'draft',
  'a1300000-0000-4000-8000-000000000001',
  '[{
    "id":"deletion-first",
    "source":"link",
    "url":"https://example.test/deletion-first",
    "snapshot_path":"link-docs/a1300000-0000-4000-8000-000000000001/snapshots/deletion-first"
  }]'::jsonb
);
SQL
test_late_status=$?
set -e
wait "$test_delete_pid"
if [[ "$test_late_status" -eq 0 ]] \
  || ! grep -q 'managed_storage_embedded_owner_mismatch' \
    "$concurrency_dir/test-late-reference.err"; then
  echo "Test deletion was overtaken by a late compatibility reference." >&2
  exit 1
fi
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c \
  "select public.complete_test_document_snapshot_storage_cleanup('a1300000-0000-4000-8000-000000000023', 'a1300000-0000-4000-8000-000000000033');"

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;
select set_config('storage.allow_delete_query', 'true', true);
do $fixture$
begin
  if (select status from public.managed_storage_objects
      where id = 'a1300000-0000-4000-8000-000000000010') <> 'ready'
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'assignment-artifacts'
        and name = 'managed-race/assignment-reference-first.png'
    )
    or (select managed_object_id from public.assignment_submission_artifacts
      where id = 'a1300000-0000-4000-8000-000000000040')
      is distinct from 'a1300000-0000-4000-8000-000000000010'
  then raise exception 'Assignment reference-first postcondition failed'; end if;
  if (select status from public.managed_storage_objects
      where id = 'a1300000-0000-4000-8000-000000000012') <> 'ready'
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'test-documents'
        and name =
          'link-docs/a1300000-0000-4000-8000-000000000001/snapshots/reference-first'
    )
    or not exists (
      select 1 from public.managed_storage_json_references
      where test_id = 'a1300000-0000-4000-8000-000000000050'
        and managed_object_id = 'a1300000-0000-4000-8000-000000000012'
    )
  then raise exception 'Test reference-first postcondition failed'; end if;
  if exists (
      select 1 from storage.objects
      where bucket_id = 'assignment-artifacts'
        and name = 'managed-race/assignment-deletion-first.png'
    ) or (select status from public.managed_storage_objects
      where id = 'a1300000-0000-4000-8000-000000000011') <> 'deleted'
  then raise exception 'Assignment deletion-first postcondition failed'; end if;
  if exists (
      select 1 from storage.objects
      where bucket_id = 'test-documents'
        and name =
          'link-docs/a1300000-0000-4000-8000-000000000001/snapshots/deletion-first'
    ) or (select status from public.managed_storage_objects
      where id = 'a1300000-0000-4000-8000-000000000013') <> 'deleted'
  then raise exception 'Test deletion-first postcondition failed'; end if;
end;
$fixture$;

delete from public.assignment_submission_artifacts
where id = 'a1300000-0000-4000-8000-000000000040';
delete from public.tests
where id = 'a1300000-0000-4000-8000-000000000050';
delete from public.assignment_artifact_storage_cleanup
where storage_path like 'managed-race/%';
delete from public.test_document_snapshot_storage_cleanup
where storage_path like
  'link-docs/a1300000-0000-4000-8000-000000000001/snapshots/%';
delete from public.managed_storage_objects
where id in (
  'a1300000-0000-4000-8000-000000000010',
  'a1300000-0000-4000-8000-000000000011',
  'a1300000-0000-4000-8000-000000000012',
  'a1300000-0000-4000-8000-000000000013'
);
delete from storage.objects
where (bucket_id = 'assignment-artifacts' and name like 'managed-race/%')
  or (
    bucket_id = 'test-documents'
    and name like
      'link-docs/a1300000-0000-4000-8000-000000000001/snapshots/%'
  );
delete from public.assignment_submission_requirements
where assignment_id = 'a1300000-0000-4000-8000-000000000004';
delete from public.assignment_docs
where id = 'a1300000-0000-4000-8000-000000000005';
delete from public.assignments
where id = 'a1300000-0000-4000-8000-000000000004';
delete from public.classroom_enrollments
where classroom_id = 'a1300000-0000-4000-8000-000000000003';
delete from public.classrooms
where id = 'a1300000-0000-4000-8000-000000000003';
delete from public.users
where id in (
  'a1300000-0000-4000-8000-000000000001',
  'a1300000-0000-4000-8000-000000000002'
);
commit;
SQL

echo "Managed-storage reference/deletion concurrency checks passed."
