#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${CLASSROOM_PURGE_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

cleanup_storage_reappearance_helper() {
  docker exec -i "$DB_CONTAINER" sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U supabase_storage_admin -d postgres -X -v ON_ERROR_STOP=1 -c "drop function if exists storage.insert_classroom_purge_reappearance_fixture()"' \
    >/dev/null 2>&1 || true
}
trap cleanup_storage_reappearance_helper EXIT

# A real provider can recreate bytes outside PostgreSQL. The local Storage
# emulator represents those bytes with storage.objects, whose table owner is
# deliberately not postgres. Install one fixed-input, storage-owner-only test
# helper so the resurrection check preserves that production ownership boundary.
docker exec -i "$DB_CONTAINER" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U supabase_storage_admin -d postgres -X -v ON_ERROR_STOP=1' <<'SQL'
create or replace function storage.insert_classroom_purge_reappearance_fixture()
returns void
language plpgsql
security definer
set search_path = storage, pg_temp
as $$
begin
  lock table storage.objects in access exclusive mode;
  alter table storage.objects disable trigger enforce_managed_storage_object_write;
  insert into storage.objects (bucket_id, name)
  values ('test-documents', 'purge-fixture/reappeared.bin');
  alter table storage.objects enable trigger enforce_managed_storage_object_write;
end;
$$;
revoke all on function storage.insert_classroom_purge_reappearance_fixture()
  from public, anon, authenticated, service_role;
grant execute on function storage.insert_classroom_purge_reappearance_fixture()
  to postgres;
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

do $privileges$
declare
  v_table text;
begin
  if (select rollout_mode from public.classroom_purge_settings where singleton) <> 'disabled'
  then raise exception 'Permanent classroom purge rollout was enabled by migration'; end if;
  if has_function_privilege(
      'anon',
      'public.begin_hot_archived_classroom_purge(uuid,uuid,uuid,text,jsonb)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.begin_hot_archived_classroom_purge(uuid,uuid,uuid,text,jsonb)',
      'execute'
    )
  then raise exception 'Permanent classroom purge entry point is publicly executable'; end if;
  if not has_function_privilege(
      'service_role',
      'public.begin_hot_archived_classroom_purge(uuid,uuid,uuid,text,jsonb)',
      'execute'
    )
    or not has_function_privilege(
      'service_role',
      'public.finalize_hot_archived_classroom_purge(uuid,uuid)',
      'execute'
    )
  then raise exception 'Permanent classroom purge worker privilege is missing'; end if;
  foreach v_table in array array[
    'classroom_purge_operations',
    'classroom_purge_resources',
    'classroom_purge_objects',
    'classroom_purge_fences'
  ]
  loop
    if has_table_privilege('service_role', 'public.' || v_table, 'INSERT')
      or has_table_privilege('service_role', 'public.' || v_table, 'UPDATE')
      or has_table_privilege('service_role', 'public.' || v_table, 'DELETE')
    then
      raise exception 'service_role can forge deletion authority through %', v_table;
    end if;
    if not has_table_privilege('service_role', 'public.' || v_table, 'SELECT') then
      raise exception 'service_role cannot inspect deletion ledger %', v_table;
    end if;
  end loop;
end;
$privileges$;

do $activate$
declare
  v_run public.managed_storage_readiness_runs;
begin
  select * into v_run from public.refresh_managed_storage_readiness();
  if v_run.status <> 'ready' then
    raise exception 'Managed storage fixture readiness blocked with % findings',
      v_run.finding_count;
  end if;
  perform public.activate_managed_storage_enforcement(
    v_run.generation, v_run.inventory_digest
  );
end;
$activate$;

insert into public.users (id, email, role) values
  ('b1800000-0000-4000-8000-000000000001', 'purge-teacher@example.test', 'teacher'),
  ('b1800000-0000-4000-8000-000000000002', 'purge-student@example.test', 'student'),
  ('b1800000-0000-4000-8000-000000000003', 'other-teacher@example.test', 'teacher');

insert into public.classrooms (id, teacher_id, title, class_code) values
  ('b1800000-0000-4000-8000-000000000010',
    'b1800000-0000-4000-8000-000000000001', 'Purge fixture', 'PUR118'),
  ('b1800000-0000-4000-8000-000000000011',
    'b1800000-0000-4000-8000-000000000001', 'Active fixture', 'ACT118');
insert into public.classroom_enrollments (classroom_id, student_id) values (
  'b1800000-0000-4000-8000-000000000010',
  'b1800000-0000-4000-8000-000000000002'
);
insert into public.classroom_roster (classroom_id, email, first_name, last_name) values (
  'b1800000-0000-4000-8000-000000000010',
  'invited@example.test', 'Invited', 'Student'
);
insert into public.assignments (id, classroom_id, title, due_at, created_by) values (
  'b1800000-0000-4000-8000-000000000030',
  'b1800000-0000-4000-8000-000000000010',
  'Purged assignment', clock_timestamp() + interval '1 day',
  'b1800000-0000-4000-8000-000000000001'
);
insert into public.assignment_docs (id, assignment_id, student_id) values (
  'b1800000-0000-4000-8000-000000000031',
  'b1800000-0000-4000-8000-000000000030',
  'b1800000-0000-4000-8000-000000000002'
);
insert into public.tests (id, classroom_id, title, status, created_by) values (
  'b1800000-0000-4000-8000-000000000035',
  'b1800000-0000-4000-8000-000000000010',
  'Purged test', 'closed',
  'b1800000-0000-4000-8000-000000000001'
);
insert into public.assignment_doc_save_operations (
  id, assignment_doc_id, save_session_id, save_sequence, metric_session_id,
  paste_word_count, keystroke_count, content_sha256, document_updated_at
) values (
  'b1800000-0000-4000-8000-000000000032',
  'b1800000-0000-4000-8000-000000000031',
  'b1800000-0000-4000-8000-000000000033', 1,
  'b1800000-0000-4000-8000-000000000034', 0, 1, repeat('c', 64),
  clock_timestamp()
);
insert into public.course_blueprints (id, teacher_id, title) values (
  'b1800000-0000-4000-8000-000000000020',
  'b1800000-0000-4000-8000-000000000001',
  'Preserved Blueprint'
);

-- Five classroom buckets plus one interrupted upload and one Blueprint file.
select public.begin_managed_storage_upload(
  'b1800000-0000-4000-8000-000000000101', 'assignment-artifacts',
  'purge-fixture/artifact.bin', 'b1800000-0000-4000-8000-000000000010',
  null, null, 'student_assignment_artifact',
  'b1800000-0000-4000-8000-000000000002',
  'b1800000-0000-4000-8000-000000000002',
  'fixture', null, 'application/octet-stream', 1
);
select public.begin_managed_storage_upload(
  'b1800000-0000-4000-8000-000000000102', 'submission-images',
  'purge-fixture/image.png', 'b1800000-0000-4000-8000-000000000010',
  null, null, 'student_inline_image',
  'b1800000-0000-4000-8000-000000000002',
  'b1800000-0000-4000-8000-000000000002',
  'fixture', null, 'image/png', 1
);
select public.begin_managed_storage_upload(
  'b1800000-0000-4000-8000-000000000103', 'test-documents',
  'purge-fixture/test.pdf', 'b1800000-0000-4000-8000-000000000010',
  null, null, 'teacher_test_material',
  'b1800000-0000-4000-8000-000000000001', null,
  'fixture', null, 'application/pdf', 1
);
select public.begin_managed_storage_upload(
  'b1800000-0000-4000-8000-000000000104', 'classroom-archives',
  'purge-fixture/archive.tar.gz', 'b1800000-0000-4000-8000-000000000010',
  null, null, 'classroom_archive',
  'b1800000-0000-4000-8000-000000000001', null,
  'fixture', null, 'application/gzip', 1
);
select public.begin_managed_storage_upload(
  'b1800000-0000-4000-8000-000000000105', 'gradex-analytics-extracts',
  'purge-fixture/gradex.tar.gz', 'b1800000-0000-4000-8000-000000000010',
  null, null, 'gradex_extract',
  'b1800000-0000-4000-8000-000000000001', null,
  'fixture', null, 'application/gzip', 1
);
select public.begin_managed_storage_upload(
  'b1800000-0000-4000-8000-000000000106', 'submission-images',
  'purge-fixture/interrupted.png', 'b1800000-0000-4000-8000-000000000010',
  null, null, 'student_inline_image',
  'b1800000-0000-4000-8000-000000000002',
  'b1800000-0000-4000-8000-000000000002',
  'fixture', null, 'image/png', 1
);
select public.begin_managed_storage_upload(
  'b1800000-0000-4000-8000-000000000107', 'test-documents',
  'purge-fixture/blueprint.pdf', null,
  'b1800000-0000-4000-8000-000000000020', null,
  'teacher_test_material',
  'b1800000-0000-4000-8000-000000000001', null,
  'course_blueprint_assessment', null, 'application/pdf', 1
);

insert into storage.objects (bucket_id, name) values
  ('assignment-artifacts', 'purge-fixture/artifact.bin'),
  ('submission-images', 'purge-fixture/image.png'),
  ('test-documents', 'purge-fixture/test.pdf'),
  ('classroom-archives', 'purge-fixture/archive.tar.gz'),
  ('gradex-analytics-extracts', 'purge-fixture/gradex.tar.gz'),
  ('test-documents', 'purge-fixture/blueprint.pdf');

do $ready$
declare
  v_id uuid;
begin
  for v_id in select id from public.managed_storage_objects
    where id between 'b1800000-0000-4000-8000-000000000101'
      and 'b1800000-0000-4000-8000-000000000105'
       or id = 'b1800000-0000-4000-8000-000000000107'
  loop
    perform public.verify_managed_storage_upload(v_id, repeat('a', 64));
    perform public.managed_storage_mark_ready(v_id);
  end loop;
end;
$ready$;

insert into public.assignment_artifact_storage_cleanup (
  id, storage_path, managed_object_id, status
) values (
  'b1800000-0000-4000-8000-000000000120',
  'purge-fixture/artifact.bin',
  'b1800000-0000-4000-8000-000000000101', 'pending'
);

update public.classrooms
set archived_at = clock_timestamp()
where id = 'b1800000-0000-4000-8000-000000000010';
update public.classroom_purge_settings
set rollout_mode = 'canary',
    canary_teacher_id = 'b1800000-0000-4000-8000-000000000001',
    canary_classroom_id = 'b1800000-0000-4000-8000-000000000010'
where singleton;

do $authorization_and_state$
declare
  v_result jsonb;
begin
  v_result := public.get_hot_archived_classroom_purge_inventory(
    'b1800000-0000-4000-8000-000000000003',
    'b1800000-0000-4000-8000-000000000010'
  );
  if v_result->>'error_code' <> 'classroom_not_found' then
    raise exception 'Non-owner learned purge inventory: %', v_result;
  end if;
  v_result := public.get_hot_archived_classroom_purge_inventory(
    'b1800000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000011'
  );
  if v_result->>'error_code' <> 'classroom_not_hot_archived' then
    raise exception 'Active classroom was purgeable: %', v_result;
  end if;
  v_result := public.get_hot_archived_classroom_purge_inventory(
    'b1800000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000010'
  );
  if v_result->>'conflicting_operation' <> 'classroom_storage_operation_active'
    or coalesce((v_result->>'deletion_available')::boolean, true)
  then raise exception 'Active upload reservation did not block purge: %', v_result; end if;
end;
$authorization_and_state$;

-- Expired interrupted uploads are purge inventory, not an active conflict.
update public.managed_storage_objects
set reservation_expires_at = clock_timestamp() - interval '1 second'
where id = 'b1800000-0000-4000-8000-000000000106';

do $expired_upload$
declare
  v_result jsonb;
begin
  v_result := public.get_hot_archived_classroom_purge_inventory(
    'b1800000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000010'
  );
  if not coalesce((v_result->>'deletion_available')::boolean, false)
    or (v_result->>'interrupted_upload_count')::integer <> 1
  then raise exception 'Expired interrupted upload was not purgeable: %', v_result; end if;
end;
$expired_upload$;

-- Each operation family must independently block deletion. These rows are
-- removed after their assertion so the fixture can prove the next family and
-- then continue through a successful purge.
do $conflict_matrix$
declare
  v_conflict text;
begin
  insert into public.classroom_archive_operations (
    id, teacher_id, classroom_id, operation_type, request_sha256, status,
    source_revision, source_schema_migration, source_app_commit, retention,
    snapshot_created_at, snapshot_expires_at
  ) values (
    'b1800000-0000-4000-8000-000000000210',
    'b1800000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000010',
    'export', repeat('1', 64), 'snapshot_ready', 1,
    '118_hot_archived_classroom_purge_managed_ownership', 'fixture',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb,
    clock_timestamp(), clock_timestamp() + interval '1 hour'
  );
  v_conflict := public.classroom_purge_conflict(
    'b1800000-0000-4000-8000-000000000010'
  );
  if v_conflict <> 'classroom_archive_operation_active' then
    raise exception 'Active archive did not block purge: %', v_conflict;
  end if;
  delete from public.classroom_archive_operations
  where id = 'b1800000-0000-4000-8000-000000000210';

  insert into public.classroom_archive_operations (
    id, teacher_id, classroom_id, operation_type, request_sha256, status,
    source_revision, source_schema_migration, source_app_commit, retention,
    snapshot_created_at, snapshot_expires_at, target_schema_migration, adapter_chain
  ) values (
    'b1800000-0000-4000-8000-000000000211',
    'b1800000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000010',
    'restore', repeat('2', 64), 'snapshot_ready', 1,
    '118_hot_archived_classroom_purge_managed_ownership', 'fixture',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb,
    clock_timestamp(), clock_timestamp() + interval '1 hour',
    '118_hot_archived_classroom_purge_managed_ownership', '[]'::jsonb
  );
  v_conflict := public.classroom_purge_conflict(
    'b1800000-0000-4000-8000-000000000010'
  );
  if v_conflict <> 'classroom_archive_operation_active' then
    raise exception 'Active restore did not block purge: %', v_conflict;
  end if;
  delete from public.classroom_archive_operations
  where id = 'b1800000-0000-4000-8000-000000000211';

  insert into public.assignment_ai_grading_runs (
    id, assignment_id, status, triggered_by, selection_hash
  ) values (
    'b1800000-0000-4000-8000-000000000212',
    'b1800000-0000-4000-8000-000000000030', 'queued',
    'b1800000-0000-4000-8000-000000000001', 'purge-conflict'
  );
  v_conflict := public.classroom_purge_conflict(
    'b1800000-0000-4000-8000-000000000010'
  );
  if v_conflict <> 'classroom_grading_operation_active' then
    raise exception 'Assignment grading did not block purge: %', v_conflict;
  end if;
  delete from public.assignment_ai_grading_runs
  where id = 'b1800000-0000-4000-8000-000000000212';

  insert into public.assignment_repo_review_runs (
    id, assignment_id, status, triggered_by
  ) values (
    'b1800000-0000-4000-8000-000000000213',
    'b1800000-0000-4000-8000-000000000030', 'running',
    'b1800000-0000-4000-8000-000000000001'
  );
  v_conflict := public.classroom_purge_conflict(
    'b1800000-0000-4000-8000-000000000010'
  );
  if v_conflict <> 'classroom_grading_operation_active' then
    raise exception 'Repository grading did not block purge: %', v_conflict;
  end if;
  delete from public.assignment_repo_review_runs
  where id = 'b1800000-0000-4000-8000-000000000213';

  insert into public.test_ai_grading_runs (
    id, test_id, status, triggered_by, selection_hash
  ) values (
    'b1800000-0000-4000-8000-000000000214',
    'b1800000-0000-4000-8000-000000000035', 'running',
    'b1800000-0000-4000-8000-000000000001', 'purge-conflict'
  );
  v_conflict := public.classroom_purge_conflict(
    'b1800000-0000-4000-8000-000000000010'
  );
  if v_conflict <> 'classroom_grading_operation_active' then
    raise exception 'Test grading did not block purge: %', v_conflict;
  end if;
  delete from public.test_ai_grading_runs
  where id = 'b1800000-0000-4000-8000-000000000214';

  insert into public.course_blueprint_operations (
    id, teacher_id, operation_type, request_sha256, status, source_classroom_id
  ) values (
    'b1800000-0000-4000-8000-000000000215',
    'b1800000-0000-4000-8000-000000000001',
    'capture', repeat('3', 64), 'running',
    'b1800000-0000-4000-8000-000000000010'
  );
  v_conflict := public.classroom_purge_conflict(
    'b1800000-0000-4000-8000-000000000010'
  );
  if v_conflict <> 'classroom_blueprint_operation_active' then
    raise exception 'Blueprint operation did not block purge: %', v_conflict;
  end if;
  delete from public.course_blueprint_operations
  where id = 'b1800000-0000-4000-8000-000000000215';

  insert into public.course_blueprint_change_proposals (
    id, teacher_id, course_blueprint_id, source_classroom_id, target_kind,
    source_kind, status, base_blueprint_revision, request_sha256, idempotency_key
  ) values (
    'b1800000-0000-4000-8000-000000000216',
    'b1800000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000020',
    'b1800000-0000-4000-8000-000000000010',
    'blueprint', 'classroom', 'needs_review', 1, repeat('4', 64),
    'b1800000-0000-4000-8000-000000000217'
  );
  v_conflict := public.classroom_purge_conflict(
    'b1800000-0000-4000-8000-000000000010'
  );
  if v_conflict <> 'classroom_blueprint_operation_active' then
    raise exception 'Blueprint proposal did not block purge: %', v_conflict;
  end if;
  delete from public.course_blueprint_change_proposals
  where id = 'b1800000-0000-4000-8000-000000000216';

  insert into public.course_blueprint_editing_sessions (
    id, teacher_id, course_blueprint_id, classroom_id,
    base_blueprint_revision, package_sha256, status, expires_at
  ) values (
    'b1800000-0000-4000-8000-000000000218',
    'b1800000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000020',
    'b1800000-0000-4000-8000-000000000010',
    1, repeat('5', 64), 'ready', clock_timestamp() + interval '1 hour'
  );
  v_conflict := public.classroom_purge_conflict(
    'b1800000-0000-4000-8000-000000000010'
  );
  if v_conflict <> 'classroom_blueprint_operation_active' then
    raise exception 'Blueprint editing session did not block purge: %', v_conflict;
  end if;
  delete from public.course_blueprint_editing_sessions
  where id = 'b1800000-0000-4000-8000-000000000218';
end;
$conflict_matrix$;

do $begin_purge$
declare
  v_inventory jsonb;
  v_result jsonb;
begin
  v_inventory := public.get_hot_archived_classroom_purge_inventory(
    'b1800000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000010'
  );
  v_result := public.begin_hot_archived_classroom_purge(
    'b1800000-0000-4000-8000-000000000200',
    'b1800000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000010',
    repeat('b', 64),
    v_inventory
  );
  if not coalesce((v_result->>'ok')::boolean, false)
    or v_result->>'operation_status' <> 'deleting_objects'
  then raise exception 'Purge did not begin: %', v_result; end if;
  if (select count(*) from public.classroom_purge_objects
      where operation_id = 'b1800000-0000-4000-8000-000000000200') <> 6
  then raise exception 'Purge did not snapshot every classroom-owned file'; end if;
  if exists (
    select 1 from public.classroom_purge_objects
    where operation_id = 'b1800000-0000-4000-8000-000000000200'
      and managed_storage_object_id = 'b1800000-0000-4000-8000-000000000107'
  ) then raise exception 'Blueprint file entered classroom purge'; end if;
end;
$begin_purge$;

do $cleanup_ledger_fence$
begin
  begin
    update public.assignment_artifact_storage_cleanup
    set next_attempt_at = clock_timestamp()
    where id = 'b1800000-0000-4000-8000-000000000120';
    raise exception 'Assignment cleanup update crossed purge fence';
  exception when sqlstate '55000' then
    if sqlerrm <> 'classroom_purge_active' then raise; end if;
  end;
  begin
    delete from public.assignment_artifact_storage_cleanup
    where id = 'b1800000-0000-4000-8000-000000000120';
    raise exception 'Assignment cleanup delete crossed purge fence';
  exception when sqlstate '55000' then
    if sqlerrm <> 'classroom_purge_active' then raise; end if;
  end;
  begin
    insert into public.test_document_snapshot_storage_cleanup (
      id, storage_path, managed_object_id, status
    ) values (
      'b1800000-0000-4000-8000-000000000121',
      'purge-fixture/test.pdf',
      'b1800000-0000-4000-8000-000000000103', 'pending'
    );
    raise exception 'Test cleanup insert crossed purge fence';
  exception when sqlstate '55000' then
    if sqlerrm <> 'classroom_purge_active' then raise; end if;
  end;
end;
$cleanup_ledger_fence$;

do $retry_and_delete$
declare
  v_claim public.classroom_purge_objects;
  v_failed_once boolean := false;
  v_lease uuid;
  v_waiting jsonb;
begin
  -- Database fixture equivalent of the application worker's Storage API
  -- delete. Supabase protects direct SQL deletes unless this transaction-local
  -- test override is set; migration 118's exact purge lease still authorizes
  -- each object independently.
  perform set_config('storage.allow_delete_query', 'true', true);
  loop
    v_lease := gen_random_uuid();
    select * into v_claim from public.claim_classroom_purge_object(
      'b1800000-0000-4000-8000-000000000200',
      'b1800000-0000-4000-8000-000000000001', v_lease, 60
    );
    exit when not found;
    if not v_failed_once then
      if not public.fail_classroom_purge_object(
        v_claim.id, 'b1800000-0000-4000-8000-000000000001',
        v_claim.lease_token, 'fixture_provider_failure'
      ) then raise exception 'Retry failure was not recorded'; end if;
      update public.classroom_purge_objects
      set next_attempt_at = clock_timestamp() + interval '1 minute'
      where operation_id = 'b1800000-0000-4000-8000-000000000200'
        and status in ('pending', 'failed');
      select * into v_claim from public.claim_classroom_purge_object(
        'b1800000-0000-4000-8000-000000000200',
        'b1800000-0000-4000-8000-000000000001', gen_random_uuid(), 60
      );
      if found then raise exception 'Backoff-ineligible purge object was claimed'; end if;
      v_waiting := public.finalize_hot_archived_classroom_purge(
        'b1800000-0000-4000-8000-000000000200',
        'b1800000-0000-4000-8000-000000000001'
      );
      if not coalesce((v_waiting->>'ok')::boolean, false)
        or v_waiting->>'operation_status' <> 'failed'
        or not coalesce((v_waiting->>'waiting_for_storage')::boolean, false)
        or not exists (
          select 1 from public.classroom_purge_operations
          where id = 'b1800000-0000-4000-8000-000000000200'
            and status = 'failed' and retryable is true
        )
      then raise exception 'Backoff wait was not durable: %', v_waiting; end if;
      update public.classroom_purge_objects
      set next_attempt_at = clock_timestamp()
      where operation_id = 'b1800000-0000-4000-8000-000000000200'
        and status in ('pending', 'failed');
      v_failed_once := true;
      continue;
    end if;
    delete from storage.objects
    where bucket_id = v_claim.storage_bucket and name = v_claim.storage_path;
    if not public.complete_classroom_purge_object(
      v_claim.id, 'b1800000-0000-4000-8000-000000000001', v_claim.lease_token
    ) then raise exception 'Leased purge object did not complete'; end if;
  end loop;
  if not v_failed_once then raise exception 'Partial failure path was not exercised'; end if;
end;
$retry_and_delete$;

do $finalize$
declare
  v_result jsonb;
begin
  v_result := public.finalize_hot_archived_classroom_purge(
    'b1800000-0000-4000-8000-000000000200',
    'b1800000-0000-4000-8000-000000000001'
  );
  if not coalesce((v_result->>'ok')::boolean, false)
    or v_result->>'operation_status' <> 'completed'
  then raise exception 'Purge did not finalize: %', v_result; end if;
  if exists (select 1 from public.classrooms
      where id = 'b1800000-0000-4000-8000-000000000010')
    or exists (select 1 from public.classroom_roster
      where classroom_id = 'b1800000-0000-4000-8000-000000000010')
    or exists (select 1 from public.assignment_doc_save_operations
      where id = 'b1800000-0000-4000-8000-000000000032')
    or exists (select 1 from public.managed_storage_objects
      where id between 'b1800000-0000-4000-8000-000000000101'
        and 'b1800000-0000-4000-8000-000000000106')
  then raise exception 'Classroom-owned state survived purge'; end if;
  if not exists (select 1 from public.users
      where id = 'b1800000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.course_blueprints
      where id = 'b1800000-0000-4000-8000-000000000020')
    or not exists (select 1 from public.managed_storage_objects
      where id = 'b1800000-0000-4000-8000-000000000107')
    or not exists (select 1 from storage.objects
      where bucket_id = 'test-documents' and name = 'purge-fixture/blueprint.pdf')
  then raise exception 'Reusable Blueprint or user account was removed'; end if;
end;
$finalize$;

-- A provider-side resurrection after verified deletion is irrecoverable from
-- the redacted worker path. Preserve a durable terminal operation and fence so
-- no database finalization can proceed silently.
select public.begin_managed_storage_upload(
  'b1800000-0000-4000-8000-000000000108', 'test-documents',
  'purge-fixture/reappeared.bin', 'b1800000-0000-4000-8000-000000000011',
  null, null, 'teacher_test_material',
  'b1800000-0000-4000-8000-000000000001', null,
  'fixture', null, 'application/octet-stream', 1
);
select public.begin_managed_storage_upload(
  'b1800000-0000-4000-8000-000000000109', 'test-documents',
  'purge-fixture/not-yet-deleted.bin', 'b1800000-0000-4000-8000-000000000011',
  null, null, 'teacher_test_material',
  'b1800000-0000-4000-8000-000000000001', null,
  'fixture', null, 'application/octet-stream', 1
);
insert into storage.objects (bucket_id, name)
values
  ('test-documents', 'purge-fixture/reappeared.bin'),
  ('test-documents', 'purge-fixture/not-yet-deleted.bin');
select public.verify_managed_storage_upload(
  'b1800000-0000-4000-8000-000000000108', repeat('a', 64)
);
select public.managed_storage_mark_ready(
  'b1800000-0000-4000-8000-000000000108'
);
select public.verify_managed_storage_upload(
  'b1800000-0000-4000-8000-000000000109', repeat('a', 64)
);
select public.managed_storage_mark_ready(
  'b1800000-0000-4000-8000-000000000109'
);
update public.classrooms set archived_at = clock_timestamp()
where id = 'b1800000-0000-4000-8000-000000000011';
update public.classroom_purge_settings
set canary_classroom_id = 'b1800000-0000-4000-8000-000000000011'
where singleton;

do $storage_reappeared$
declare
  v_inventory jsonb;
  v_result jsonb;
  v_claim public.classroom_purge_objects;
begin
  v_inventory := public.get_hot_archived_classroom_purge_inventory(
    'b1800000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000011'
  );
  v_result := public.begin_hot_archived_classroom_purge(
    'b1800000-0000-4000-8000-000000000201',
    'b1800000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000011', repeat('e', 64), v_inventory
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Reappearance purge did not begin: %', v_result;
  end if;
  update public.classroom_purge_objects
  set next_attempt_at = case managed_storage_object_id
    when 'b1800000-0000-4000-8000-000000000108' then clock_timestamp()
    else clock_timestamp() + interval '1 minute'
  end
  where operation_id = 'b1800000-0000-4000-8000-000000000201';
  select * into strict v_claim from public.claim_classroom_purge_object(
    'b1800000-0000-4000-8000-000000000201',
    'b1800000-0000-4000-8000-000000000001', gen_random_uuid(), 60
  );
  if v_claim.managed_storage_object_id <>
    'b1800000-0000-4000-8000-000000000108'
  then raise exception 'Reappearance fixture claimed the wrong object'; end if;
  delete from storage.objects
  where bucket_id = v_claim.storage_bucket and name = v_claim.storage_path;
  if not public.complete_classroom_purge_object(
    v_claim.id, 'b1800000-0000-4000-8000-000000000001', v_claim.lease_token
  ) then raise exception 'Reappearance object did not complete'; end if;

  perform storage.insert_classroom_purge_reappearance_fixture();

  select * into v_claim from public.claim_classroom_purge_object(
    'b1800000-0000-4000-8000-000000000201',
    'b1800000-0000-4000-8000-000000000001', gen_random_uuid(), 60
  );
  if found
    or not exists (
      select 1 from public.classroom_purge_objects
      where operation_id = 'b1800000-0000-4000-8000-000000000201'
        and managed_storage_object_id = 'b1800000-0000-4000-8000-000000000109'
        and status = 'pending'
    )
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'test-documents'
        and name = 'purge-fixture/not-yet-deleted.bin'
    )
  then raise exception 'Resurrection did not stop before the next object'; end if;

  v_result := public.finalize_hot_archived_classroom_purge(
    'b1800000-0000-4000-8000-000000000201',
    'b1800000-0000-4000-8000-000000000001'
  );
  if v_result->>'error_code' <> 'classroom_purge_storage_reappeared'
    or not exists (
      select 1 from public.classroom_purge_operations
      where id = 'b1800000-0000-4000-8000-000000000201'
        and status = 'failed' and retryable is false
        and error_code = 'classroom_purge_storage_reappeared'
    )
    or not exists (
      select 1 from public.classroom_purge_fences
      where operation_id = 'b1800000-0000-4000-8000-000000000201'
    )
  then raise exception 'Storage reappearance was not terminal and durable: %', v_result; end if;
end;
$storage_reappeared$;

rollback;
SQL

cleanup_storage_reappearance_helper
trap - EXIT

# Prove a trigger-level writer fails fast instead of deadlocking while purge
# owns the lifecycle advisory lock. No fixture rows are required for this lock.
LOCK_CLASSROOM_ID="b1800000-0000-4000-8000-000000000099"
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c "
  begin;
  select public.classroom_purge_lock('$LOCK_CLASSROOM_ID');
  select pg_sleep(4);
  rollback;
" >/dev/null &
LOCK_HOLDER_PID=$!
sleep 1
set +e
LOCK_OUTPUT=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c "
  select public.guard_classroom_purge_lifecycle('$LOCK_CLASSROOM_ID');
" 2>&1)
LOCK_STATUS=$?
set -e
wait "$LOCK_HOLDER_PID"
if [[ $LOCK_STATUS -eq 0 || "$LOCK_OUTPUT" != *"classroom_operation_busy"* ]]; then
  echo "Trigger-level purge fence did not fail fast under lifecycle contention." >&2
  exit 1
fi

echo "Hot archived classroom purge database checks passed."
