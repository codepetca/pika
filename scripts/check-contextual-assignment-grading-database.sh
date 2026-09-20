#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after migration 194 is applied locally.
GRADING_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$GRADING_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$GRADING_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
declare
  v_signature constant text := 'public.save_assignment_grades_for_owner_v1(uuid,uuid,uuid[],jsonb,boolean,integer,integer,integer,boolean,boolean,text,timestamp with time zone)';
  v_security_definer boolean;
  v_config text[];
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '194'
  ) then
    raise exception 'Migration 194 is required; this harness never applies it';
  end if;
  if to_regprocedure(v_signature) is null then
    raise exception 'Contextual Assignment grading function is missing';
  end if;
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute')
  then
    raise exception 'Contextual Assignment grading privileges are incorrect';
  end if;
  select procedure.prosecdef, procedure.proconfig
  into strict v_security_definer, v_config
  from pg_proc as procedure
  where procedure.oid = to_regprocedure(v_signature);
  if not v_security_definer or not (v_config @> array['search_path=""']::text[]) then
    raise exception 'Contextual Assignment grading security metadata is incorrect';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1940000-0000-4000-8000-000000000001', 'grading-owner-student@example.invalid', 'student'),
  ('c1940000-0000-4000-8000-000000000002', 'grading-learner@example.invalid', 'student'),
  ('c1940000-0000-4000-8000-000000000003', 'grading-outsider@example.invalid', 'teacher'),
  ('c1940000-0000-4000-8000-000000000004', 'grading-not-enrolled@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c1940000-0000-4000-8000-000000000001',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 2,
  'test:migration-194', 'assignment_grading_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c1940000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code) values (
  'c1940000-0000-4000-8000-000000000010',
  'c1940000-0000-4000-8000-000000000001',
  'Student-valued grading owner', 'C194GRAD'
);
insert into public.classroom_enrollments (classroom_id, student_id) values (
  'c1940000-0000-4000-8000-000000000010',
  'c1940000-0000-4000-8000-000000000002'
);
insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, is_draft, released_at
) values (
  'c1940000-0000-4000-8000-000000000020',
  'c1940000-0000-4000-8000-000000000010',
  'Grade me', '', clock_timestamp() + interval '7 days',
  'c1940000-0000-4000-8000-000000000001', false, clock_timestamp()
);
insert into public.assignment_docs (
  id, assignment_id, student_id, content, is_submitted, submitted_at
) values (
  'c1940000-0000-4000-8000-000000000030',
  'c1940000-0000-4000-8000-000000000020',
  'c1940000-0000-4000-8000-000000000002',
  '{"type":"doc","content":[]}'::jsonb, true, clock_timestamp()
);

set local role service_role;
do $behavior$
declare
  v_assignment constant uuid := 'c1940000-0000-4000-8000-000000000020';
  v_learner constant uuid := 'c1940000-0000-4000-8000-000000000002';
  v_owner constant uuid := 'c1940000-0000-4000-8000-000000000001';
  v_outsider constant uuid := 'c1940000-0000-4000-8000-000000000003';
  v_not_enrolled constant uuid := 'c1940000-0000-4000-8000-000000000004';
  v_expected timestamptz;
  v_result jsonb;
begin
  select updated_at into strict v_expected
  from public.assignment_docs
  where assignment_id = v_assignment and student_id = v_learner;

  v_result := public.save_assignment_grades_for_owner_v1(
    v_owner, v_assignment, array[v_learner],
    jsonb_build_object(v_learner::text, to_jsonb(v_expected)),
    true, 7, 8, 9, true, true, 'Contextual feedback', clock_timestamp()
  );
  if jsonb_array_length(v_result->'docs') <> 1
    or v_result->'docs'->0->>'assignment_id' is distinct from v_assignment::text
    or v_result->'docs'->0->>'student_id' is distinct from v_learner::text
    or (v_result->'docs'->0->>'score_completion')::integer <> 7
  then
    raise exception 'Contextual grade returned invalid evidence: %', v_result;
  end if;

  begin
    perform public.save_assignment_grades_for_owner_v1(
      v_outsider, v_assignment, array[v_learner], '{}'::jsonb,
      true, 1, 1, 1, true, false, '', clock_timestamp()
    );
    raise exception 'Expected unrelated actor grading denial';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.save_assignment_grades_for_owner_v1(
      v_owner, v_assignment, array[v_not_enrolled],
      jsonb_build_object(v_not_enrolled::text, null),
      true, 1, 1, 1, true, false, '', clock_timestamp()
    );
    raise exception 'Expected non-enrolled learner grading denial';
  exception when invalid_parameter_value then null;
  end;

  update public.classrooms set archived_at = clock_timestamp()
  where id = 'c1940000-0000-4000-8000-000000000010';
  begin
    perform public.save_assignment_grades_for_owner_v1(
      v_owner, v_assignment, array[v_learner], '{}'::jsonb,
      true, 1, 1, 1, true, false, '', clock_timestamp()
    );
    raise exception 'Expected archived Assignment grading denial';
  exception when sqlstate '55000' then null;
  end;
end;
$behavior$;
reset role;

rollback;
SQL

echo 'Contextual Assignment grading database checks passed.'
