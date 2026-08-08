#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${COURSE_BLUEPRINT_PURGE_DB_CONTAINER:-$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)}"
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

# This fixture requires migration 120. It is intentionally transactional and
# leaves local data and rollout settings unchanged. Do not run it until the
# exact migration has been authorized and replayed locally.
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
begin;

do $privileges$
declare
  v_table text;
begin
  if (select rollout_mode from public.course_blueprint_purge_settings where singleton)
      <> 'disabled'
  then
    raise exception 'Course Blueprint purge rollout was enabled by migration';
  end if;
  if has_function_privilege(
      'anon',
      'public.begin_course_blueprint_purge(uuid,uuid,uuid,text,jsonb)',
      'execute'
    ) or has_function_privilege(
      'authenticated',
      'public.begin_course_blueprint_purge(uuid,uuid,uuid,text,jsonb)',
      'execute'
    ) or has_function_privilege(
      'authenticated',
      'public.settle_managed_storage_blueprint_copy_owner(uuid,uuid,uuid,uuid,text)',
      'execute'
    ) or has_function_privilege(
      'authenticated',
      'public.recover_managed_storage_blueprint_copy_owner(uuid,uuid,uuid,uuid,timestamp with time zone,boolean)',
      'execute'
    )
  then
    raise exception 'Course Blueprint purge entry point is publicly executable';
  end if;
  if not has_function_privilege(
      'service_role',
      'public.begin_course_blueprint_purge(uuid,uuid,uuid,text,jsonb)',
      'execute'
    ) or not has_function_privilege(
      'service_role',
      'public.finalize_course_blueprint_purge(uuid,uuid)',
      'execute'
    ) or not has_function_privilege(
      'service_role',
      'public.heartbeat_managed_storage_blueprint_copy_owner(uuid,uuid,uuid,uuid)',
      'execute'
    ) or not has_function_privilege(
      'service_role',
      'public.settle_managed_storage_blueprint_copy_owner(uuid,uuid,uuid,uuid,text)',
      'execute'
    ) or not has_function_privilege(
      'service_role',
      'public.recover_managed_storage_blueprint_copy_owner(uuid,uuid,uuid,uuid,timestamp with time zone,boolean)',
      'execute'
    )
  then
    raise exception 'Course Blueprint purge worker privilege is missing';
  end if;
  foreach v_table in array array[
    'course_blueprint_purge_operations',
    'course_blueprint_purge_objects',
    'course_blueprint_purge_fences'
  ] loop
    if has_table_privilege('service_role', 'public.' || v_table, 'INSERT')
      or has_table_privilege('service_role', 'public.' || v_table, 'UPDATE')
      or has_table_privilege('service_role', 'public.' || v_table, 'DELETE')
    then
      raise exception 'service_role can forge purge authority through %', v_table;
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
  ('c1200000-0000-4000-8000-000000000001', 'blueprint-purge-teacher@example.test', 'teacher'),
  ('c1200000-0000-4000-8000-000000000002', 'blueprint-purge-student@example.test', 'student'),
  ('c1200000-0000-4000-8000-000000000003', 'blueprint-purge-other@example.test', 'teacher');

insert into public.course_blueprints (id, teacher_id, title) values
  ('c1200000-0000-4000-8000-000000000010',
    'c1200000-0000-4000-8000-000000000001', 'Blueprint purge fixture'),
  ('c1200000-0000-4000-8000-000000000011',
    'c1200000-0000-4000-8000-000000000003', 'Preserved other Blueprint');
insert into public.course_blueprint_assignments (
  id, course_blueprint_id, title
) values (
  'c1200000-0000-4000-8000-000000000020',
  'c1200000-0000-4000-8000-000000000010', 'Deleted assignment'
);
insert into public.course_blueprint_assessments (
  id, course_blueprint_id, assessment_type, title
) values (
  'c1200000-0000-4000-8000-000000000021',
  'c1200000-0000-4000-8000-000000000010', 'test', 'Deleted test'
);
insert into public.course_blueprint_versions (
  id, course_blueprint_id, version_number, source_draft_revision,
  snapshot_json, snapshot_sha256, created_by
) select
  'c1200000-0000-4000-8000-000000000022', id, 1, content_revision,
  '{}'::jsonb, repeat('a', 64), teacher_id
from public.course_blueprints
where id = 'c1200000-0000-4000-8000-000000000010';
insert into public.classrooms (
  id, teacher_id, title, class_code, source_blueprint_id,
  source_blueprint_version_id, source_blueprint_origin
) values (
  'c1200000-0000-4000-8000-000000000030',
  'c1200000-0000-4000-8000-000000000001',
  'Preserved linked Classroom', 'PUR120',
  'c1200000-0000-4000-8000-000000000010',
  'c1200000-0000-4000-8000-000000000022',
  jsonb_build_object(
    'blueprint_id', 'c1200000-0000-4000-8000-000000000010',
    'blueprint_title', 'Blueprint purge fixture',
    'blueprint_version_id', 'c1200000-0000-4000-8000-000000000022'
  )
);
insert into public.classroom_enrollments (classroom_id, student_id) values (
  'c1200000-0000-4000-8000-000000000030',
  'c1200000-0000-4000-8000-000000000002'
);

select public.begin_managed_storage_upload(
  'c1200000-0000-4000-8000-000000000040', 'test-documents',
  'blueprint-purge-fixture/teacher-material.pdf', null,
  'c1200000-0000-4000-8000-000000000010', null,
  'teacher_test_material',
  'c1200000-0000-4000-8000-000000000001', null,
  'course_blueprint_assessment',
  'c1200000-0000-4000-8000-000000000021',
  'application/pdf', 8
);
insert into storage.objects (bucket_id, name) values (
  'test-documents', 'blueprint-purge-fixture/teacher-material.pdf'
);
select public.verify_managed_storage_upload(
  'c1200000-0000-4000-8000-000000000040', repeat('b', 64)
);
select public.managed_storage_mark_ready(
  'c1200000-0000-4000-8000-000000000040'
);

do $copy_intents$
declare
  v_expired_at timestamptz;
begin
  if not public.begin_managed_storage_blueprint_copy_owner(
    'c1200000-0000-4000-8000-000000000070',
    'c1200000-0000-4000-8000-000000000071',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010'
  ) then raise exception 'Could not open Blueprint copy intent'; end if;
  if public.course_blueprint_purge_conflict(
      'c1200000-0000-4000-8000-000000000010'
    ) <> 'course_blueprint_copy_active'
  then raise exception 'Live Blueprint copy intent did not block purge'; end if;

  update public.managed_storage_provisional_owners
  set expires_at = clock_timestamp() - interval '1 minute'
  where id = 'c1200000-0000-4000-8000-000000000070';
  if public.course_blueprint_purge_conflict(
      'c1200000-0000-4000-8000-000000000010'
    ) <> 'course_blueprint_copy_active'
  then raise exception 'Expired unclosed copy intent lost its purge fence'; end if;
  if not public.heartbeat_managed_storage_blueprint_copy_owner(
    'c1200000-0000-4000-8000-000000000070',
    'c1200000-0000-4000-8000-000000000071',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010'
  ) then raise exception 'Could not heartbeat Blueprint copy intent'; end if;
  if public.course_blueprint_purge_conflict(
      'c1200000-0000-4000-8000-000000000010'
    ) <> 'course_blueprint_copy_active'
  then raise exception 'Heartbeat did not preserve a long-running copy fence'; end if;
  if not public.settle_managed_storage_blueprint_copy_owner(
    'c1200000-0000-4000-8000-000000000070',
    'c1200000-0000-4000-8000-000000000071',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010', 'aborted'
  ) then raise exception 'Could not abort Blueprint copy intent'; end if;
  if public.course_blueprint_purge_conflict(
      'c1200000-0000-4000-8000-000000000010'
    ) is not null
  then raise exception 'Closed copy intent still blocked purge'; end if;

  if not public.begin_managed_storage_blueprint_copy_owner(
    'c1200000-0000-4000-8000-000000000072',
    'c1200000-0000-4000-8000-000000000073',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010'
  ) then raise exception 'Could not open operation-backed copy intent'; end if;
  insert into public.course_blueprint_operations (
    id, teacher_id, operation_type, request_sha256, status
  ) values (
    'c1200000-0000-4000-8000-000000000073',
    'c1200000-0000-4000-8000-000000000001', 'instantiate',
    repeat('e', 64), 'running'
  );
  update public.managed_storage_provisional_owners
  set expires_at = clock_timestamp() - interval '25 hours'
  where id = 'c1200000-0000-4000-8000-000000000072';
  select expires_at into v_expired_at
  from public.managed_storage_provisional_owners
  where id = 'c1200000-0000-4000-8000-000000000072';
  if public.course_blueprint_purge_conflict(
      'c1200000-0000-4000-8000-000000000010'
    ) <> 'course_blueprint_copy_active'
  then raise exception 'Running copy lost its purge fence after lease expiry'; end if;
  if public.recover_managed_storage_blueprint_copy_owner(
    'c1200000-0000-4000-8000-000000000072',
    'c1200000-0000-4000-8000-000000000073',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010', v_expired_at, true
  ) then raise exception 'Recovery closed an intent with a running operation'; end if;
  if not public.settle_managed_storage_blueprint_copy_owner(
    'c1200000-0000-4000-8000-000000000072',
    'c1200000-0000-4000-8000-000000000073',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010', 'aborted'
  ) then raise exception 'Could not close operation-backed copy intent'; end if;
  delete from public.course_blueprint_operations
  where id = 'c1200000-0000-4000-8000-000000000073';

  if not public.begin_managed_storage_blueprint_copy_owner(
    'c1200000-0000-4000-8000-000000000074',
    'c1200000-0000-4000-8000-000000000075',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010'
  ) then raise exception 'Could not open stale recovery fixture'; end if;
  perform public.begin_managed_storage_upload(
    'c1200000-0000-4000-8000-000000000076', 'test-documents',
    'blueprint-purge-fixture/abandoned-copy.pdf', null, null,
    'c1200000-0000-4000-8000-000000000074',
    'teacher_test_material',
    'c1200000-0000-4000-8000-000000000001', null,
    'course_blueprint_operation',
    'c1200000-0000-4000-8000-000000000075',
    'application/pdf', 8
  );
  update public.managed_storage_provisional_owners
  set expires_at = clock_timestamp() - interval '25 hours'
  where id = 'c1200000-0000-4000-8000-000000000074'
  returning expires_at into v_expired_at;
  if public.recover_managed_storage_blueprint_copy_owner(
    'c1200000-0000-4000-8000-000000000074',
    'c1200000-0000-4000-8000-000000000075',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010',
    v_expired_at - interval '1 second', true
  ) then raise exception 'Recovery ignored its exact stale snapshot'; end if;
  if public.recover_managed_storage_blueprint_copy_owner(
    'c1200000-0000-4000-8000-000000000074',
    'c1200000-0000-4000-8000-000000000075',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010', v_expired_at, true
  ) then raise exception 'Recovery ignored live provisional file state'; end if;
  if not public.queue_managed_storage_cleanup(
    'c1200000-0000-4000-8000-000000000076',
    'blueprint_copy_operator_recovery'
  ) then raise exception 'Could not reconcile stale provisional file'; end if;
  if not public.recover_managed_storage_blueprint_copy_owner(
    'c1200000-0000-4000-8000-000000000074',
    'c1200000-0000-4000-8000-000000000075',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010', v_expired_at, true
  ) then raise exception 'Confirmed stale copy intent was not recovered'; end if;
  if public.course_blueprint_purge_conflict(
      'c1200000-0000-4000-8000-000000000010'
    ) is not null
  then raise exception 'Recovered copy intent still blocked purge'; end if;
  if not public.recover_managed_storage_blueprint_copy_owner(
    'c1200000-0000-4000-8000-000000000074',
    'c1200000-0000-4000-8000-000000000075',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010', v_expired_at, true
  ) then raise exception 'Recovery was not idempotent'; end if;
end;
$copy_intents$;

do $exercise$
declare
  v_impact jsonb;
  v_old_impact jsonb;
  v_result jsonb;
  v_claim public.course_blueprint_purge_objects;
  v_fenced boolean := false;
  v_recreated boolean := false;
begin
  v_impact := public.get_course_blueprint_purge_inventory(
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010'
  );
  if not (v_impact->>'ok')::boolean
    or (v_impact->>'linked_classroom_count')::integer <> 1
    or (v_impact->>'managed_file_count')::integer <> 1
  then raise exception 'Blueprint impact fixture is incomplete: %', v_impact; end if;
  if (public.get_course_blueprint_purge_inventory(
      'c1200000-0000-4000-8000-000000000003',
      'c1200000-0000-4000-8000-000000000010'
    )->>'status')::integer <> 404
  then raise exception 'Non-owner could inventory Blueprint deletion'; end if;

  insert into public.course_blueprint_operations (
    id, teacher_id, operation_type, request_sha256, status,
    source_blueprint_id
  ) values (
    'c1200000-0000-4000-8000-000000000050',
    'c1200000-0000-4000-8000-000000000001', 'instantiate',
    repeat('c', 64), 'running',
    'c1200000-0000-4000-8000-000000000010'
  );
  if public.course_blueprint_purge_conflict(
      'c1200000-0000-4000-8000-000000000010'
    ) <> 'course_blueprint_operation_active'
  then raise exception 'Running operation did not block Blueprint purge'; end if;
  delete from public.course_blueprint_operations
  where id = 'c1200000-0000-4000-8000-000000000050';

  update public.course_blueprint_purge_settings
  set rollout_mode = 'canary',
      canary_teacher_id = 'c1200000-0000-4000-8000-000000000001',
      canary_blueprint_id = 'c1200000-0000-4000-8000-000000000010'
  where singleton;
  v_impact := public.get_course_blueprint_purge_inventory(
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010'
  );
  if not (v_impact->>'deletion_available')::boolean then
    raise exception 'Canary Blueprint purge did not become available: %', v_impact;
  end if;

  v_old_impact := v_impact;
  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1,
      source_blueprint_origin = source_blueprint_origin
        || jsonb_build_object('lineage_fixture_revision', 2)
  where id = 'c1200000-0000-4000-8000-000000000030';
  v_impact := public.get_course_blueprint_purge_inventory(
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010'
  );
  if v_impact->>'inventory_sha256' = v_old_impact->>'inventory_sha256' then
    raise exception 'Linked Classroom lineage did not stale confirmation';
  end if;
  v_result := public.begin_course_blueprint_purge(
    'c1200000-0000-4000-8000-000000000059',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010',
    repeat('f', 64), v_old_impact
  );
  if v_result->>'error_code' <> 'course_blueprint_purge_inventory_changed' then
    raise exception 'Stale linked-Classroom confirmation was accepted: %', v_result;
  end if;

  v_result := public.begin_course_blueprint_purge(
    'c1200000-0000-4000-8000-000000000060',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010',
    repeat('d', 64), v_impact
  );
  if not (v_result->>'ok')::boolean then
    raise exception 'Blueprint purge did not start: %', v_result;
  end if;

  begin
    update public.course_blueprints set title = 'Fence failure'
    where id = 'c1200000-0000-4000-8000-000000000010';
  exception when sqlstate '55000' then
    v_fenced := true;
  end;
  if not v_fenced then raise exception 'Concurrent Blueprint edit crossed purge fence'; end if;

  -- The Classroom is preserved, so its independent edits remain available
  -- while only the Blueprint-owned graph is fenced.
  update public.classrooms
  set blueprint_source_revision = blueprint_source_revision + 1,
      source_blueprint_origin = source_blueprint_origin
        || jsonb_build_object('during_purge_edit_preserved', true)
  where id = 'c1200000-0000-4000-8000-000000000030';

  select * into v_claim from public.claim_course_blueprint_purge_object(
    'c1200000-0000-4000-8000-000000000060',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000061', 60
  );
  if v_claim.id is null then raise exception 'No Blueprint file was claimed'; end if;
  if not public.fail_course_blueprint_purge_object(
    v_claim.id,
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000061',
    'fixture_provider_failure'
  ) then raise exception 'Provider failure was not persisted'; end if;
  if not exists (
    select 1 from public.course_blueprint_purge_operations
    where id = 'c1200000-0000-4000-8000-000000000060'
      and status = 'failed' and retryable is true
  ) then raise exception 'Blueprint retry state was not durable'; end if;

  update public.course_blueprint_purge_objects
  set next_attempt_at = clock_timestamp()
  where id = v_claim.id;
  select * into v_claim from public.claim_course_blueprint_purge_object(
    'c1200000-0000-4000-8000-000000000060',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000062', 60
  );
  -- Supabase Storage sets this transaction-local capability while deleting
  -- through the provider API. The managed-storage trigger still requires the
  -- exact object to hold purge-processing authority.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
  where bucket_id = v_claim.storage_bucket and name = v_claim.storage_path;
  if not public.complete_course_blueprint_purge_object(
    v_claim.id,
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000062'
  ) then raise exception 'Verified provider deletion did not complete'; end if;
  if exists (
    select 1 from public.course_blueprint_purge_objects
    where id = v_claim.id and storage_path is not null
  ) then raise exception 'Deleted storage path was not redacted'; end if;

  v_result := public.begin_course_blueprint_purge(
    'c1200000-0000-4000-8000-000000000060',
    'c1200000-0000-4000-8000-000000000001',
    'c1200000-0000-4000-8000-000000000010',
    repeat('d', 64), v_impact
  );
  if not (v_result->>'ok')::boolean
    or not coalesce((v_result->>'replayed')::boolean, false)
  then raise exception 'Interrupted purge could not replay after file deletion: %', v_result;
  end if;

  begin
    insert into storage.objects (bucket_id, name) values (
      'test-documents', 'blueprint-purge-fixture/teacher-material.pdf'
    );
  exception when sqlstate '55000' then
    v_recreated := true;
  end;
  if not v_recreated then raise exception 'Deleted path could be recreated'; end if;

  v_result := public.finalize_course_blueprint_purge(
    'c1200000-0000-4000-8000-000000000060',
    'c1200000-0000-4000-8000-000000000001'
  );
  if v_result->>'operation_status' <> 'completed' then
    raise exception 'Blueprint purge did not finalize: %', v_result;
  end if;
end;
$exercise$;

do $verify$
begin
  if exists (
    select 1 from public.course_blueprints
    where id = 'c1200000-0000-4000-8000-000000000010'
  ) then raise exception 'Deleted Blueprint survived'; end if;
  if not exists (
    select 1 from public.course_blueprints
    where id = 'c1200000-0000-4000-8000-000000000011'
  ) then raise exception 'Unrelated Blueprint was deleted'; end if;
  if not exists (
    select 1 from public.classrooms
    where id = 'c1200000-0000-4000-8000-000000000030'
      and source_blueprint_id is null
      and source_blueprint_version_id is null
      and source_blueprint_origin->>'blueprint_deleted' = 'true'
      and source_blueprint_origin->>'during_purge_edit_preserved' = 'true'
  ) then raise exception 'Linked Classroom was not preserved and unlinked'; end if;
  if (select count(*) from public.users where id in (
      'c1200000-0000-4000-8000-000000000001',
      'c1200000-0000-4000-8000-000000000002'
    )) <> 2
  then raise exception 'Teacher or student account was deleted'; end if;
  if exists (
    select 1 from public.managed_storage_objects
    where id = 'c1200000-0000-4000-8000-000000000040'
  ) then raise exception 'Blueprint managed object survived'; end if;
  if not exists (
    select 1 from public.course_blueprint_purge_operations
    where id = 'c1200000-0000-4000-8000-000000000060'
      and status = 'completed'
  ) then raise exception 'Durable Blueprint purge audit was not preserved'; end if;
end;
$verify$;

rollback;
SQL

echo "Course Blueprint purge database fixture passed."
