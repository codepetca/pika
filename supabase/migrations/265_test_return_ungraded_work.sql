-- Return existing Test work once student access is closed, including ungraded
-- and teacher-closed unsubmitted attempts. Returning work does not submit it.
-- Grading completeness still controls aggregate Grades eligibility separately.
set lock_timeout = '5s';
set statement_timeout = '30s';

-- Compatibility hook retained for the current grade-save and grade-clear RPCs.
-- Those writers no longer retract an explicit Return because scores are missing.
-- Explicit reopen, unsubmit and delete keep their existing lifecycle transitions.
create or replace function private.revoke_incomplete_test_returns(p_test_id uuid, p_student_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform p_test_id, p_student_ids;
end;
$$;
revoke all on function private.revoke_incomplete_test_returns(uuid, uuid[]) from public, anon, authenticated, service_role;

create or replace function public.return_test_attempts_checked_atomic(p_test_id uuid, p_student_ids uuid[], p_returned_by uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_test public.tests%rowtype; v_ids uuid[]; v_eligible uuid[]; v_returned integer := 0; v_already integer := 0;
begin
  if p_returned_by is null or p_student_ids is null or cardinality(p_student_ids) < 1 or cardinality(p_student_ids) > 100
    or array_position(p_student_ids, null) is not null then
    raise exception 'student_ids array is required (maximum 100)' using errcode = '22023';
  end if;
  select array_agg(distinct id order by id) into v_ids from unnest(p_student_ids) id;
  v_test := private.lock_test_lifecycle(p_test_id);
  perform 1 from public.classrooms where id = v_test.classroom_id and teacher_id = p_returned_by and archived_at is null;
  if not found then raise exception 'Test return is not allowed' using errcode = '42501'; end if;
  if v_test.status = 'draft' then raise exception 'Cannot return work for a draft test' using errcode = '22023'; end if;
  perform 1 from public.classroom_enrollments where classroom_id = v_test.classroom_id and student_id = any(v_ids) order by student_id for share;
  if (select count(*) from public.classroom_enrollments where classroom_id = v_test.classroom_id and student_id = any(v_ids)) <> cardinality(v_ids) then
    raise exception 'One or more selected students are not enrolled in this classroom' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_ids) selected(student_id) left join public.test_student_availability access on access.test_id = p_test_id and access.student_id = selected.student_id
    where coalesce(access.state, case when v_test.status = 'active' then 'open' else 'closed' end) = 'open') then
    raise exception 'Close selected students before returning their test work.' using errcode = 'PT409';
  end if;
  -- Access is closed for every selected student. Finalize existing unfinished
  -- attempts for either global or selected-student closure; never create work
  -- for students who did not start. Replays preserve closed/returned attempts.
  perform public.finalize_test_attempts_for_grading_atomic(p_test_id, v_ids, p_returned_by);
  perform 1 from public.test_attempts where test_id = p_test_id and student_id = any(v_ids) order by student_id for update;
  perform 1 from public.test_responses where test_id = p_test_id and student_id = any(v_ids) order by id for update;
  -- Return discloses existing closed work independently of grading completeness.
  -- Student submission and teacher closure remain distinct participation states.
  select coalesce(array_agg(attempt.student_id order by attempt.student_id), array[]::uuid[]) into v_eligible
  from public.test_attempts attempt
  where attempt.test_id = p_test_id and attempt.student_id = any(v_ids)
    and (attempt.is_submitted or attempt.closed_for_grading_at is not null)
    and exists (select 1 from public.test_questions where test_id = p_test_id);
  select count(*) into v_already from public.test_attempts where test_id = p_test_id and student_id = any(v_eligible) and returned_at is not null;
  -- Preserve migration104's AFTER returned_at review finalizer. Its metadata-
  -- only response updates are excluded by stamp_test_response_revision; do not
  -- duplicate that trigger with a second review/revision writer here.
  update public.test_attempts set returned_at = clock_timestamp(), returned_by = p_returned_by
    where test_id = p_test_id and student_id = any(v_eligible) and returned_at is null;
  get diagnostics v_returned = row_count;
  return jsonb_build_object('returned_count', v_returned, 'already_returned_count', v_already,
    'skipped_count', cardinality(v_ids) - cardinality(v_eligible), 'test_closed', false);
end;
$$;

revoke all on function public.return_test_attempts_checked_atomic(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.return_test_attempts_checked_atomic(uuid, uuid[], uuid) to service_role;

reset lock_timeout;
reset statement_timeout;
