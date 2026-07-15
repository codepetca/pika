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
      raise exception 'Test response grade changed; reload and retry' using errcode = '40001';
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
          raise exception 'Question changed; generate a new AI suggestion' using errcode = '40001';
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
  if p_expected_responses is null
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
    raise exception 'Test response grade changed; reload and retry' using errcode = '40001';
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
     and attempt.is_submitted = true
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
        raise exception 'Test response changed; reload and retry' using errcode = '40001';
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
      or btrim(coalesce(v_response.response_text, '')) <> ''
    then
      raise exception 'Test response changed; reload and retry' using errcode = '40001';
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
    and attempt.is_submitted = true;
  v_current_eligible_count := cardinality(v_current_eligible_student_ids);
  if v_current_eligible_count <> p_eligible_student_count
    or v_current_eligible_student_ids is distinct from v_eligible_student_ids
  then
    raise exception 'Test submission state changed; reload and retry' using errcode = '40001';
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
    raise exception 'Test response changed; reload and retry' using errcode = '40001';
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
    raise exception 'Test AI grading run items were not created' using errcode = '40001';
  end if;

  return jsonb_build_object('outcome', 'created', 'run_id', v_run.id);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Test AI grading run payload is invalid' using errcode = '22023';
end;
$$;

create or replace function public.claim_test_ai_grading_run(
  p_run_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns setof public.test_ai_grading_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_run_id is null or p_lease_token is null or p_lease_seconds is null then
    raise exception 'Test AI grading lease claim is invalid' using errcode = '22023';
  end if;

  return query
    update public.test_ai_grading_runs run
    set
      status = case when run.status = 'queued' then 'running' else run.status end,
      lease_token = p_lease_token,
      lease_expires_at = clock_timestamp() + make_interval(secs => greatest(p_lease_seconds, 1)),
      started_at = coalesce(run.started_at, clock_timestamp()),
      completed_at = null
    where run.id = p_run_id
      and run.status in ('queued', 'running')
      and (run.lease_expires_at is null or run.lease_expires_at <= clock_timestamp())
    returning run.*;
end;
$$;

create or replace function public.renew_test_ai_grading_run_lease(
  p_run_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_run_id is null
    or p_lease_token is null
    or p_lease_seconds is null
    or p_lease_seconds < 1
  then
    raise exception 'Test AI grading lease renewal is invalid' using errcode = '22023';
  end if;

  update public.test_ai_grading_runs run
  set lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  where run.id = p_run_id
    and run.status in ('queued', 'running')
    and run.lease_token = p_lease_token
    and run.lease_expires_at > clock_timestamp();
  if not found then
    raise exception 'Test AI grading lease changed; stop this worker' using errcode = '40001';
  end if;
  return true;
end;
$$;

create or replace function public.set_test_ai_grading_item_state_atomic(
  p_item_id uuid,
  p_lease_token uuid,
  p_status text,
  p_attempt_count integer,
  p_next_retry_at timestamptz,
  p_last_error_code text,
  p_last_error_message text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_question_grading_snapshot jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_run public.test_ai_grading_runs%rowtype;
  v_item public.test_ai_grading_run_items%rowtype;
begin
  if p_status is null
    or p_status not in ('queued', 'processing', 'failed')
    or p_attempt_count is null
    or p_attempt_count < 0
    or p_item_id is null
    or p_lease_token is null
  then
    raise exception 'Test AI grading item state is invalid' using errcode = '22023';
  end if;
  if p_status = 'processing' and (
    p_question_grading_snapshot is null
    or jsonb_typeof(p_question_grading_snapshot) <> 'object'
  ) then
    raise exception 'Test AI grading question snapshot is required' using errcode = '22023';
  end if;

  select item.run_id into v_run_id
  from public.test_ai_grading_run_items item
  where item.id = p_item_id;
  if not found then
    raise exception 'Test AI grading item not found' using errcode = 'P0002';
  end if;

  select run.* into v_run
  from public.test_ai_grading_runs run
  where run.id = v_run_id
  for update;
  if not found
    or v_run.status not in ('queued', 'running')
    or v_run.lease_token is distinct from p_lease_token
    or v_run.lease_expires_at is null
    or v_run.lease_expires_at <= clock_timestamp()
  then
    raise exception 'Test AI grading lease changed; stop this worker' using errcode = '40001';
  end if;

  select item.* into v_item
  from public.test_ai_grading_run_items item
  where item.id = p_item_id
    and item.run_id = v_run_id
  for update;
  if not found then
    raise exception 'Test AI grading item not found' using errcode = 'P0002';
  end if;
  if v_item.status not in ('queued', 'processing') then
    raise exception 'Test AI grading item state is invalid' using errcode = '22023';
  end if;

  update public.test_ai_grading_run_items item
  set
    status = p_status,
    attempt_count = greatest(coalesce(p_attempt_count, 0), item.attempt_count),
    next_retry_at = p_next_retry_at,
    last_error_code = p_last_error_code,
    last_error_message = p_last_error_message,
    started_at = coalesce(item.started_at, p_started_at),
    completed_at = p_completed_at,
    question_grading_snapshot = case
      when p_status = 'processing'
        then coalesce(item.question_grading_snapshot, p_question_grading_snapshot)
      else item.question_grading_snapshot
    end
  where item.id = p_item_id;
  return true;
end;
$$;

create or replace function public.finalize_test_ai_grading_item_atomic(
  p_item_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid,
  p_score numeric,
  p_feedback text,
  p_ai_grading_basis text,
  p_ai_reference_answers jsonb,
  p_ai_model text,
  p_attempt_count integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_test_id uuid;
  v_question_id uuid;
  v_classroom_teacher_id uuid;
  v_archived_at timestamptz;
  v_test_title text;
  v_run public.test_ai_grading_runs%rowtype;
  v_item public.test_ai_grading_run_items%rowtype;
  v_response public.test_responses%rowtype;
  v_points numeric;
  v_question_type text;
  v_question_grading_snapshot jsonb;
begin
  if p_item_id is null
    or p_teacher_id is null
    or p_lease_token is null
    or p_now is null
    or p_attempt_count is null
    or p_attempt_count < 1
  then
    raise exception 'AI grade finalization metadata is invalid' using errcode = '22023';
  end if;

  select item.run_id, item.test_id, item.question_id into v_run_id, v_test_id, v_question_id
  from public.test_ai_grading_run_items item
  where item.id = p_item_id;
  if not found then
    raise exception 'Test AI grading item not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_test_id::text, 0));

  select classroom.teacher_id, classroom.archived_at, test.title
  into v_classroom_teacher_id, v_archived_at, v_test_title
  from public.tests test
  join public.classrooms classroom on classroom.id = test.classroom_id
  where test.id = v_test_id;
  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;
  if v_classroom_teacher_id is distinct from p_teacher_id then
    raise exception 'Test AI grading item mutation is not allowed' using errcode = '42501';
  end if;
  if v_archived_at is not null then
    raise exception 'Classroom is archived' using errcode = '42501';
  end if;

  perform 1
  from public.test_questions question
  where question.id = v_question_id
    and question.test_id = v_test_id
  for share;
  if not found then
    raise exception 'AI grading requires an open-response question' using errcode = '22023';
  end if;

  select classroom.teacher_id, classroom.archived_at
  into v_classroom_teacher_id, v_archived_at
  from public.tests test
  join public.classrooms classroom on classroom.id = test.classroom_id
  where test.id = v_test_id
  for share of classroom;
  if not found or v_classroom_teacher_id is distinct from p_teacher_id then
    raise exception 'Test AI grading item mutation is not allowed' using errcode = '42501';
  end if;
  if v_archived_at is not null then
    raise exception 'Classroom is archived' using errcode = '42501';
  end if;

  select run.* into v_run
  from public.test_ai_grading_runs run
  where run.id = v_run_id
  for update;
  if not found or v_run.triggered_by is distinct from p_teacher_id then
    raise exception 'Test AI grading item mutation is not allowed' using errcode = '42501';
  end if;

  select item.* into v_item
  from public.test_ai_grading_run_items item
  where item.id = p_item_id
    and item.run_id = v_run_id
  for update;
  if not found then
    raise exception 'Test AI grading item not found' using errcode = 'P0002';
  end if;

  if v_item.status = 'completed' then
    select response.* into v_response
    from public.test_responses response
    where response.id = v_item.response_id;
    return jsonb_build_object('outcome', 'replayed', 'response', jsonb_build_object(
      'id', v_response.id,
      'revision', v_response.revision,
      'score', v_response.score,
      'feedback', v_response.feedback
    ));
  end if;

  if v_run.status not in ('queued', 'running')
    or v_run.lease_token is distinct from p_lease_token
    or v_run.lease_expires_at is null
    or v_run.lease_expires_at <= clock_timestamp()
  then
    raise exception 'Test AI grading lease changed; stop this worker' using errcode = '40001';
  end if;
  if v_item.status not in ('queued', 'processing') then
    raise exception 'Test AI grading item state is invalid' using errcode = '22023';
  end if;

  select response.* into v_response
  from public.test_responses response
  where response.id = v_item.response_id
    and response.test_id = v_item.test_id
    and response.student_id = v_item.student_id
    and response.question_id = v_item.question_id
  for update;
  if not found then
    raise exception 'Test response not found' using errcode = 'P0002';
  end if;

  if v_response.revision <> v_item.response_revision then
    update public.test_ai_grading_run_items item
    set
      status = 'failed',
      attempt_count = greatest(coalesce(p_attempt_count, 0), item.attempt_count),
      next_retry_at = null,
      last_error_code = 'source_revision_conflict',
      last_error_message = 'Response changed after AI grading started; start a new grading run',
      started_at = coalesce(item.started_at, p_now),
      completed_at = p_now
    where item.id = p_item_id;
    return jsonb_build_object('outcome', 'stale', 'response', null);
  end if;

  select
    question.points,
    question.question_type,
    jsonb_build_object(
      'test_title', v_test_title,
      'question_text', question.question_text,
      'points', question.points,
      'response_monospace', question.response_monospace,
      'answer_key', question.answer_key,
      'sample_solution', question.sample_solution
    )
  into v_points, v_question_type, v_question_grading_snapshot
  from public.test_questions question
  where question.id = v_item.question_id
    and question.test_id = v_item.test_id
  for share;
  if not found or v_question_type <> 'open_response' then
    raise exception 'AI grading requires an open-response question' using errcode = '22023';
  end if;
  if v_item.question_grading_snapshot is distinct from v_question_grading_snapshot then
    update public.test_ai_grading_run_items item
    set
      status = 'failed',
      attempt_count = greatest(coalesce(p_attempt_count, 0), item.attempt_count),
      next_retry_at = null,
      last_error_code = 'question_revision_conflict',
      last_error_message = 'Question changed after AI grading started; start a new grading run',
      started_at = coalesce(item.started_at, p_now),
      completed_at = p_now
    where item.id = p_item_id;
    return jsonb_build_object('outcome', 'stale', 'response', null);
  end if;
  if p_score is null or p_score < 0 or p_score > coalesce(v_points, 0) then
    raise exception 'AI grade score is invalid' using errcode = '22023';
  end if;
  if p_feedback is null or char_length(p_feedback) > 10000 then
    raise exception 'AI grade feedback is invalid' using errcode = '22023';
  end if;
  if p_ai_grading_basis is null
    or p_ai_grading_basis not in ('teacher_key', 'generated_reference')
    or p_ai_model is null
    or btrim(p_ai_model) = ''
    or char_length(p_ai_model) > 200
    or (p_ai_grading_basis = 'teacher_key' and p_ai_reference_answers is not null)
    or (p_ai_grading_basis = 'generated_reference' and (
      p_ai_reference_answers is null
      or jsonb_typeof(p_ai_reference_answers) <> 'array'
      or jsonb_array_length(p_ai_reference_answers) < 1
      or jsonb_array_length(p_ai_reference_answers) > 3
      or exists (
        select 1 from jsonb_array_elements(p_ai_reference_answers) answer
        where jsonb_typeof(answer) <> 'string'
          or btrim(answer #>> '{}') = ''
          or char_length(answer #>> '{}') > 10000
      )
    ))
  then
    raise exception 'AI grading metadata is invalid' using errcode = '22023';
  end if;

  update public.test_responses response
  set
    score = round(p_score, 2),
    feedback = p_feedback,
    graded_at = p_now,
    graded_by = p_teacher_id,
    ai_grading_basis = p_ai_grading_basis,
    ai_reference_answers = p_ai_reference_answers,
    ai_model = p_ai_model,
    ai_suggested_score = round(p_score, 2),
    ai_suggested_feedback = p_feedback
  where response.id = v_item.response_id
  returning response.* into v_response;

  update public.test_ai_grading_run_items item
  set
    status = 'completed',
    attempt_count = greatest(coalesce(p_attempt_count, 0), item.attempt_count),
    next_retry_at = null,
    last_error_code = null,
    last_error_message = null,
    started_at = coalesce(item.started_at, p_now),
    completed_at = p_now
  where item.id = p_item_id;

  return jsonb_build_object('outcome', 'saved', 'response', jsonb_build_object(
    'id', v_response.id,
    'revision', v_response.revision,
    'score', v_response.score,
    'feedback', v_response.feedback
  ));
end;
$$;

create or replace function public.delete_test_atomic(
  p_test_id uuid,
  p_teacher_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom_teacher_id uuid;
  v_archived_at timestamptz;
  v_responses_count integer;
begin
  if p_test_id is null or p_teacher_id is null then
    raise exception 'Test deletion payload is invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text, 0));

  select classroom.teacher_id, classroom.archived_at
  into v_classroom_teacher_id, v_archived_at
  from public.tests test
  join public.classrooms classroom on classroom.id = test.classroom_id
  where test.id = p_test_id;
  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;
  if v_classroom_teacher_id is distinct from p_teacher_id then
    raise exception 'Test deletion is not allowed' using errcode = '42501';
  end if;
  if v_archived_at is not null then
    raise exception 'Classroom is archived' using errcode = '42501';
  end if;

  select count(*) into v_responses_count
  from public.test_responses response
  where response.test_id = p_test_id;

  delete from public.tests test
  where test.id = p_test_id;
  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'responses_count', v_responses_count
  );
end;
$$;

-- Archive restore rows are version-adapted before the exact schema check.
-- Add future schema adapters here when archived resource columns change.
create or replace function public.normalize_classroom_archive_restore_row(
  p_operation_id uuid,
  p_table_name text,
  p_row jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_response_revision bigint;
  v_missing_response_revision boolean;
begin
  if p_table_name = 'test_responses' then
    if not (p_row ? 'revision') or jsonb_typeof(p_row->'revision') = 'null' then
      p_row := p_row || jsonb_build_object('revision', 1);
    end if;
    if not (p_row ? 'ai_suggested_score') then
      p_row := p_row || jsonb_build_object('ai_suggested_score', null);
    end if;
    if not (p_row ? 'ai_suggested_feedback') then
      p_row := p_row || jsonb_build_object('ai_suggested_feedback', null);
    end if;
    return p_row;
  end if;

  if p_table_name = 'test_ai_grading_run_items' then
    v_missing_response_revision := not (p_row ? 'response_revision')
      or jsonb_typeof(p_row->'response_revision') = 'null';
    if v_missing_response_revision then
      select coalesce((staged.row_data->>'revision')::bigint, 1)
      into v_response_revision
      from public.classroom_archive_restore_staging staged
      where staged.operation_id = p_operation_id
        and staged.table_name = 'test_responses'
        and staged.row_id::text = p_row->>'response_id';

      p_row := p_row || jsonb_build_object(
        'response_revision', coalesce(v_response_revision, 1)
      );
    end if;
    if p_row->>'status' in ('queued', 'processing') then
      p_row := p_row || jsonb_build_object(
        'status', 'failed',
        'next_retry_at', null,
        'last_error_code', case
          when v_missing_response_revision then 'revision_baseline_unavailable'
          when p_row->>'last_error_code' is null then 'archive_restore_invalidated'
          else p_row->>'last_error_code'
        end,
        'last_error_message', 'Retry this response in a new AI grading run',
        'completed_at', coalesce(p_row->'updated_at', p_row->'created_at')
      );
    end if;
    if not (p_row ? 'question_grading_snapshot') then
      p_row := p_row || jsonb_build_object('question_grading_snapshot', null);
    end if;
    return p_row;
  end if;

  if p_table_name = 'test_ai_grading_runs'
    and p_row->>'status' in ('queued', 'running')
  then
    p_row := p_row || jsonb_build_object(
      'status', 'failed',
      'processed_count', coalesce((p_row->>'queued_response_count')::integer, 0),
      'failed_count', greatest(
        coalesce((p_row->>'failed_count')::integer, 0),
        coalesce((p_row->>'queued_response_count')::integer, 0)
          - coalesce((p_row->>'completed_count')::integer, 0)
      ),
      'lease_token', null,
      'lease_expires_at', null,
      'completed_at', coalesce(p_row->'updated_at', p_row->'created_at')
    );
    return p_row;
  end if;

  return p_row;
end;
$$;

create or replace function public.stage_classroom_archive_restore_rows(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_table_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_operation public.classroom_archive_operations;
  v_contract public.classroom_archive_resource_contract;
  v_expected_columns text[];
  v_actual_columns text[];
  v_expected_count integer;
  v_staged_count integer;
  v_row jsonb;
  v_row_id uuid;
  v_parent_id uuid;
  v_actor_column text;
  v_actor_id uuid;
  v_existing jsonb;
  v_typed_row jsonb;
begin
  if p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 500
    or pg_column_size(p_rows) > 1048576
  then
    raise exception 'Restore staging batch must contain 1-500 rows and be at most 1 MiB'
      using errcode = '22023';
  end if;

  select * into v_operation
  from public.classroom_archive_operations
  where id = p_operation_id
  for update;
  if v_operation.id is null
    or v_operation.teacher_id <> p_teacher_id
    or v_operation.operation_type not in ('restore', 'compact')
  then
    return jsonb_build_object(
      'ok', false,
      'status', 404,
      'operation_id', p_operation_id,
      'error_code', 'restore_operation_not_found',
      'error', 'Restore operation not found',
      'retryable', false
    );
  end if;
  if v_operation.status = 'snapshot_ready'
    and v_operation.snapshot_expires_at <= clock_timestamp()
  then
    update public.classroom_archive_operations
    set
      status = 'failed',
      error_code = 'archive_snapshot_expired',
      retryable = false,
      updated_at = clock_timestamp()
    where id = p_operation_id;
    delete from public.classroom_archive_restore_staging where operation_id = p_operation_id;
    update public.classroom_archive_object_upload_cleanup
    set status = 'pending', next_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
    where operation_id = p_operation_id and status = 'staged';
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', 'archive_snapshot_expired',
      'error', 'Restore staging expired',
      'retryable', false
    );
  end if;
  if v_operation.status <> 'snapshot_ready' then
    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'operation_id', p_operation_id,
      'error_code', coalesce(v_operation.error_code, 'restore_staging_not_ready'),
      'error', 'Restore staging is not available',
      'retryable', coalesce(v_operation.retryable, false)
    );
  end if;

  select * into v_contract
  from public.classroom_archive_resource_contract
  where table_name = p_table_name;
  if v_contract.table_name is null then
    raise exception 'Unknown classroom archive restore resource: %', p_table_name
      using errcode = '22023';
  end if;

  select array_agg(attribute.attname order by attribute.attname)
  into v_expected_columns
  from pg_attribute attribute
  join pg_class relation on relation.oid = attribute.attrelid
  join pg_namespace relation_namespace on relation_namespace.oid = relation.relnamespace
  where relation_namespace.nspname = 'public'
    and relation.relname = p_table_name
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = '';

  v_expected_count := (v_operation.resource_counts->>p_table_name)::integer;
  select count(*) into v_staged_count
  from public.classroom_archive_restore_staging
  where operation_id = p_operation_id and table_name = p_table_name;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'Restore row for % must be an object', p_table_name
        using errcode = '22023';
    end if;
    v_row := public.normalize_classroom_archive_restore_row(
      p_operation_id,
      p_table_name,
      v_row
    );
    select array_agg(key order by key) into v_actual_columns
    from jsonb_object_keys(v_row) key;
    if v_actual_columns is distinct from v_expected_columns then
      raise exception 'Restore row columns do not match current schema for %', p_table_name
        using errcode = '22023';
    end if;
    begin
      execute format(
        'select to_jsonb(typed_row) from jsonb_populate_record(null::public.%I, $1) typed_row',
        p_table_name
      ) into v_typed_row using v_row;
    exception when others then
      raise exception 'Restore row types do not match current schema for %', p_table_name
        using errcode = '22023';
    end;

    begin
      v_row_id := nullif(v_row->>v_contract.primary_key_columns[1], '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Restore row has an invalid primary key for %', p_table_name
        using errcode = '22023';
    end;
    if v_row_id is null then
      raise exception 'Restore row is missing its primary key for %', p_table_name
        using errcode = '22023';
    end if;

    if p_table_name = 'classrooms' then
      if v_row_id <> v_operation.classroom_id
        or nullif(v_row->>'teacher_id', '')::uuid <> v_operation.teacher_id
        or v_row->>'archived_at' is null
      then
        raise exception 'Restore classroom root does not match the cold operation'
          using errcode = '22023';
      end if;
    else
      begin
        v_parent_id := nullif(v_row->>v_contract.parent_column, '')::uuid;
      exception when invalid_text_representation then
        raise exception 'Restore row has an invalid parent for %', p_table_name
          using errcode = '22023';
      end;
      if v_parent_id is null or not exists (
        select 1
        from public.classroom_archive_restore_staging parent
        where parent.operation_id = p_operation_id
          and parent.table_name = v_contract.parent_table
          and parent.row_id = v_parent_id
      ) then
        raise exception 'Restore parent is not staged for %', p_table_name
          using errcode = '23503';
      end if;
    end if;

    foreach v_actor_column in array v_contract.actor_columns
    loop
      begin
        v_actor_id := nullif(v_row->>v_actor_column, '')::uuid;
      exception when invalid_text_representation then
        raise exception 'Restore row has an invalid actor for %.%', p_table_name, v_actor_column
          using errcode = '22023';
      end;
      if v_actor_id is not null
        and not exists (select 1 from public.users where id = v_actor_id)
      then
        raise exception 'Restore actor is unresolved for %.%', p_table_name, v_actor_column
          using errcode = '23503';
      end if;
    end loop;

    select row_data into v_existing
    from public.classroom_archive_restore_staging
    where operation_id = p_operation_id
      and table_name = p_table_name
      and row_id = v_row_id;
    if found and v_existing <> v_row then
      raise exception 'Restore staging replay differs for %.%', p_table_name, v_row_id
        using errcode = '23505';
    end if;
    if not found then
      if v_staged_count >= v_expected_count then
        raise exception 'Restore staging exceeds expected count for %', p_table_name
          using errcode = '22023';
      end if;
      insert into public.classroom_archive_restore_staging (
        operation_id, table_name, row_id, row_data
      ) values (p_operation_id, p_table_name, v_row_id, v_row);
      v_staged_count := v_staged_count + 1;
    end if;
  end loop;

  select count(*) into v_staged_count
  from public.classroom_archive_restore_staging
  where operation_id = p_operation_id and table_name = p_table_name;
  return jsonb_build_object(
    'ok', true,
    'status', 202,
    'operation_id', p_operation_id,
    'table_name', p_table_name,
    'staged_count', v_staged_count,
    'expected_count', v_expected_count
  );
end;
$$;

revoke all on function public.stamp_test_response_revision()
  from public, anon, authenticated;
revoke all on function public.validate_test_ai_grading_item_response_revision()
  from public, anon, authenticated;
revoke all on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_test_response_grades_atomic(uuid, uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.clear_test_open_response_grades_atomic(uuid, uuid, uuid[], jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.save_test_unanswered_grades_atomic(uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.create_test_ai_grading_run_atomic(uuid, uuid, text, uuid[], uuid[], text, integer, integer, integer, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.set_test_ai_grading_item_state_atomic(uuid, uuid, text, integer, timestamptz, text, text, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.finalize_test_ai_grading_item_atomic(uuid, uuid, uuid, numeric, text, text, jsonb, text, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_test_ai_grading_run(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.renew_test_ai_grading_run_lease(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.delete_test_atomic(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.save_test_response_grades_atomic(uuid, uuid, uuid, jsonb, timestamptz)
  to service_role;
grant execute on function public.clear_test_open_response_grades_atomic(uuid, uuid, uuid[], jsonb, timestamptz)
  to service_role;
grant execute on function public.save_test_unanswered_grades_atomic(uuid, uuid, jsonb, timestamptz)
  to service_role;
grant execute on function public.create_test_ai_grading_run_atomic(uuid, uuid, text, uuid[], uuid[], text, integer, integer, integer, jsonb, jsonb, text)
  to service_role;
grant execute on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)
  to service_role;
grant execute on function public.set_test_ai_grading_item_state_atomic(uuid, uuid, text, integer, timestamptz, text, text, timestamptz, timestamptz, jsonb)
  to service_role;
grant execute on function public.finalize_test_ai_grading_item_atomic(uuid, uuid, uuid, numeric, text, text, jsonb, text, integer, timestamptz)
  to service_role;
grant execute on function public.claim_test_ai_grading_run(uuid, uuid, integer)
  to service_role;
grant execute on function public.renew_test_ai_grading_run_lease(uuid, uuid, integer)
  to service_role;
grant execute on function public.delete_test_atomic(uuid, uuid)
  to service_role;
