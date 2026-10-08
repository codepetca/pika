-- Add a dormant transactional boundary for a classroom member saving their own
-- assignment document. Applying this migration changes no rows and does not
-- route any request through the function; API admission remains separately gated.

begin;

create function public.save_assignment_doc_for_member_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_trigger text,
  p_paste_word_count integer,
  p_keystroke_count integer,
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
  v_result jsonb;
begin
  if p_actor_id is null or p_assignment_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment save request';
  end if;

  -- This unlocked lookup discovers only the advisory-lock namespace. The
  -- assignment and classroom are read again under locks before authorization.
  select assignment.classroom_id
  into v_initial_classroom_id
  from public.assignments as assignment
  where assignment.id = p_assignment_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment not found';
  end if;

  -- Match the assignment-open and membership-removal lock order. Ordinary
  -- saves queue briefly on a classroom operation; subject/pair contention is
  -- retryable rather than deadlocking with a student purge.
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
  for update of classroom, assignment;

  if not found
    or v_assignment_classroom_id is distinct from v_initial_classroom_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  -- Keep unpublished and archived work concealed on the learner boundary.
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

  -- Reuse the established revision, idempotency, history and metric ledger
  -- transaction while the live membership and assignment parents stay locked.
  v_result := public.save_assignment_doc_atomic(
    p_assignment_id,
    p_actor_id,
    p_content,
    p_expected_updated_at,
    p_trigger,
    p_paste_word_count,
    p_keystroke_count,
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
    raise exception using errcode = '22023', message = 'Invalid assignment save result';
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
    raise exception using errcode = '22023', message = 'Invalid assignment save result';
  end if;

  return v_result;
end;
$function$;

revoke all on function public.save_assignment_doc_for_member_v1(
  uuid, uuid, jsonb, timestamptz, text, integer, integer,
  jsonb, jsonb, integer, integer, uuid, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.save_assignment_doc_for_member_v1(
  uuid, uuid, jsonb, timestamptz, text, integer, integer,
  jsonb, jsonb, integer, integer, uuid, bigint, uuid
) to service_role;

comment on function public.save_assignment_doc_for_member_v1(
  uuid, uuid, jsonb, timestamptz, text, integer, integer,
  jsonb, jsonb, integer, integer, uuid, bigint, uuid
) is
  'Dormant service-only assignment save boundary: holds current membership and live assignment locks around the established atomic save.';

commit;
