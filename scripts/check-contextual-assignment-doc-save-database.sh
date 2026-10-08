#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after separately authorized migrations 184–185.
ASSIGNMENT_SAVE_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$ASSIGNMENT_SAVE_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$ASSIGNMENT_SAVE_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
declare
  v_signature text := 'public.save_assignment_doc_for_member_v1(uuid,uuid,jsonb,timestamp with time zone,text,integer,integer,jsonb,jsonb,integer,integer,uuid,bigint,uuid)';
  v_security_definer boolean;
  v_config text[];
  v_owner text;
begin
  if to_regprocedure(v_signature) is null then
    raise exception 'Migration 185 is required; this harness never applies it';
  end if;
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '185'
  ) then
    raise exception 'Migration 185 is required; this harness never applies it';
  end if;
  if has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute')
  then
    raise exception 'Contextual assignment-save privileges are incorrect';
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
    raise exception 'Contextual assignment-save security metadata is incorrect';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1840000-0000-4000-8000-000000000001', 'assignment-save-teacher-member@example.invalid', 'teacher'),
  ('c1840000-0000-4000-8000-000000000002', 'assignment-save-owner@example.invalid', 'student'),
  ('c1840000-0000-4000-8000-000000000003', 'assignment-save-outsider@example.invalid', 'student'),
  ('c1840000-0000-4000-8000-000000000004', 'assignment-save-student-member@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c1840000-0000-4000-8000-000000000002',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 10,
  'test:migration-184', 'assignment_save_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c1840000-0000-4000-8000-000000000002'
      and feature_key = 'classrooms.create'), 0)
);
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c1840000-0000-4000-8000-000000000001',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 1,
  'test:migration-184', 'assignment_save_owned_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c1840000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c1840000-0000-4000-8000-000000000010', 'c1840000-0000-4000-8000-000000000002', 'Assignment save active', 'C184LIVE', null),
  ('c1840000-0000-4000-8000-000000000011', 'c1840000-0000-4000-8000-000000000002', 'Assignment save archived', 'C184ARCH', clock_timestamp()),
  ('c1840000-0000-4000-8000-000000000012', 'c1840000-0000-4000-8000-000000000001', 'Assignment save owned', 'C184OWN', null);

insert into public.classroom_enrollments (classroom_id, student_id) values
  ('c1840000-0000-4000-8000-000000000010', 'c1840000-0000-4000-8000-000000000001'),
  ('c1840000-0000-4000-8000-000000000010', 'c1840000-0000-4000-8000-000000000004'),
  ('c1840000-0000-4000-8000-000000000011', 'c1840000-0000-4000-8000-000000000001');

insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, is_draft, released_at
) values
  ('c1840000-0000-4000-8000-000000000020', 'c1840000-0000-4000-8000-000000000010', 'Teacher member live', '', clock_timestamp() + interval '7 days', 'c1840000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour'),
  ('c1840000-0000-4000-8000-000000000021', 'c1840000-0000-4000-8000-000000000010', 'Student member live', '', clock_timestamp() + interval '7 days', 'c1840000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour'),
  ('c1840000-0000-4000-8000-000000000022', 'c1840000-0000-4000-8000-000000000010', 'Draft assignment', '', clock_timestamp() + interval '7 days', 'c1840000-0000-4000-8000-000000000002', true, null),
  ('c1840000-0000-4000-8000-000000000023', 'c1840000-0000-4000-8000-000000000010', 'Scheduled assignment', '', clock_timestamp() + interval '7 days', 'c1840000-0000-4000-8000-000000000002', false, clock_timestamp() + interval '1 hour'),
  ('c1840000-0000-4000-8000-000000000024', 'c1840000-0000-4000-8000-000000000011', 'Archived assignment', '', clock_timestamp() + interval '7 days', 'c1840000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour'),
  ('c1840000-0000-4000-8000-000000000025', 'c1840000-0000-4000-8000-000000000012', 'Owner-only assignment', '', clock_timestamp() + interval '7 days', 'c1840000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour');

set local role service_role;
do $behavior$
declare
  v_teacher constant uuid := 'c1840000-0000-4000-8000-000000000001';
  v_student constant uuid := 'c1840000-0000-4000-8000-000000000004';
  v_outsider constant uuid := 'c1840000-0000-4000-8000-000000000003';
  v_live constant uuid := 'c1840000-0000-4000-8000-000000000020';
  v_student_live constant uuid := 'c1840000-0000-4000-8000-000000000021';
  v_content jsonb := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Saved"}]}]}'::jsonb;
  v_result jsonb;
  v_doc_id uuid;
  v_updated_at timestamptz;
begin
  v_result := public.save_assignment_doc_for_member_v1(
    v_teacher, v_live, v_content, null, 'autosave', 0, 5,
    '[]'::jsonb, v_content, 1, 5,
    'c1840000-0000-4000-8000-000000000030', 1,
    'c1840000-0000-4000-8000-000000000031'
  );
  v_doc_id := (v_result->'doc'->>'id')::uuid;
  v_updated_at := (v_result->'doc'->>'updated_at')::timestamptz;
  if not (v_result->>'ok')::boolean
    or not (v_result->>'created')::boolean
    or v_result->'doc'->>'assignment_id' is distinct from v_live::text
    or v_result->'doc'->>'student_id' is distinct from v_teacher::text
    or v_result->'history_entry'->>'assignment_doc_id' is distinct from v_doc_id::text
  then
    raise exception 'Teacher-valued exact member save returned invalid evidence: %', v_result;
  end if;

  v_result := public.save_assignment_doc_for_member_v1(
    v_teacher, v_live, v_content, v_updated_at, 'autosave', 0, 5,
    '[]'::jsonb, null, 1, 5,
    'c1840000-0000-4000-8000-000000000030', 1,
    'c1840000-0000-4000-8000-000000000031'
  );
  if not (v_result->>'ok')::boolean
    or (v_result->>'created')::boolean
    or v_result->'history_entry' is distinct from 'null'::jsonb
  then
    raise exception 'Idempotent save changed established semantics: %', v_result;
  end if;
  if (select count(*) from public.assignment_doc_save_operations
      where assignment_doc_id = v_doc_id) <> 1 then
    raise exception 'Idempotent save duplicated its operation ledger';
  end if;

  v_result := public.save_assignment_doc_for_member_v1(
    v_student, v_student_live, v_content, null, 'blur', 1, 7,
    '[]'::jsonb, v_content, 1, 5,
    'c1840000-0000-4000-8000-000000000032', 1,
    'c1840000-0000-4000-8000-000000000033'
  );
  if not (v_result->>'ok')::boolean
    or v_result->'doc'->>'student_id' is distinct from v_student::text
  then
    raise exception 'Student-valued exact member save returned invalid evidence: %', v_result;
  end if;

  v_result := public.save_assignment_doc_for_member_v1(
    v_teacher, v_live, v_content, null, 'autosave', 0, 0,
    '[]'::jsonb, null, 1, 5,
    'c1840000-0000-4000-8000-000000000034', 1,
    'c1840000-0000-4000-8000-000000000035'
  );
  if (v_result->>'ok')::boolean
    or v_result->>'error_code' is distinct from 'assignment_doc_revision_required'
  then
    raise exception 'Structured revision conflict was not preserved: %', v_result;
  end if;

  begin
    perform public.save_assignment_doc_for_member_v1(v_outsider, v_live, v_content, null, 'autosave', 0, 0, '[]'::jsonb, null, 1, 5, gen_random_uuid(), 1, gen_random_uuid());
    raise exception 'Expected nonmember denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_assignment_doc_for_member_v1(v_teacher, 'c1840000-0000-4000-8000-000000000022', v_content, null, 'autosave', 0, 0, '[]'::jsonb, null, 1, 5, gen_random_uuid(), 1, gen_random_uuid());
    raise exception 'Expected draft concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.save_assignment_doc_for_member_v1(v_teacher, 'c1840000-0000-4000-8000-000000000023', v_content, null, 'autosave', 0, 0, '[]'::jsonb, null, 1, 5, gen_random_uuid(), 1, gen_random_uuid());
    raise exception 'Expected scheduled concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.save_assignment_doc_for_member_v1(v_teacher, 'c1840000-0000-4000-8000-000000000024', v_content, null, 'autosave', 0, 0, '[]'::jsonb, null, 1, 5, gen_random_uuid(), 1, gen_random_uuid());
    raise exception 'Expected archived concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.save_assignment_doc_for_member_v1(v_teacher, 'c1840000-0000-4000-8000-000000000025', v_content, null, 'autosave', 0, 0, '[]'::jsonb, null, 1, 5, gen_random_uuid(), 1, gen_random_uuid());
    raise exception 'Expected owner-without-enrollment denial';
  exception when insufficient_privilege then null;
  end;

  if exists (
    select 1 from public.assignment_docs
    where assignment_id in (
      'c1840000-0000-4000-8000-000000000022',
      'c1840000-0000-4000-8000-000000000023',
      'c1840000-0000-4000-8000-000000000024',
      'c1840000-0000-4000-8000-000000000025'
    )
  ) then
    raise exception 'Denied assignment save wrote a document';
  end if;
end;
$behavior$;
reset role;

rollback;
SQL

echo 'Contextual assignment-save database checks passed.'
