-- Synthetic, rollback-only lifecycle contract. Requires separately authorized
-- migration 168 on a disposable database. This file never applies migrations.
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
begin
  if to_regprocedure('public.resolve_pal_membership(uuid,uuid)') is null then
    raise exception 'Migration 168 is required';
  end if;
  if has_function_privilege('anon', 'public.resolve_pal_membership(uuid,uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.resolve_pal_membership(uuid,uuid)', 'execute')
    or not has_function_privilege('service_role', 'public.resolve_pal_membership(uuid,uuid)', 'execute')
    or has_table_privilege('service_role', 'private.pal_membership_generations', 'select,insert,update,delete')
  then raise exception 'Membership identity privilege boundary failed'; end if;
end;
$$;

insert into public.users (id, email, role) values
  ('c1680000-0000-4000-8000-000000000001', 'teacher-168@example.invalid', 'teacher'),
  ('c1680000-0000-4000-8000-000000000002', 'student-168@example.invalid', 'student'),
  ('c1680000-0000-4000-8000-000000000003', 'other-168@example.invalid', 'student');
insert into public.classrooms (id, teacher_id, title, class_code) values
  ('c1680000-0000-4000-8000-000000000010', 'c1680000-0000-4000-8000-000000000001', 'Pal A', 'C168A'),
  ('c1680000-0000-4000-8000-000000000011', 'c1680000-0000-4000-8000-000000000001', 'Pal B', 'C168B');
insert into public.classroom_roster (id, classroom_id, email) values
  ('c1680000-0000-4000-8000-000000000020', 'c1680000-0000-4000-8000-000000000010', 'student-168@example.invalid'),
  ('c1680000-0000-4000-8000-000000000021', 'c1680000-0000-4000-8000-000000000011', 'student-168@example.invalid'),
  ('c1680000-0000-4000-8000-000000000022', 'c1680000-0000-4000-8000-000000000010', 'other-168@example.invalid');
insert into public.classroom_enrollments (id, classroom_id, student_id) values
  ('c1680000-0000-4000-8000-000000000030', 'c1680000-0000-4000-8000-000000000010', 'c1680000-0000-4000-8000-000000000002'),
  ('c1680000-0000-4000-8000-000000000031', 'c1680000-0000-4000-8000-000000000011', 'c1680000-0000-4000-8000-000000000002'),
  ('c1680000-0000-4000-8000-000000000032', 'c1680000-0000-4000-8000-000000000010', 'c1680000-0000-4000-8000-000000000003');

do $$
declare
  student uuid := 'c1680000-0000-4000-8000-000000000002';
  other_student uuid := 'c1680000-0000-4000-8000-000000000003';
  course_a uuid := 'c1680000-0000-4000-8000-000000000010';
  course_b uuid := 'c1680000-0000-4000-8000-000000000011';
  generation uuid := 'c1680000-0000-4000-8000-000000000030';
  original_ref text;
  other_ref text;
  saved_enrollment public.classroom_enrollments%rowtype;
  generation_count bigint;
begin
  if public.resolve_pal_membership(student, course_a) <> '{"status":"disabled"}'::jsonb then
    raise exception 'Rollout must default disabled';
  end if;
  update private.pal_membership_settings set enabled = true;
  original_ref := public.resolve_pal_membership(student, course_a)->>'learner_id';
  if original_ref is null or original_ref !~ '^pika-membership-v1-[0-9a-f]{32}$'
    or position(replace(student::text, '-', '') in original_ref) > 0
    or position(replace(generation::text, '-', '') in original_ref) > 0
  then raise exception 'Opaque reference contract failed'; end if;
  if public.resolve_pal_membership(student, course_a)->>'learner_id' is distinct from original_ref then
    raise exception 'Retry changed reference';
  end if;
  select count(*) into generation_count from private.pal_membership_generations;
  insert into public.classroom_enrollments(classroom_id, student_id)
    values (course_a, student) on conflict (classroom_id, student_id) do nothing;
  if (select count(*) from private.pal_membership_generations) <> generation_count then
    raise exception 'Discarded enrollment retry created a phantom generation';
  end if;
  other_ref := public.resolve_pal_membership(student, course_b)->>'learner_id';
  if other_ref is null or other_ref = original_ref
    or public.resolve_pal_membership(other_student, course_a)->>'learner_id' = original_ref
  then raise exception 'Membership isolation failed'; end if;
  if public.resolve_pal_membership(other_student, course_b) <> '{"status":"forbidden"}'::jsonb
    or public.resolve_pal_membership('c1680000-0000-4000-8000-000000000001', course_a) <> '{"status":"forbidden"}'::jsonb
  then raise exception 'Cross-classroom/role access was allowed'; end if;

  -- Identity mutations cannot retarget an existing generation.
  begin
    perform private.register_pal_membership(generation, course_b, other_student, 'active');
    raise exception 'Generation reused across subjects';
  exception when sqlstate '55000' then null; end;
  begin
    update public.classroom_enrollments set id = gen_random_uuid() where id = generation;
    raise exception 'Enrollment generation mutation accepted';
  exception when sqlstate '55000' then null; end;
  begin
    update private.pal_membership_generations set pal_reference = 'pika-membership-v1-' || repeat('a',32)
      where generation_id = generation;
    raise exception 'Opaque reference mutation accepted';
  exception when sqlstate '55000' then null; end;

  -- Model the exact compaction/restore membership boundary with original rows.
  -- Full archive coordinator contracts run separately; this is not a worker.
  select * into saved_enrollment from public.classroom_enrollments where id = generation;
  update public.classrooms set archived_at = clock_timestamp() where id = course_a;
  if public.resolve_pal_membership(student, course_a) <> '{"status":"forbidden"}'::jsonb then
    raise exception 'Hot archive allowed access';
  end if;
  perform set_config('pika.classroom_archive_compaction', 'on', true);
  delete from public.classroom_enrollments where id = generation;
  perform set_config('pika.classroom_archive_compaction', 'off', true);
  perform set_config('pika.classroom_archive_restore', 'on', true);
  insert into public.classroom_enrollments select saved_enrollment.*;
  perform set_config('pika.classroom_archive_restore', 'off', true);
  update public.classrooms set archived_at = null where id = course_a;
  if public.resolve_pal_membership(student, course_a)->>'learner_id' is distinct from original_ref then
    raise exception 'Archive restore changed identity';
  end if;

  perform public.remove_classroom_students_preserving_data(
    'c1680000-0000-4000-8000-000000000001', course_a,
    array['c1680000-0000-4000-8000-000000000020'::uuid]);
  if public.resolve_pal_membership(student, course_a) <> '{"status":"forbidden"}'::jsonb
    or not exists (select 1 from private.pal_membership_generations
      where generation_id = generation and state = 'removed' and pal_reference = original_ref)
  then raise exception 'Removal lost cleanup identity or allowed access'; end if;

  -- Removed evidence survives without enrollment and is not reopened by stale
  -- archive replay, including before future cleanup has marked it purged.
  begin
    perform set_config('pika.classroom_archive_restore', 'on', true);
    perform private.register_pal_membership(generation, course_a, student, 'active');
    raise exception 'Removed generation reopened through archive restore';
  exception when sqlstate '55000' then null; end;
  perform set_config('pika.classroom_archive_restore', 'off', true);

  -- Model future verified cleanup. No production cleanup API exists in Phase 1.
  delete from public.classroom_roster where id = 'c1680000-0000-4000-8000-000000000020';
  update private.pal_membership_generations set state = 'purged', scope_digest = null
    where generation_id = generation;
  begin
    perform set_config('pika.classroom_archive_compaction', 'off', true);
  perform set_config('pika.classroom_archive_restore', 'on', true);
    insert into public.classroom_enrollments select saved_enrollment.*;
    raise exception 'Purged archive generation resurrected';
  exception when sqlstate '55000' then null; end;
  perform set_config('pika.classroom_archive_restore', 'off', true);
  begin
    delete from private.pal_membership_generations where generation_id = generation;
    raise exception 'Deletion evidence erased';
  exception when sqlstate '55000' then null; end;
  begin
    update private.pal_membership_generations set state = 'active' where generation_id = generation;
    raise exception 'Purged generation reopened';
  exception when sqlstate '55000' then null; end;

  insert into public.classroom_roster (classroom_id, email) values (course_a, 'student-168@example.invalid');
  insert into public.classroom_enrollments (classroom_id, student_id) values (course_a, student);
  if public.resolve_pal_membership(student, course_a)->>'learner_id' is null
    or public.resolve_pal_membership(student, course_a)->>'learner_id' = original_ref
    or public.resolve_pal_membership(student, course_b)->>'learner_id' is distinct from other_ref
  then raise exception 'Fresh re-add or neighboring membership isolation failed'; end if;
end;
$$;
rollback;
