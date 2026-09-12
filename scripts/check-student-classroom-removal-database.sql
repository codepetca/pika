-- Rollback-only migration 164/165 behavioral fixture. Run with psql against a
-- disposable database that has migrations 001-164 or 001-165 applied. This script never
-- applies migrations and leaves no durable rows.

\if :{?archive_placeholder_id}
\else
\set archive_placeholder_id c1640000-0000-4000-8000-000000000039
\endif
begin;
set local pika.removal_test_placeholder_id = :'archive_placeholder_id';
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
  ('c1640000-0000-4000-8000-000000000020', 'inactive-164@example.invalid', 'student'),
  ('c1640000-0000-4000-8000-000000000040', 'archive-164@example.invalid', 'student'),
  ('c1640000-0000-4000-8000-000000000051', 'reuse-holder-164@example.invalid', 'student');

insert into public.classrooms (id, teacher_id, title, class_code, allow_enrollment, join_policy)
values (
  'c1640000-0000-4000-8000-000000000010',
  'c1640000-0000-4000-8000-000000000001',
  'Removal fixture',
  'C164FIXTURE',
  true,
  'roster'
), (
  'c1640000-0000-4000-8000-000000000041',
  'c1640000-0000-4000-8000-000000000001',
  'Removal archive fixture',
  'C164ARCHIVE',
  true,
  'roster'
), (
  'c1640000-0000-4000-8000-000000000048',
  'c1640000-0000-4000-8000-000000000001',
  'Removal cross-class fixture',
  'C164CROSS',
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
  ),
  (
    'c1640000-0000-4000-8000-000000000042',
    'c1640000-0000-4000-8000-000000000041',
    'archive-164@example.invalid',
    'Archive',
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
), (
  'c1640000-0000-4000-8000-000000000043',
  'c1640000-0000-4000-8000-000000000041',
  'c1640000-0000-4000-8000-000000000040',
  '2026-08-20T14:00:00Z',
  '{"2026-08-21":"absent"}'::jsonb
), (
  'c1640000-0000-4000-8000-000000000049',
  'c1640000-0000-4000-8000-000000000048',
  'c1640000-0000-4000-8000-000000000040',
  '2026-08-20T15:00:00Z',
  '{}'::jsonb
);

-- An unrelated invitation can become an overlap when the member changes email.
-- Seed it before that change so it remains unbound, as with a failed 164 re-add.
insert into public.classroom_roster (id, classroom_id, email) values (
  :'archive_placeholder_id'::uuid,
  'c1640000-0000-4000-8000-000000000041',
  'archive-renamed-164@example.invalid'
);

-- Stable roster identity, not mutable account email, selects the learner.
update public.users
set email = 'archive-renamed-164@example.invalid'
where id = 'c1640000-0000-4000-8000-000000000040';

insert into public.entries (
  id, student_id, classroom_id, date, text, on_time
) values (
  'c1640000-0000-4000-8000-000000000013',
  'c1640000-0000-4000-8000-000000000003',
  'c1640000-0000-4000-8000-000000000010',
  '2026-09-02',
  'Retained daily log',
  true
), (
  'c1640000-0000-4000-8000-000000000047',
  'c1640000-0000-4000-8000-000000000040',
  'c1640000-0000-4000-8000-000000000041',
  '2026-08-21',
  'Archived removed-student log',
  true
), (
  'c1640000-0000-4000-8000-000000000050',
  'c1640000-0000-4000-8000-000000000040',
  'c1640000-0000-4000-8000-000000000048',
  '2026-08-21',
  'Other-class retained log',
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
), (
  'c1640000-0000-4000-8000-000000000044',
  'c1640000-0000-4000-8000-000000000041',
  'Archived retained mark',
  20,
  15,
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
), (
  'c1640000-0000-4000-8000-000000000045',
  'c1640000-0000-4000-8000-000000000041',
  'c1640000-0000-4000-8000-000000000044',
  'c1640000-0000-4000-8000-000000000040',
  17,
  '2026-08-22T16:00:00Z'
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
), (
  'c1640000-0000-4000-8000-000000000046',
  'c1640000-0000-4000-8000-000000000041',
  'c1640000-0000-4000-8000-000000000040',
  'final',
  'c1640000-0000-4000-8000-000000000041',
  91,
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

create temporary table removal_archive_rows (
  table_name text primary key,
  rows jsonb not null
) on commit drop;
grant select, insert on removal_archive_rows to service_role;

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
  v_final_removal boolean := to_regprocedure('private.guard_final_student_roster_write()') is not null;
  v_result jsonb;
  v_counts jsonb;
  v_actors jsonb;
  v_verification jsonb;
  v_rows jsonb;
  v_resource record;
  v_archive_path text;
  v_original_roster jsonb;
  v_original_placeholder jsonb;
  v_original_score jsonb;
  v_original_override jsonb;
  v_retained_before jsonb;
  v_retained_after jsonb;
  v_invitation uuid;
  v_export_id constant uuid := 'c1640000-0000-4000-8000-000000000060';
  v_compact_id constant uuid := 'c1640000-0000-4000-8000-000000000061';
  v_restore_id constant uuid := 'c1640000-0000-4000-8000-000000000062';
begin
  begin
    perform public.remove_classroom_roster_entries_atomic(
      'c1640000-0000-4000-8000-000000000010', array[
        'c1640000-0000-4000-8000-000000000018'::uuid,
        'c1640000-0000-4000-8000-000000000011'::uuid]);
    raise exception 'Legacy mixed deletion admitted a joined student';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'joined_students_require_comprehensive_removal' then raise; end if;
  end;
  if not exists (select 1 from public.classroom_roster where id = 'c1640000-0000-4000-8000-000000000018') then
    raise exception 'Rejected legacy batch partially deleted its invitation';
  end if;
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

  update public.users
  set email = 'student-renamed-164@example.invalid'
  where id = 'c1640000-0000-4000-8000-000000000003';

  -- Legacy callers may remove an unrelated invitation or an unbound re-add
  -- placeholder. Neither owns the removed learner's retained work or marks.
  select jsonb_build_object(
    'work', (select to_jsonb(e) from public.entries e where id = 'c1640000-0000-4000-8000-000000000013'),
    'score', (select to_jsonb(s) from public.gradebook_item_scores s where id = 'c1640000-0000-4000-8000-000000000015'),
    'override', (select to_jsonb(o) from public.gradebook_score_overrides o where id = 'c1640000-0000-4000-8000-000000000016')
  ) into v_retained_before;
  insert into public.classroom_roster (id, classroom_id, email) values
    ('c1640000-0000-4000-8000-000000000080', 'c1640000-0000-4000-8000-000000000010', 'unrelated-164@example.invalid');
  if not v_final_removal then
  insert into public.classroom_roster (id, classroom_id, email) values
    ('c1640000-0000-4000-8000-000000000081', 'c1640000-0000-4000-8000-000000000010', 'student-renamed-164@example.invalid');
  end if;
  foreach v_invitation in array case when v_final_removal then
    array['c1640000-0000-4000-8000-000000000080'::uuid]
  else array[
    'c1640000-0000-4000-8000-000000000080'::uuid,
    'c1640000-0000-4000-8000-000000000081'::uuid
  ] end loop
    v_result := public.remove_classroom_roster_entries_atomic(
      'c1640000-0000-4000-8000-000000000010', array[v_invitation, v_invitation]);
    if v_result <> '{"requested_count":1,"deleted_roster_entries":1,"deleted_entries":0,"deleted_assignment_docs":0,"deleted_enrollments":0,"deleted_gradebook_score_overrides":0,"deleted_gradebook_item_scores":0}'::jsonb
      or exists (select 1 from public.classroom_roster where id = v_invitation)
    then raise exception 'Legacy invitation deletion changed the wrong data: %', v_result; end if;
    select jsonb_build_object(
      'work', (select to_jsonb(e) from public.entries e where id = 'c1640000-0000-4000-8000-000000000013'),
      'score', (select to_jsonb(s) from public.gradebook_item_scores s where id = 'c1640000-0000-4000-8000-000000000015'),
      'override', (select to_jsonb(o) from public.gradebook_score_overrides o where id = 'c1640000-0000-4000-8000-000000000016')
    ) into v_retained_after;
    if v_retained_after is distinct from v_retained_before then
      raise exception 'Legacy invitation deletion erased retained student work or marks';
    end if;
  end loop;

  if not v_final_removal then
  insert into public.classroom_roster (
    id, classroom_id, email, first_name, last_name, student_number,
    counselor_email, join_source
  ) values (
    'c1640000-0000-4000-8000-000000000023',
    'c1640000-0000-4000-8000-000000000010',
    'student-renamed-164@example.invalid',
    'Updated',
    'Student',
    'S-164-NEW',
    'counselor-renamed-164@example.invalid',
    'csv'
  );
  end if;

  begin
    insert into public.classroom_enrollments (classroom_id, student_id)
    values (
      'c1640000-0000-4000-8000-000000000010',
      'c1640000-0000-4000-8000-000000000003'
    );
    raise exception 'Expected direct re-enrollment denial';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> case when v_final_removal then 'student_class_data_pending_purge'
      else 'classroom_membership_removed_teacher_restore_required' end then raise; end if;
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

  if not v_final_removal then
  v_result := public.restore_removed_classroom_students(
    'c1640000-0000-4000-8000-000000000001',
    'c1640000-0000-4000-8000-000000000010',
    array[' STUDENT-RENAMED-164@EXAMPLE.INVALID ', 'inactive-164@example.invalid']
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
      and email = 'student-renamed-164@example.invalid'
      and first_name = 'Updated'
      and last_name = 'Student'
      and student_number = 'S-164-NEW'
      and counselor_email = 'counselor-renamed-164@example.invalid'
      and join_source = 'csv'
      and removed_at is null
      and removed_student_id is null
      and retained_manual_attendance_marks is null
  ) then
    raise exception 'Restore did not merge the explicit re-add metadata';
  end if;
  if exists (
    select 1 from public.classroom_roster
    where id = 'c1640000-0000-4000-8000-000000000023'
  ) or (
    select count(*) from public.classroom_roster
    where classroom_id = 'c1640000-0000-4000-8000-000000000010'
      and lower(btrim(email)) = 'student-renamed-164@example.invalid'
  ) <> 1 then
    raise exception 'Restore did not merge the unbound re-add placeholder';
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
  else
    begin
      perform public.restore_removed_classroom_students(
        'c1640000-0000-4000-8000-000000000001', 'c1640000-0000-4000-8000-000000000010',
        array[' STUDENT-RENAMED-164@EXAMPLE.INVALID ', 'inactive-164@example.invalid']);
      raise exception 'Retired restoration RPC restored a removed learner';
    exception when object_not_in_prerequisite_state then
      if sqlerrm <> 'student_class_data_pending_purge' then raise; end if;
    end;
    begin
      insert into public.classroom_roster (classroom_id, email) values
        ('c1640000-0000-4000-8000-000000000010', 'new-batch-165@example.invalid'),
        ('c1640000-0000-4000-8000-000000000010', 'student-renamed-164@example.invalid');
      raise exception 'Re-add admitted a removed learner under the changed email';
    exception when object_not_in_prerequisite_state then
      if sqlerrm <> 'student_class_data_pending_purge' then raise; end if;
    end;
    if exists (select 1 from public.classroom_roster where email = 'new-batch-165@example.invalid') then
      raise exception 'Blocked batch partially added an invitation';
    end if;
    begin
      update public.classroom_roster set first_name = 'Overwritten'
      where id = 'c1640000-0000-4000-8000-000000000011';
      raise exception 'Re-add updated retained history';
    exception when object_not_in_prerequisite_state then
      if sqlerrm <> 'student_class_data_pending_purge' then raise; end if;
    end;
    begin
      perform set_config('pika.classroom_membership_restore', 'on', true);
      insert into public.classroom_enrollments (classroom_id, student_id) values
        ('c1640000-0000-4000-8000-000000000010', 'c1640000-0000-4000-8000-000000000003');
      raise exception 'Retired restore setting bypassed final removal';
    exception when object_not_in_prerequisite_state then
      if sqlerrm <> 'student_class_data_pending_purge' then raise; end if;
    end;
    select jsonb_build_object(
      'work', (select to_jsonb(e) from public.entries e where id = 'c1640000-0000-4000-8000-000000000013'),
      'score', (select to_jsonb(s) from public.gradebook_item_scores s where id = 'c1640000-0000-4000-8000-000000000015'),
      'override', (select to_jsonb(o) from public.gradebook_score_overrides o where id = 'c1640000-0000-4000-8000-000000000016')
    ) into v_retained_after;
    if v_retained_after is distinct from v_retained_before then
      raise exception 'Final removal or failed re-add erased retained records';
    end if;
  end if;

  -- A removed membership remains removed across hot-to-cold-to-hot archive,
  -- while retained roster metadata and grades round-trip byte-for-byte.
  -- Preserve the unbound overlap without disabling triggers or applying SQL.
  if exists (select 1 from public.classroom_roster_student_bindings
    where roster_id = current_setting('pika.removal_test_placeholder_id')::uuid)
  then raise exception 'Legacy overlap fixture must be unbound'; end if;
  select to_jsonb(roster) into strict v_original_placeholder
  from public.classroom_roster roster
  where roster.id = current_setting('pika.removal_test_placeholder_id')::uuid;
  v_result := public.remove_classroom_students_preserving_data(
    'c1640000-0000-4000-8000-000000000001',
    'c1640000-0000-4000-8000-000000000041',
    array['c1640000-0000-4000-8000-000000000042'::uuid]
  );
  if v_result <> '{"removed_count":1,"requested_count":1}'::jsonb then
    raise exception 'Archive-fixture removal failed: %', v_result;
  end if;
  select to_jsonb(roster) into strict v_original_roster
  from public.classroom_roster roster
  where roster.id = 'c1640000-0000-4000-8000-000000000042';
  select to_jsonb(score) into strict v_original_score
  from public.gradebook_item_scores score
  where score.id = 'c1640000-0000-4000-8000-000000000045';
  select to_jsonb(override_row) into strict v_original_override
  from public.gradebook_score_overrides override_row
  where override_row.id = 'c1640000-0000-4000-8000-000000000046';
  if exists (
    select 1 from public.classroom_enrollments
    where id = 'c1640000-0000-4000-8000-000000000043'
  ) then
    raise exception 'Archive-fixture removal retained enrollment';
  end if;
  update public.users
  set email = 'archive-164@example.invalid'
  where id = 'c1640000-0000-4000-8000-000000000002';
  begin
    perform public.restore_removed_classroom_students(
      'c1640000-0000-4000-8000-000000000001',
      'c1640000-0000-4000-8000-000000000041',
      array['archive-164@example.invalid']
    );
    raise exception 'Expected teacher-owned reused-email identity conflict';
  exception when invalid_parameter_value or object_not_in_prerequisite_state then
    if sqlerrm <> case when v_final_removal then 'student_class_data_pending_purge'
      else 'classroom_roster_restore_identity_conflict' end then raise; end if;
  end;
  if exists (
    select 1 from public.classroom_enrollments
    where id = 'c1640000-0000-4000-8000-000000000043'
  ) then
    raise exception 'Teacher-owned reused email restored a retained student';
  end if;
  update public.users
  set email = 'other-owner-164@example.invalid'
  where id = 'c1640000-0000-4000-8000-000000000002';
  update public.users
  set email = 'archive-164@example.invalid'
  where id = 'c1640000-0000-4000-8000-000000000051';
  begin
    perform public.restore_removed_classroom_students(
      'c1640000-0000-4000-8000-000000000001',
      'c1640000-0000-4000-8000-000000000041',
      array['archive-164@example.invalid']
    );
    raise exception 'Expected reused-email identity conflict';
  exception when invalid_parameter_value or object_not_in_prerequisite_state then
    if sqlerrm <> case when v_final_removal then 'student_class_data_pending_purge'
      else 'classroom_roster_restore_identity_conflict' end then raise; end if;
  end;
  if exists (
    select 1 from public.classroom_enrollments
    where id = 'c1640000-0000-4000-8000-000000000043'
  ) then
    raise exception 'Reused email restored a different retained identity';
  end if;
  update public.users
  set email = 'reuse-holder-164@example.invalid'
  where id = 'c1640000-0000-4000-8000-000000000051';
  if not exists (
    select 1 from public.classroom_enrollments
    where id = 'c1640000-0000-4000-8000-000000000049'
  ) or not exists (
    select 1 from public.entries
    where id = 'c1640000-0000-4000-8000-000000000050'
  ) then
    raise exception 'Removal changed the same learner in another classroom';
  end if;

  update public.classrooms
  set archived_at = clock_timestamp()
  where id = 'c1640000-0000-4000-8000-000000000041';
  v_actors := jsonb_build_array(
    jsonb_build_object(
      'actor_id', 'c1640000-0000-4000-8000-000000000001'::uuid,
      'role', 'teacher'
    ),
    jsonb_build_object(
      'actor_id', 'c1640000-0000-4000-8000-000000000040'::uuid,
      'role', 'student'
    )
  );
  v_result := public.begin_classroom_archive_export_v2(
    v_export_id,
    'c1640000-0000-4000-8000-000000000001',
    'c1640000-0000-4000-8000-000000000041',
    repeat('a', 64),
    '164_student_classroom_removal',
    'abcdef1',
    '{"mode":"teacher_managed","delete_after":null}'::jsonb,
    2,
    2
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Removed-student archive begin failed: %', v_result;
  end if;
  v_counts := v_result->'resource_counts';
  if v_counts->>'classroom_roster' <> '2'
    or v_counts->>'classroom_enrollments' <> '0'
    or v_counts->>'gradebook_item_scores' <> '1'
    or v_counts->>'gradebook_score_overrides' <> '1'
  then
    raise exception 'Removed-student archive inventory is incomplete: %', v_counts;
  end if;
  for v_resource in
    select *
    from public.classroom_archive_resource_contract_versions
    where format_version = 2
    order by export_position
  loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(source) order by source.%I), ''[]''::jsonb) '
      || 'from public.%I source '
      || 'where public.resolve_classroom_archive_resource_classroom_id(%L, source.%I) = $1',
      v_resource.primary_key_columns[1],
      v_resource.table_name,
      v_resource.table_name,
      v_resource.primary_key_columns[1]
    ) into v_rows using 'c1640000-0000-4000-8000-000000000041'::uuid;
    insert into removal_archive_rows values (v_resource.table_name, v_rows);
  end loop;
  v_archive_path := format(
    '%s/%s/%s/classroom-v2.tar.gz',
    'c1640000-0000-4000-8000-000000000001',
    'c1640000-0000-4000-8000-000000000041',
    v_export_id
  );
  if not public.stage_classroom_archive_object_upload(
    v_export_id,
    'c1640000-0000-4000-8000-000000000001',
    'classroom-archives',
    v_archive_path,
    repeat('b', 64),
    1024
  ) then
    raise exception 'Removed-student archive staging failed';
  end if;
  v_result := public.complete_classroom_archive_export_v2(
    v_export_id,
    'c1640000-0000-4000-8000-000000000001',
    'classroom-archives',
    v_archive_path,
    repeat('b', 64),
    repeat('c', 64),
    1024,
    4096,
    v_counts,
    2,
    v_counts,
    '{"total_count":0,"total_bytes":0,"by_bucket":{}}'::jsonb,
    '{"read_back_verified":true,"artifact_checksum_verified":true,"manifest_verified":true,"resource_checksums_verified":true,"resource_counts_verified":true,"storage_objects_verified":true,"actor_snapshots_verified":true}'::jsonb
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Removed-student archive finalize failed: %', v_result;
  end if;
  v_result := public.begin_classroom_archive_compaction_v2(
    v_compact_id,
    'c1640000-0000-4000-8000-000000000001',
    'c1640000-0000-4000-8000-000000000041',
    v_export_id,
    repeat('d', 64),
    2
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Removed-student compaction begin failed: %', v_result;
  end if;
  for v_resource in select * from removal_archive_rows loop
    if jsonb_array_length(v_resource.rows) > 0 then
      perform public.stage_classroom_archive_restore_rows(
        v_compact_id,
        'c1640000-0000-4000-8000-000000000001',
        v_resource.table_name,
        v_resource.rows
      );
    end if;
  end loop;
  perform public.stage_classroom_archive_compaction_objects(
    v_compact_id,
    'c1640000-0000-4000-8000-000000000001',
    '[]'::jsonb
  );
  v_verification := jsonb_build_object(
    'operation_id', v_compact_id,
    'archive_id', v_export_id,
    'artifact_sha256', repeat('b', 64),
    'content_sha256', repeat('c', 64),
    'verified_at', clock_timestamp(),
    'read_back_verified', true,
    'artifact_checksum_verified', true,
    'manifest_verified', true,
    'resource_checksums_verified', true,
    'resource_counts_verified', true,
    'storage_objects_verified', true,
    'actor_snapshots_verified', true,
    'schema_adapter_verified', true,
    'actor_references_resolved', true,
    'source_object_cleanup_staged', true
  );
  v_result := public.complete_classroom_archive_compaction_v2(
    v_compact_id,
    'c1640000-0000-4000-8000-000000000001',
    v_actors,
    v_verification,
    2
  );
  if not coalesce((v_result->>'ok')::boolean, false)
    or exists (
      select 1 from public.classrooms
      where id = 'c1640000-0000-4000-8000-000000000041'
    )
  then
    raise exception 'Removed-student compaction failed: %', v_result;
  end if;
  if not exists (
    select 1 from public.classroom_enrollments
    where id = 'c1640000-0000-4000-8000-000000000049'
  ) or not exists (
    select 1 from public.entries
    where id = 'c1640000-0000-4000-8000-000000000050'
  ) then
    raise exception 'Compaction changed the same learner in another classroom';
  end if;
  v_result := public.begin_classroom_archive_restore_v2(
    v_restore_id,
    'c1640000-0000-4000-8000-000000000001',
    'c1640000-0000-4000-8000-000000000041',
    v_export_id,
    repeat('e', 64),
    '164_student_classroom_removal',
    '[]'::jsonb,
    v_counts,
    '[]'::jsonb,
    2147483648,
    2,
    2,
    v_counts
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Removed-student restore begin failed: %', v_result;
  end if;
  for v_resource in select * from removal_archive_rows loop
    if jsonb_array_length(v_resource.rows) > 0 then
      perform public.stage_classroom_archive_restore_rows_v2(
        v_restore_id,
        'c1640000-0000-4000-8000-000000000001',
        v_resource.table_name,
        v_resource.rows,
        2
      );
    end if;
  end loop;
  v_result := public.complete_classroom_archive_restore_v2(
    v_restore_id,
    'c1640000-0000-4000-8000-000000000001',
    '{"archive_checksum_verified":true,"manifest_verified":true,"resource_checksums_verified":true,"resource_counts_verified":true,"storage_objects_verified":true,"actor_snapshots_verified":true,"schema_adapter_available":true,"restored_storage_objects_verified":true,"adapter_chain":[]}'::jsonb,
    2
  );
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'Removed-student archive restore failed: %', v_result;
  end if;
  if (select to_jsonb(roster) from public.classroom_roster roster
      where roster.id = 'c1640000-0000-4000-8000-000000000042')
      is distinct from v_original_roster
    or (select to_jsonb(roster) from public.classroom_roster roster
      where roster.id = current_setting('pika.removal_test_placeholder_id')::uuid)
      is distinct from v_original_placeholder
    or (select to_jsonb(score) from public.gradebook_item_scores score
      where score.id = 'c1640000-0000-4000-8000-000000000045')
      is distinct from v_original_score
    or (select to_jsonb(override_row) from public.gradebook_score_overrides override_row
      where override_row.id = 'c1640000-0000-4000-8000-000000000046')
      is distinct from v_original_override
  then
    raise exception 'Archive roundtrip changed retained roster or grades';
  end if;
  if exists (
    select 1 from public.classroom_enrollments
    where id = 'c1640000-0000-4000-8000-000000000043'
  ) then
    raise exception 'Archive restore accidentally reenrolled the removed learner';
  end if;
  update public.classrooms
  set archived_at = null
  where id = 'c1640000-0000-4000-8000-000000000041';
  if not v_final_removal then
  v_result := public.restore_removed_classroom_students(
    'c1640000-0000-4000-8000-000000000001',
    'c1640000-0000-4000-8000-000000000041',
    array['archive-164@example.invalid']
  );
  if v_result <> '{"requested_count":1,"restored_count":1}'::jsonb
    or not exists (
      select 1 from public.classroom_enrollments
      where id = 'c1640000-0000-4000-8000-000000000043'
        and student_id = 'c1640000-0000-4000-8000-000000000040'
        and created_at = '2026-08-20T14:00:00Z'
        and manual_attendance_marks = '{"2026-08-21":"absent"}'::jsonb
    )
  then
    raise exception 'Explicit post-archive membership restore changed metadata: %', v_result;
  end if;
  else
    begin
      insert into public.classroom_enrollments (classroom_id, student_id) values (
        'c1640000-0000-4000-8000-000000000041', 'c1640000-0000-4000-8000-000000000040');
      raise exception 'Archive placeholder allowed removed-student re-enrollment';
    exception when object_not_in_prerequisite_state then
      if sqlerrm <> 'student_class_data_pending_purge' then raise; end if;
    end;
    begin
      perform public.restore_removed_classroom_students(
        'c1640000-0000-4000-8000-000000000001', 'c1640000-0000-4000-8000-000000000041',
        array['archive-164@example.invalid']);
      raise exception 'Archive roundtrip made removed membership recoverable';
    exception when object_not_in_prerequisite_state then
      if sqlerrm <> 'student_class_data_pending_purge' then raise; end if;
    end;
  end if;
  if not exists (
    select 1 from public.classroom_enrollments
    where id = 'c1640000-0000-4000-8000-000000000049'
  ) or not exists (
    select 1 from public.entries
    where id = 'c1640000-0000-4000-8000-000000000050'
  ) then
    raise exception 'Archive restore changed the same learner in another classroom';
  end if;
end;
$behavior$;

rollback;
