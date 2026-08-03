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

do $fixture$
declare
  v_run public.managed_storage_readiness_runs;
  v_claim public.managed_storage_objects;
  v_artifact_cleanup public.assignment_artifact_storage_cleanup;
  v_snapshot_cleanup public.test_document_snapshot_storage_cleanup;
  v_compat_cleanup_id uuid;
  v_legacy_id uuid;
begin
  if (select status from public.managed_storage_objects
      where id = 'a1100000-0000-4000-8000-000000000010') <> 'ready'
  then raise exception 'Relational attach did not atomically adopt the object'; end if;

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
  delete from storage.objects
  where bucket_id = 'assignment-artifacts'
    and name = 'managed-fixture/compatibility-managed.png';
  if not public.complete_assignment_artifact_storage_cleanup(
    v_artifact_cleanup.id, v_artifact_cleanup.lease_token
  ) or (select status from public.managed_storage_objects
    where id = v_compat_cleanup_id) <> 'deleted'
  then raise exception 'Compatibility cleanup did not preserve a managed tombstone'; end if;
  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then
    raise exception 'Compatibility cleanup left managed readiness blocked';
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
  select * into v_claim from public.claim_managed_storage_cleanup(
    'a1100000-0000-4000-8000-000000000021', 1, 30
  );
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
  if not public.complete_assignment_artifact_storage_cleanup(
    v_artifact_cleanup.id, v_artifact_cleanup.lease_token
  ) or (select status from public.managed_storage_objects
    where id = 'a1100000-0000-4000-8000-000000000022') <> 'deleted'
  then raise exception 'Assignment cleanup did not use managed authority'; end if;

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
  if not public.complete_test_document_snapshot_storage_cleanup(
    v_snapshot_cleanup.id, v_snapshot_cleanup.lease_token
  ) or (select status from public.managed_storage_objects
    where id = 'a1100000-0000-4000-8000-000000000024') <> 'deleted'
  then raise exception 'Snapshot cleanup did not use managed authority'; end if;

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
  || ! rg -q 'managed_storage_readiness_stale' "$concurrency_dir/activation.err"; then
  echo "Managed-storage activation overtook a pre-enforcement writer." >&2
  exit 1
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
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
delete from storage.objects
where bucket_id = 'submission-images' and name = 'managed-fixture/concurrent.png';
delete from public.managed_storage_objects
where id = 'a1200000-0000-4000-8000-000000000003';
delete from public.classrooms where id = 'a1200000-0000-4000-8000-000000000002';
delete from public.users where id = 'a1200000-0000-4000-8000-000000000001';
SQL

echo "Managed-storage activation concurrency checks passed."
