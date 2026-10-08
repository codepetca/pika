#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after migrations 188-189 are applied locally.
ASSIGNMENT_HISTORY_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$ASSIGNMENT_HISTORY_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$ASSIGNMENT_HISTORY_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
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
    select 1 from supabase_migrations.schema_migrations where version = '189'
  ) then
    raise exception 'Migration 189 is required; this harness never applies it';
  end if;

  foreach v_signature in array array[
    'public.get_assignment_doc_history_for_actor_v1(uuid,uuid,uuid,boolean)',
    'public.restore_assignment_doc_for_member_v1(uuid,uuid,uuid,jsonb,timestamp with time zone,jsonb,jsonb,integer,integer,uuid,bigint,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Migration 188 function is missing: %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
    then
      raise exception 'Contextual assignment-history privileges are incorrect: %', v_signature;
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
      raise exception 'Contextual assignment-history security metadata is incorrect: %', v_signature;
    end if;
  end loop;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1880000-0000-4000-8000-000000000001', 'assignment-history-teacher-member@example.invalid', 'teacher'),
  ('c1880000-0000-4000-8000-000000000002', 'assignment-history-student-owner@example.invalid', 'student'),
  ('c1880000-0000-4000-8000-000000000003', 'assignment-history-outsider@example.invalid', 'student'),
  ('c1880000-0000-4000-8000-000000000004', 'assignment-history-student-member@example.invalid', 'student'),
  ('c1880000-0000-4000-8000-000000000005', 'assignment-history-owner-target@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c1880000-0000-4000-8000-000000000002',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 2,
  'test:migration-188', 'assignment_history_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c1880000-0000-4000-8000-000000000002'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c1880000-0000-4000-8000-000000000010', 'c1880000-0000-4000-8000-000000000002', 'Assignment history active', 'C188LIVE', null),
  ('c1880000-0000-4000-8000-000000000011', 'c1880000-0000-4000-8000-000000000002', 'Assignment history archived', 'C188ARCH', clock_timestamp());

insert into public.classroom_enrollments (classroom_id, student_id) values
  ('c1880000-0000-4000-8000-000000000010', 'c1880000-0000-4000-8000-000000000001'),
  ('c1880000-0000-4000-8000-000000000010', 'c1880000-0000-4000-8000-000000000004'),
  ('c1880000-0000-4000-8000-000000000010', 'c1880000-0000-4000-8000-000000000005'),
  ('c1880000-0000-4000-8000-000000000011', 'c1880000-0000-4000-8000-000000000001'),
  ('c1880000-0000-4000-8000-000000000011', 'c1880000-0000-4000-8000-000000000005');

insert into public.assignments (
  id, classroom_id, title, description, due_at, created_by, is_draft, released_at
) values
  ('c1880000-0000-4000-8000-000000000020', 'c1880000-0000-4000-8000-000000000010', 'Teacher member live', '', clock_timestamp() + interval '7 days', 'c1880000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour'),
  ('c1880000-0000-4000-8000-000000000021', 'c1880000-0000-4000-8000-000000000010', 'Student member live', '', clock_timestamp() + interval '7 days', 'c1880000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour'),
  ('c1880000-0000-4000-8000-000000000022', 'c1880000-0000-4000-8000-000000000010', 'Owner draft target', '', clock_timestamp() + interval '7 days', 'c1880000-0000-4000-8000-000000000002', true, null),
  ('c1880000-0000-4000-8000-000000000023', 'c1880000-0000-4000-8000-000000000010', 'Scheduled target', '', clock_timestamp() + interval '7 days', 'c1880000-0000-4000-8000-000000000002', false, clock_timestamp() + interval '1 hour'),
  ('c1880000-0000-4000-8000-000000000024', 'c1880000-0000-4000-8000-000000000011', 'Archived target', '', clock_timestamp() + interval '7 days', 'c1880000-0000-4000-8000-000000000002', false, clock_timestamp() - interval '1 hour');

insert into public.assignment_docs (
  id, assignment_id, student_id, content, viewed_at
) values
  ('c1880000-0000-4000-8000-000000000030', 'c1880000-0000-4000-8000-000000000020', 'c1880000-0000-4000-8000-000000000001', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Current teacher work"}]}]}'::jsonb, clock_timestamp()),
  ('c1880000-0000-4000-8000-000000000031', 'c1880000-0000-4000-8000-000000000021', 'c1880000-0000-4000-8000-000000000004', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Current student work"}]}]}'::jsonb, clock_timestamp()),
  ('c1880000-0000-4000-8000-000000000032', 'c1880000-0000-4000-8000-000000000022', 'c1880000-0000-4000-8000-000000000005', '{"type":"doc","content":[]}'::jsonb, clock_timestamp()),
  ('c1880000-0000-4000-8000-000000000033', 'c1880000-0000-4000-8000-000000000024', 'c1880000-0000-4000-8000-000000000005', '{"type":"doc","content":[]}'::jsonb, clock_timestamp());

insert into public.assignment_doc_history (
  id, assignment_doc_id, patch, snapshot, word_count, char_count,
  paste_word_count, keystroke_count, trigger, created_at
) values
  ('c1880000-0000-4000-8000-000000000040', 'c1880000-0000-4000-8000-000000000030', null, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Restored teacher work"}]}]}'::jsonb, 3, 21, 0, 0, 'baseline', clock_timestamp() - interval '2 hours'),
  ('c1880000-0000-4000-8000-000000000044', 'c1880000-0000-4000-8000-000000000030', '[{"op":"replace","path":"/content/0/content/0/text","value":"Patch target work"}]'::jsonb, null, 3, 17, 0, 0, 'restore', clock_timestamp() - interval '1 hour'),
  ('c1880000-0000-4000-8000-000000000041', 'c1880000-0000-4000-8000-000000000031', null, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Restored student work"}]}]}'::jsonb, 3, 21, 0, 0, 'baseline', clock_timestamp() - interval '1 hour'),
  ('c1880000-0000-4000-8000-000000000042', 'c1880000-0000-4000-8000-000000000032', null, '{"type":"doc","content":[]}'::jsonb, 0, 0, 0, 0, 'baseline', clock_timestamp() - interval '1 hour'),
  ('c1880000-0000-4000-8000-000000000043', 'c1880000-0000-4000-8000-000000000033', null, '{"type":"doc","content":[]}'::jsonb, 0, 0, 0, 0, 'baseline', clock_timestamp() - interval '1 hour');

set local role service_role;
do $behavior$
declare
  v_teacher constant uuid := 'c1880000-0000-4000-8000-000000000001';
  v_owner constant uuid := 'c1880000-0000-4000-8000-000000000002';
  v_outsider constant uuid := 'c1880000-0000-4000-8000-000000000003';
  v_student constant uuid := 'c1880000-0000-4000-8000-000000000004';
  v_target constant uuid := 'c1880000-0000-4000-8000-000000000005';
  v_live constant uuid := 'c1880000-0000-4000-8000-000000000020';
  v_student_live constant uuid := 'c1880000-0000-4000-8000-000000000021';
  v_result jsonb;
  v_revision timestamptz;
  v_before_content jsonb;
  v_before_updated_at timestamptz;
  v_before_history_count bigint;
  v_rejected boolean := false;
begin
  v_result := public.get_assignment_doc_history_for_actor_v1(v_teacher, v_live, null, false);
  if v_result->>'access_mode' is distinct from 'member'
    or v_result->>'subject_id' is distinct from v_teacher::text
    or v_result->'doc'->>'student_id' is distinct from v_teacher::text
    or jsonb_array_length(v_result->'history') <> 2
  then
    raise exception 'Teacher-valued member history returned invalid evidence: %', v_result;
  end if;

  v_result := public.get_assignment_doc_history_for_actor_v1(v_owner, 'c1880000-0000-4000-8000-000000000022', v_target, false);
  if v_result->>'access_mode' is distinct from 'owner'
    or v_result->>'subject_id' is distinct from v_target::text
    or v_result->'doc'->>'assignment_id' is distinct from 'c1880000-0000-4000-8000-000000000022'
  then
    raise exception 'Student-valued owner draft history returned invalid evidence: %', v_result;
  end if;

  v_result := public.get_assignment_doc_history_for_actor_v1(v_owner, 'c1880000-0000-4000-8000-000000000024', v_target, false);
  if v_result->>'access_mode' is distinct from 'owner'
    or v_result->'assignment'->>'classroom_id' is distinct from 'c1880000-0000-4000-8000-000000000011'
  then
    raise exception 'Archived owner history returned invalid evidence: %', v_result;
  end if;

  v_result := public.get_assignment_doc_history_for_actor_v1(v_student, v_student_live, v_target, false);
  if v_result->>'access_mode' is distinct from 'member'
    or v_result->>'subject_id' is distinct from v_student::text
    or v_result->'doc'->>'student_id' is distinct from v_student::text
  then
    raise exception 'Member history did not remain own-document scoped: %', v_result;
  end if;

  select content, updated_at into v_before_content, v_before_updated_at
  from public.assignment_docs
  where assignment_id = v_live and student_id = v_teacher;
  select count(*) into v_before_history_count
  from public.assignment_doc_history
  where assignment_doc_id = 'c1880000-0000-4000-8000-000000000030';
  begin
    perform public.restore_assignment_doc_for_member_v1(
      v_teacher,
      v_live,
      'c1880000-0000-4000-8000-000000000044',
      '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Tampered work"}]}]}'::jsonb,
      v_before_updated_at,
      '[]'::jsonb,
      '{"type":"doc","content":[]}'::jsonb,
      999,
      999,
      'c1880000-0000-4000-8000-000000000052',
      1,
      'c1880000-0000-4000-8000-000000000053'
    );
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected
    or (select content from public.assignment_docs
        where assignment_id = v_live and student_id = v_teacher) is distinct from v_before_content
    or (select updated_at from public.assignment_docs
        where assignment_id = v_live and student_id = v_teacher) is distinct from v_before_updated_at
    or (select count(*) from public.assignment_doc_history
        where assignment_doc_id = 'c1880000-0000-4000-8000-000000000030') <> v_before_history_count
  then
    raise exception 'Mismatched restore content was not rejected atomically';
  end if;

  select updated_at into v_revision
  from public.assignment_docs
  where assignment_id = v_live and student_id = v_teacher;
  v_result := public.restore_assignment_doc_for_member_v1(
    v_teacher,
    v_live,
    'c1880000-0000-4000-8000-000000000044',
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Patch target work"}]}]}'::jsonb,
    v_revision,
    '[]'::jsonb,
    null,
    999,
    999,
    'c1880000-0000-4000-8000-000000000050',
    1,
    'c1880000-0000-4000-8000-000000000051'
  );
  if not (v_result->>'ok')::boolean
    or v_result->>'classroom_id' is distinct from 'c1880000-0000-4000-8000-000000000010'
    or v_result->'doc'->>'student_id' is distinct from v_teacher::text
    or v_result->'history_entry'->>'trigger' is distinct from 'restore'
    or v_result->'history_entry'->'snapshot' is distinct from '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Patch target work"}]}]}'::jsonb
    or v_result->'history_entry'->'patch' is distinct from 'null'::jsonb
    or (v_result->'history_entry'->>'word_count')::integer <> 3
    or (v_result->'history_entry'->>'char_count')::integer <> 17
  then
    raise exception 'Teacher-valued member restore returned invalid evidence: %', v_result;
  end if;

  begin
    perform public.get_assignment_doc_history_for_actor_v1(v_owner, v_live, null, false);
    raise exception 'Expected owner history target requirement';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.get_assignment_doc_history_for_actor_v1(v_outsider, v_live, null, false);
    raise exception 'Expected outsider history denial';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_assignment_doc_history_for_actor_v1(v_teacher, 'c1880000-0000-4000-8000-000000000022', null, true);
    raise exception 'Expected draft member concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.get_assignment_doc_history_for_actor_v1(v_teacher, 'c1880000-0000-4000-8000-000000000023', null, true);
    raise exception 'Expected scheduled member concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.get_assignment_doc_history_for_actor_v1(v_teacher, 'c1880000-0000-4000-8000-000000000024', null, true);
    raise exception 'Expected archived member concealment';
  exception when no_data_found then null;
  end;
  begin
    perform public.restore_assignment_doc_for_member_v1(
      v_teacher, v_live, gen_random_uuid(), '{}'::jsonb,
      (select updated_at from public.assignment_docs where assignment_id = v_live and student_id = v_teacher),
      '[]'::jsonb, '{}'::jsonb, 0, 0, gen_random_uuid(), 1, gen_random_uuid()
    );
    raise exception 'Expected exact history target denial';
  exception when no_data_found then null;
  end;

  delete from public.classroom_enrollments
  where classroom_id = 'c1880000-0000-4000-8000-000000000010'
    and student_id = v_teacher;
  begin
    perform public.get_assignment_doc_history_for_actor_v1(v_teacher, v_live, null, true);
    raise exception 'Removed member history disclosed state';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.restore_assignment_doc_for_member_v1(
      v_teacher, v_live, 'c1880000-0000-4000-8000-000000000040', '{}'::jsonb,
      (select updated_at from public.assignment_docs where assignment_id = v_live and student_id = v_teacher),
      '[]'::jsonb, '{}'::jsonb, 0, 0, gen_random_uuid(), 1, gen_random_uuid()
    );
    raise exception 'Removed member restored work';
  exception when insufficient_privilege then null;
  end;
end;
$behavior$;
reset role;

rollback;
SQL

echo 'Contextual assignment-history database checks passed.'
