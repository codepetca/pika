#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after migration 192 is applied locally.
ASSIGNMENT_CREATION_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$ASSIGNMENT_CREATION_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$ASSIGNMENT_CREATION_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
declare
  v_signature constant text := 'public.create_assignment_for_owner_v1(uuid,uuid,text,text,text,jsonb,timestamp with time zone,jsonb)';
  v_security_definer boolean;
  v_config text[];
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '192'
  ) then
    raise exception 'Migration 192 is required; this harness never applies it';
  end if;
  if to_regprocedure(v_signature) is null then
    raise exception 'Contextual Assignment creation function is missing';
  end if;
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute')
  then
    raise exception 'Contextual Assignment creation privileges are incorrect';
  end if;

  select procedure.prosecdef, procedure.proconfig
  into strict v_security_definer, v_config
  from pg_proc as procedure
  where procedure.oid = to_regprocedure(v_signature);
  if not v_security_definer or not (v_config @> array['search_path=""']::text[]) then
    raise exception 'Contextual Assignment creation security metadata is incorrect';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1920000-0000-4000-8000-000000000001', 'assignment-creation-student@example.invalid', 'student'),
  ('c1920000-0000-4000-8000-000000000002', 'assignment-creation-teacher@example.invalid', 'teacher'),
  ('c1920000-0000-4000-8000-000000000003', 'assignment-creation-outsider@example.invalid', 'teacher');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), owner_id, 'classrooms.create', 'manual', true,
  clock_timestamp(), null, 10, 'test:migration-192', 'assignment_creation_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = owner_id and feature_key = 'classrooms.create'), 0)
)
from (values
  ('c1920000-0000-4000-8000-000000000001'::uuid),
  ('c1920000-0000-4000-8000-000000000002'::uuid)
) as owners(owner_id);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c1920000-0000-4000-8000-000000000010', 'c1920000-0000-4000-8000-000000000001', 'Student-valued owner', 'C192STUD', null),
  ('c1920000-0000-4000-8000-000000000011', 'c1920000-0000-4000-8000-000000000002', 'Teacher-valued owner', 'C192TEAC', null),
  ('c1920000-0000-4000-8000-000000000012', 'c1920000-0000-4000-8000-000000000001', 'Archived owner class', 'C192ARCH', clock_timestamp());

insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, position
) values (
  'c1920000-0000-4000-8000-000000000020',
  'c1920000-0000-4000-8000-000000000010',
  'Existing assignment', '', clock_timestamp() + interval '7 days',
  'c1920000-0000-4000-8000-000000000001', 1
);
insert into public.surveys (
  id, classroom_id, title, position, created_by
) values (
  'c1920000-0000-4000-8000-000000000021',
  'c1920000-0000-4000-8000-000000000010',
  'Existing survey', 4, 'c1920000-0000-4000-8000-000000000001'
);

set local role service_role;
do $behavior$
declare
  v_student_owner constant uuid := 'c1920000-0000-4000-8000-000000000001';
  v_teacher_owner constant uuid := 'c1920000-0000-4000-8000-000000000002';
  v_outsider constant uuid := 'c1920000-0000-4000-8000-000000000003';
  v_result jsonb;
  v_assignment_id uuid;
begin
  v_result := public.create_assignment_for_owner_v1(
    v_student_owner,
    'c1920000-0000-4000-8000-000000000010',
    '  Student owner assignment  ',
    'Student owner description',
    'Student owner instructions',
    '{"type":"doc","content":[]}'::jsonb,
    clock_timestamp() + interval '7 days',
    '[{"type":"link","label":"  Evidence link  ","required":true,"position":0,"validation_policy_json":{}}]'::jsonb
  );
  v_assignment_id := (v_result->'assignment'->>'id')::uuid;
  if not (v_result->>'ok')::boolean
    or v_result->'assignment'->>'title' is distinct from 'Student owner assignment'
    or (v_result->'assignment'->>'created_by')::uuid is distinct from v_student_owner
    or (v_result->'assignment'->>'position')::integer <> 5
    or jsonb_array_length(v_result->'submission_requirements') <> 1
    or v_result->'submission_requirements'->0->>'assignment_id' is distinct from v_assignment_id::text
    or v_result->'submission_requirements'->0->>'label' is distinct from 'Evidence link'
  then
    raise exception 'Student-valued owner creation returned invalid evidence: %', v_result;
  end if;

  v_result := public.create_assignment_for_owner_v1(
    v_teacher_owner,
    'c1920000-0000-4000-8000-000000000011',
    'Teacher owner assignment', '', 'Instructions',
    '{"type":"doc","content":[]}'::jsonb,
    clock_timestamp() + interval '7 days', '[]'::jsonb
  );
  if not (v_result->>'ok')::boolean
    or (v_result->'assignment'->>'created_by')::uuid is distinct from v_teacher_owner
  then
    raise exception 'Teacher-valued owner creation returned invalid evidence: %', v_result;
  end if;

  begin
    perform public.create_assignment_for_owner_v1(
      v_outsider, 'c1920000-0000-4000-8000-000000000010',
      'Forbidden', '', 'Instructions', '{"type":"doc","content":[]}'::jsonb,
      clock_timestamp() + interval '7 days', '[]'::jsonb
    );
    raise exception 'Expected unrelated user creation denial';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.create_assignment_for_owner_v1(
      v_student_owner, 'c1920000-0000-4000-8000-000000000012',
      'Forbidden archive', '', 'Instructions', '{"type":"doc","content":[]}'::jsonb,
      clock_timestamp() + interval '7 days', '[]'::jsonb
    );
    raise exception 'Expected archived Classroom creation denial';
  exception when sqlstate '55000' then null;
  end;

  begin
    perform public.create_assignment_for_owner_v1(
      v_student_owner, 'c1920000-0000-4000-8000-000000000010',
      '', '', 'Instructions', '{"type":"doc","content":[]}'::jsonb,
      clock_timestamp() + interval '7 days', '[]'::jsonb
    );
    raise exception 'Expected empty-title creation denial';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.create_assignment_for_owner_v1(
      v_student_owner, 'c1920000-0000-4000-8000-000000000010',
      'Bad requirements', '', 'Instructions', '{"type":"doc","content":[]}'::jsonb,
      clock_timestamp() + interval '7 days', '{}'::jsonb
    );
    raise exception 'Expected malformed requirements creation denial';
  exception when invalid_parameter_value then null;
  end;
end;
$behavior$;
reset role;

rollback;
SQL

echo 'Contextual Assignment creation database checks passed.'
