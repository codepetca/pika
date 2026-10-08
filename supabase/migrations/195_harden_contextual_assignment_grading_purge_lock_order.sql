-- Prevent reverse-order deadlocks between contextual grading and the
-- individual-student purge subject -> Classroom lock order.

begin;

create or replace function public.save_assignment_grades_for_owner_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_student_ids uuid[],
  p_expected_doc_updated_at_by_student jsonb,
  p_apply_grade boolean,
  p_score_completion integer,
  p_score_thinking integer,
  p_score_workflow integer,
  p_mark_graded boolean,
  p_apply_comments boolean,
  p_feedback text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_archived_at timestamptz;
  v_assignment_classroom_id uuid;
  v_blueprint_archived_at timestamptz;
  v_initial_classroom_id uuid;
  v_owner_id uuid;
  v_student_id uuid;
begin
  if p_actor_id is null or p_assignment_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment grading request';
  end if;

  -- Preserve the grading/return family lock as the narrow first fence.
  perform pg_advisory_xact_lock(hashtextextended(p_assignment_id::text, 0));

  -- Discover only the Classroom-operation namespace. Binding and authority are
  -- read again below while both parent rows are locked.
  select assignment.classroom_id
  into v_initial_classroom_id
  from public.assignments as assignment
  where assignment.id = p_assignment_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );

  -- Student purge takes subject -> Classroom -> pair. This transaction already
  -- owns Classroom, so every target subject/pair must be acquired nonblocking.
  -- A started purge wins and this transaction rolls back instead of deadlocking.
  for v_student_id in
    select distinct requested.student_id
    from unnest(p_student_ids) as requested(student_id)
    order by requested.student_id
  loop
    perform private.try_lock_classroom_membership_change(
      v_initial_classroom_id,
      v_student_id
    );
  end loop;

  select
    assignment.classroom_id,
    assignment.blueprint_archived_at,
    classroom.teacher_id,
    classroom.archived_at
  into
    v_assignment_classroom_id,
    v_blueprint_archived_at,
    v_owner_id,
    v_archived_at
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for update of classroom, assignment;

  if not found or v_assignment_classroom_id is distinct from v_initial_classroom_id then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;
  if v_owner_id is distinct from p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;
  if v_archived_at is not null or v_blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'assignment_grading_archived';
  end if;

  return public.save_assignment_grades_atomic(
    p_assignment_id,
    p_student_ids,
    p_actor_id,
    p_expected_doc_updated_at_by_student,
    p_apply_grade,
    p_score_completion,
    p_score_thinking,
    p_score_workflow,
    p_mark_graded,
    p_apply_comments,
    p_feedback,
    p_now
  );
end;
$function$;

revoke all on function public.save_assignment_grades_for_owner_v1(
  uuid, uuid, uuid[], jsonb, boolean, integer, integer, integer,
  boolean, boolean, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.save_assignment_grades_for_owner_v1(
  uuid, uuid, uuid[], jsonb, boolean, integer, integer, integer,
  boolean, boolean, text, timestamptz
) to service_role;

comment on function public.save_assignment_grades_for_owner_v1(
  uuid, uuid, uuid[], jsonb, boolean, integer, integer, integer,
  boolean, boolean, text, timestamptz
) is
  'Fences owner and per-student purge lifecycle before delegating one manual grade save.';

commit;
