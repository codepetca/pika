-- Business conflicts must not use serialization_failure: hosted PostgREST 14
-- can retry SQLSTATE 40001 indefinitely, even after the HTTP caller times out.
-- PT409 produces one HTTP conflict. Preserve migration 244's checks, locks,
-- signatures, SECURITY DEFINER/search_path, and existing function ACLs.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
set lock_timeout = '5s';
set statement_timeout = '30s';

create or replace function public.update_test_student_access_atomic(
  p_test_id uuid,
  p_student_ids uuid[],
  p_state text,
  p_updated_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test public.tests%rowtype;
  v_student_ids uuid[];
  v_locked_student_ids uuid[];
  v_previous_closure_context text := current_setting('pika.test_teacher_closure', true);
  v_now timestamptz := now();
  v_locked_count integer := 0;
  v_unlocked_count integer := 0;
  v_inserted_responses integer := 0;
begin
  v_test := private.lock_test_lifecycle(p_test_id);
  perform 1 from public.classrooms
  where id = v_test.classroom_id and teacher_id = p_updated_by and archived_at is null;
  if not found then
    raise exception 'Test access update is not allowed' using errcode = '42501';
  end if;
  if v_test.status = 'draft' then
    raise exception 'Cannot update access for a draft test' using errcode = '22023';
  end if;
  if p_state is null or p_state not in ('open', 'closed') then
    raise exception 'state must be open or closed' using errcode = '22023';
  end if;

  if coalesce(array_length(p_student_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'locked_count', 0,
      'unlocked_count', 0,
      'inserted_responses', 0
    );
  end if;

  if cardinality(p_student_ids) > 100 or array_position(p_student_ids, null) is not null then
    raise exception 'Invalid selected students (maximum 100)' using errcode = '22023';
  end if;
  select array_agg(distinct id order by id) into v_student_ids from unnest(p_student_ids) id;
  -- The route intentionally skips its initial outsiders. Every ID it passed must
  -- still be enrolled after the Classroom/Test locks; never partially mutate on
  -- membership drift while this request waited behind roster removal.
  select coalesce(array_agg(locked.student_id order by locked.student_id), array[]::uuid[])
  into v_locked_student_ids
  from (
    select enrollment.student_id
    from public.classroom_enrollments enrollment
    where enrollment.classroom_id = v_test.classroom_id
      and enrollment.student_id = any(v_student_ids)
    order by enrollment.student_id
    for share
  ) locked;
  if cardinality(v_locked_student_ids) <> cardinality(v_student_ids) then
    raise exception 'Selected students changed; reload and retry' using errcode = 'PT409';
  end if;

  insert into public.test_student_availability (
    test_id,
    student_id,
    state,
    updated_by,
    updated_at
  )
  select
    p_test_id,
    student_id,
    p_state,
    p_updated_by,
    v_now
  from unnest(v_student_ids) as selected_students(student_id)
  on conflict (test_id, student_id) do update
    set state = excluded.state,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  if p_state = 'open' then
    with locked_attempts as materialized (
      select id, student_id
      from public.test_attempts
      where test_id = p_test_id
        and student_id = any(v_student_ids)
        and is_submitted = false
        and closed_for_grading_at is not null
      for update
    ),
    deleted_responses as (
      delete from public.test_responses responses
      using locked_attempts attempts
      where responses.test_id = p_test_id
        and responses.student_id = attempts.student_id
      returning responses.id
    ),
    unlocked_attempts as (
      update public.test_attempts attempts
      set closed_for_grading_at = null,
          closed_for_grading_by = null,
          returned_at = null,
          returned_by = null
      from locked_attempts locked
      where attempts.id = locked.id
      returning attempts.id
    )
    select count(*) into v_unlocked_count
    from unlocked_attempts;

    return jsonb_build_object(
      'locked_count', 0,
      'unlocked_count', v_unlocked_count,
      'inserted_responses', 0
    );
  end if;

  perform set_config('pika.test_teacher_closure', p_test_id::text, true);
  with attempts as materialized (
    select id, student_id, responses
    from public.test_attempts
    where test_id = p_test_id
      and student_id = any(v_student_ids)
      and is_submitted = false
    for update
  ),
  questions as materialized (
    select id, question_type, correct_option, points, options
    from public.test_questions
    where test_id = p_test_id
  ),
  normalized_responses as (
    select
      attempts.student_id,
      questions.id as question_id,
      questions.question_type,
      questions.correct_option,
      questions.points,
      questions.options,
      attempts.responses -> questions.id::text as response
    from attempts
    cross join questions
    where not exists (
      select 1
      from public.test_responses existing
      where existing.test_id = p_test_id
        and existing.question_id = questions.id
        and existing.student_id = attempts.student_id
    )
  ),
  response_rows as (
    select
      p_test_id as test_id,
      question_id,
      student_id,
      case
        when question_type = 'multiple_choice'
          and jsonb_typeof(response) = 'object'
          and response ? 'selected_option'
          and (response ->> 'selected_option') ~ '^[0-9]+$'
          and (response ->> 'selected_option')::integer < jsonb_array_length(options)
          then (response ->> 'selected_option')::integer
        else null
      end as selected_option,
      case
        when question_type = 'open_response'
          and jsonb_typeof(response) = 'object'
          and jsonb_typeof(response -> 'response_text') = 'string'
          then response ->> 'response_text'
        when question_type = 'open_response' then ''
        else null
      end as response_text,
      case
        when question_type = 'open_response'
          and length(trim(
            case
              when jsonb_typeof(response) = 'object'
                and jsonb_typeof(response -> 'response_text') = 'string'
                then response ->> 'response_text'
              else ''
            end
          )) = 0
          then 0
        when question_type = 'multiple_choice'
          and jsonb_typeof(response) = 'object'
          and response ? 'selected_option'
          and (response ->> 'selected_option') ~ '^[0-9]+$'
          and (response ->> 'selected_option')::integer = correct_option
          then points
        when question_type = 'multiple_choice' then 0
        else null
      end as score,
      null::text as feedback,
      case
        when question_type = 'multiple_choice' then v_now
        when question_type = 'open_response'
          and length(trim(
            case
              when jsonb_typeof(response) = 'object'
                and jsonb_typeof(response -> 'response_text') = 'string'
                then response ->> 'response_text'
              else ''
            end
          )) = 0
          then v_now
        else null
      end as graded_at,
      null::uuid as graded_by,
      v_now as submitted_at
    from normalized_responses
    -- Teacher closure materializes every question of an existing started attempt.
    -- An unanswered MC row has NULL selected_option and an explicit zero score.
  ),
  inserted_responses as (
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
    )
    select
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
    from response_rows
    on conflict (question_id, student_id) do nothing
    returning id
  ),
  locked_attempts as (
    update public.test_attempts update_attempts
    set closed_for_grading_at = v_now,
        closed_for_grading_by = p_updated_by,
        returned_at = null,
        returned_by = null
    from attempts
    where update_attempts.id = attempts.id
      and update_attempts.closed_for_grading_at is null
    returning update_attempts.id
  )
  select
    (select count(*) from inserted_responses),
    (select count(*) from locked_attempts)
  into v_inserted_responses, v_locked_count;

  perform set_config('pika.test_teacher_closure', coalesce(v_previous_closure_context, ''), true);
  return jsonb_build_object(
    'locked_count', v_locked_count,
    'unlocked_count', 0,
    'inserted_responses', v_inserted_responses
  );
end;
$$;

create or replace function public.save_test_response_grades_atomic(
  p_test_id uuid,
  p_student_id uuid,
  p_teacher_id uuid,
  p_grade_rows jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom_id uuid;
  v_classroom_teacher_id uuid;
  v_archived_at timestamptz;
  v_test_title text;
  v_grade jsonb;
  v_response public.test_responses%rowtype;
  v_question record;
  v_response_id uuid;
  v_question_id uuid;
  v_expected_revision bigint;
  v_clear boolean;
  v_score numeric(6,2);
  v_feedback text;
  v_ai_basis text;
  v_ai_basis_valid boolean;
  v_ai_answers jsonb;
  v_ai_model text;
  v_ai_model_valid boolean;
  v_ai_question_snapshot jsonb;
  v_ai_suggested_score numeric(6,2);
  v_ai_suggested_feedback text;
  v_ai_suggested_feedback_valid boolean;
  v_saved_count integer := 0;
  v_cleared_count integer := 0;
  v_saved_responses jsonb := '[]'::jsonb;
begin
  if p_now is null then
    raise exception 'Grade timestamp is required' using errcode = '22023';
  end if;
  if p_grade_rows is null
    or jsonb_typeof(p_grade_rows) <> 'array'
    or jsonb_array_length(p_grade_rows) = 0
    or jsonb_array_length(p_grade_rows) > 100
  then
    raise exception 'Grade rows must contain between 1 and 100 items' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text, 0));
  perform private.lock_test_lifecycle(p_test_id);

  select test.classroom_id, classroom.teacher_id, classroom.archived_at, test.title
  into v_classroom_id, v_classroom_teacher_id, v_archived_at, v_test_title
  from public.tests test
  join public.classrooms classroom on classroom.id = test.classroom_id
  where test.id = p_test_id;
  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;

  if v_classroom_teacher_id is distinct from p_teacher_id then
    raise exception 'Test grading is not allowed' using errcode = '42501';
  end if;
  if v_archived_at is not null then
    raise exception 'Classroom is archived' using errcode = '42501';
  end if;

  if exists (
    select 1
    from (
      select row->>'response_id' as response_id, count(*)
      from jsonb_array_elements(p_grade_rows) row
      group by row->>'response_id'
      having count(*) > 1
    ) duplicates
  ) then
    raise exception 'Duplicate response_id in grade rows' using errcode = '22023';
  end if;

  perform 1
  from public.test_questions question
  join public.test_responses response on response.question_id = question.id
  where response.id in (
    select (row->>'response_id')::uuid
    from jsonb_array_elements(p_grade_rows) row
  )
  order by question.id
  for share of question;

  select classroom.teacher_id, classroom.archived_at
  into v_classroom_teacher_id, v_archived_at
  from public.classrooms classroom
  where classroom.id = v_classroom_id
  for share;
  if not found or v_classroom_teacher_id is distinct from p_teacher_id then
    raise exception 'Test grading is not allowed' using errcode = '42501';
  end if;
  if v_archived_at is not null then
    raise exception 'Classroom is archived' using errcode = '42501';
  end if;

  perform 1
  from public.test_responses response
  where response.id in (
    select (row->>'response_id')::uuid
    from jsonb_array_elements(p_grade_rows) row
  )
  order by response.id
  for update;

  for v_grade in select value from jsonb_array_elements(p_grade_rows)
  loop
    if jsonb_typeof(v_grade) <> 'object'
      or jsonb_typeof(v_grade->'response_id') <> 'string'
      or jsonb_typeof(v_grade->'expected_response_revision') <> 'number'
      or jsonb_typeof(v_grade->'clear_grade') <> 'boolean'
    then
      raise exception 'Invalid grade row' using errcode = '22023';
    end if;

    begin
      v_response_id := (v_grade->>'response_id')::uuid;
      v_expected_revision := (v_grade->>'expected_response_revision')::bigint;
      if v_grade ? 'question_id' and jsonb_typeof(v_grade->'question_id') = 'string' then
        v_question_id := (v_grade->>'question_id')::uuid;
      else
        v_question_id := null;
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Invalid grade row identity or revision' using errcode = '22023';
    end;
    if v_expected_revision < 1 then
      raise exception 'Invalid response revision' using errcode = '22023';
    end if;

    select response.*
    into v_response
    from public.test_responses response
    where response.id = v_response_id
      and response.test_id = p_test_id
    for update;
    if not found then
      raise exception 'Test response not found' using errcode = 'P0002';
    end if;
    if p_student_id is not null and v_response.student_id <> p_student_id then
      raise exception 'Test response not found' using errcode = 'P0002';
    end if;
    if v_question_id is not null and v_response.question_id <> v_question_id then
      raise exception 'Test response question does not match' using errcode = '22023';
    end if;
    if v_response.revision <> v_expected_revision then
      raise exception 'Test response grade changed; reload and retry' using errcode = 'PT409';
    end if;

    perform 1
    from public.classroom_enrollments enrollment
    where enrollment.classroom_id = v_classroom_id
      and enrollment.student_id = v_response.student_id
    for share;
    if not found then
      raise exception 'Student is not enrolled in this classroom' using errcode = '22023';
    end if;

    select
      question.id,
      question.question_type,
      question.points,
      question.question_text,
      question.response_monospace,
      question.answer_key,
      question.sample_solution
    into v_question
    from public.test_questions question
    where question.id = v_response.question_id
      and question.test_id = p_test_id
    for share;
    if not found then
      raise exception 'Question not found for response' using errcode = 'P0002';
    end if;
    v_clear := (v_grade->>'clear_grade')::boolean;
    if v_clear then
      v_score := null;
      v_feedback := null;
      v_ai_basis := null;
      v_ai_answers := null;
      v_ai_model := null;
      v_ai_question_snapshot := null;
      v_ai_suggested_score := null;
      v_ai_suggested_feedback := null;
      v_cleared_count := v_cleared_count + 1;
    else
      if jsonb_typeof(v_grade->'score') <> 'number' then
        raise exception 'score must be a non-negative number' using errcode = '22023';
      end if;
      begin
        v_score := (v_grade->>'score')::numeric(6,2);
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'score must be a non-negative number' using errcode = '22023';
      end;
      if v_score < 0 or v_score > coalesce(v_question.points, 0) then
        raise exception 'score cannot exceed %', coalesce(v_question.points, 0) using errcode = '22023';
      end if;

      if v_grade->'feedback' is null or jsonb_typeof(v_grade->'feedback') = 'null' then
        v_feedback := null;
      elsif jsonb_typeof(v_grade->'feedback') = 'string' then
        v_feedback := nullif(btrim(v_grade->>'feedback'), '');
      else
        raise exception 'feedback must be a string or null' using errcode = '22023';
      end if;
      if v_feedback is not null and char_length(v_feedback) > 10000 then
        raise exception 'feedback is too long' using errcode = '22023';
      end if;

      if not (v_grade ? 'ai_grading_basis') then
        if v_grade ? 'ai_reference_answers'
          or v_grade ? 'ai_model'
          or v_grade ? 'question_grading_snapshot'
          or v_grade ? 'ai_suggested_score'
          or v_grade ? 'ai_suggested_feedback'
        then
          raise exception 'AI grading metadata is invalid' using errcode = '22023';
        end if;
        v_ai_basis := v_response.ai_grading_basis;
        v_ai_answers := v_response.ai_reference_answers;
        v_ai_model := v_response.ai_model;
        v_ai_question_snapshot := null;
        v_ai_suggested_score := v_response.ai_suggested_score;
        v_ai_suggested_feedback := v_response.ai_suggested_feedback;
      else
        v_ai_basis_valid := true;
        if v_grade->'ai_grading_basis' is null
          or jsonb_typeof(v_grade->'ai_grading_basis') = 'null'
        then
          v_ai_basis := null;
        elsif jsonb_typeof(v_grade->'ai_grading_basis') = 'string' then
          v_ai_basis := v_grade->>'ai_grading_basis';
        else
          v_ai_basis := null;
          v_ai_basis_valid := false;
        end if;
        v_ai_answers := case
          when v_grade->'ai_reference_answers' is null
            or jsonb_typeof(v_grade->'ai_reference_answers') = 'null'
          then null
          else v_grade->'ai_reference_answers'
        end;
        v_ai_model_valid := true;
        if v_grade->'ai_model' is null or jsonb_typeof(v_grade->'ai_model') = 'null' then
          v_ai_model := null;
        elsif jsonb_typeof(v_grade->'ai_model') = 'string' then
          v_ai_model := nullif(btrim(v_grade->>'ai_model'), '');
        else
          v_ai_model := null;
          v_ai_model_valid := false;
        end if;
        v_ai_question_snapshot := case
          when v_grade->'question_grading_snapshot' is null
            or jsonb_typeof(v_grade->'question_grading_snapshot') = 'null'
          then null
          else v_grade->'question_grading_snapshot'
        end;
        if v_grade->'ai_suggested_score' is null
          or jsonb_typeof(v_grade->'ai_suggested_score') = 'null'
        then
          v_ai_suggested_score := null;
        elsif jsonb_typeof(v_grade->'ai_suggested_score') = 'number' then
          begin
            v_ai_suggested_score := (v_grade->>'ai_suggested_score')::numeric(6,2);
          exception when invalid_text_representation or numeric_value_out_of_range then
            raise exception 'AI suggested score is invalid' using errcode = '22023';
          end;
        else
          raise exception 'AI suggested score is invalid' using errcode = '22023';
        end if;
        v_ai_suggested_feedback_valid := true;
        if v_grade->'ai_suggested_feedback' is null
          or jsonb_typeof(v_grade->'ai_suggested_feedback') = 'null'
        then
          v_ai_suggested_feedback := null;
        elsif jsonb_typeof(v_grade->'ai_suggested_feedback') = 'string' then
          v_ai_suggested_feedback := v_grade->>'ai_suggested_feedback';
        else
          v_ai_suggested_feedback := null;
          v_ai_suggested_feedback_valid := false;
        end if;

        if not v_ai_basis_valid
          or not v_ai_model_valid
          or not v_ai_suggested_feedback_valid
        then
          raise exception 'AI grading metadata is invalid' using errcode = '22023';
        end if;
        if v_ai_basis is not null and v_question.question_type <> 'open_response' then
          raise exception 'AI grading metadata is only supported for open-response questions' using errcode = '22023';
        end if;
        if v_ai_basis not in ('teacher_key', 'generated_reference')
          or (v_ai_basis is null and (v_ai_answers is not null or v_ai_model is not null))
          or (v_ai_basis is null and (
            v_ai_question_snapshot is not null
            or v_ai_suggested_score is not null
            or v_ai_suggested_feedback is not null
          ))
          or (v_ai_basis is not null and v_ai_model is null)
          or (v_ai_basis is not null and (
            v_ai_suggested_score is null
            or v_ai_suggested_score < 0
            or v_ai_suggested_score > coalesce(v_question.points, 0)
            or v_ai_suggested_feedback is null
            or char_length(v_ai_suggested_feedback) > 10000
          ))
          or (v_ai_basis is not null and (
            v_ai_question_snapshot is null
            or jsonb_typeof(v_ai_question_snapshot) <> 'object'
          ))
          or (v_ai_basis = 'teacher_key' and v_ai_answers is not null)
          or (v_ai_basis = 'generated_reference' and (
            v_ai_answers is null
            or jsonb_typeof(v_ai_answers) <> 'array'
            or jsonb_array_length(v_ai_answers) < 1
            or jsonb_array_length(v_ai_answers) > 3
            or exists (
              select 1 from jsonb_array_elements(v_ai_answers) answer
              where jsonb_typeof(answer) <> 'string'
                or btrim(answer #>> '{}') = ''
                or char_length(answer #>> '{}') > 10000
            )
          ))
        then
          raise exception 'AI grading metadata is invalid' using errcode = '22023';
        end if;
        if v_ai_basis is not null and v_ai_question_snapshot is distinct from jsonb_build_object(
          'test_title', v_test_title,
          'question_text', v_question.question_text,
          'points', v_question.points,
          'response_monospace', v_question.response_monospace,
          'answer_key', v_question.answer_key,
          'sample_solution', v_question.sample_solution
        ) then
          raise exception 'Question changed; generate a new AI suggestion' using errcode = 'PT409';
        end if;
        if v_ai_model is not null and char_length(v_ai_model) > 200 then
          raise exception 'AI model is too long' using errcode = '22023';
        end if;
      end if;
    end if;

    update public.test_responses response
    set
      score = v_score,
      feedback = v_feedback,
      graded_at = case when v_clear then null else p_now end,
      graded_by = case when v_clear then null else p_teacher_id end,
      ai_grading_basis = v_ai_basis,
      ai_reference_answers = v_ai_answers,
      ai_model = v_ai_model,
      ai_suggested_score = v_ai_suggested_score,
      ai_suggested_feedback = v_ai_suggested_feedback
    where response.id = v_response_id
    returning response.* into v_response;

    v_saved_count := v_saved_count + 1;
    v_saved_responses := v_saved_responses || jsonb_build_array(jsonb_build_object(
      'id', v_response.id,
      'revision', v_response.revision,
      'score', v_response.score,
      'feedback', v_response.feedback
    ));
  end loop;

  perform private.revoke_incomplete_test_returns(p_test_id, (
    select coalesce(array_agg(distinct response.student_id), array[]::uuid[])
    from jsonb_array_elements(p_grade_rows) grade
    join public.test_responses response on response.id = (grade->>'response_id')::uuid
    where response.test_id = p_test_id and (grade->>'clear_grade')::boolean
  ));

  return jsonb_build_object(
    'saved_count', v_saved_count,
    'cleared_count', v_cleared_count,
    'responses', v_saved_responses
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid grade row identity or revision' using errcode = '22023';
end;
$$;

create or replace function public.clear_test_open_response_grades_atomic(
  p_test_id uuid,
  p_teacher_id uuid,
  p_student_ids uuid[],
  p_expected_responses jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom_id uuid;
  v_classroom_teacher_id uuid;
  v_archived_at timestamptz;
  v_student_ids uuid[];
  v_requested_count integer;
  v_locked_student_ids uuid[];
  v_expected_count integer;
  v_current_count integer;
  v_cleared_responses integer := 0;
  v_cleared_students integer := 0;
begin
  select coalesce(array_agg(student_id order by student_id), array[]::uuid[])
  into v_student_ids
  from (select distinct student_id from unnest(coalesce(p_student_ids, array[]::uuid[])) selected(student_id)) ids;
  v_requested_count := cardinality(v_student_ids);
  if v_requested_count = 0 or v_requested_count > 100 then
    raise exception 'Student IDs must contain between 1 and 100 values' using errcode = '22023';
  end if;
  if p_now is null
    or p_expected_responses is null
    or jsonb_typeof(p_expected_responses) <> 'array'
    or jsonb_array_length(p_expected_responses) > 1000
  then
    raise exception 'Expected response revisions are invalid' using errcode = '22023';
  end if;
  v_expected_count := jsonb_array_length(p_expected_responses);
  if v_expected_count <> (
    select count(distinct expected.response_id)
    from jsonb_to_recordset(p_expected_responses) expected(
      response_id uuid,
      expected_response_revision bigint
    )
  ) or exists (
    select 1
    from jsonb_to_recordset(p_expected_responses) expected(
      response_id uuid,
      expected_response_revision bigint
    )
    where expected.response_id is null
      or expected.expected_response_revision is null
      or expected.expected_response_revision < 1
  ) then
    raise exception 'Expected response revisions are invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text, 0));
  perform private.lock_test_lifecycle(p_test_id);

  select test.classroom_id, classroom.teacher_id, classroom.archived_at
  into v_classroom_id, v_classroom_teacher_id, v_archived_at
  from public.tests test
  join public.classrooms classroom on classroom.id = test.classroom_id
  where test.id = p_test_id;
  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;

  if v_classroom_teacher_id is distinct from p_teacher_id then
    raise exception 'Test grading is not allowed' using errcode = '42501';
  end if;
  if v_archived_at is not null then
    raise exception 'Classroom is archived' using errcode = '42501';
  end if;

  select coalesce(array_agg(locked.student_id order by locked.student_id), array[]::uuid[])
  into v_locked_student_ids
  from (
    select enrollment.student_id
    from public.classroom_enrollments enrollment
    where enrollment.classroom_id = v_classroom_id
      and enrollment.student_id = any(v_student_ids)
    order by enrollment.student_id
    for share
  ) locked;
  if cardinality(v_locked_student_ids) <> v_requested_count then
    raise exception 'One or more selected students are not enrolled in this classroom' using errcode = '22023';
  end if;

  perform 1
  from public.test_questions question
  where question.id in (
    select response.question_id
    from public.test_responses response
    where response.test_id = p_test_id
      and response.student_id = any(v_student_ids)
  )
  order by question.id
  for share;

  perform 1
  from public.tests test
  where test.id = p_test_id
  for update;
  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;

  select classroom.teacher_id, classroom.archived_at
  into v_classroom_teacher_id, v_archived_at
  from public.classrooms classroom
  where classroom.id = v_classroom_id
  for share;
  if not found or v_classroom_teacher_id is distinct from p_teacher_id then
    raise exception 'Test grading is not allowed' using errcode = '42501';
  end if;
  if v_archived_at is not null then
    raise exception 'Classroom is archived' using errcode = '42501';
  end if;

  perform 1
  from public.test_responses response
  where response.test_id = p_test_id
    and response.student_id = any(v_student_ids)
  order by response.id
  for update;

  select count(*) into v_current_count
  from public.test_responses response
  join public.test_questions question on question.id = response.question_id
  where response.test_id = p_test_id
    and response.student_id = any(v_student_ids)
    and question.question_type = 'open_response';
  if v_current_count <> v_expected_count
    or exists (
      select 1
      from public.test_responses response
      join public.test_questions question on question.id = response.question_id
      left join jsonb_to_recordset(p_expected_responses) expected(
        response_id uuid,
        expected_response_revision bigint
      ) on expected.response_id = response.id
      where response.test_id = p_test_id
        and response.student_id = any(v_student_ids)
        and question.question_type = 'open_response'
        and (
          expected.response_id is null
          or expected.expected_response_revision <> response.revision
        )
    )
  then
    raise exception 'Test response grade changed; reload and retry' using errcode = 'PT409';
  end if;

  with candidates as materialized (
    select
      response.id,
      response.student_id,
      (
        response.score is not null
        or response.feedback is not null
        or response.graded_at is not null
        or response.graded_by is not null
        or response.ai_grading_basis is not null
        or response.ai_reference_answers is not null
        or response.ai_model is not null
        or response.ai_suggested_score is not null
        or response.ai_suggested_feedback is not null
      ) as had_grade
    from public.test_responses response
    join public.test_questions question on question.id = response.question_id
    join jsonb_to_recordset(p_expected_responses) expected(
      response_id uuid,
      expected_response_revision bigint
    ) on expected.response_id = response.id
      and expected.expected_response_revision = response.revision
    where response.test_id = p_test_id
      and response.student_id = any(v_student_ids)
      and question.question_type = 'open_response'
  ),
  cleared as (
    update public.test_responses response
    set
      score = null,
      feedback = null,
      graded_at = null,
      graded_by = null,
      ai_grading_basis = null,
      ai_reference_answers = null,
      ai_model = null,
      ai_suggested_score = null,
      ai_suggested_feedback = null
    from candidates
    where response.id = candidates.id
      and candidates.had_grade
    returning candidates.student_id, candidates.had_grade
  )
  select
    count(*) filter (where had_grade),
    count(distinct student_id) filter (where had_grade)
  into v_cleared_responses, v_cleared_students
  from cleared;

  perform private.revoke_incomplete_test_returns(p_test_id, v_student_ids);

  return jsonb_build_object(
    'cleared_students', v_cleared_students,
    'skipped_students', v_requested_count - v_cleared_students,
    'cleared_responses', v_cleared_responses
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Expected response revisions are invalid' using errcode = '22023';
end;
$$;

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
  -- Idempotent finalization now leaves already closed/returned attempts untouched.
  if v_test.status = 'closed' then perform public.finalize_test_attempts_for_grading_atomic(p_test_id, v_ids, p_returned_by); end if;
  perform 1 from public.test_attempts where test_id = p_test_id and student_id = any(v_ids) order by student_id for update;
  perform 1 from public.test_responses where test_id = p_test_id and student_id = any(v_ids) order by id for update;
  -- Completeness matches gradebook eligibility: every current question has a finite score.
  select coalesce(array_agg(attempt.student_id order by attempt.student_id), array[]::uuid[]) into v_eligible
  from public.test_attempts attempt
  where attempt.test_id = p_test_id and attempt.student_id = any(v_ids)
    and (attempt.is_submitted or attempt.closed_for_grading_at is not null)
    and exists (select 1 from public.test_questions where test_id = p_test_id)
    and not exists (
      select 1 from public.test_questions question left join public.test_responses response
        on response.question_id = question.id and response.student_id = attempt.student_id and response.test_id = p_test_id
      where question.test_id = p_test_id and (response.id is null or response.score is null or response.score::text in ('NaN', 'Infinity', '-Infinity'))
    );
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

reset lock_timeout;
reset statement_timeout;
