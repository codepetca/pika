-- Conceal contextual learner save/submission/preflight under locked Classwork visibility.
-- Preserve the four complete migration 214 definitions, lock order and service-only ACL.
-- Candidate 241 is unapplied; no admission, legacy RPC, data or Pal activation changes.

begin;

create or replace function public.save_assignment_doc_for_member_v1(
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
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_feature_visibility jsonb;
  v_result jsonb;
begin
  if p_actor_id is null or p_assignment_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment save request';
  end if;

  -- Match all existing assignment-document mutations before taking the broader
  -- classroom/member fences. Neither legacy fence depends on the other, so this
  -- fixed order safely queues behind either operation without holding a lock it
  -- needs later through an assignment_docs trigger.
  perform pg_advisory_xact_lock(
    hashtextextended('assignment_submission:' || p_assignment_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(p_assignment_id::text || ':' || p_actor_id::text, 0)
  );

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
    classroom.teacher_id,
    classroom.archived_at,
    classroom.feature_visibility
  into
    v_assignment_classroom_id,
    v_assignment_is_draft,
    v_assignment_released_at,
    v_teacher_id,
    v_archived_at,
    v_feature_visibility
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for update of classroom, assignment;

  if not found
    or v_assignment_classroom_id is distinct from v_initial_classroom_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  -- Ownership takes precedence over historical self-enrollment. The owner
  -- value comes from the classroom row already locked above.
  if v_teacher_id = p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  if v_archived_at is not null
    or v_assignment_is_draft
    or v_assignment_released_at > clock_timestamp()
    -- Match normalization: only an object with JSON boolean false hides Classwork.
    or (jsonb_typeof(v_feature_visibility) = 'object'
      and v_feature_visibility->'classwork' = 'false'::jsonb)
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

create or replace function public.submit_assignment_doc_for_member_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_word_count integer,
  p_char_count integer,
  p_acknowledged_missing_requirement_ids uuid[],
  p_emit_pal_event boolean,
  p_pal_event jsonb
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
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_feature_visibility jsonb;
  v_event_occurred_at timestamptz;
  v_event_activity_day date;
  v_expected_period_key text;
  v_expected_timing text;
  v_result jsonb;
begin
  if p_actor_id is null
    or p_assignment_id is null
    or p_content is null
    or p_expected_updated_at is null
    or p_emit_pal_event is null
  then
    raise exception using errcode = '22023', message = 'Invalid assignment submission request';
  end if;

  -- Every assignment-document mutation takes these fences in this order before
  -- the broader classroom/member locks. Calls to the legacy atomic submit are
  -- re-entrant on the first fence.
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
    classroom.teacher_id,
    classroom.archived_at,
    classroom.feature_visibility
  into
    v_assignment_classroom_id,
    v_assignment_is_draft,
    v_assignment_released_at,
    v_assignment_due_at,
    v_teacher_id,
    v_archived_at,
    v_feature_visibility
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for update of classroom, assignment;

  if not found
    or v_assignment_classroom_id is distinct from v_initial_classroom_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  -- Ownership takes precedence over historical self-enrollment. The owner
  -- value comes from the classroom row already locked above.
  if v_teacher_id = p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  if v_archived_at is not null
    or v_assignment_is_draft
    or v_assignment_released_at > clock_timestamp()
    -- Match normalization: only an object with JSON boolean false hides Classwork.
    or (jsonb_typeof(v_feature_visibility) = 'object'
      and v_feature_visibility->'classwork' = 'false'::jsonb)
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

  -- Legacy Pal delivery is still supported while membership-scoped signals are
  -- off. Bind every database-verifiable completion field to this submission.
  -- A null event remains valid when membership-scoped Pal owns delivery.
  if p_pal_event is not null then
    if not p_emit_pal_event
      or jsonb_typeof(p_pal_event) <> 'object'
      or not p_pal_event ?& array[
        'schema_version', 'idempotency_key', 'learner_id', 'event_type',
        'occurred_at', 'metadata'
      ]
      or p_pal_event - array[
        'schema_version', 'idempotency_key', 'learner_id', 'event_type',
        'occurred_at', 'metadata'
      ] <> '{}'::jsonb
      or p_pal_event->>'schema_version' <> '1'
      or p_pal_event->>'event_type' <> 'learning_item.completed'
      or coalesce(p_pal_event->>'idempotency_key', '') !~ '^pika:v1:pika-fact-[A-Za-z0-9_-]{43}$'
      or coalesce(p_pal_event->>'learner_id', '') !~ '^pika-learner-[A-Za-z0-9_-]{43}$'
      or jsonb_typeof(p_pal_event->'metadata') <> 'object'
      or not (p_pal_event->'metadata') ?& array['item_token', 'kind', 'period_key', 'timing']
      or (p_pal_event->'metadata') - array['item_token', 'kind', 'period_key', 'timing'] <> '{}'::jsonb
      or p_pal_event->'metadata'->>'kind' <> 'assignment'
      or coalesce(p_pal_event->'metadata'->>'item_token', '') !~ '^pika-item-[A-Za-z0-9_-]{43}$'
    then
      raise exception using errcode = '22023', message = 'Invalid assignment completion event';
    end if;

    begin
      v_event_occurred_at := (p_pal_event->>'occurred_at')::timestamptz;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode = '22023', message = 'Invalid assignment completion event timestamp';
    end;

    v_event_activity_day := (v_event_occurred_at at time zone 'America/Toronto')::date;
    v_expected_period_key := 'pika-week-' || to_char(
      v_event_activity_day - (extract(isodow from v_event_activity_day)::integer - 1),
      'YYYY-MM-DD'
    );
    v_expected_timing := case
      when v_assignment_due_at is null or v_event_occurred_at <= v_assignment_due_at
        then 'on_time'
      else 'late'
    end;

    if p_pal_event->'metadata'->>'period_key' is distinct from v_expected_period_key
      or p_pal_event->'metadata'->>'timing' is distinct from v_expected_timing
    then
      raise exception using errcode = '22023', message = 'Assignment completion event does not match request';
    end if;
  end if;

  if p_emit_pal_event then
    v_result := public.submit_assignment_doc_with_pal_event_atomic(
      p_assignment_id,
      p_actor_id,
      p_content,
      p_expected_updated_at,
      p_word_count,
      p_char_count,
      p_pal_event,
      coalesce(p_acknowledged_missing_requirement_ids, '{}'::uuid[])
    );
  else
    v_result := public.submit_assignment_doc_atomic(
      p_assignment_id,
      p_actor_id,
      p_content,
      p_expected_updated_at,
      p_word_count,
      p_char_count,
      coalesce(p_acknowledged_missing_requirement_ids, '{}'::uuid[])
    );
  end if;

  if jsonb_typeof(v_result) is distinct from 'object'
    or jsonb_typeof(v_result->'ok') is distinct from 'boolean'
  then
    raise exception using errcode = '22023', message = 'Invalid assignment submission result';
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
    raise exception using errcode = '22023', message = 'Invalid assignment submission result';
  end if;

  return v_result || jsonb_build_object('classroom_id', v_assignment_classroom_id);
end;
$function$;

revoke all on function public.submit_assignment_doc_for_member_v1(
  uuid, uuid, jsonb, timestamptz, integer, integer, uuid[], boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.submit_assignment_doc_for_member_v1(
  uuid, uuid, jsonb, timestamptz, integer, integer, uuid[], boolean, jsonb
) to service_role;

create or replace function public.unsubmit_assignment_doc_for_member_v1(
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
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_feature_visibility jsonb;
  v_result jsonb;
begin
  if p_actor_id is null or p_assignment_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment unsubmit request';
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
    classroom.teacher_id,
    classroom.archived_at,
    classroom.feature_visibility
  into
    v_assignment_classroom_id,
    v_assignment_is_draft,
    v_assignment_released_at,
    v_teacher_id,
    v_archived_at,
    v_feature_visibility
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for update of classroom, assignment;

  if not found
    or v_assignment_classroom_id is distinct from v_initial_classroom_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  -- Ownership takes precedence over historical self-enrollment. The owner
  -- value comes from the classroom row already locked above.
  if v_teacher_id = p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  if v_archived_at is not null
    or v_assignment_is_draft
    or v_assignment_released_at > clock_timestamp()
    -- Match normalization: only an object with JSON boolean false hides Classwork.
    or (jsonb_typeof(v_feature_visibility) = 'object'
      and v_feature_visibility->'classwork' = 'false'::jsonb)
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

  v_result := public.unsubmit_assignment_doc_atomic(
    p_assignment_id,
    p_actor_id
  );

  if jsonb_typeof(v_result) is distinct from 'object'
    or jsonb_typeof(v_result->'ok') is distinct from 'boolean'
  then
    raise exception using errcode = '22023', message = 'Invalid assignment unsubmit result';
  end if;

  if (v_result->>'ok')::boolean and (
    v_result->'doc'->>'assignment_id' is distinct from p_assignment_id::text
    or v_result->'doc'->>'student_id' is distinct from p_actor_id::text
  ) then
    raise exception using errcode = '22023', message = 'Invalid assignment unsubmit result';
  end if;

  return v_result || jsonb_build_object('classroom_id', v_assignment_classroom_id);
end;
$function$;

revoke all on function public.unsubmit_assignment_doc_for_member_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.unsubmit_assignment_doc_for_member_v1(uuid, uuid)
  to service_role;

create or replace function public.prepare_assignment_doc_submission_for_member_v1(
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
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_feature_visibility jsonb;
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
    classroom.teacher_id,
    classroom.archived_at,
    classroom.feature_visibility
  into
    v_assignment_classroom_id,
    v_assignment_is_draft,
    v_assignment_released_at,
    v_assignment_due_at,
    v_teacher_id,
    v_archived_at,
    v_feature_visibility
  from public.assignments as assignment
  join public.classrooms as classroom on classroom.id = assignment.classroom_id
  where assignment.id = p_assignment_id
  for share of classroom, assignment;

  if not found
    or v_assignment_classroom_id is distinct from v_initial_classroom_id
  then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  -- Ownership takes precedence over historical self-enrollment. The owner
  -- value comes from the classroom row already locked above.
  if v_teacher_id = p_actor_id then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  if v_archived_at is not null
    or v_assignment_is_draft
    or v_assignment_released_at > clock_timestamp()
    -- Match normalization: only an object with JSON boolean false hides Classwork.
    or (jsonb_typeof(v_feature_visibility) = 'object'
      and v_feature_visibility->'classwork' = 'false'::jsonb)
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

commit;
