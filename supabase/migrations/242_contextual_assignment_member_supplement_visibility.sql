-- Conceal learner history/restore/artifact/inline-image effects under locked Classwork visibility.
-- Owner history remains available; complete latest 214/213 definitions and ACLs are preserved.
-- Candidate 242 is unapplied; no data, wrapper, admission or activation changes.

begin;

create or replace function public.get_assignment_doc_history_for_actor_v1(
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
  v_feature_visibility jsonb;
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
    -- Ownership takes precedence over historical self-enrollment. The owner
    -- value comes from the classroom row already locked above.
    if v_teacher_id = p_actor_id then
      raise exception using errcode = '42501', message = 'Forbidden';
    end if;

    v_access_mode := 'member';
    if v_archived_at is not null
      or v_assignment_is_draft
      or v_assignment_released_at > clock_timestamp()
      -- Match normalization: only an object with JSON boolean false hides Classwork.
      or (jsonb_typeof(v_feature_visibility) = 'object'
        and v_feature_visibility->'classwork' = 'false'::jsonb)
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

create or replace function public.restore_assignment_doc_for_member_v1(
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
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_feature_visibility jsonb;
  v_doc public.assignment_docs;
  v_target public.assignment_doc_history;
  v_baseline public.assignment_doc_history;
  v_history public.assignment_doc_history;
  v_target_content jsonb;
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
  if (p_patch is not null and jsonb_typeof(p_patch) <> 'array')
    or (p_snapshot is not null and jsonb_typeof(p_snapshot) <> 'object')
    or coalesce(p_word_count, 0) < 0
    or coalesce(p_char_count, 0) < 0
  then
    raise exception using errcode = '22023', message = 'Invalid assignment restore evidence';
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
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Assignment doc not found';
  end if;

  select history.*
  into v_target
  from public.assignment_doc_history as history
  where history.id = p_history_id
    and history.assignment_doc_id = v_doc.id
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'History entry not found';
  end if;

  select history.*
  into v_baseline
  from public.assignment_doc_history as history
  where history.assignment_doc_id = v_doc.id
    and history.snapshot is not null
    and (history.created_at, history.id) <= (v_target.created_at, v_target.id)
  order by history.created_at desc, history.id desc
  limit 1
  for share;

  if not found then
    raise exception using errcode = '22023', message = 'Assignment history baseline is missing';
  end if;

  v_target_content := v_baseline.snapshot;
  for v_history in
    select history.*
    from public.assignment_doc_history as history
    where history.assignment_doc_id = v_doc.id
      and (history.created_at, history.id) > (v_baseline.created_at, v_baseline.id)
      and (history.created_at, history.id) <= (v_target.created_at, v_target.id)
    order by history.created_at, history.id
    for share
  loop
    if v_history.snapshot is not null then
      v_target_content := v_history.snapshot;
    elsif v_history.patch is not null then
      v_target_content := private.apply_assignment_json_patch_v1(
        v_target_content,
        v_history.patch
      );
    else
      raise exception using errcode = '22023', message = 'Assignment history entry has no content';
    end if;
  end loop;

  if v_target_content is distinct from p_content then
    raise exception using errcode = '22023', message = 'Assignment restore content does not match history target';
  end if;

  v_result := public.save_assignment_doc_atomic(
    p_assignment_id,
    p_actor_id,
    v_target_content,
    p_expected_updated_at,
    'restore',
    0,
    0,
    null,
    v_target_content,
    v_target.word_count,
    v_target.char_count,
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
    or v_result->'doc'->'content' is distinct from v_target_content
    or (
      v_result->'history_entry' is not null
      and v_result->'history_entry' <> 'null'::jsonb
      and (
        v_result->'history_entry'->>'assignment_doc_id'
          is distinct from v_result->'doc'->>'id'
        or v_result->'history_entry'->'snapshot' is distinct from v_target_content
        or v_result->'history_entry'->'patch' is distinct from 'null'::jsonb
        or (v_result->'history_entry'->>'word_count')::integer is distinct from v_target.word_count
        or (v_result->'history_entry'->>'char_count')::integer is distinct from v_target.char_count
      )
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

create or replace function private.lock_assignment_artifact_member_context_v1(
  p_actor_id uuid,
  p_assignment_id uuid,
  p_requirement_id uuid
)
returns table (
  classroom_id uuid,
  assignment_doc_id uuid,
  requirement_type text,
  requirement jsonb,
  artifact jsonb,
  doc_is_submitted boolean
)
language plpgsql
security invoker
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
  v_requirement public.assignment_submission_requirements%rowtype;
  v_doc public.assignment_docs%rowtype;
  v_artifact public.assignment_submission_artifacts%rowtype;
begin
  if p_actor_id is null or p_assignment_id is null or p_requirement_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment artifact request';
  end if;

  -- Match save, submit, restore, and requirement mutation before taking the
  -- broader classroom/member fences.
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

  select requirement_row.*
  into v_requirement
  from public.assignment_submission_requirements as requirement_row
  where requirement_row.id = p_requirement_id
    and requirement_row.assignment_id = p_assignment_id
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'Requirement not found';
  end if;

  select document.*
  into v_doc
  from public.assignment_docs as document
  where document.assignment_id = p_assignment_id
    and document.student_id = p_actor_id
  for update;

  if not found then
    insert into public.assignment_docs (
      assignment_id,
      student_id,
      content,
      repo_url,
      github_username,
      is_submitted,
      submitted_at,
      viewed_at
    ) values (
      p_assignment_id,
      p_actor_id,
      '{"type":"doc","content":[]}'::jsonb,
      null,
      null,
      false,
      null,
      clock_timestamp()
    )
    returning * into v_doc;
  end if;

  select artifact_row.*
  into v_artifact
  from public.assignment_submission_artifacts as artifact_row
  where artifact_row.assignment_doc_id = v_doc.id
    and artifact_row.requirement_id = p_requirement_id
  for update;

  if v_artifact.id is not null and (
    v_artifact.student_id is distinct from p_actor_id
    or v_artifact.type is distinct from v_requirement.type
  ) then
    raise exception using errcode = '22023', message = 'Invalid assignment artifact binding';
  end if;

  return query select
    v_assignment_classroom_id,
    v_doc.id,
    v_requirement.type,
    to_jsonb(v_requirement),
    case when v_artifact.id is null then null::jsonb else to_jsonb(v_artifact) end,
    v_doc.is_submitted;
end;
$function$;

revoke all on function private.lock_assignment_artifact_member_context_v1(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.lock_assignment_inline_image_member_context_v1(
  p_actor_id uuid,
  p_assignment_doc_id uuid
)
returns table (
  classroom_id uuid,
  assignment_id uuid,
  assignment_doc_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_initial_assignment_id uuid;
  v_initial_classroom_id uuid;
  v_assignment_classroom_id uuid;
  v_assignment_is_draft boolean;
  v_assignment_released_at timestamptz;
  v_teacher_id uuid;
  v_archived_at timestamptz;
  v_feature_visibility jsonb;
  v_doc public.assignment_docs%rowtype;
begin
  if p_actor_id is null or p_assignment_doc_id is null then
    raise exception using errcode = '22023', message = 'Invalid assignment image request';
  end if;

  -- This read establishes only advisory-lock namespaces. All identity and
  -- lifecycle evidence is re-read under the shared submission/editor,
  -- classroom-operation, and membership fences below.
  select document.assignment_id, assignment.classroom_id
  into v_initial_assignment_id, v_initial_classroom_id
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
    hashtextextended(v_initial_assignment_id::text || ':' || p_actor_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  perform private.try_lock_classroom_membership_change(v_initial_classroom_id, p_actor_id);

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
  where assignment.id = v_initial_assignment_id
  for update of classroom, assignment;

  if not found or v_assignment_classroom_id is distinct from v_initial_classroom_id then
    raise exception using errcode = '40001', message = 'Assignment binding changed';
  end if;

  -- Classroom ownership takes precedence over historical self-enrollment.
  -- Owners inspect through the read boundary only; they never upload as a
  -- member to their own Classroom.
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

  select document.* into v_doc
  from public.assignment_docs as document
  where document.id = p_assignment_doc_id
    and document.assignment_id = v_initial_assignment_id
    and document.student_id = p_actor_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Forbidden';
  end if;

  if v_doc.is_submitted then
    return query select
      v_assignment_classroom_id, v_initial_assignment_id, v_doc.id;
    return;
  end if;

  return query select v_assignment_classroom_id, v_initial_assignment_id, v_doc.id;
end;
$function$;

revoke all on function private.lock_assignment_inline_image_member_context_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

commit;
