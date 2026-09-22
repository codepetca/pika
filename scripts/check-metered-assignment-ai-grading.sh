#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="supabase_db_pika"
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

cleanup() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
delete from public.classrooms where id = 'e2030000-0000-4000-8000-000000000010';
delete from public.users where id::text like 'e2030000-0000-4000-8000-00000000000%';
SQL
}
trap cleanup EXIT
cleanup

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
set session_replication_role = replica;
insert into public.users (id, email, role) values
  ('e2030000-0000-4000-8000-000000000001', 'metered-assignment-teacher@example.test', 'teacher'),
  ('e2030000-0000-4000-8000-000000000002', 'metered-assignment-student-1@example.test', 'student'),
  ('e2030000-0000-4000-8000-000000000003', 'metered-assignment-student-2@example.test', 'student'),
  ('e2030000-0000-4000-8000-000000000004', 'metered-assignment-student-3@example.test', 'student');

insert into public.classrooms (id, teacher_id, title, class_code) values
  ('e2030000-0000-4000-8000-000000000010', 'e2030000-0000-4000-8000-000000000001', 'Metered assignment', 'METER203');
insert into public.classroom_enrollments (classroom_id, student_id) values
  ('e2030000-0000-4000-8000-000000000010', 'e2030000-0000-4000-8000-000000000002'),
  ('e2030000-0000-4000-8000-000000000010', 'e2030000-0000-4000-8000-000000000003'),
  ('e2030000-0000-4000-8000-000000000010', 'e2030000-0000-4000-8000-000000000004');
insert into public.assignments (id, classroom_id, title, due_at, created_by, gradebook_weight) values
  ('e2030000-0000-4000-8000-000000000011', 'e2030000-0000-4000-8000-000000000010', 'Metered assignment', now() + interval '1 day', 'e2030000-0000-4000-8000-000000000001', 1);
insert into public.assignment_docs (id, assignment_id, student_id, content, is_submitted, submitted_at) values
  ('e2030000-0000-4000-8000-000000000012', 'e2030000-0000-4000-8000-000000000011', 'e2030000-0000-4000-8000-000000000002', '{"type":"doc","content":[{"type":"paragraph"}]}', true, now()),
  ('e2030000-0000-4000-8000-000000000013', 'e2030000-0000-4000-8000-000000000011', 'e2030000-0000-4000-8000-000000000003', '{"type":"doc","content":[{"type":"paragraph"}]}', true, now()),
  ('e2030000-0000-4000-8000-000000000014', 'e2030000-0000-4000-8000-000000000011', 'e2030000-0000-4000-8000-000000000004', '{"type":"doc","content":[{"type":"paragraph"}]}', true, now());
insert into public.effective_feature_entitlements (
  subject_user_id, feature_key, source, enabled, starts_at, quota_limit, revision
) values (
  'e2030000-0000-4000-8000-000000000001', 'grading.ai', 'manual', true,
  clock_timestamp() - interval '1 minute', 3, 1
);
set session_replication_role = origin;

do $contract$
declare
  v_teacher constant uuid := 'e2030000-0000-4000-8000-000000000001';
  v_assignment constant uuid := 'e2030000-0000-4000-8000-000000000011';
  v_doc_1 constant uuid := 'e2030000-0000-4000-8000-000000000012';
  v_doc_2 constant uuid := 'e2030000-0000-4000-8000-000000000013';
  v_doc_3 constant uuid := 'e2030000-0000-4000-8000-000000000014';
  v_lease constant uuid := 'e2030000-0000-4000-8000-000000000020';
  v_run public.assignment_ai_grading_runs%rowtype;
  v_legacy_run public.assignment_ai_grading_runs%rowtype;
  v_item_1 public.assignment_ai_grading_run_items%rowtype;
  v_item_2 public.assignment_ai_grading_run_items%rowtype;
  v_item_3 public.assignment_ai_grading_run_items%rowtype;
  v_rows jsonb;
  v_result jsonb;
  v_count integer;
  v_run_count integer;
  v_status text;
begin
  if has_function_privilege('authenticated', 'public.create_metered_assignment_ai_grading_run_v1(uuid,uuid,text,uuid[],text,integer,integer,integer,jsonb,timestamp with time zone)', 'execute')
    or has_function_privilege('authenticated', 'public.reserve_assignment_ai_grading_item_usage_with_lease_v1(uuid,uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.finalize_assignment_ai_grading_item_and_settle_usage_v1(uuid,uuid,uuid,integer,integer,integer,text,boolean,boolean,text,text,jsonb,text,integer,text,text,timestamp with time zone)', 'execute')
    or has_function_privilege('authenticated', 'public.finalize_skipped_assignment_ai_grading_item_and_release_v1(uuid,uuid,uuid,integer,integer,integer,text,boolean,boolean,text,text,jsonb,text,integer,text,timestamp with time zone)', 'execute')
    or has_function_privilege('authenticated', 'public.fail_assignment_ai_grading_item_and_release_usage_with_lease_v1(uuid,uuid,integer,text,text,text)', 'execute')
    or has_function_privilege('authenticated', 'public.fail_assignment_ai_grading_run_and_release_usage_with_lease_v1(uuid,uuid,text,text,text)', 'execute')
    or not has_function_privilege('service_role', 'public.create_metered_assignment_ai_grading_run_v1(uuid,uuid,text,uuid[],text,integer,integer,integer,jsonb,timestamp with time zone)', 'execute')
    or not has_function_privilege('service_role', 'public.finalize_skipped_assignment_ai_grading_item_and_release_v1(uuid,uuid,uuid,integer,integer,integer,text,boolean,boolean,text,text,jsonb,text,integer,text,timestamp with time zone)', 'execute')
  then
    raise exception 'Unexpected metered Assignment AI grading privileges';
  end if;

  select jsonb_agg(jsonb_build_object(
    'student_id', d.student_id,
    'assignment_doc_id', d.id,
    'assignment_doc_updated_at', d.updated_at,
    'assignment_doc_revision_provided', true,
    'queue_position', case when d.id = v_doc_1 then 0 when d.id = v_doc_2 then 1 else 2 end,
    'status', 'queued',
    'skip_reason', null,
    'attempt_count', 0
  ) order by d.id)
  into v_rows
  from public.assignment_docs d
  where d.id in (v_doc_1, v_doc_2, v_doc_3);

  set local role service_role;
  begin
    perform public.settle_feature_usage_v1(gen_random_uuid(), v_teacher, null, 1);
    raise exception 'Null settlement feature key bypassed validation';
  exception when invalid_parameter_value then
    null;
  end;
  begin
    perform public.release_feature_usage_v1(gen_random_uuid(), v_teacher, 'grading.ai', 1, null);
    raise exception 'Null release reason bypassed validation';
  exception when invalid_parameter_value then
    null;
  end;
  begin
    perform public.create_metered_assignment_ai_grading_run_v1(
      v_assignment,
      v_teacher,
      'test-model',
      array[
        'e2030000-0000-4000-8000-000000000002'::uuid,
        'e2030000-0000-4000-8000-000000000003'::uuid,
        'e2030000-0000-4000-8000-000000000004'::uuid
      ],
      repeat('e', 64),
      0,
      0,
      0,
      v_rows,
      clock_timestamp()
    );
    raise exception 'Mismatched queued count created a metered Assignment run';
  exception when invalid_parameter_value then
    null;
  end;
  reset role;

  update public.assignments
  set blueprint_archived_at = clock_timestamp()
  where id = v_assignment;
  set local role service_role;
  begin
    perform public.create_metered_assignment_ai_grading_run_v1(
      v_assignment,
      v_teacher,
      'test-model',
      array[
        'e2030000-0000-4000-8000-000000000002'::uuid,
        'e2030000-0000-4000-8000-000000000003'::uuid,
        'e2030000-0000-4000-8000-000000000004'::uuid
      ],
      repeat('f', 64),
      3,
      0,
      0,
      v_rows,
      clock_timestamp()
    );
    raise exception 'Blueprint-archived Assignment reserved usage';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  update public.assignments
  set blueprint_archived_at = null
  where id = v_assignment;

  select count(*) into v_count
  from public.assignment_ai_grading_runs run where run.assignment_id = v_assignment;
  if v_count <> 0 then
    raise exception 'Rejected metered Assignment admission left behind a run';
  end if;
  select count(*) into v_count
  from public.feature_usage_reservations reservation
  where reservation.subject_user_id = v_teacher;
  if v_count <> 0 then
    raise exception 'Rejected metered Assignment admission left behind a reservation';
  end if;

  set local role service_role;
  v_run := public.create_metered_assignment_ai_grading_run_v1(
    v_assignment,
    v_teacher,
    'test-model',
    array[
      'e2030000-0000-4000-8000-000000000002'::uuid,
      'e2030000-0000-4000-8000-000000000003'::uuid,
      'e2030000-0000-4000-8000-000000000004'::uuid
    ],
    repeat('a', 64),
    3,
    0,
    0,
    v_rows,
    clock_timestamp()
  );
  reset role;

  if v_run.worker_contract_version <> 1 then
    raise exception 'Metered Assignment run did not opt into lease contract v1';
  end if;

  select count(*) into v_count
  from public.feature_usage_reservations reservation
  where reservation.subject_user_id = v_teacher
    and reservation.operation_kind = 'assignment_ai_grading'
    and reservation.status = 'reserved'
    and reservation.units = 1;
  if v_count <> 3 then
    raise exception 'Expected one reserved unit per queued Assignment item, found %', v_count;
  end if;

  select item.* into v_item_1
  from public.assignment_ai_grading_run_items item
  where item.run_id = v_run.id and item.student_id = 'e2030000-0000-4000-8000-000000000002';
  select item.* into v_item_2
  from public.assignment_ai_grading_run_items item
  where item.run_id = v_run.id and item.student_id = 'e2030000-0000-4000-8000-000000000003';
  select item.* into v_item_3
  from public.assignment_ai_grading_run_items item
  where item.run_id = v_run.id and item.student_id = 'e2030000-0000-4000-8000-000000000004';

  set local role service_role;
  perform public.claim_assignment_ai_grading_run(v_run.id, v_lease, 120);
  v_result := public.reserve_assignment_ai_grading_item_usage_with_lease_v1(v_item_1.id, v_lease);
  if coalesce((v_result->>'duplicate')::boolean, false) is not true then
    raise exception 'Retrying an admitted Assignment item did not return its reservation';
  end if;
  perform public.reserve_assignment_ai_grading_item_usage_with_lease_v1(v_item_1.id, v_lease);

  perform public.finalize_assignment_ai_grading_item_and_settle_usage_v1(
    v_item_1.id, v_lease, v_teacher,
    3, 3, 3, 'metered feedback', true, true,
    'metered feedback', 'test-model', null, 'teacher',
    1, 'completed', null, clock_timestamp()
  );
  reset role;

  select status into v_status
  from public.feature_usage_reservations where operation_id = v_item_1.id;
  if v_status <> 'settled' then
    raise exception 'Successful Assignment grading did not settle its reserved unit';
  end if;
  select count(*) into v_count
  from public.feature_usage_reservations where operation_id = v_item_1.id;
  if v_count <> 1 then
    raise exception 'Assignment item replay created duplicate reservations';
  end if;

  set local role service_role;
  begin
    perform public.finalize_assignment_ai_grading_item_and_settle_usage_v1(
      v_item_2.id, v_lease, v_teacher,
      0, 0, 0, 'no gradable work', true, true,
      null, null, null, 'teacher',
      1, 'skipped', 'empty_doc', clock_timestamp()
    );
    raise exception 'Skipped Assignment item settled a usage reservation';
  exception when invalid_parameter_value then
    null;
  end;
  perform public.finalize_skipped_assignment_ai_grading_item_and_release_v1(
    v_item_2.id, v_lease, v_teacher,
    0, 0, 0, 'no gradable work', true, true,
    null, null, null, 'teacher',
    1, 'empty_doc', clock_timestamp()
  );
  reset role;

  select status into v_status
  from public.feature_usage_reservations where operation_id = v_item_2.id;
  if v_status <> 'released' then
    raise exception 'Skipped Assignment item did not release its reserved unit';
  end if;

  update public.feature_usage_reservations
  set reserved_at = clock_timestamp() - interval '2 days',
      expires_at = clock_timestamp() - interval '1 day'
  where operation_id = v_item_3.id;

  set local role service_role;
  begin
    perform public.finalize_assignment_ai_grading_item_and_settle_usage_v1(
      v_item_3.id, v_lease, v_teacher,
      3, 3, 3, 'must roll back', true, true,
      'must roll back', 'test-model', null, 'teacher',
      1, 'completed', null, clock_timestamp()
    );
    raise exception 'Expired reservation finalized an Assignment item';
  exception when object_not_in_prerequisite_state then
    null;
  end;
  reset role;

  select item.status into v_status
  from public.assignment_ai_grading_run_items item where item.id = v_item_3.id;
  if v_status <> 'queued' then
    raise exception 'Failed settlement did not roll back Assignment finalization';
  end if;

  set local role service_role;
  perform public.fail_assignment_ai_grading_item_and_release_usage_with_lease_v1(
    v_item_3.id, v_lease, 1, 'reservation_expired', 'Reservation expired', 'expired'
  );
  perform public.patch_assignment_ai_grading_run_with_lease_v1(
    v_run.id,
    v_lease,
    jsonb_build_object(
      'status', 'completed_with_errors',
      'processed_count', 3,
      'completed_count', 1,
      'skipped_empty_count', 1,
      'failed_count', 1,
      'completed_at', clock_timestamp(),
      'lease_token', null,
      'lease_expires_at', null
    )
  );
  reset role;

  select status into v_status
  from public.feature_usage_reservations where operation_id = v_item_3.id;
  if v_status <> 'released' then
    raise exception 'Terminal Assignment failure did not release its unit';
  end if;

  update public.effective_feature_entitlements
  set quota_limit = 1, revision = 2, updated_at = clock_timestamp()
  where subject_user_id = v_teacher and feature_key = 'grading.ai';

  select count(*) into v_run_count
  from public.assignment_ai_grading_runs run
  where run.assignment_id = v_assignment and run.worker_contract_version = 1;

  select jsonb_build_array(jsonb_build_object(
    'student_id', d.student_id,
    'assignment_doc_id', d.id,
    'assignment_doc_updated_at', d.updated_at,
    'assignment_doc_revision_provided', true,
    'queue_position', 0,
    'status', 'queued',
    'attempt_count', 0
  ))
  into v_rows
  from public.assignment_docs d where d.id = v_doc_1;

  set local role service_role;
  begin
    perform public.create_metered_assignment_ai_grading_run_v1(
      v_assignment, v_teacher, 'test-model',
      array['e2030000-0000-4000-8000-000000000002'::uuid],
      repeat('b', 64), 1, 0, 0, v_rows, clock_timestamp()
    );
    raise exception 'Entitlement revision minted fresh Assignment grading capacity';
  exception when check_violation then
    if sqlerrm <> 'feature_usage_quota_exhausted' then
      raise;
    end if;
  end;
  reset role;

  select count(*) into v_count
  from public.assignment_ai_grading_runs run
  where run.assignment_id = v_assignment and run.worker_contract_version = 1;
  if v_count <> v_run_count then
    raise exception 'Failed quota admission left behind a metered Assignment run';
  end if;

  set local role service_role;
  v_legacy_run := public.create_assignment_ai_grading_run_atomic(
    v_assignment, v_teacher, 'test-model',
    array['e2030000-0000-4000-8000-000000000002'::uuid],
    repeat('c', 64), 1, 0, 0, v_rows, clock_timestamp()
  );
  reset role;

  if v_legacy_run.worker_contract_version <> 0 then
    raise exception 'Legacy Assignment path unexpectedly opted into metering';
  end if;
  select count(*) into v_count
  from public.feature_usage_reservations reservation
  where reservation.subject_user_id = v_teacher;
  if v_count <> 3 then
    raise exception 'Legacy Assignment path unexpectedly created usage reservations';
  end if;
end;
$contract$;

select 'Passed: Assignment AI usage is reserved per queued item, settled on success, released on terminal failure, revision-safe, and default-off';
SQL
