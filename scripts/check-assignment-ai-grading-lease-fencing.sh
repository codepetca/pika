#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="supabase_db_pika"
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "Supabase database container is not running." >&2
  exit 2
fi

cleanup() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
delete from public.classrooms where id = 'e2020000-0000-4000-8000-000000000010';
delete from public.users where id::text like 'e2020000-0000-4000-8000-00000000000%';
SQL
}
trap cleanup EXIT
cleanup

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
set session_replication_role = replica;
insert into public.users (id, email, role) values
  ('e2020000-0000-4000-8000-000000000001', 'lease-teacher@example.test', 'teacher'),
  ('e2020000-0000-4000-8000-000000000002', 'lease-student@example.test', 'student');

insert into public.classrooms (id, teacher_id, title, class_code) values
  ('e2020000-0000-4000-8000-000000000010', 'e2020000-0000-4000-8000-000000000001', 'Lease fencing', 'LEASE202');
insert into public.classroom_enrollments (classroom_id, student_id) values
  ('e2020000-0000-4000-8000-000000000010', 'e2020000-0000-4000-8000-000000000002');
insert into public.assignments (id, classroom_id, title, due_at, created_by, gradebook_weight) values
  ('e2020000-0000-4000-8000-000000000011', 'e2020000-0000-4000-8000-000000000010', 'Lease assignment', now() + interval '1 day', 'e2020000-0000-4000-8000-000000000001', 1);
insert into public.assignment_docs (id, assignment_id, student_id, content, is_submitted, submitted_at) values
  ('e2020000-0000-4000-8000-000000000012', 'e2020000-0000-4000-8000-000000000011', 'e2020000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}', true, now());
insert into public.assignment_ai_grading_runs (
  id, assignment_id, status, triggered_by, model, requested_student_ids_json,
  selection_hash, requested_count, gradable_count
) values (
  'e2020000-0000-4000-8000-000000000013', 'e2020000-0000-4000-8000-000000000011', 'queued',
  'e2020000-0000-4000-8000-000000000001', 'test-model', '["e2020000-0000-4000-8000-000000000002"]',
  repeat('a', 64), 1, 1
);
insert into public.assignment_ai_grading_run_items (
  id, run_id, assignment_id, student_id, assignment_doc_id, assignment_doc_updated_at,
  queue_position, status
) select
  'e2020000-0000-4000-8000-000000000014', 'e2020000-0000-4000-8000-000000000013',
  'e2020000-0000-4000-8000-000000000011', 'e2020000-0000-4000-8000-000000000002',
  d.id, d.updated_at, 0, 'queued'
from public.assignment_docs d where d.id = 'e2020000-0000-4000-8000-000000000012';
set session_replication_role = origin;

do $contract$
declare
  v_old_token constant uuid := 'e2020000-0000-4000-8000-000000000020';
  v_new_token constant uuid := 'e2020000-0000-4000-8000-000000000021';
  v_item public.assignment_ai_grading_run_items%rowtype;
begin
  if has_function_privilege('authenticated', 'public.patch_assignment_ai_grading_run_with_lease_v1(uuid,uuid,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.patch_assignment_ai_grading_item_with_lease_v1(uuid,uuid,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.finalize_assignment_ai_grading_item_with_provenance_lease_v1(uuid,uuid,uuid,integer,integer,integer,text,boolean,boolean,text,text,jsonb,text,integer,text,text,timestamp with time zone)', 'execute')
    or not has_function_privilege('service_role', 'public.patch_assignment_ai_grading_item_with_lease_v1(uuid,uuid,jsonb)', 'execute')
  then
    raise exception 'Unexpected assignment AI grading lease RPC privileges';
  end if;

  set local role service_role;
  perform public.claim_assignment_ai_grading_run(
    'e2020000-0000-4000-8000-000000000013', v_old_token, 120
  );
  select * into v_item from public.assignment_ai_grading_run_items
  where id = 'e2020000-0000-4000-8000-000000000014';

  perform public.patch_assignment_ai_grading_item_with_lease_v1(
    v_item.id, v_old_token, '{"status":"processing"}'
  );
  reset role;

  update public.assignment_ai_grading_runs
  set lease_expires_at = clock_timestamp() - interval '1 second'
  where id = 'e2020000-0000-4000-8000-000000000013';

  set local role service_role;
  perform public.claim_assignment_ai_grading_run(
    'e2020000-0000-4000-8000-000000000013', v_new_token, 120
  );

  begin
    perform public.patch_assignment_ai_grading_item_with_lease_v1(
      v_item.id, v_old_token, '{"status":"failed","last_error_code":"stale-worker"}'
    );
    raise exception 'Stale lease mutated an assignment AI grading item';
  exception when serialization_failure then
    null;
  end;

  begin
    perform public.finalize_assignment_ai_grading_item_with_provenance_lease_v1(
      v_item.id, v_old_token, 'e2020000-0000-4000-8000-000000000001',
      9, 9, 9, 'stale', true, true, 'stale', 'test-model', null, 'teacher',
      1, 'completed', null, clock_timestamp()
    );
    raise exception 'Stale lease finalized an assignment AI grading item';
  exception when serialization_failure then
    null;
  end;

  perform public.patch_assignment_ai_grading_item_with_lease_v1(
    v_item.id, v_new_token, '{"status":"queued","last_error_code":null}'
  );
  reset role;

  select * into v_item from public.assignment_ai_grading_run_items where id = v_item.id;
  if v_item.status <> 'queued' or v_item.last_error_code is not null then
    raise exception 'Current lease could not mutate the assignment AI grading item';
  end if;
end;
$contract$;

select 'Passed: stale assignment AI grading workers cannot mutate or finalize after lease takeover';
SQL
