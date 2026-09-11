-- Rollback-only migration 164 behavioral fixture. Run with psql against a
-- disposable database that has migrations 001-164 applied. This script never
-- applies migrations and leaves no durable rows.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $contract$
declare
  v_remove text := 'public.remove_classroom_students_preserving_data(uuid,uuid,uuid[])';
  v_restore text := 'public.restore_removed_classroom_students(uuid,uuid,text[])';
begin
  if to_regprocedure(v_remove) is null or to_regprocedure(v_restore) is null then
    raise exception 'Migration 164 is required; this fixture never applies it';
  end if;
  if has_function_privilege('anon', v_remove, 'execute')
    or has_function_privilege('authenticated', v_remove, 'execute')
    or not has_function_privilege('service_role', v_remove, 'execute')
    or has_function_privilege('anon', v_restore, 'execute')
    or has_function_privilege('authenticated', v_restore, 'execute')
    or not has_function_privilege('service_role', v_restore, 'execute')
  then
    raise exception 'Migration 164 RPC privileges are incorrect';
  end if;
  if exists (
    select 1
    from pg_constraint
    where conname in (
      'gradebook_score_overrides_classroom_id_student_id_fkey',
      'gradebook_item_scores_classroom_id_student_id_fkey'
    )
  ) then
    raise exception 'Enrollment-coupled Gradebook constraints remain';
  end if;
  if position(
    'pg_try_advisory_xact_lock' in pg_get_functiondef(
      'private.try_lock_classroom_membership_change(uuid,uuid)'::regprocedure
    )
  ) = 0 then
    raise exception 'Membership-change locking must fail fast';
  end if;
end;
$contract$;

insert into public.users (id, email, role) values
  ('c1640000-0000-4000-8000-000000000001', 'owner-164@example.invalid', 'teacher'),
  ('c1640000-0000-4000-8000-000000000002', 'other-owner-164@example.invalid', 'teacher'),
  ('c1640000-0000-4000-8000-000000000003', 'student-164@example.invalid', 'student'),
  ('c1640000-0000-4000-8000-000000000020', 'inactive-164@example.invalid', 'student');

insert into public.classrooms (id, teacher_id, title, class_code, allow_enrollment, join_policy)
values (
  'c1640000-0000-4000-8000-000000000010',
  'c1640000-0000-4000-8000-000000000001',
  'Removal fixture',
  'C164FIXTURE',
  true,
  'roster'
);

insert into public.classroom_roster (
  id, classroom_id, email, first_name, last_name, join_source
) values
  (
    'c1640000-0000-4000-8000-000000000011',
    'c1640000-0000-4000-8000-000000000010',
    'student-164@example.invalid',
    'Student',
    'Fixture',
    'manual'
  ),
  (
    'c1640000-0000-4000-8000-000000000018',
    'c1640000-0000-4000-8000-000000000010',
    'invited-164@example.invalid',
    'Invited',
    'Fixture',
    'manual'
  ),
  (
    'c1640000-0000-4000-8000-000000000021',
    'c1640000-0000-4000-8000-000000000010',
    'inactive-164@example.invalid',
    'Inactive',
    'Fixture',
    'manual'
  );

insert into public.classroom_enrollments (
  id, classroom_id, student_id, created_at, manual_attendance_marks
) values (
  'c1640000-0000-4000-8000-000000000012',
  'c1640000-0000-4000-8000-000000000010',
  'c1640000-0000-4000-8000-000000000003',
  '2026-09-01T12:00:00Z',
  '{"2026-09-02":"late"}'::jsonb
), (
  'c1640000-0000-4000-8000-000000000022',
  'c1640000-0000-4000-8000-000000000010',
  'c1640000-0000-4000-8000-000000000020',
  '2026-09-01T13:00:00Z',
  '{}'::jsonb
);

insert into public.entries (
  id, student_id, classroom_id, date, text, on_time
) values (
  'c1640000-0000-4000-8000-000000000013',
  'c1640000-0000-4000-8000-000000000003',
  'c1640000-0000-4000-8000-000000000010',
  '2026-09-02',
  'Retained daily log',
  true
);

insert into public.gradebook_items (
  id, classroom_id, title, points_possible, gradebook_weight,
  include_in_final, created_by
) values (
  'c1640000-0000-4000-8000-000000000014',
  'c1640000-0000-4000-8000-000000000010',
  'Retained mark',
  10,
  10,
  true,
  'c1640000-0000-4000-8000-000000000001'
);

insert into public.gradebook_item_scores (
  id, classroom_id, item_id, student_id, earned, returned_at
) values (
  'c1640000-0000-4000-8000-000000000015',
  'c1640000-0000-4000-8000-000000000010',
  'c1640000-0000-4000-8000-000000000014',
  'c1640000-0000-4000-8000-000000000003',
  8,
  clock_timestamp()
);

insert into public.gradebook_score_overrides (
  id, classroom_id, student_id, assessment_type, assessment_id, earned, created_by
) values (
  'c1640000-0000-4000-8000-000000000016',
  'c1640000-0000-4000-8000-000000000010',
  'c1640000-0000-4000-8000-000000000003',
  'final',
  'c1640000-0000-4000-8000-000000000010',
  87,
  'c1640000-0000-4000-8000-000000000001'
);

insert into public.attendance_participant_mappings (
  classroom_id, student_id, participant_ref, active
) values (
  'c1640000-0000-4000-8000-000000000010',
  'c1640000-0000-4000-8000-000000000003',
  'participant_16400000000000000000000000000000',
  true
), (
  'c1640000-0000-4000-8000-000000000010',
  'c1640000-0000-4000-8000-000000000020',
  'participant_16400000000000000000000000000020',
  false
);

insert into public.pal_event_outbox (
  id, idempotency_key, student_id, event_type, source_kind, source_id, payload
) values (
  'c1640000-0000-4000-8000-000000000017',
  'pika:v1:pika-fact-1640000000000000000000000000000000000000000',
  'c1640000-0000-4000-8000-000000000003',
  'classroom.joined',
  'classroom_enrollment',
  'c1640000-0000-4000-8000-000000000010',
  jsonb_build_object(
    'schema_version', 1,
    'idempotency_key', 'pika:v1:pika-fact-1640000000000000000000000000000000000000000',
    'event_type', 'classroom.joined',
    'metadata', '{}'::jsonb
  )
);

set local role service_role;

do $ownership$
begin
  begin
    perform public.remove_classroom_students_preserving_data(
      'c1640000-0000-4000-8000-000000000002',
      'c1640000-0000-4000-8000-000000000010',
      array['c1640000-0000-4000-8000-000000000011'::uuid]
    );
    raise exception 'Expected non-owner removal denial';
  exception when insufficient_privilege then null;
  end;
end;
$ownership$;

reset role;
insert into public.attendance_decommission_operations (
  id, classroom_id, teacher_id, installation_ref, roster_ref, actor_principal_ref
) values (
  'c1640000-0000-4000-8000-000000000019',
  'c1640000-0000-4000-8000-000000000010',
  'c1640000-0000-4000-8000-000000000001',
  'installation_164',
  'roster_164',
  'principal_164'
);
set local role service_role;

do $active_conflict$
begin
  begin
    perform public.remove_classroom_students_preserving_data(
      'c1640000-0000-4000-8000-000000000001',
      'c1640000-0000-4000-8000-000000000010',
      array['c1640000-0000-4000-8000-000000000011'::uuid]
    );
    raise exception 'Expected active classroom-operation denial';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'attendance_decommission_active' then raise; end if;
  end;
end;
$active_conflict$;

reset role;
delete from public.attendance_decommission_operations
where id = 'c1640000-0000-4000-8000-000000000019';
set local role service_role;

do $behavior$
declare
  v_result jsonb;
begin
  v_result := public.remove_classroom_students_preserving_data(
    'c1640000-0000-4000-8000-000000000001',
    'c1640000-0000-4000-8000-000000000010',
    array[
      'c1640000-0000-4000-8000-000000000011'::uuid,
      'c1640000-0000-4000-8000-000000000018'::uuid,
      'c1640000-0000-4000-8000-000000000021'::uuid
    ]
  );
  if v_result <> '{"removed_count":3,"requested_count":3}'::jsonb then
    raise exception 'Unexpected removal result: %', v_result;
  end if;
  if exists (
    select 1 from public.classroom_roster
    where id = 'c1640000-0000-4000-8000-000000000018'
  ) then
    raise exception 'Removal retained an invitation-only roster row';
  end if;
  if exists (
    select 1 from public.classroom_enrollments
    where id in (
      'c1640000-0000-4000-8000-000000000012',
      'c1640000-0000-4000-8000-000000000022'
    )
  ) then
    raise exception 'Removal did not revoke enrollment access';
  end if;
  if not exists (
    select 1 from public.classroom_roster
    where id = 'c1640000-0000-4000-8000-000000000011'
      and removed_student_id = 'c1640000-0000-4000-8000-000000000003'
      and removed_enrollment_id = 'c1640000-0000-4000-8000-000000000012'
      and removed_enrolled_at = '2026-09-01T12:00:00Z'
      and retained_manual_attendance_marks = '{"2026-09-02":"late"}'::jsonb
      and retained_attendance_participant_active is true
  ) then
    raise exception 'Removal did not retain the complete membership snapshot';
  end if;
  if not exists (
    select 1 from public.classroom_roster
    where id = 'c1640000-0000-4000-8000-000000000021'
      and removed_student_id = 'c1640000-0000-4000-8000-000000000020'
      and retained_attendance_participant_active is false
  ) then
    raise exception 'Removal did not retain inactive attendance state';
  end if;
  if not exists (
    select 1 from public.classroom_roster_student_bindings
    where roster_id = 'c1640000-0000-4000-8000-000000000011'
      and student_id = 'c1640000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Removal lost stable roster identity';
  end if;
  if not exists (select 1 from public.entries where id = 'c1640000-0000-4000-8000-000000000013')
    or not exists (select 1 from public.gradebook_item_scores where id = 'c1640000-0000-4000-8000-000000000015')
    or not exists (select 1 from public.gradebook_score_overrides where id = 'c1640000-0000-4000-8000-000000000016')
    or not exists (select 1 from public.pal_event_outbox where id = 'c1640000-0000-4000-8000-000000000017')
  then
    raise exception 'Removal deleted retained academic or Pal state';
  end if;
  if exists (
    select 1 from public.attendance_participant_mappings
    where classroom_id = 'c1640000-0000-4000-8000-000000000010'
      and student_id = 'c1640000-0000-4000-8000-000000000003'
      and active
  ) then
    raise exception 'Removal did not deactivate the attendance participant';
  end if;

  begin
    insert into public.classroom_enrollments (classroom_id, student_id)
    values (
      'c1640000-0000-4000-8000-000000000010',
      'c1640000-0000-4000-8000-000000000003'
    );
    raise exception 'Expected direct re-enrollment denial';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'classroom_membership_removed_teacher_restore_required' then raise; end if;
  end;

  begin
    perform public.remove_classroom_roster_entries_atomic(
      'c1640000-0000-4000-8000-000000000010',
      array['c1640000-0000-4000-8000-000000000011'::uuid]
    );
    raise exception 'Expected destructive remover denial';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'removed_students_require_explicit_restore_or_purge' then raise; end if;
  end;

  v_result := public.remove_classroom_students_preserving_data(
    'c1640000-0000-4000-8000-000000000001',
    'c1640000-0000-4000-8000-000000000010',
    array['c1640000-0000-4000-8000-000000000011'::uuid]
  );
  if v_result <> '{"removed_count":0,"requested_count":1}'::jsonb then
    raise exception 'Removal retry was not idempotent: %', v_result;
  end if;

  v_result := public.restore_removed_classroom_students(
    'c1640000-0000-4000-8000-000000000001',
    'c1640000-0000-4000-8000-000000000010',
    array[' STUDENT-164@EXAMPLE.INVALID ', 'inactive-164@example.invalid']
  );
  if v_result <> '{"requested_count":2,"restored_count":2}'::jsonb then
    raise exception 'Unexpected restore result: %', v_result;
  end if;
  if not exists (
    select 1 from public.classroom_enrollments
    where id = 'c1640000-0000-4000-8000-000000000012'
      and classroom_id = 'c1640000-0000-4000-8000-000000000010'
      and student_id = 'c1640000-0000-4000-8000-000000000003'
      and created_at = '2026-09-01T12:00:00Z'
      and manual_attendance_marks = '{"2026-09-02":"late"}'::jsonb
  ) then
    raise exception 'Restore did not recreate the exact enrollment';
  end if;
  if not exists (
    select 1 from public.classroom_roster
    where id = 'c1640000-0000-4000-8000-000000000011'
      and removed_at is null
      and removed_student_id is null
      and retained_manual_attendance_marks is null
  ) then
    raise exception 'Restore did not clear retained removal state';
  end if;
  if not exists (
    select 1 from public.attendance_participant_mappings
    where classroom_id = 'c1640000-0000-4000-8000-000000000010'
      and student_id = 'c1640000-0000-4000-8000-000000000003'
      and active
  ) then
    raise exception 'Restore did not reactivate the attendance participant';
  end if;
  if exists (
    select 1 from public.attendance_participant_mappings
    where classroom_id = 'c1640000-0000-4000-8000-000000000010'
      and student_id = 'c1640000-0000-4000-8000-000000000020'
      and active
  ) then
    raise exception 'Restore activated a participant that was inactive before removal';
  end if;
  if not exists (select 1 from public.pal_event_outbox where id = 'c1640000-0000-4000-8000-000000000017') then
    raise exception 'Restore rewrote Pal state';
  end if;
end;
$behavior$;

rollback;
