#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after migration 200 is applied locally.
REPO_TARGET_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$REPO_TARGET_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$REPO_TARGET_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
declare
  v_signature constant text := 'public.save_assignment_repo_target_for_owner_v1(uuid,uuid,uuid,jsonb,timestamp with time zone)';
  v_security_definer boolean;
  v_config text[];
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '200'
  ) then
    raise exception 'Migration 200 is required; this harness never applies it';
  end if;
  if to_regprocedure(v_signature) is null then
    raise exception 'Contextual Assignment repo target function is missing';
  end if;
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute')
  then
    raise exception 'Contextual Assignment repo target privileges are incorrect';
  end if;
  select procedure.prosecdef, procedure.proconfig
  into strict v_security_definer, v_config
  from pg_proc as procedure
  where procedure.oid = to_regprocedure(v_signature);
  if not v_security_definer or not (v_config @> array['search_path=""']::text[]) then
    raise exception 'Contextual Assignment repo target security metadata is incorrect';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c2000000-0000-4000-8000-000000000001', 'repo-target-owner@example.invalid', 'student'),
  ('c2000000-0000-4000-8000-000000000002', 'repo-target-learner@example.invalid', 'student'),
  ('c2000000-0000-4000-8000-000000000003', 'repo-target-outsider@example.invalid', 'teacher'),
  ('c2000000-0000-4000-8000-000000000004', 'repo-target-unenrolled@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c2000000-0000-4000-8000-000000000001',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 2,
  'test:migration-200', 'assignment_repo_target_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c2000000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code) values (
  'c2000000-0000-4000-8000-000000000010',
  'c2000000-0000-4000-8000-000000000001',
  'Student-valued repo target owner', 'C200RT'
);
insert into public.classroom_enrollments (classroom_id, student_id) values (
  'c2000000-0000-4000-8000-000000000010',
  'c2000000-0000-4000-8000-000000000002'
);
insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, is_draft, released_at
) values (
  'c2000000-0000-4000-8000-000000000020',
  'c2000000-0000-4000-8000-000000000010',
  'Repository target', '', clock_timestamp() + interval '7 days',
  'c2000000-0000-4000-8000-000000000001', false, clock_timestamp()
);

set local role service_role;
do $behavior$
declare
  v_result jsonb;
begin
  v_result := public.save_assignment_repo_target_for_owner_v1(
    'c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000020',
    'c2000000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'selected_repo_url', 'https://github.com/codepetca/pika',
      'override_github_username', 'learner-login',
      'repo_owner', 'codepetca',
      'repo_name', 'pika',
      'selection_mode', 'teacher_override',
      'validation_status', 'valid',
      'validation_message', null
    ),
    '2026-09-20T20:00:00Z'
  );
  if v_result ->> 'actor_id' <> 'c2000000-0000-4000-8000-000000000001'
    or v_result #>> '{repo_target,assignment_id}' <> 'c2000000-0000-4000-8000-000000000020'
    or v_result #>> '{repo_target,student_id}' <> 'c2000000-0000-4000-8000-000000000002'
    or v_result #>> '{repo_target,repo_owner}' <> 'codepetca'
  then
    raise exception 'Contextual repo target returned unbound evidence: %', v_result;
  end if;

  begin
    perform public.save_assignment_repo_target_for_owner_v1(
      'c2000000-0000-4000-8000-000000000003',
      'c2000000-0000-4000-8000-000000000020',
      'c2000000-0000-4000-8000-000000000002', null, clock_timestamp()
    );
    raise exception 'Expected outsider denial';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.save_assignment_repo_target_for_owner_v1(
      'c2000000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000020',
      'c2000000-0000-4000-8000-000000000004', null, clock_timestamp()
    );
    raise exception 'Expected unenrolled learner denial';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.save_assignment_repo_target_for_owner_v1(
      'c2000000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000020',
      'c2000000-0000-4000-8000-000000000002',
      '{"selection_mode":"teacher_override"}'::jsonb,
      clock_timestamp()
    );
    raise exception 'Expected malformed target denial';
  exception when invalid_parameter_value then null;
  end;

  v_result := public.save_assignment_repo_target_for_owner_v1(
    'c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000020',
    'c2000000-0000-4000-8000-000000000002', null, clock_timestamp()
  );
  if v_result -> 'repo_target' <> 'null'::jsonb or exists (
    select 1 from public.assignment_repo_targets
    where assignment_id = 'c2000000-0000-4000-8000-000000000020'
      and student_id = 'c2000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Contextual repo target reset failed: %', v_result;
  end if;
end;
$behavior$;
reset role;

update public.classrooms
set archived_at = clock_timestamp()
where id = 'c2000000-0000-4000-8000-000000000010';

set local role service_role;
do $archived$
begin
  perform public.save_assignment_repo_target_for_owner_v1(
    'c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000020',
    'c2000000-0000-4000-8000-000000000002', null, clock_timestamp()
  );
  raise exception 'Expected archived Classroom denial';
exception when sqlstate '55000' then null;
end;
$archived$;
reset role;

rollback;
SQL

echo 'Contextual Assignment repo target database contracts passed.'
