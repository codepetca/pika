-- Add dormant, service-only contextual boundaries for assignment-document
-- history reads and member restores. Both functions serialize document access
-- before taking classroom/member fences so they share the established
-- save/submit/removal lock order.

begin;

create function public.get_assignment_doc_history_for_actor_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_requested_student_id uuid default null,
  p_member_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_initial_classroom_id uuid;
  v_initial_teacher_id uuid;
  v_subject_id uuid;
  v_assignment_classroom_id uuid;
  v_assignment_is_draft boolean;
  v_assignment_released_at timestamptz;
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_access_mode text;
  v_doc public.assignment_docs;
  v_history jsonb := '[]'::jsonb;
begin
  if p_actor_id is null or p_assignment_id is null or p_member_only is null then
    raise exception using errcode = '22023', message = 'Invalid assignment history request';
  end if;

  -- This first read selects only the lock namespace and document subject. The
  -- relationship and visibility decisions are repeated after all fences.
  select assignment.classroom_id, classroom.teacher_id
  into v_initial_classroom_id, v_initial_teacher_id
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  if not p_member_only and v_initial_teacher_id = p_actor_id then
    if p_requested_student_id is null then
      raise exception using errcode = '22023', message = 'student_id is required';
    end if;
    v_subject_id := p_requested_student_id;
  else
    v_subject_id := p_actor_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(p_assignment_id::text || ':' || v_subject_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  perform private.try_lock_classroom_membership_change(
    v_initial_classroom_id,
    v_subject_id
  );

  select
    assignment.classroom_id,
    assignment.is_draft,
    assignment.released_at,
    classroom.teacher_id,
    classroom.archived_at
  into
    v_assignment_classroom_id,
    v_assignment_is_draft,
    v_assignment_released_at,
    v_teacher_id,
    v_archived_at
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for share of classroom, assignment;

  if not found
    or v_assignment_classroom_id is distinct from v_initial_classroom_id
    or v_teacher_id is distinct from v_initial_teacher_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  if not p_member_only and v_teacher_id = p_actor_id then
    v_access_mode := 'owner';
  else
    v_access_mode := 'member';
    if v_archived_at is not null
      or v_assignment_is_draft
      or v_assignment_released_at > clock_timestamp()
    then
      raise exception using errcode = 'P0002', message = 'Assignment not found';
    end if;
  end if;

  perform 1
  from public.classroom_enrollments as enrollment
  where enrollment.classroom_id = v_assignment_classroom_id
    and enrollment.student_id = v_subject_id
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  select doc.*
  into v_doc
  from public.assignment_docs as doc
  where doc.assignment_id = p_assignment_id
    and doc.student_id = v_subject_id
  for share;

  if v_doc.id is not null then
    select coalesce(
      jsonb_agg(to_jsonb(history) order by history.created_at, history.id),
      '[]'::jsonb
    )
    into v_history
    from public.assignment_doc_history as history
    where history.assignment_doc_id = v_doc.id;
  end if;

  return jsonb_build_object(
    'access_mode', v_access_mode,
    'assignment', jsonb_build_object(
      'id', p_assignment_id,
      'classroom_id', v_assignment_classroom_id
    ),
    'subject_id', v_subject_id,
    'doc', case
      when v_doc.id is null then null::jsonb
      else jsonb_build_object(
        'id', v_doc.id,
        'assignment_id', v_doc.assignment_id,
        'student_id', v_doc.student_id,
        'content', v_doc.content,
        'is_submitted', v_doc.is_submitted,
        'updated_at', v_doc.updated_at
      )
    end,
    'history', v_history
  );
end;
$function$;

revoke all on function public.get_assignment_doc_history_for_actor_v1(
  uuid, uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.get_assignment_doc_history_for_actor_v1(
  uuid, uuid, uuid, boolean
) to service_role;

comment on function public.get_assignment_doc_history_for_actor_v1(
  uuid, uuid, uuid, boolean
) is
  'Dormant service-only owner/member assignment history read with locked relationship, visibility and document evidence.';

create function public.restore_assignment_doc_for_member_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_history_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_snapshot jsonb,
  p_word_count integer,
  p_char_count integer,
  p_save_session_id uuid,
  p_save_sequence bigint,
  p_metric_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_initial_classroom_id uuid;
  v_assignment_classroom_id uuid;
  v_assignment_is_draft boolean;
  v_assignment_released_at timestamptz;
  v_archived_at timestamptz;
  v_doc public.assignment_docs;
  v_result jsonb;
begin
  if p_actor_id is null
    or p_assignment_id is null
    or p_history_id is null
    or p_content is null
    or p_expected_updated_at is null
    or p_save_session_id is null
    or p_save_sequence is null
    or p_save_sequence <= 0
    or p_metric_session_id is null
  then
    raise exception using errcode = '22023', message = 'Invalid assignment restore request';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(p_assignment_id::text || ':' || p_actor_id::text, 0)
  );

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
  perform private.try_lock_classroom_membership_change(
    v_initial_classroom_id,
    p_actor_id
  );

  select
    assignment.classroom_id,
    assignment.is_draft,
    assignment.released_at,
    classroom.archived_at
  into
    v_assignment_classroom_id,
    v_assignment_is_draft,
    v_assignment_released_at,
    v_archived_at
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for share of classroom, assignment;

  if not found
    or v_assignment_classroom_id is distinct from v_initial_classroom_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  if v_archived_at is not null
    or v_assignment_is_draft
    or v_assignment_released_at > clock_timestamp()
  then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  perform 1
  from public.classroom_enrollments as enrollment
  where enrollment.classroom_id = v_assignment_classroom_id
    and enrollment.student_id = p_actor_id
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  select doc.*
  into v_doc
  from public.assignment_docs as doc
  where doc.assignment_id = p_assignment_id
    and doc.student_id = p_actor_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment doc not found';
  end if;

  perform 1
  from public.assignment_doc_history as history
  where history.id = p_history_id
    and history.assignment_doc_id = v_doc.id
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'History entry not found';
  end if;

  v_result := public.save_assignment_doc_atomic(
    p_assignment_id,
    p_actor_id,
    p_content,
    p_expected_updated_at,
    'restore',
    0,
    0,
    p_patch,
    p_snapshot,
    p_word_count,
    p_char_count,
    p_save_session_id,
    p_save_sequence,
    p_metric_session_id
  );

  if jsonb_typeof(v_result) is distinct from 'object'
    or jsonb_typeof(v_result->'ok') is distinct from 'boolean'
  then
    raise exception using errcode = '22023', message = 'Invalid assignment restore result';
  end if;

  if (v_result->>'ok')::boolean and (
    v_result->'doc'->>'assignment_id' is distinct from p_assignment_id::text
    or v_result->'doc'->>'student_id' is distinct from p_actor_id::text
    or (
      v_result->'history_entry' is not null
      and v_result->'history_entry' <> 'null'::jsonb
      and v_result->'history_entry'->>'assignment_doc_id'
        is distinct from v_result->'doc'->>'id'
    )
  ) then
    raise exception using errcode = '22023', message = 'Invalid assignment restore result';
  end if;

  return v_result || jsonb_build_object('classroom_id', v_assignment_classroom_id);
end;
$function$;

revoke all on function public.restore_assignment_doc_for_member_v1(
  uuid, uuid, uuid, jsonb, timestamptz, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.restore_assignment_doc_for_member_v1(
  uuid, uuid, uuid, jsonb, timestamptz, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid
) to service_role;

comment on function public.restore_assignment_doc_for_member_v1(
  uuid, uuid, uuid, jsonb, timestamptz, jsonb, jsonb,
  integer, integer, uuid, bigint, uuid
) is
  'Dormant service-only assignment restore with current member, live assignment, exact history target and atomic save enforcement.';

commit;
