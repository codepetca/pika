#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after separately authorized migrations 186-187.
ASSIGNMENT_SUBMISSION_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$ASSIGNMENT_SUBMISSION_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$ASSIGNMENT_SUBMISSION_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
declare
  v_signature text;
  v_security_definer boolean;
  v_config text[];
  v_owner text;
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '186'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations where version = '187'
  ) then
    raise exception 'Migrations 186-187 are required; this harness never applies them';
  end if;

  foreach v_signature in array array[
    'public.prepare_assignment_doc_submission_for_member_v1(uuid,uuid)',
    'public.submit_assignment_doc_for_member_v1(uuid,uuid,jsonb,timestamp with time zone,integer,integer,uuid[],boolean,jsonb)',
    'public.unsubmit_assignment_doc_for_member_v1(uuid,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Migration 186 function is missing: %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
    then
      raise exception 'Contextual assignment-submission privileges are incorrect: %', v_signature;
    end if;
    select procedure.prosecdef, procedure.proconfig, owner.rolname
    into strict v_security_definer, v_config, v_owner
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'public'
      and procedure.oid = to_regprocedure(v_signature);
    if not v_security_definer
      or not (v_config @> array['search_path=""']::text[])
      or v_owner <> 'postgres'
    then
      raise exception 'Contextual assignment-submission security metadata is incorrect: %', v_signature;
    end if;
  end loop;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1860000-0000-4000-8000-000000000001', 'assignment-submit-teacher-member@example.invalid', 'teacher'),
  ('c1860000-0000-4000-8000-000000000002', 'assignment-submit-owner@example.invalid', 'student'),
  ('c1860000-0000-4000-8000-000000000003', 'assignment-submit-outsider@example.invalid', 'student'),
  ('c1860000-0000-4000-8000-000000000004', 'assignment-submit-student-member@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c1860000-0000-4000-8000-000000000002',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 10,
  'test:migration-186', 'assignment_submission_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c1860000-0000-4000-8000-000000000002'
      and feature_key = 'classrooms.create'), 0)
);
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c1860000-0000-4000-8000-000000000001',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 1,
  'test:migration-186', 'assignment_submission_owned_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c1860000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c1860000-0000-4000-8000-000000000010', 'c1860000-0000-4000-8000-000000000002', 'Assignment submission active', 'C186LIVE', null),
  ('c1860000-0000-4000-8000-000000000011', 'c1860000-0000-4000-8000-000000000002', 'Assignment submission archived', 'C186ARCH', clock_timestamp()),
  ('c1860000-0000-4000-8000-000000000012', 'c1860000-0000-4000-8000-000000000001', 'Assignment submission owned', 'C186OWN', null);

insert into public.classroom_enrollments (classroom_id, student_id) values
  ('c1860000-0000-4000-8000-000000000010', 'c1860000-0000-4000-8000-000000000001'),
  ('c1860000-0000-4000-8000-000000000010', 'c1860000-0000-4000-8000-000000000004'),
  ('c1860000-0000-4000-8000-000000000011', 'c1860000-0000-4000-8000-000000000001');

insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, is_draft, released_at
) values
  ('c1860000-0000-4000-8000-000000000020', 'c1860000-0000-4000-8000-000000000010', 'Teacher member live', '', clock_timestamp() + interval '7 days', 'c1860000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour'),
  ('c1860000-0000-4000-8000-000000000021', 'c1860000-0000-4000-8000-000000000010', 'Student member live', '', clock_timestamp() + interval '7 days', 'c1860000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour'),
  ('c1860000-0000-4000-8000-000000000022', 'c1860000-0000-4000-8000-000000000010', 'Draft assignment', '', clock_timestamp() + interval '7 days', 'c1860000-0000-4000-8000-000000000002', true, null),
  ('c1860000-0000-4000-8000-000000000023', 'c1860000-0000-4000-8000-000000000010', 'Scheduled assignment', '', clock_timestamp() + interval '7 days', 'c1860000-0000-4000-8000-000000000002', false, clock_timestamp() + interval '1 hour'),
  ('c1860000-0000-4000-8000-000000000024', 'c1860000-0000-4000-8000-000000000011', 'Archived assignment', '', clock_timestamp() + interval '7 days', 'c1860000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour'),
  ('c1860000-0000-4000-8000-000000000025', 'c1860000-0000-4000-8000-000000000012', 'Owner-only assignment', '', clock_timestamp() + interval '7 days', 'c1860000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour');

insert into public.assignment_docs (
  id, assignment_id, student_id, content, viewed_at
) values
  ('c1860000-0000-4000-8000-000000000030', 'c1860000-0000-4000-8000-000000000020', 'c1860000-0000-4000-8000-000000000001', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Teacher work"}]}]}'::jsonb, clock_timestamp()),
  ('c1860000-0000-4000-8000-000000000031', 'c1860000-0000-4000-8000-000000000021', 'c1860000-0000-4000-8000-000000000004', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Student work"}]}]}'::jsonb, clock_timestamp());

set local role service_role;
do $behavior$
declare
  v_teacher constant uuid := 'c1860000-0000-4000-8000-000000000001';
  v_student constant uuid := 'c1860000-0000-4000-8000-000000000004';
  v_outsider constant uuid := 'c1860000-0000-4000-8000-000000000003';
  v_live constant uuid := 'c1860000-0000-4000-8000-000000000020';
  v_student_live constant uuid := 'c1860000-0000-4000-8000-000000000021';
  v_content jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Teacher work"}]}]}'::jsonb;
  v_student_content jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Student work"}]}]}'::jsonb;
  v_result jsonb;
  v_revision timestamptz;
begin
  v_result := public.prepare_assignment_doc_submission_for_member_v1(v_teacher, v_live);
  if v_result->'assignment'->>'id' is distinct from v_live::text
    or v_result->'assignment'->>'classroom_id' is distinct from 'c1860000-0000-4000-8000-000000000010'
    or v_result->'doc'->>'assignment_id' is distinct from v_live::text
    or v_result->'doc'->>'student_id' is distinct from v_teacher::text
    or jsonb_typeof(v_result->'submission_requirements') is distinct from 'array'
    or jsonb_typeof(v_result->'submission_artifacts') is distinct from 'array'
  then
    raise exception 'Teacher-valued exact member preflight returned invalid evidence: %', v_result;
  end if;

  select updated_at into v_revision from public.assignment_docs
  where assignment_id = v_live and student_id = v_teacher;
  v_result := public.submit_assignment_doc_for_member_v1(
    v_teacher, v_live, v_content, v_revision, 2, 12, '{}'::uuid[], false, null
  );
  if not (v_result->>'ok')::boolean
    or (v_result->>'idempotent')::boolean
    or v_result->>'classroom_id' is distinct from 'c1860000-0000-4000-8000-000000000010'
    or v_result->'doc'->>'assignment_id' is distinct from v_live::text
    or v_result->'doc'->>'student_id' is distinct from v_teacher::text
    or v_result->'history_entry'->>'assignment_doc_id' is distinct from v_result->'doc'->>'id'
  then
    raise exception 'Teacher-valued exact member submit returned invalid evidence: %', v_result;
  end if;

  v_result := public.unsubmit_assignment_doc_for_member_v1(v_teacher, v_live);
  if not (v_result->>'ok')::boolean
    or coalesce((v_result->'doc'->>'is_submitted')::boolean, true)
    or v_result->>'classroom_id' is distinct from 'c1860000-0000-4000-8000-000000000010'
  then
    raise exception 'Teacher-valued exact member unsubmit returned invalid evidence: %', v_result;
  end if;

  select updated_at into v_revision from public.assignment_docs
  where assignment_id = v_student_live and student_id = v_student;
  v_result := public.submit_assignment_doc_for_member_v1(
    v_student, v_student_live, v_student_content, v_revision, 2, 12,
    '{}'::uuid[], false, null
  );
  if not (v_result->>'ok')::boolean
    or v_result->'doc'->>'student_id' is distinct from v_student::text
  then
    raise exception 'Student-valued exact member submit returned invalid evidence: %', v_result;
  end if;
  v_result := public.unsubmit_assignment_doc_for_member_v1(v_student, v_student_live);
  if not (v_result->>'ok')::boolean then
    raise exception 'Student-valued exact member unsubmit failed: %', v_result;
  end if;

  begin
    perform public.prepare_assignment_doc_submission_for_member_v1(v_outsider, v_live);
    raise exception 'Expected nonmember preflight denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_assignment_doc_for_member_v1(
      v_teacher, v_live, v_content,
      (select updated_at from public.assignment_docs where assignment_id = v_live and student_id = v_teacher),
      2, 12, '{}'::uuid[], true,
      '{"schema_version":1,"idempotency_key":"bad","learner_id":"bad","event_type":"learning_item.completed","occurred_at":"2026-09-20T12:00:00.000Z","metadata":{}}'::jsonb
    );
    raise exception 'Expected malformed Pal completion denial';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform public.submit_assignment_doc_for_member_v1(
      v_outsider, v_live, v_content, clock_timestamp(), 2, 12, '{}'::uuid[], false, null
    );
    raise exception 'Expected nonmember denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.unsubmit_assignment_doc_for_member_v1(v_outsider, v_live);
    raise exception 'Expected nonmember unsubmit denial';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.submit_assignment_doc_for_member_v1(v_teacher, 'c1860000-0000-4000-8000-000000000022', v_content, clock_timestamp(), 2, 12, '{}'::uuid[], false, null);
    raise exception 'Expected draft concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_assignment_doc_for_member_v1(v_teacher, 'c1860000-0000-4000-8000-000000000023', v_content, clock_timestamp(), 2, 12, '{}'::uuid[], false, null);
    raise exception 'Expected scheduled concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_assignment_doc_for_member_v1(v_teacher, 'c1860000-0000-4000-8000-000000000024', v_content, clock_timestamp(), 2, 12, '{}'::uuid[], false, null);
    raise exception 'Expected archived concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.submit_assignment_doc_for_member_v1(v_teacher, 'c1860000-0000-4000-8000-000000000025', v_content, clock_timestamp(), 2, 12, '{}'::uuid[], false, null);
    raise exception 'Expected owner-without-enrollment denial';
  exception when insufficient_privilege then null;
  end;

  delete from public.classroom_enrollments
  where classroom_id = 'c1860000-0000-4000-8000-000000000010'
    and student_id = v_teacher;
  begin
    perform public.prepare_assignment_doc_submission_for_member_v1(v_teacher, v_live);
    raise exception 'Removed member preflight disclosed assignment state';
  exception when insufficient_privilege then null;
  end;

  if exists (
    select 1 from public.assignment_docs
    where assignment_id in (
      'c1860000-0000-4000-8000-000000000022',
      'c1860000-0000-4000-8000-000000000023',
      'c1860000-0000-4000-8000-000000000024',
      'c1860000-0000-4000-8000-000000000025'
    )
  ) then
    raise exception 'Denied assignment submission wrote a document';
  end if;
end;
$behavior$;
reset role;

rollback;
SQL

echo 'Contextual assignment-submission database checks passed.'
