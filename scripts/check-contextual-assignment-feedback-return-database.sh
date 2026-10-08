#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after migration 196 is applied locally.
FEEDBACK_RETURN_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$FEEDBACK_RETURN_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$FEEDBACK_RETURN_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
declare
  v_feedback_signature constant text := 'public.return_assignment_feedback_for_owner_v1(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone)';
  v_return_signature constant text := 'public.return_assignment_docs_for_owner_v1(uuid,uuid,uuid[],timestamp with time zone)';
  v_security_definer boolean;
  v_config text[];
  v_signature text;
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '196'
  ) then
    raise exception 'Migration 196 is required; this harness never applies it';
  end if;

  foreach v_signature in array array[v_feedback_signature, v_return_signature]
  loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Contextual Assignment feedback-return function is missing: %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
    then
      raise exception 'Contextual Assignment feedback-return privileges are incorrect: %', v_signature;
    end if;
    select procedure.prosecdef, procedure.proconfig
    into strict v_security_definer, v_config
    from pg_proc as procedure
    where procedure.oid = to_regprocedure(v_signature);
    if not v_security_definer or not (v_config @> array['search_path=""']::text[]) then
      raise exception 'Contextual Assignment feedback-return security metadata is incorrect: %', v_signature;
    end if;
  end loop;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1960000-0000-4000-8000-000000000001', 'feedback-owner-student@example.invalid', 'student'),
  ('c1960000-0000-4000-8000-000000000002', 'feedback-learner@example.invalid', 'student'),
  ('c1960000-0000-4000-8000-000000000003', 'return-learner@example.invalid', 'student'),
  ('c1960000-0000-4000-8000-000000000004', 'missing-doc-learner@example.invalid', 'student'),
  ('c1960000-0000-4000-8000-000000000005', 'feedback-outsider@example.invalid', 'teacher'),
  ('c1960000-0000-4000-8000-000000000006', 'feedback-not-enrolled@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c1960000-0000-4000-8000-000000000001',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 2,
  'test:migration-196', 'assignment_feedback_return_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c1960000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code) values (
  'c1960000-0000-4000-8000-000000000010',
  'c1960000-0000-4000-8000-000000000001',
  'Student-valued feedback-return owner', 'C196BACK'
);
insert into public.classroom_enrollments (classroom_id, student_id) values
  ('c1960000-0000-4000-8000-000000000010', 'c1960000-0000-4000-8000-000000000002'),
  ('c1960000-0000-4000-8000-000000000010', 'c1960000-0000-4000-8000-000000000003'),
  ('c1960000-0000-4000-8000-000000000010', 'c1960000-0000-4000-8000-000000000004');
insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, is_draft, released_at
) values (
  'c1960000-0000-4000-8000-000000000020',
  'c1960000-0000-4000-8000-000000000010',
  'Return my feedback', '', clock_timestamp() + interval '7 days',
  'c1960000-0000-4000-8000-000000000001', false, clock_timestamp()
);
insert into public.assignment_docs (
  id, assignment_id, student_id, content, is_submitted, submitted_at,
  score_completion, score_thinking, score_workflow, teacher_feedback_draft
) values
  (
    'c1960000-0000-4000-8000-000000000030',
    'c1960000-0000-4000-8000-000000000020',
    'c1960000-0000-4000-8000-000000000002',
    '{"type":"doc","content":[]}'::jsonb, true, clock_timestamp(),
    null, null, null, 'Draft feedback'
  ),
  (
    'c1960000-0000-4000-8000-000000000031',
    'c1960000-0000-4000-8000-000000000020',
    'c1960000-0000-4000-8000-000000000003',
    '{"type":"doc","content":[]}'::jsonb, true, clock_timestamp(),
    8, 7, 9, 'Returned grading feedback'
  );

set local role service_role;
do $behavior$
declare
  v_assignment constant uuid := 'c1960000-0000-4000-8000-000000000020';
  v_feedback_learner constant uuid := 'c1960000-0000-4000-8000-000000000002';
  v_return_learner constant uuid := 'c1960000-0000-4000-8000-000000000003';
  v_created_learner constant uuid := 'c1960000-0000-4000-8000-000000000004';
  v_owner constant uuid := 'c1960000-0000-4000-8000-000000000001';
  v_outsider constant uuid := 'c1960000-0000-4000-8000-000000000005';
  v_not_enrolled constant uuid := 'c1960000-0000-4000-8000-000000000006';
  v_expected timestamptz;
  v_feedback_result jsonb;
  v_return_result jsonb;
begin
  select updated_at into strict v_expected
  from public.assignment_docs
  where assignment_id = v_assignment and student_id = v_feedback_learner;

  v_feedback_result := public.return_assignment_feedback_for_owner_v1(
    v_owner, v_assignment, v_feedback_learner,
    'Contextual feedback', v_expected, clock_timestamp()
  );
  if (v_feedback_result->>'applied')::boolean is not true
    or v_feedback_result->'doc'->>'assignment_id' is distinct from v_assignment::text
    or v_feedback_result->'doc'->>'student_id' is distinct from v_feedback_learner::text
    or v_feedback_result->'doc'->>'feedback' is distinct from 'Contextual feedback'
    or v_feedback_result->'entry'->>'entry_kind' is distinct from 'teacher_feedback'
    or v_feedback_result->'entry'->>'author_type' is distinct from 'teacher'
    or v_feedback_result->'entry'->>'created_by' is distinct from v_owner::text
  then
    raise exception 'Contextual feedback-only return produced invalid evidence: %', v_feedback_result;
  end if;

  begin
    perform public.return_assignment_feedback_for_owner_v1(
      v_outsider, v_assignment, v_feedback_learner,
      'Forbidden', (v_feedback_result->'doc'->>'updated_at')::timestamptz, clock_timestamp()
    );
    raise exception 'Expected unrelated actor feedback-return denial';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.return_assignment_feedback_for_owner_v1(
      v_owner, v_assignment, v_not_enrolled, 'Not enrolled', null, clock_timestamp()
    );
    raise exception 'Expected non-enrolled feedback-return denial';
  exception when invalid_parameter_value then null;
  end;

  v_return_result := public.return_assignment_docs_for_owner_v1(
    v_owner,
    v_assignment,
    array[v_return_learner, v_created_learner, v_not_enrolled],
    clock_timestamp()
  );
  if (v_return_result->>'returned_count')::integer <> 2
    or (v_return_result->>'updated_count')::integer <> 1
    or (v_return_result->>'created_count')::integer <> 1
    or (v_return_result->>'missing_count')::integer <> 1
    or not (v_return_result->'returned_student_ids' @> to_jsonb(array[v_return_learner, v_created_learner]))
    or not (v_return_result->'created_student_ids' @> to_jsonb(array[v_created_learner]))
    or not (v_return_result->'missing_student_ids' @> to_jsonb(array[v_not_enrolled]))
    or (v_return_result->>'mailbox_tracking_available')::boolean is not true
  then
    raise exception 'Contextual selected return produced invalid partition evidence: %', v_return_result;
  end if;
  if not exists (
    select 1 from public.assignment_docs
    where assignment_id = v_assignment and student_id = v_return_learner
      and is_submitted is false and returned_at is not null
      and feedback = 'Returned grading feedback'
      and score_completion = 8 and score_thinking = 7 and score_workflow = 9
  ) or not exists (
    select 1 from public.assignment_docs
    where assignment_id = v_assignment and student_id = v_created_learner
      and is_submitted is false and returned_at is not null
      and score_completion = 0 and score_thinking = 0 and score_workflow = 0
  ) then
    raise exception 'Contextual selected return did not preserve return semantics';
  end if;

  update public.classrooms set archived_at = clock_timestamp()
  where id = 'c1960000-0000-4000-8000-000000000010';
  begin
    perform public.return_assignment_feedback_for_owner_v1(
      v_owner, v_assignment, v_feedback_learner, 'Archived',
      (v_feedback_result->'doc'->>'updated_at')::timestamptz, clock_timestamp()
    );
    raise exception 'Expected archived feedback-only return denial';
  exception when sqlstate '55000' then
    if sqlerrm <> 'assignment_feedback_return_archived' then
      raise;
    end if;
  end;
  begin
    perform public.return_assignment_docs_for_owner_v1(
      v_owner, v_assignment, array[v_feedback_learner], clock_timestamp()
    );
    raise exception 'Expected archived selected return denial';
  exception when sqlstate '55000' then
    if sqlerrm <> 'assignment_feedback_return_archived' then
      raise;
    end if;
  end;
end;
$behavior$;
reset role;

rollback;
SQL

echo 'Contextual Assignment feedback-return database checks passed.'
