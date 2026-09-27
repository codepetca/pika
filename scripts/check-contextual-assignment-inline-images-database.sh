#!/usr/bin/env bash
set -euo pipefail

# Rollback-only post-migration contract check. It never applies migration 213;
# run only against the isolated local Supabase fixture after explicit approval.
CONTEXTUAL_IMAGE_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$CONTEXTUAL_IMAGE_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$CONTEXTUAL_IMAGE_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
do $check$
declare
  v_signature text;
  v_security_definer boolean;
  v_config text[];
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '213') then
    raise exception 'Migration 213 is required; this harness never applies it';
  end if;
  foreach v_signature in array array[
    'public.reserve_assignment_inline_image_for_member_v1(uuid,uuid,uuid,uuid,text,text,bigint)',
    'public.finalize_assignment_inline_image_for_member_v1(uuid,uuid,uuid,uuid)',
    'public.read_assignment_inline_image_for_context_v1(uuid,uuid,uuid,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null
      or has_function_privilege('anon', v_signature, 'execute')
      or has_function_privilege('authenticated', v_signature, 'execute')
      or not has_function_privilege('service_role', v_signature, 'execute')
    then
      raise exception 'Contextual Assignment image function privilege/signature is incorrect: %', v_signature;
    end if;
    select procedure.prosecdef, procedure.proconfig into strict v_security_definer, v_config
    from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where procedure.oid = to_regprocedure(v_signature);
    if not v_security_definer or not (v_config @> array['search_path=""']::text[]) then
      raise exception 'Contextual Assignment image function security metadata is incorrect: %', v_signature;
    end if;
  end loop;
  if has_function_privilege('service_role', 'private.lock_assignment_inline_image_member_context_v1(uuid,uuid)', 'execute') then
    raise exception 'Private contextual Assignment image helper is directly executable';
  end if;
end;
$check$;

-- Behaviour fixture: mixed global roles prove that the relationship, rather
-- than user.role, controls the three boundaries. Everything rolls back.
insert into public.users (id, email, role) values
  ('c2130000-0000-4000-8000-000000000001', 'inline-image-owner@example.invalid', 'student'),
  ('c2130000-0000-4000-8000-000000000002', 'inline-image-teacher-member@example.invalid', 'teacher'),
  ('c2130000-0000-4000-8000-000000000003', 'inline-image-student-member@example.invalid', 'student'),
  ('c2130000-0000-4000-8000-000000000004', 'inline-image-outsider@example.invalid', 'student');

set local role service_role;
select public.set_effective_feature_entitlement_v1(
  gen_random_uuid(), 'c2130000-0000-4000-8000-000000000001',
  'classrooms.create', 'manual', true, clock_timestamp(), null, 2,
  'test:migration-213', 'inline_image_fixture',
  coalesce((select revision from public.effective_feature_entitlements
    where subject_user_id = 'c2130000-0000-4000-8000-000000000001'
      and feature_key = 'classrooms.create'), 0)
);
reset role;

insert into public.classrooms (id, teacher_id, title, class_code, archived_at) values
  ('c2130000-0000-4000-8000-000000000010', 'c2130000-0000-4000-8000-000000000001', 'Inline images', 'C213LIVE', null),
  ('c2130000-0000-4000-8000-000000000011', 'c2130000-0000-4000-8000-000000000001', 'Archived inline images', 'C213ARCH', clock_timestamp());
insert into public.classroom_enrollments (classroom_id, student_id) values
  ('c2130000-0000-4000-8000-000000000010', 'c2130000-0000-4000-8000-000000000002'),
  ('c2130000-0000-4000-8000-000000000010', 'c2130000-0000-4000-8000-000000000003'),
  -- Owner precedence must reject this historical self-enrollment for writes.
  ('c2130000-0000-4000-8000-000000000010', 'c2130000-0000-4000-8000-000000000001'),
  ('c2130000-0000-4000-8000-000000000011', 'c2130000-0000-4000-8000-000000000003');
insert into public.assignments (id, classroom_id, title, description, due_at, created_by, is_draft, released_at) values
  ('c2130000-0000-4000-8000-000000000020', 'c2130000-0000-4000-8000-000000000010', 'Live', '', clock_timestamp() + interval '7 days', 'c2130000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour'),
  ('c2130000-0000-4000-8000-000000000021', 'c2130000-0000-4000-8000-000000000010', 'Draft', '', clock_timestamp() + interval '7 days', 'c2130000-0000-4000-8000-000000000001', true, null),
  ('c2130000-0000-4000-8000-000000000022', 'c2130000-0000-4000-8000-000000000010', 'Scheduled', '', clock_timestamp() + interval '7 days', 'c2130000-0000-4000-8000-000000000001', false, clock_timestamp() + interval '1 hour'),
  ('c2130000-0000-4000-8000-000000000023', 'c2130000-0000-4000-8000-000000000011', 'Archived', '', clock_timestamp() + interval '7 days', 'c2130000-0000-4000-8000-000000000001', false, clock_timestamp() - interval '1 hour');
insert into public.assignment_docs (id, assignment_id, student_id, content, is_submitted) values
  ('c2130000-0000-4000-8000-000000000030', 'c2130000-0000-4000-8000-000000000020', 'c2130000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}', false),
  ('c2130000-0000-4000-8000-000000000031', 'c2130000-0000-4000-8000-000000000020', 'c2130000-0000-4000-8000-000000000003', '{"type":"doc","content":[]}', false),
  ('c2130000-0000-4000-8000-000000000032', 'c2130000-0000-4000-8000-000000000021', 'c2130000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}', false),
  ('c2130000-0000-4000-8000-000000000033', 'c2130000-0000-4000-8000-000000000022', 'c2130000-0000-4000-8000-000000000002', '{"type":"doc","content":[]}', false),
  ('c2130000-0000-4000-8000-000000000034', 'c2130000-0000-4000-8000-000000000023', 'c2130000-0000-4000-8000-000000000003', '{"type":"doc","content":[]}', false),
  ('c2130000-0000-4000-8000-000000000035', 'c2130000-0000-4000-8000-000000000020', 'c2130000-0000-4000-8000-000000000001', '{"type":"doc","content":[]}', false);

-- Matching verified objects isolate lifecycle denial from object substitution.
select public.begin_managed_storage_upload('c2130000-0000-4000-8000-000000000041', 'submission-images', 'fixture/c213/draft.png', 'c2130000-0000-4000-8000-000000000010', null, null, 'student_inline_image', 'c2130000-0000-4000-8000-000000000002', 'c2130000-0000-4000-8000-000000000002', 'assignment_doc', 'c2130000-0000-4000-8000-000000000032', 'image/png', 4);
select public.begin_managed_storage_upload('c2130000-0000-4000-8000-000000000042', 'submission-images', 'fixture/c213/scheduled.png', 'c2130000-0000-4000-8000-000000000010', null, null, 'student_inline_image', 'c2130000-0000-4000-8000-000000000002', 'c2130000-0000-4000-8000-000000000002', 'assignment_doc', 'c2130000-0000-4000-8000-000000000033', 'image/png', 4);
select public.begin_managed_storage_upload('c2130000-0000-4000-8000-000000000043', 'submission-images', 'fixture/c213/archived.png', 'c2130000-0000-4000-8000-000000000011', null, null, 'student_inline_image', 'c2130000-0000-4000-8000-000000000003', 'c2130000-0000-4000-8000-000000000003', 'assignment_doc', 'c2130000-0000-4000-8000-000000000034', 'image/png', 4);
insert into storage.objects (bucket_id, name) values ('submission-images', 'fixture/c213/draft.png'), ('submission-images', 'fixture/c213/scheduled.png'), ('submission-images', 'fixture/c213/archived.png');
select public.verify_managed_storage_upload('c2130000-0000-4000-8000-000000000041'), public.verify_managed_storage_upload('c2130000-0000-4000-8000-000000000042'), public.verify_managed_storage_upload('c2130000-0000-4000-8000-000000000043');

set local role service_role;
do $behavior$
declare
  v_teacher_member constant uuid := 'c2130000-0000-4000-8000-000000000002';
  v_student_member constant uuid := 'c2130000-0000-4000-8000-000000000003';
  v_outsider constant uuid := 'c2130000-0000-4000-8000-000000000004';
  v_classroom constant uuid := 'c2130000-0000-4000-8000-000000000010';
  v_other_classroom constant uuid := 'c2130000-0000-4000-8000-000000000011';
  v_teacher_doc constant uuid := 'c2130000-0000-4000-8000-000000000030';
  v_student_doc constant uuid := 'c2130000-0000-4000-8000-000000000031';
  v_draft_doc constant uuid := 'c2130000-0000-4000-8000-000000000032';
  v_scheduled_doc constant uuid := 'c2130000-0000-4000-8000-000000000033';
  v_archived_doc constant uuid := 'c2130000-0000-4000-8000-000000000034';
  v_object constant uuid := 'c2130000-0000-4000-8000-000000000040';
  v_result jsonb;
begin
  v_result := public.reserve_assignment_inline_image_for_member_v1(
    v_teacher_member, v_classroom, v_teacher_doc, v_object, 'png', 'image/png', 4
  );
  if not (v_result->>'ok')::boolean or v_result->>'managed_object_id' is distinct from v_object::text then
    raise exception 'Teacher-valued member reservation returned invalid evidence: %', v_result;
  end if;
  if not exists (select 1 from public.managed_storage_objects where id = v_object
    and classroom_id = v_classroom and data_subject_user_id = v_teacher_member
    and resource_id = v_teacher_doc and status = 'reserved') then
    raise exception 'Reservation did not bind immutable inline-image ownership';
  end if;
  insert into storage.objects (bucket_id, name) values ('submission-images',
    'classrooms/c2130000-0000-4000-8000-000000000010/students/c2130000-0000-4000-8000-000000000002/assignment-docs/c2130000-0000-4000-8000-000000000030/c2130000-0000-4000-8000-000000000040.png');
  v_result := public.finalize_assignment_inline_image_for_member_v1(
    v_teacher_member, v_classroom, v_teacher_doc, v_object
  );
  if not (v_result->>'ok')::boolean or (select status from public.managed_storage_objects where id = v_object) <> 'verified' then
    raise exception 'Teacher-valued member finalization did not verify the reserved object: %', v_result;
  end if;
  v_result := public.read_assignment_inline_image_for_context_v1(
    v_teacher_member, v_classroom, v_teacher_doc, v_object
  );
  if not (v_result->>'ok')::boolean then raise exception 'Teacher-valued member could not read own image: %', v_result; end if;

  begin
    perform public.reserve_assignment_inline_image_for_member_v1(v_outsider, v_classroom, v_teacher_doc, gen_random_uuid(), 'png', 'image/png', 4);
    raise exception 'Outsider reserved an inline image';
  exception when insufficient_privilege then null; end;
  begin
    perform public.finalize_assignment_inline_image_for_member_v1(v_teacher_member, v_classroom, v_teacher_doc, gen_random_uuid());
    raise exception 'Substituted object finalized';
  exception when no_data_found then null; end;
  begin
    perform public.read_assignment_inline_image_for_context_v1(v_teacher_member, v_other_classroom, v_teacher_doc, v_object);
    raise exception 'Wrong expected Classroom was accepted';
  exception when serialization_failure then null; end;

  update public.assignment_docs set is_submitted = true, submitted_at = clock_timestamp() where id = v_teacher_doc;
  v_result := public.read_assignment_inline_image_for_context_v1(v_teacher_member, v_classroom, v_teacher_doc, v_object);
  if not (v_result->>'ok')::boolean then raise exception 'Submitted member image became unreadable: %', v_result; end if;
  v_result := public.reserve_assignment_inline_image_for_member_v1(v_teacher_member, v_classroom, v_teacher_doc, gen_random_uuid(), 'png', 'image/png', 4);
  if (v_result->>'ok')::boolean or (v_result->>'status')::integer <> 409 then raise exception 'Submitted document accepted a reservation: %', v_result; end if;

  foreach v_result in array array[
    public.read_assignment_inline_image_for_context_v1(v_teacher_member, v_classroom, v_draft_doc, 'c2130000-0000-4000-8000-000000000041'),
    public.read_assignment_inline_image_for_context_v1(v_teacher_member, v_classroom, v_scheduled_doc, 'c2130000-0000-4000-8000-000000000042'),
    public.read_assignment_inline_image_for_context_v1(v_student_member, 'c2130000-0000-4000-8000-000000000011', v_archived_doc, 'c2130000-0000-4000-8000-000000000043')
  ] loop
    if (v_result->>'ok')::boolean then raise exception 'Hidden lifecycle image was readable: %', v_result; end if;
  end loop;
  delete from public.classroom_enrollments where classroom_id = v_classroom and student_id = v_teacher_member;
  begin
    perform public.reserve_assignment_inline_image_for_member_v1(v_teacher_member, v_classroom, v_teacher_doc, gen_random_uuid(), 'png', 'image/png', 4);
    raise exception 'Revoked member reserved an inline image';
  exception when insufficient_privilege then null; end;
end;
$behavior$;
reset role;

-- Only the fixture's postgres session may promote verified bytes without a
-- persistent reference. Application service_role never receives this grant.
select public.managed_storage_mark_ready('c2130000-0000-4000-8000-000000000040');
set local role service_role;
do $owner_behavior$
declare
  v_owner constant uuid := 'c2130000-0000-4000-8000-000000000001';
  v_classroom constant uuid := 'c2130000-0000-4000-8000-000000000010';
  v_teacher_doc constant uuid := 'c2130000-0000-4000-8000-000000000030';
  v_owner_doc constant uuid := 'c2130000-0000-4000-8000-000000000035';
  v_object constant uuid := 'c2130000-0000-4000-8000-000000000040';
  v_result jsonb;
begin
  v_result := public.read_assignment_inline_image_for_context_v1(v_owner, v_classroom, v_teacher_doc, v_object);
  if not (v_result->>'ok')::boolean then raise exception 'Student-valued owner could not inspect ready image: %', v_result; end if;
  begin
    perform public.reserve_assignment_inline_image_for_member_v1(v_owner, v_classroom, v_owner_doc, gen_random_uuid(), 'png', 'image/png', 4);
    raise exception 'Owner self-enrollment bypassed write precedence';
  exception when insufficient_privilege then null; end;
end;
$owner_behavior$;
reset role;
rollback;
SQL

echo 'Contextual Assignment inline-image database contract checks passed.'
