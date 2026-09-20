#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after migration 190 is applied locally.
ASSIGNMENT_ARTIFACT_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$ASSIGNMENT_ARTIFACT_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$ASSIGNMENT_ARTIFACT_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
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
    select 1 from supabase_migrations.schema_migrations where version = '190'
  ) then
    raise exception 'Migration 190 is required; this harness never applies it';
  end if;

  foreach v_signature in array array[
    'public.prepare_assignment_artifact_for_member_v1(uuid,uuid,uuid)',
    'public.upsert_assignment_artifact_for_member_v1(uuid,uuid,uuid,text,text,text,jsonb,text,text,timestamp with time zone,uuid,boolean,text,text,text)',
    'public.delete_assignment_artifact_for_member_v1(uuid,uuid,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Migration 190 function is missing: %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
    then
      raise exception 'Contextual assignment-artifact privileges are incorrect: %', v_signature;
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
      raise exception 'Contextual assignment-artifact security metadata is incorrect: %', v_signature;
    end if;
  end loop;

  if has_function_privilege(
    'service_role',
    'private.lock_assignment_artifact_member_context_v1(uuid,uuid,uuid)',
    'execute'
  ) then
    raise exception 'Private contextual assignment-artifact helper is directly executable';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1900000-0000-4000-8000-000000000001', 'assignment-artifact-owner@example.invalid', 'student'),
  ('c1900000-0000-4000-8000-000000000002', 'assignment-artifact-teacher-member@example.invalid', 'teacher'),
  ('c1900000-0000-4000-8000-000000000003', 'assignment-artifact-student-member@example.invalid', 'student'),
  ('c1900000-0000-4000-8000-000000000004', 'assignment-artifact-outsider@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c1900000-0000-4000-8000-000000000001',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 2,
  'test:migration-190', 'assignment_artifact_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c1900000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c1900000-0000-4000-8000-000000000010', 'c1900000-0000-4000-8000-000000000001', 'Assignment artifacts active', 'C190LIVE', null),
  ('c1900000-0000-4000-8000-000000000011', 'c1900000-0000-4000-8000-000000000001', 'Assignment artifacts archived', 'C190ARCH', clock_timestamp());

insert into public.classroom_enrollments (classroom_id, student_id) values
  ('c1900000-0000-4000-8000-000000000010', 'c1900000-0000-4000-8000-000000000002'),
  ('c1900000-0000-4000-8000-000000000010', 'c1900000-0000-4000-8000-000000000003'),
  ('c1900000-0000-4000-8000-000000000011', 'c1900000-0000-4000-8000-000000000002');

insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, is_draft, released_at
) values
  ('c1900000-0000-4000-8000-000000000020', 'c1900000-0000-4000-8000-000000000010', 'Teacher member live', '', clock_timestamp() + interval '7 days', 'c1900000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c1900000-0000-4000-8000-000000000021', 'c1900000-0000-4000-8000-000000000010', 'Student member live', '', clock_timestamp() + interval '7 days', 'c1900000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c1900000-0000-4000-8000-000000000022', 'c1900000-0000-4000-8000-000000000010', 'Draft assignment', '', clock_timestamp() + interval '7 days', 'c1900000-0000-4000-8000-000000000001', true, null),
  ('c1900000-0000-4000-8000-000000000023', 'c1900000-0000-4000-8000-000000000010', 'Scheduled assignment', '', clock_timestamp() + interval '7 days', 'c1900000-0000-4000-8000-000000000001', false, clock_timestamp() + interval '1 hour'),
  ('c1900000-0000-4000-8000-000000000024', 'c1900000-0000-4000-8000-000000000011', 'Archived assignment', '', clock_timestamp() + interval '7 days', 'c1900000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour');

insert into public.assignment_submission_requirements (
  id, assignment_id, type, label, required, position
) values
  ('c1900000-0000-4000-8000-000000000030', 'c1900000-0000-4000-8000-000000000020', 'repo_link', 'Repository', false, 0),
  ('c1900000-0000-4000-8000-000000000031', 'c1900000-0000-4000-8000-000000000020', 'image', 'Screenshot', false, 1),
  ('c1900000-0000-4000-8000-000000000032', 'c1900000-0000-4000-8000-000000000021', 'link', 'Student link', false, 0),
  ('c1900000-0000-4000-8000-000000000033', 'c1900000-0000-4000-8000-000000000022', 'link', 'Draft link', false, 0),
  ('c1900000-0000-4000-8000-000000000034', 'c1900000-0000-4000-8000-000000000023', 'link', 'Scheduled link', false, 0),
  ('c1900000-0000-4000-8000-000000000035', 'c1900000-0000-4000-8000-000000000024', 'link', 'Archived link', false, 0);

set local role service_role;
do $behavior$
declare
  v_teacher constant uuid := 'c1900000-0000-4000-8000-000000000002';
  v_student constant uuid := 'c1900000-0000-4000-8000-000000000003';
  v_owner constant uuid := 'c1900000-0000-4000-8000-000000000001';
  v_outsider constant uuid := 'c1900000-0000-4000-8000-000000000004';
  v_teacher_assignment constant uuid := 'c1900000-0000-4000-8000-000000000020';
  v_student_assignment constant uuid := 'c1900000-0000-4000-8000-000000000021';
  v_repo_requirement constant uuid := 'c1900000-0000-4000-8000-000000000030';
  v_image_requirement constant uuid := 'c1900000-0000-4000-8000-000000000031';
  v_student_requirement constant uuid := 'c1900000-0000-4000-8000-000000000032';
  v_result jsonb;
  v_teacher_doc uuid;
  v_rejected boolean;
begin
  v_result := public.prepare_assignment_artifact_for_member_v1(
    v_teacher, v_teacher_assignment, v_repo_requirement
  );
  if not (v_result->>'ok')::boolean
    or v_result->>'classroom_id' is distinct from 'c1900000-0000-4000-8000-000000000010'
    or v_result->'requirement'->>'assignment_id' is distinct from v_teacher_assignment::text
    or v_result->'requirement'->>'id' is distinct from v_repo_requirement::text
    or v_result->'artifact' is distinct from 'null'::jsonb
  then
    raise exception 'Teacher-valued member artifact preflight returned invalid evidence: %', v_result;
  end if;
  v_teacher_doc := (v_result->>'assignment_doc_id')::uuid;

  v_result := public.upsert_assignment_artifact_for_member_v1(
    v_teacher, v_teacher_assignment, v_repo_requirement,
    'repo_link', 'https://github.com/codepetca/pika', null,
    '{"github_login":"codepetca"}'::jsonb, 'valid', null,
    clock_timestamp(), null, true, 'codepetca', 'valid', null
  );
  if not (v_result->>'ok')::boolean
    or v_result->'artifact'->>'assignment_doc_id' is distinct from v_teacher_doc::text
    or v_result->'artifact'->>'student_id' is distinct from v_teacher::text
    or v_result->'artifact'->>'requirement_id' is distinct from v_repo_requirement::text
    or v_result->'artifact'->>'type' is distinct from 'repo_link'
    or (select github_login from public.user_github_identities where user_id = v_teacher)
      is distinct from 'codepetca'
  then
    raise exception 'Teacher-valued member artifact upsert returned invalid evidence: %', v_result;
  end if;

  v_result := public.upsert_assignment_artifact_for_member_v1(
    v_student, v_student_assignment, v_student_requirement,
    'link', 'https://example.com/student-work', null,
    '{}'::jsonb, 'valid', null, clock_timestamp(), null
  );
  if not (v_result->>'ok')::boolean
    or v_result->'artifact'->>'student_id' is distinct from v_student::text
  then
    raise exception 'Student-valued member artifact upsert returned invalid evidence: %', v_result;
  end if;

  begin
    perform public.prepare_assignment_artifact_for_member_v1(
      v_outsider, v_teacher_assignment, v_repo_requirement
    );
    raise exception 'Expected outsider artifact denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.prepare_assignment_artifact_for_member_v1(
      v_owner, v_teacher_assignment, v_repo_requirement
    );
    raise exception 'Expected non-enrolled owner artifact denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.prepare_assignment_artifact_for_member_v1(
      v_teacher, 'c1900000-0000-4000-8000-000000000022',
      'c1900000-0000-4000-8000-000000000033'
    );
    raise exception 'Expected draft artifact concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.prepare_assignment_artifact_for_member_v1(
      v_teacher, 'c1900000-0000-4000-8000-000000000023',
      'c1900000-0000-4000-8000-000000000034'
    );
    raise exception 'Expected scheduled artifact concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.prepare_assignment_artifact_for_member_v1(
      v_teacher, 'c1900000-0000-4000-8000-000000000024',
      'c1900000-0000-4000-8000-000000000035'
    );
    raise exception 'Expected archived artifact concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.prepare_assignment_artifact_for_member_v1(
      v_teacher, v_teacher_assignment, v_student_requirement
    );
    raise exception 'Expected foreign requirement denial';
  exception when no_data_found then null;
  end;

  v_rejected := false;
  begin
    perform public.upsert_assignment_artifact_for_member_v1(
      v_teacher, v_teacher_assignment, v_repo_requirement,
      'image', null, 'wrong/type.png', '{}'::jsonb, 'valid', null,
      clock_timestamp(), gen_random_uuid()
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Mismatched artifact type was not rejected';
  end if;

  update public.assignment_docs
  set is_submitted = true, submitted_at = clock_timestamp()
  where id = v_teacher_doc;
  v_result := public.prepare_assignment_artifact_for_member_v1(
    v_teacher, v_teacher_assignment, v_repo_requirement
  );
  if (v_result->>'ok')::boolean
    or (v_result->>'status')::integer <> 403
  then
    raise exception 'Submitted artifact preflight did not fail closed: %', v_result;
  end if;
  v_result := public.delete_assignment_artifact_for_member_v1(
    v_teacher, v_teacher_assignment, v_repo_requirement
  );
  if (v_result->>'ok')::boolean
    or (v_result->>'status')::integer <> 409
  then
    raise exception 'Submitted artifact delete did not fail closed: %', v_result;
  end if;
  update public.assignment_docs
  set is_submitted = false, submitted_at = null
  where id = v_teacher_doc;

  delete from public.classroom_enrollments
  where classroom_id = 'c1900000-0000-4000-8000-000000000010'
    and student_id = v_student;
  begin
    perform public.delete_assignment_artifact_for_member_v1(
      v_student, v_student_assignment, v_student_requirement
    );
    raise exception 'Removed member deleted assignment artifact';
  exception when insufficient_privilege then null;
  end;
end;
$behavior$;

-- Exercise managed image ownership with the document identity returned by the
-- same contextual preflight boundary.
select public.begin_managed_storage_upload(
  'c1900000-0000-4000-8000-000000000040',
  'assignment-artifacts',
  'classrooms/c1900000-0000-4000-8000-000000000010/students/c1900000-0000-4000-8000-000000000002/contextual.png',
  'c1900000-0000-4000-8000-000000000010', null, null,
  'student_assignment_artifact',
  'c1900000-0000-4000-8000-000000000002',
  'c1900000-0000-4000-8000-000000000002',
  'assignment_doc',
  (select id from public.assignment_docs
    where assignment_id = 'c1900000-0000-4000-8000-000000000020'
      and student_id = 'c1900000-0000-4000-8000-000000000002'),
  'image/png', 4
);
insert into storage.objects (bucket_id, name) values (
  'assignment-artifacts',
  'classrooms/c1900000-0000-4000-8000-000000000010/students/c1900000-0000-4000-8000-000000000002/contextual.png'
);
select public.verify_managed_storage_upload(
  'c1900000-0000-4000-8000-000000000040', null
);

do $image$
declare
  v_result jsonb;
begin
  v_result := public.upsert_assignment_artifact_for_member_v1(
    'c1900000-0000-4000-8000-000000000002',
    'c1900000-0000-4000-8000-000000000020',
    'c1900000-0000-4000-8000-000000000031',
    'image', null,
    'classrooms/c1900000-0000-4000-8000-000000000010/students/c1900000-0000-4000-8000-000000000002/contextual.png',
    '{"file_name":"contextual.png","file_size":4,"content_type":"image/png"}'::jsonb,
    'valid', null, clock_timestamp(),
    'c1900000-0000-4000-8000-000000000040'
  );
  if not (v_result->>'ok')::boolean
    or v_result->'artifact'->>'managed_object_id'
      is distinct from 'c1900000-0000-4000-8000-000000000040'
  then
    raise exception 'Managed image artifact returned invalid evidence: %', v_result;
  end if;

  v_result := public.delete_assignment_artifact_for_member_v1(
    'c1900000-0000-4000-8000-000000000002',
    'c1900000-0000-4000-8000-000000000020',
    'c1900000-0000-4000-8000-000000000031'
  );
  if not (v_result->>'ok')::boolean
    or not (v_result->>'deleted')::boolean
    or v_result->>'storage_path' is distinct from
      'classrooms/c1900000-0000-4000-8000-000000000010/students/c1900000-0000-4000-8000-000000000002/contextual.png'
    or not exists (
      select 1 from public.assignment_artifact_storage_cleanup
      where storage_path = v_result->>'storage_path'
    )
  then
    raise exception 'Managed image artifact deletion returned invalid evidence: %', v_result;
  end if;
end;
$image$;

reset role;
rollback;
SQL

echo 'Contextual assignment artifact database checks passed.'
