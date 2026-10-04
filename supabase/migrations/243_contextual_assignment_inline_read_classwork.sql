-- Conceal only nonowner inline-image reads from locked Classwork visibility.
-- Complete latest 213 definition and owner inspection semantics are preserved.
-- Candidate 243 is unapplied; no activation or application changes.

begin;

create or replace function public.read_assignment_inline_image_for_context_v1(
  p_actor_id uuid,
  p_expected_classroom_id uuid,
  p_assignment_doc_id uuid,
  p_managed_object_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_initial_assignment_id uuid;
  v_initial_classroom_id uuid;
  v_subject_id uuid;
  v_assignment_classroom_id uuid;
  v_teacher_id uuid;
  v_assignment_is_draft boolean;
  v_assignment_released_at timestamptz;
  v_archived_at timestamptz;
  v_feature_visibility jsonb;
  v_is_owner boolean;
  v_current_assignment_id uuid;
  v_current_subject_id uuid;
  v_object public.managed_storage_objects%rowtype;
begin
  if p_actor_id is null or p_expected_classroom_id is null or p_assignment_doc_id is null or p_managed_object_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment image request';
  end if;

  select document.assignment_id, assignment.classroom_id, document.student_id
  into v_initial_assignment_id, v_initial_classroom_id, v_subject_id
  from public.assignment_docs as document
  join public.assignments as assignment on assignment.id = document.assignment_id
  where document.id = p_assignment_doc_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment document not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || v_initial_assignment_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(v_initial_assignment_id::text || ':' || v_subject_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  perform private.try_lock_classroom_membership_change(v_initial_classroom_id, v_subject_id);

  select assignment.classroom_id, classroom.teacher_id, assignment.is_draft,
    assignment.released_at, classroom.archived_at, classroom.feature_visibility
  into v_assignment_classroom_id, v_teacher_id, v_assignment_is_draft,
    v_assignment_released_at, v_archived_at, v_feature_visibility
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = v_initial_assignment_id
  for share of classroom, assignment;
  if not found or v_assignment_classroom_id is distinct from v_initial_classroom_id then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;
  if v_assignment_classroom_id is distinct from p_expected_classroom_id then
    raise exception using errcode = '40001', message = 'Assignment classroom changed';
  end if;

  select document.assignment_id, document.student_id
  into v_current_assignment_id, v_current_subject_id
  from public.assignment_docs as document
  where document.id = p_assignment_doc_id
  for share;
  if not found
    or v_current_assignment_id is distinct from v_initial_assignment_id
    or v_current_subject_id is distinct from v_subject_id
  then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Image not found');
  end if;

  v_is_owner := v_teacher_id = p_actor_id;
  if not v_is_owner then
    if p_actor_id is distinct from v_subject_id
      or v_archived_at is not null
      or v_assignment_is_draft
      or v_assignment_released_at > clock_timestamp()
      -- Match normalization: only an object with JSON boolean false hides Classwork.
      or (jsonb_typeof(v_feature_visibility) = 'object'
        and v_feature_visibility->'classwork' = 'false'::jsonb)
    then
      return jsonb_build_object('ok', false, 'status', 404, 'error', 'Image not found');
    end if;
  end if;

  -- Owners retain the canonical history/detail behaviour: their inspected
  -- subject must still be enrolled, even for archived Classrooms.
  perform 1 from public.classroom_enrollments as enrollment
  where enrollment.classroom_id = v_assignment_classroom_id
    and enrollment.student_id = v_subject_id
  for share;
  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Image not found');
  end if;

  select * into v_object from public.managed_storage_objects as object
  where object.id = p_managed_object_id
  for share;
  if not found
    or v_object.storage_bucket <> 'submission-images'
    or v_object.purpose <> 'student_inline_image'
    or v_object.classroom_id is distinct from v_assignment_classroom_id
    or v_object.created_by_user_id is distinct from v_subject_id
    or v_object.data_subject_user_id is distinct from v_subject_id
    or v_object.resource_type <> 'assignment_doc'
    or v_object.resource_id is distinct from p_assignment_doc_id
    or (v_is_owner and v_object.status <> 'ready')
    or (not v_is_owner and (
      v_object.created_by_user_id is distinct from p_actor_id
      or v_object.status not in ('verified', 'ready')
    ))
  then
    return jsonb_build_object('ok', false, 'status', 404, 'error', 'Image not found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'classroom_id', v_assignment_classroom_id,
    'assignment_id', v_initial_assignment_id,
    'assignment_doc_id', p_assignment_doc_id,
    'managed_object_id', p_managed_object_id
  );
end;
$function$;

revoke all on function public.read_assignment_inline_image_for_context_v1(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_assignment_inline_image_for_context_v1(uuid, uuid, uuid, uuid)
  to service_role;

commit;
