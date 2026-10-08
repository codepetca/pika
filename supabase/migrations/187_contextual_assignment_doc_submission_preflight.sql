-- Keep contextual submit UX preflight evidence behind the same transaction-time
-- membership and visibility boundary as the eventual mutation. The submit RPC
-- still rechecks every authorization parent before writing.

begin;

create function public.prepare_assignment_doc_submission_for_member_v1(
  p_actor_id uuid,
  p_assignment_id uuid
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
  v_assignment_due_at timestamptz;
  v_archived_at timestamptz;
  v_doc public.assignment_docs;
  v_requirements jsonb;
  v_artifacts jsonb;
begin
  if p_actor_id is null or p_assignment_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment submission preflight request';
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
    assignment.due_at,
    classroom.archived_at
  into
    v_assignment_classroom_id,
    v_assignment_is_draft,
    v_assignment_released_at,
    v_assignment_due_at,
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
  for share;

  select coalesce(jsonb_agg(to_jsonb(requirement) order by requirement.position, requirement.created_at), '[]'::jsonb)
  into v_requirements
  from public.assignment_submission_requirements as requirement
  where requirement.assignment_id = p_assignment_id;

  if v_doc.id is null then
    v_artifacts := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(to_jsonb(artifact) order by artifact.created_at), '[]'::jsonb)
    into v_artifacts
    from public.assignment_submission_artifacts as artifact
    where artifact.assignment_doc_id = v_doc.id
      and artifact.student_id = p_actor_id;
  end if;

  return jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', p_assignment_id,
      'classroom_id', v_assignment_classroom_id,
      'due_at', v_assignment_due_at
    ),
    'doc', case
      when v_doc.id is null then null::jsonb
      else jsonb_build_object(
        'id', v_doc.id,
        'assignment_id', v_doc.assignment_id,
        'student_id', v_doc.student_id,
        'content', v_doc.content,
        'is_submitted', v_doc.is_submitted,
        'submitted_at', v_doc.submitted_at,
        'updated_at', v_doc.updated_at,
        'returned_at', v_doc.returned_at,
        'teacher_cleared_at', v_doc.teacher_cleared_at
      )
    end,
    'submission_requirements', v_requirements,
    'submission_artifacts', v_artifacts
  );
end;
$function$;

revoke all on function public.prepare_assignment_doc_submission_for_member_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_assignment_doc_submission_for_member_v1(uuid, uuid)
  to service_role;

comment on function public.prepare_assignment_doc_submission_for_member_v1(uuid, uuid) is
  'Dormant service-only submit preflight with locked current membership and assignment visibility.';

commit;
