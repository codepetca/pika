-- Source only; application requires approval naming migration264 and target.
-- Async grading starts from the saved, teacher-finalized snapshot, never a
-- fabricated student submission. Existing archive/removal/purge triggers remain.
set lock_timeout = '5s';
set statement_timeout = '30s';
begin;

-- Match ECMAScript String.trim used by the application scope classifier.
create function private.test_ai_response_is_blank(p_text text)
returns boolean language sql immutable set search_path = '' as $blank$
  select pg_catalog.btrim(coalesce(p_text, ''),
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '';
$blank$;
revoke all on function private.test_ai_response_is_blank(text) from public, anon, authenticated, service_role;

-- Forward replacements retain094 validation, revision fences and service ACLs.
-- Both legacy entrypoints now admit existing teacher-closed attempts.
create or replace function public.save_test_unanswered_grades_atomic(
  p_test_id uuid,
  p_teacher_id uuid,
  p_rows jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom_id uuid;
  v_row jsonb;
  v_row_count integer;
  v_question_id uuid;
  v_student_id uuid;
  v_response_id uuid;
  v_expected_revision bigint;
  v_submitted_at timestamptz;
  v_response public.test_responses%rowtype;
  v_affected integer;
  v_inserted_count integer := 0;
  v_updated_count integer := 0;
begin
  if p_test_id is null
    or p_teacher_id is null
    or p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or p_now is null
  then
    raise exception 'Unanswered grade payload is invalid' using errcode = '22023';
  end if;
  v_row_count := jsonb_array_length(p_rows);
  if v_row_count < 1 or v_row_count > 1000 then
    raise exception 'Unanswered grade payload is invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text, 0));

  select test.classroom_id into v_classroom_id
  from public.tests test
  join public.classrooms classroom on classroom.id = test.classroom_id
  where test.id = p_test_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null;
  if not found then
    raise exception 'Test unanswered grading is not allowed' using errcode = '42501';
  end if;

  perform 1
  from public.test_questions question
  where question.id in (
    select (row->>'question_id')::uuid
    from jsonb_array_elements(p_rows) row
  )
  order by question.id
  for share;

  perform 1
  from public.classrooms classroom
  where classroom.id = v_classroom_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null
  for share;
  if not found then
    raise exception 'Test unanswered grading is not allowed' using errcode = '42501';
  end if;

  for v_row in
    select value
    from jsonb_array_elements(p_rows)
    order by
      coalesce(value->>'response_id', value->>'question_id'),
      value->>'student_id'
  loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Unanswered grade row is invalid' using errcode = '22023';
    end if;
    v_question_id := (v_row->>'question_id')::uuid;
    v_student_id := (v_row->>'student_id')::uuid;
    v_response_id := nullif(v_row->>'response_id', '')::uuid;
    v_expected_revision := nullif(v_row->>'expected_response_revision', '')::bigint;
    v_submitted_at := nullif(v_row->>'submitted_at', '')::timestamptz;
    if v_question_id is null
      or v_student_id is null
      or (v_response_id is null and v_expected_revision is not null)
      or (v_response_id is not null and (v_expected_revision is null or v_expected_revision < 1))
      or (v_response_id is null and v_submitted_at is null)
    then
      raise exception 'Unanswered grade row is invalid' using errcode = '22023';
    end if;

    perform 1
    from public.test_questions question
    join public.classroom_enrollments enrollment
      on enrollment.classroom_id = v_classroom_id
     and enrollment.student_id = v_student_id
    join public.test_attempts attempt
      on attempt.test_id = p_test_id
     and attempt.student_id = v_student_id
     and (attempt.is_submitted = true or attempt.closed_for_grading_at is not null)
    where question.id = v_question_id
      and question.test_id = p_test_id
      and question.question_type = 'open_response'
    for share of question, enrollment, attempt;
    if not found then
      raise exception 'Unanswered grade row is not eligible' using errcode = '22023';
    end if;

    if v_response_id is null then
      insert into public.test_responses (
        test_id,
        question_id,
        student_id,
        selected_option,
        response_text,
        score,
        feedback,
        graded_at,
        graded_by,
        submitted_at
      ) values (
        p_test_id,
        v_question_id,
        v_student_id,
        null,
        '',
        0,
        'Unanswered',
        p_now,
        p_teacher_id,
        v_submitted_at
      )
      on conflict (question_id, student_id) do nothing;
      get diagnostics v_affected = row_count;
      if v_affected = 0 then
        raise exception 'Test response changed; reload and retry' using errcode = 'PT409';
      end if;
      v_inserted_count := v_inserted_count + v_affected;
      continue;
    end if;

    select response.* into v_response
    from public.test_responses response
    where response.id = v_response_id
    for update;
    if not found
      or v_response.test_id <> p_test_id
      or v_response.question_id <> v_question_id
      or v_response.student_id <> v_student_id
      or v_response.revision <> v_expected_revision
      or not private.test_ai_response_is_blank(v_response.response_text)
    then
      raise exception 'Test response changed; reload and retry' using errcode = 'PT409';
    end if;

    update public.test_responses response
    set
      score = 0,
      feedback = 'Unanswered',
      graded_at = p_now,
      graded_by = p_teacher_id,
      ai_grading_basis = null,
      ai_reference_answers = null,
      ai_model = null,
      ai_suggested_score = null,
      ai_suggested_feedback = null
    where response.id = v_response_id;
    v_updated_count := v_updated_count + 1;
  end loop;

  return jsonb_build_object(
    'inserted_count', v_inserted_count,
    'updated_count', v_updated_count
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Unanswered grade row is invalid' using errcode = '22023';
end;
$$;

create or replace function public.create_test_ai_grading_run_atomic(
  p_test_id uuid,
  p_teacher_id uuid,
  p_model text,
  p_requested_student_ids uuid[],
  p_eligible_student_ids uuid[],
  p_selection_hash text,
  p_eligible_student_count integer,
  p_skipped_unanswered_count integer,
  p_skipped_already_graded_count integer,
  p_item_rows jsonb,
  p_unanswered_rows jsonb,
  p_prompt_guideline_override text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom_id uuid;
  v_requested_count integer := cardinality(coalesce(p_requested_student_ids, array[]::uuid[]));
  v_eligible_student_ids uuid[];
  v_current_eligible_student_ids uuid[];
  v_item_count integer;
  v_current_eligible_count integer;
  v_run public.test_ai_grading_runs%rowtype;
begin
  if p_test_id is null
    or p_teacher_id is null
    or p_model is null
    or btrim(p_model) = ''
    or char_length(p_model) > 200
    or p_selection_hash is null
    or btrim(p_selection_hash) = ''
    or p_item_rows is null
    or jsonb_typeof(p_item_rows) <> 'array'
    or p_unanswered_rows is null
    or jsonb_typeof(p_unanswered_rows) <> 'array'
    or jsonb_array_length(p_unanswered_rows) > 1000
    or p_eligible_student_count is null
    or p_eligible_student_count < 0
    or p_eligible_student_count > v_requested_count
    or p_skipped_unanswered_count is null
    or p_skipped_unanswered_count < 0
    or p_skipped_already_graded_count is null
    or p_skipped_already_graded_count < 0
    or v_requested_count < 1
    or v_requested_count > 100
  then
    raise exception 'Test AI grading run payload is invalid' using errcode = '22023';
  end if;
  select coalesce(array_agg(student_id order by student_id), array[]::uuid[])
  into v_eligible_student_ids
  from (
    select distinct student_id
    from unnest(coalesce(p_eligible_student_ids, array[]::uuid[])) eligible(student_id)
  ) normalized;
  if cardinality(v_eligible_student_ids) <> p_eligible_student_count
    or exists (
      select 1
      from unnest(v_eligible_student_ids) eligible(student_id)
      where not (eligible.student_id = any(p_requested_student_ids))
    )
  then
    raise exception 'Test AI grading run payload is invalid' using errcode = '22023';
  end if;
  if p_prompt_guideline_override is not null
    and (btrim(p_prompt_guideline_override) = '' or char_length(p_prompt_guideline_override) > 10000)
  then
    raise exception 'Test AI grading prompt override is invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text, 0));

  select test.classroom_id into v_classroom_id
  from public.tests test
  join public.classrooms classroom on classroom.id = test.classroom_id
  where test.id = p_test_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null;
  if not found then
    raise exception 'Test AI grading run creation is not allowed' using errcode = '42501';
  end if;

  select run.* into v_run
  from public.test_ai_grading_runs run
  where run.test_id = p_test_id
    and run.status in ('queued', 'running')
  order by run.created_at desc
  limit 1;
  if found then
    return jsonb_build_object('outcome', 'existing', 'run_id', v_run.id);
  end if;

  perform 1
  from public.test_questions question
  where question.id in (
    select item.question_id
    from jsonb_to_recordset(p_item_rows) item(question_id uuid)
    union
    select unanswered.question_id
    from jsonb_to_recordset(p_unanswered_rows) unanswered(question_id uuid)
  )
  order by question.id
  for share;

  perform 1
  from public.tests test
  where test.id = p_test_id
  for update;
  if not found then
    raise exception 'Test AI grading run creation is not allowed' using errcode = '42501';
  end if;

  perform 1
  from public.classrooms classroom
  where classroom.id = v_classroom_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null
  for share;
  if not found then
    raise exception 'Test AI grading run creation is not allowed' using errcode = '42501';
  end if;

  perform 1
  from public.classroom_enrollments enrollment
  where enrollment.classroom_id = v_classroom_id
    and enrollment.student_id = any(p_requested_student_ids)
  order by enrollment.student_id
  for share;
  if (
    select count(distinct requested.student_id)
    from unnest(p_requested_student_ids) requested(student_id)
  ) <> v_requested_count
    or (
      select count(distinct enrollment.student_id)
      from public.classroom_enrollments enrollment
      where enrollment.classroom_id = v_classroom_id
        and enrollment.student_id = any(p_requested_student_ids)
    ) <> v_requested_count
  then
    raise exception 'Student is not enrolled in this classroom' using errcode = '22023';
  end if;

  perform 1
  from public.test_attempts attempt
  where attempt.test_id = p_test_id
    and attempt.student_id = any(p_requested_student_ids)
  order by attempt.student_id
  for share;
  select coalesce(array_agg(attempt.student_id order by attempt.student_id), array[]::uuid[])
  into v_current_eligible_student_ids
  from public.test_attempts attempt
  where attempt.test_id = p_test_id
    and attempt.student_id = any(p_requested_student_ids)
    and (attempt.is_submitted = true or attempt.closed_for_grading_at is not null);
  v_current_eligible_count := cardinality(v_current_eligible_student_ids);
  if v_current_eligible_count <> p_eligible_student_count
    or v_current_eligible_student_ids is distinct from v_eligible_student_ids
  then
    raise exception 'Test submission state changed; reload and retry' using errcode = 'PT409';
  end if;

  v_item_count := jsonb_array_length(p_item_rows);
  if v_item_count > 1000
    or v_item_count <> (
      select count(distinct item.response_id)
      from jsonb_to_recordset(p_item_rows) item(
        student_id uuid,
        question_id uuid,
        response_id uuid,
        response_revision bigint,
        queue_position integer
      )
    )
    or v_item_count <> (
      select count(distinct item.queue_position)
      from jsonb_to_recordset(p_item_rows) item(
        student_id uuid,
        question_id uuid,
        response_id uuid,
        response_revision bigint,
        queue_position integer
      )
    )
    or v_item_count <> (
      select count(distinct (item.student_id, item.question_id))
      from jsonb_to_recordset(p_item_rows) item(
        student_id uuid,
        question_id uuid,
        response_id uuid,
        response_revision bigint,
        queue_position integer
      )
    )
    or exists (
      select 1
      from jsonb_to_recordset(p_item_rows) item(
        student_id uuid,
        question_id uuid,
        response_id uuid,
        response_revision bigint,
        queue_position integer
      )
      left join public.test_responses response
        on response.id = item.response_id
       and response.test_id = p_test_id
       and response.student_id = item.student_id
       and response.question_id = item.question_id
      left join public.test_questions question
        on question.id = item.question_id
       and question.test_id = p_test_id
      where item.student_id is null
        or item.question_id is null
        or item.response_id is null
        or item.response_revision is null
        or item.response_revision < 1
        or item.queue_position is null
        or item.queue_position < 0
        or not (item.student_id = any(v_eligible_student_ids))
        or response.id is null
        or response.revision <> item.response_revision
        or question.id is null
        or question.question_type <> 'open_response'
    )
  then
    raise exception 'Test response changed; reload and retry' using errcode = 'PT409';
  end if;

  perform 1
  from public.test_responses response
  join jsonb_to_recordset(p_item_rows) item(response_id uuid)
    on item.response_id = response.id
  order by response.id
  for share of response;

  if jsonb_array_length(p_unanswered_rows) > 0 then
    perform public.save_test_unanswered_grades_atomic(
      p_test_id,
      p_teacher_id,
      p_unanswered_rows,
      clock_timestamp()
    );
  end if;
  if v_item_count = 0 then
    return jsonb_build_object('outcome', 'noop', 'run_id', null);
  end if;

  insert into public.test_ai_grading_runs (
    test_id,
    status,
    triggered_by,
    model,
    prompt_guideline_override,
    requested_student_ids_json,
    selection_hash,
    requested_count,
    eligible_student_count,
    queued_response_count,
    processed_count,
    completed_count,
    skipped_unanswered_count,
    skipped_already_graded_count,
    failed_count,
    error_samples_json,
    started_at,
    completed_at
  ) values (
    p_test_id,
    'queued',
    p_teacher_id,
    btrim(p_model),
    nullif(btrim(p_prompt_guideline_override), ''),
    to_jsonb(p_requested_student_ids),
    p_selection_hash,
    v_requested_count,
    p_eligible_student_count,
    v_item_count,
    0,
    0,
    p_skipped_unanswered_count,
    p_skipped_already_graded_count,
    0,
    '[]'::jsonb,
    null,
    null
  ) returning * into v_run;

  insert into public.test_ai_grading_run_items (
    run_id,
    test_id,
    student_id,
    question_id,
    response_id,
    response_revision,
    queue_position,
    status,
    attempt_count,
    next_retry_at,
    last_error_code,
    last_error_message,
    started_at,
    completed_at
  )
  select
    v_run.id,
    p_test_id,
    item.student_id,
    item.question_id,
    item.response_id,
    item.response_revision,
    item.queue_position,
    'queued',
    0,
    null,
    null,
    null,
    null,
    null
  from jsonb_to_recordset(p_item_rows) item(
    student_id uuid,
    question_id uuid,
    response_id uuid,
    response_revision bigint,
    queue_position integer
  )
  order by item.queue_position;

  if not found then
    raise exception 'Test AI grading run items were not created' using errcode = 'PT409';
  end if;

  return jsonb_build_object('outcome', 'created', 'run_id', v_run.id);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Test AI grading run payload is invalid' using errcode = '22023';
end;
$$;

-- Lock and validate before closure, then derive all seeds inside this transaction.
-- Reuse248 selected closure and094 run creation to preserve worker contracts.
create function public.start_test_ai_grading_run_atomic(
  p_test_id uuid,
  p_teacher_id uuid,
  p_model text,
  p_requested_student_ids uuid[],
  p_selection_hash text,
  p_grade_scope text,
  p_prompt_guideline_override text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test public.tests%rowtype;
  v_run public.test_ai_grading_runs%rowtype;
  v_selected_ids uuid[];
  v_closure_ids uuid[];
  v_eligible_ids uuid[];
  v_prior_graded_ids uuid[];
  v_items jsonb := '[]'::jsonb;
  v_unanswered jsonb := '[]'::jsonb;
  v_result jsonb;
  v_row record;
  v_unanswered_count integer := 0;
  v_already_graded_count integer := 0;
  v_has_grade boolean;
begin
  if p_test_id is null or p_teacher_id is null
    or p_model is null or btrim(p_model) = '' or char_length(p_model) > 200
    or p_selection_hash is null or btrim(p_selection_hash) = ''
    or p_grade_scope is null or p_grade_scope not in ('ungraded', 'all')
    or p_requested_student_ids is null or array_ndims(p_requested_student_ids) is distinct from 1
    or cardinality(p_requested_student_ids) not between 1 and 100
    or array_position(p_requested_student_ids, null) is not null
    or (p_prompt_guideline_override is not null
      and (btrim(p_prompt_guideline_override) = '' or char_length(p_prompt_guideline_override) > 10000))
  then
    raise exception 'Test AI grading start payload is invalid' using errcode = '22023';
  end if;
  select array_agg(distinct id order by id) into v_selected_ids
    from unnest(p_requested_student_ids) id;
  if cardinality(v_selected_ids) <> cardinality(p_requested_student_ids) then
    raise exception 'Test AI grading selection must contain unique students' using errcode = '22023';
  end if;

  -- Same advisory key as094, and Classroom -> Test row locks as244. Student
  -- save/submit/access, prompt edits, roster changes and grading serialize here.
  v_test := private.lock_test_lifecycle(p_test_id);
  perform 1 from public.classrooms classroom
    join public.users teacher on teacher.id = classroom.teacher_id and teacher.role = 'teacher'
    where classroom.id = v_test.classroom_id
      and classroom.teacher_id = p_teacher_id and classroom.archived_at is null;
  if not found then
    raise exception 'Test AI grading run creation is not allowed' using errcode = '42501';
  end if;
  if v_test.status = 'draft' then
    raise exception 'Cannot AI grade a draft test' using errcode = '22023';
  end if;
  perform 1 from public.classroom_enrollments enrollment
    where enrollment.classroom_id = v_test.classroom_id and enrollment.student_id = any(v_selected_ids)
    order by enrollment.student_id for share;
  if (select count(*) from public.classroom_enrollments enrollment
    where enrollment.classroom_id = v_test.classroom_id and enrollment.student_id = any(v_selected_ids))
    <> cardinality(v_selected_ids) then
    raise exception 'Student is not enrolled in this classroom' using errcode = '22023';
  end if;

  -- Return the persisted active run before any no-op or availability mutation.
  -- The coordinator compares model, selection hash and override for resume/conflict.
  select run.* into v_run from public.test_ai_grading_runs run
    where run.test_id = p_test_id and run.status in ('queued', 'running')
    order by run.created_at desc limit 1;
  if found then
    return jsonb_build_object('outcome', 'existing', 'run_id', v_run.id,
      'eligible_student_count', v_run.eligible_student_count,
      'skipped_unanswered_count', v_run.skipped_unanswered_count,
      'skipped_already_graded_count', v_run.skipped_already_graded_count);
  end if;
  perform 1 from public.test_questions question where question.test_id = p_test_id
    order by question.id for share;
  if not exists (select 1 from public.test_questions
    where test_id = p_test_id and question_type = 'open_response') then
    return jsonb_build_object('outcome', 'noop', 'run_id', null, 'noop_reason', 'no_open_questions',
      'eligible_student_count', 0, 'skipped_unanswered_count', 0, 'skipped_already_graded_count', 0);
  end if;

  perform 1 from public.test_attempts attempt where attempt.test_id = p_test_id
    and attempt.student_id = any(v_selected_ids) order by attempt.student_id for update;
  -- Snapshot prior grades so zeros created by this closure report as unanswered;
  -- prior blank grades remain already_graded for both scopes, as in the TS helper.
  perform 1 from public.test_responses response where response.test_id = p_test_id
    and response.student_id = any(v_selected_ids) order by response.id for update;
  select coalesce(array_agg(response.id), array[]::uuid[]) into v_prior_graded_ids
    from public.test_responses response where response.test_id = p_test_id
      and response.student_id = any(v_selected_ids)
      and (response.graded_at is not null or response.score is not null or response.feedback is not null);
  select coalesce(array_agg(attempt.student_id order by attempt.student_id), array[]::uuid[])
    into v_closure_ids from public.test_attempts attempt
    where attempt.test_id = p_test_id and attempt.student_id = any(v_selected_ids) and not attempt.is_submitted;
  if cardinality(v_closure_ids) > 0 then
    perform public.update_test_student_access_atomic(p_test_id, v_closure_ids, 'closed', p_teacher_id);
  end if;
  select coalesce(array_agg(attempt.student_id order by attempt.student_id), array[]::uuid[])
    into v_eligible_ids from public.test_attempts attempt
    where attempt.test_id = p_test_id and attempt.student_id = any(v_selected_ids)
      and (attempt.is_submitted or attempt.closed_for_grading_at is not null);

  for v_row in
    select attempt.student_id, question.id as question_id, response.id as response_id,
      response.revision, response.response_text,
      coalesce(attempt.submitted_at, attempt.closed_for_grading_at) as snapshot_at
    from public.test_attempts attempt
    join public.test_questions question on question.test_id = attempt.test_id and question.question_type = 'open_response'
    left join public.test_responses response on response.test_id = attempt.test_id
      and response.student_id = attempt.student_id and response.question_id = question.id
    where attempt.test_id = p_test_id and attempt.student_id = any(v_eligible_ids)
    order by attempt.student_id, question.position, question.id
  loop
    v_has_grade := coalesce(v_row.response_id = any(v_prior_graded_ids), false);
    -- JS String.trim includes tabs/newlines and Unicode whitespace as well as spaces.
    if private.test_ai_response_is_blank(v_row.response_text) then
      if v_has_grade then
        v_already_graded_count := v_already_graded_count + 1;
      else
        v_unanswered_count := v_unanswered_count + 1;
        v_unanswered := v_unanswered || jsonb_build_array(jsonb_build_object(
          'student_id', v_row.student_id, 'question_id', v_row.question_id,
          'response_id', v_row.response_id, 'expected_response_revision', v_row.revision,
          'submitted_at', coalesce(v_row.snapshot_at, now())));
      end if;
    elsif p_grade_scope = 'ungraded' and v_has_grade then
      v_already_graded_count := v_already_graded_count + 1;
    else
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'student_id', v_row.student_id, 'question_id', v_row.question_id,
        'response_id', v_row.response_id, 'response_revision', v_row.revision,
        'queue_position', jsonb_array_length(v_items)));
    end if;
  end loop;
  v_result := public.create_test_ai_grading_run_atomic(p_test_id, p_teacher_id, p_model,
    v_selected_ids, v_eligible_ids, p_selection_hash, cardinality(v_eligible_ids),
    v_unanswered_count, v_already_graded_count, v_items, v_unanswered, p_prompt_guideline_override);
  return v_result || jsonb_build_object('eligible_student_count', cardinality(v_eligible_ids),
    'skipped_unanswered_count', v_unanswered_count, 'skipped_already_graded_count', v_already_graded_count);
end;
$$;

revoke all on function public.start_test_ai_grading_run_atomic(uuid, uuid, text, uuid[], text, text, text)
  from public, anon, authenticated;
grant execute on function public.start_test_ai_grading_run_atomic(uuid, uuid, text, uuid[], text, text, text)
  to service_role;
commit;
