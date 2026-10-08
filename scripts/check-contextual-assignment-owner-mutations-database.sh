#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after migration 191 is applied locally.
ASSIGNMENT_OWNER_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$ASSIGNMENT_OWNER_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$ASSIGNMENT_OWNER_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
declare
  v_signature text;
  v_security_definer boolean;
  v_config text[];
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '191'
  ) then
    raise exception 'Migration 191 is required; this harness never applies it';
  end if;

  foreach v_signature in array array[
    'public.update_assignment_for_owner_v1(uuid,uuid,jsonb,jsonb)',
    'public.release_assignment_for_owner_v1(uuid,uuid,timestamp with time zone,boolean)',
    'public.delete_assignment_for_owner_v1(uuid,uuid)',
    'public.discard_pristine_assignment_draft_for_owner_v1(uuid,uuid,timestamp with time zone)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Migration 191 function is missing: %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
    then
      raise exception 'Contextual Assignment owner privileges are incorrect: %', v_signature;
    end if;
    select procedure.prosecdef, procedure.proconfig
    into strict v_security_definer, v_config
    from pg_proc as procedure
    where procedure.oid = to_regprocedure(v_signature);
    if not v_security_definer or not (v_config @> array['search_path=""']::text[]) then
      raise exception 'Contextual Assignment owner security metadata is incorrect: %', v_signature;
    end if;
  end loop;

  if has_function_privilege(
    'service_role',
    'private.lock_assignment_owner_mutation_context_v1(uuid,uuid)',
    'execute'
  ) then
    raise exception 'Private contextual Assignment owner helper is directly executable';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1910000-0000-4000-8000-000000000001', 'assignment-owner-student@example.invalid', 'student'),
  ('c1910000-0000-4000-8000-000000000002', 'assignment-owner-teacher@example.invalid', 'teacher'),
  ('c1910000-0000-4000-8000-000000000003', 'assignment-owner-outsider@example.invalid', 'teacher');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), owner_id, 'classrooms.create', 'manual', true,
  clock_timestamp(), null, 10, 'test:migration-191', 'assignment_owner_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = owner_id and feature_key = 'classrooms.create'), 0)
)
from (values
  ('c1910000-0000-4000-8000-000000000001'::uuid),
  ('c1910000-0000-4000-8000-000000000002'::uuid)
) as owners(owner_id);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c1910000-0000-4000-8000-000000000010', 'c1910000-0000-4000-8000-000000000001', 'Student-valued owner', 'C191STUD', null),
  ('c1910000-0000-4000-8000-000000000011', 'c1910000-0000-4000-8000-000000000002', 'Teacher-valued owner', 'C191TEAC', null),
  ('c1910000-0000-4000-8000-000000000012', 'c1910000-0000-4000-8000-000000000001', 'Archived owner class', 'C191ARCH', clock_timestamp());

insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, is_draft, released_at
) values
  ('c1910000-0000-4000-8000-000000000020', 'c1910000-0000-4000-8000-000000000010', 'Update me', '', clock_timestamp() + interval '7 days', 'c1910000-0000-4000-8000-000000000001', true, null),
  ('c1910000-0000-4000-8000-000000000021', 'c1910000-0000-4000-8000-000000000011', 'Release me', '', clock_timestamp() + interval '7 days', 'c1910000-0000-4000-8000-000000000002', true, null),
  ('c1910000-0000-4000-8000-000000000022', 'c1910000-0000-4000-8000-000000000010', 'Delete me', '', clock_timestamp() + interval '7 days', 'c1910000-0000-4000-8000-000000000001', true, null),
  ('c1910000-0000-4000-8000-000000000023', 'c1910000-0000-4000-8000-000000000010', 'Untitled 2026-09-20', '', clock_timestamp() + interval '7 days', 'c1910000-0000-4000-8000-000000000001', true, null),
  ('c1910000-0000-4000-8000-000000000024', 'c1910000-0000-4000-8000-000000000010', 'Submitted requirements', '', clock_timestamp() + interval '7 days', 'c1910000-0000-4000-8000-000000000001', true, null),
  ('c1910000-0000-4000-8000-000000000025', 'c1910000-0000-4000-8000-000000000012', 'Archived mutation', '', clock_timestamp() + interval '7 days', 'c1910000-0000-4000-8000-000000000001', true, null),
  ('c1910000-0000-4000-8000-000000000026', 'c1910000-0000-4000-8000-000000000010', 'Invalid schedule', '', clock_timestamp() + interval '1 day', 'c1910000-0000-4000-8000-000000000001', true, null);

insert into public.assignment_submission_requirements (
  id, assignment_id, type, label, required, position
) values (
  'c1910000-0000-4000-8000-000000000030',
  'c1910000-0000-4000-8000-000000000024',
  'link', 'Required link', true, 0
);
insert into public.assignment_docs (
  id, assignment_id, student_id, content, is_submitted, submitted_at
) values (
  'c1910000-0000-4000-8000-000000000031',
  'c1910000-0000-4000-8000-000000000024',
  'c1910000-0000-4000-8000-000000000001',
  '{"type":"doc","content":[]}'::jsonb,
  true,
  clock_timestamp()
);

set local role service_role;
do $behavior$
declare
  v_student_owner constant uuid := 'c1910000-0000-4000-8000-000000000001';
  v_teacher_owner constant uuid := 'c1910000-0000-4000-8000-000000000002';
  v_outsider constant uuid := 'c1910000-0000-4000-8000-000000000003';
  v_result jsonb;
  v_expected_updated_at timestamptz;
begin
  v_result := public.update_assignment_for_owner_v1(
    v_student_owner, 'c1910000-0000-4000-8000-000000000020',
    '{"title":"Student-valued owner updated"}'::jsonb, null
  );
  if not (v_result->>'ok')::boolean
    or v_result->'assignment'->>'title' is distinct from 'Student-valued owner updated'
  then
    raise exception 'Student-valued owner update returned invalid evidence: %', v_result;
  end if;

  v_result := public.release_assignment_for_owner_v1(
    v_teacher_owner, 'c1910000-0000-4000-8000-000000000021',
    clock_timestamp(), false
  );
  if not (v_result->>'ok')::boolean or (v_result->'assignment'->>'is_draft')::boolean then
    raise exception 'Teacher-valued owner release returned invalid evidence: %', v_result;
  end if;

  begin
    perform public.update_assignment_for_owner_v1(
      v_outsider, 'c1910000-0000-4000-8000-000000000020',
      '{"title":"Forbidden"}'::jsonb, null
    );
    raise exception 'Expected unrelated user owner-mutation denial';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.update_assignment_for_owner_v1(
      v_student_owner, 'c1910000-0000-4000-8000-000000000025',
      '{"title":"Forbidden archived mutation"}'::jsonb, null
    );
    raise exception 'Expected archived Classroom owner-mutation denial';
  exception when sqlstate '55000' then null;
  end;

  begin
    perform public.update_assignment_for_owner_v1(
      v_student_owner, 'c1910000-0000-4000-8000-000000000020',
      '{"teacher_id":"Forbidden arbitrary key"}'::jsonb, null
    );
    raise exception 'Expected arbitrary Assignment update-key denial';
  exception when invalid_parameter_value then null;
  end;

  v_result := public.update_assignment_for_owner_v1(
    v_student_owner, 'c1910000-0000-4000-8000-000000000024', '{}'::jsonb, '[]'::jsonb
  );
  if (v_result->>'ok')::boolean
    or (v_result->>'status')::integer <> 409
    or v_result->>'error_code' is distinct from 'assignment_requirements_submitted'
  then
    raise exception 'Submitted requirement mutation did not fail closed: %', v_result;
  end if;

  v_result := public.release_assignment_for_owner_v1(
    v_student_owner, 'c1910000-0000-4000-8000-000000000026',
    clock_timestamp() + interval '2 days', true
  );
  if (v_result->>'ok')::boolean
    or (v_result->>'status')::integer <> 400
    or v_result->>'error_code' is distinct from 'assignment_release_after_due'
  then
    raise exception 'Invalid scheduled release did not fail closed: %', v_result;
  end if;

  v_result := public.delete_assignment_for_owner_v1(
    v_student_owner, 'c1910000-0000-4000-8000-000000000022'
  );
  if not (v_result->>'ok')::boolean
    or (v_result->>'deleted')::boolean is not true
    or exists (select 1 from public.assignments where id = 'c1910000-0000-4000-8000-000000000022')
  then
    raise exception 'Owner deletion returned invalid evidence: %', v_result;
  end if;

  select updated_at into strict v_expected_updated_at
  from public.assignments
  where id = 'c1910000-0000-4000-8000-000000000023';
  v_result := public.discard_pristine_assignment_draft_for_owner_v1(
    v_student_owner, 'c1910000-0000-4000-8000-000000000023', v_expected_updated_at
  );
  if not (v_result->>'discarded')::boolean
    or exists (select 1 from public.assignments where id = 'c1910000-0000-4000-8000-000000000023')
  then
    raise exception 'Owner pristine discard returned invalid evidence: %', v_result;
  end if;
end;
$behavior$;
reset role;

rollback;
SQL

echo 'Contextual Assignment owner mutation database checks passed.'
