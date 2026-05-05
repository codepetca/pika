-- Atomically update selected-student test access and related attempt state.

create or replace function public.update_test_student_access_atomic(
  p_test_id uuid,
  p_student_ids uuid[],
  p_state text,
  p_updated_by uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_locked_count integer := 0;
  v_unlocked_count integer := 0;
  v_inserted_responses integer := 0;
begin
  if p_state not in ('open', 'closed') then
    raise exception 'state must be open or closed' using errcode = '22023';
  end if;

  if coalesce(array_length(p_student_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'locked_count', 0,
      'unlocked_count', 0,
      'inserted_responses', 0
    );
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
  from unnest(p_student_ids) as selected_students(student_id)
  on conflict (test_id, student_id) do update
    set state = excluded.state,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  if p_state = 'open' then
    with locked_attempts as materialized (
      select id, student_id
      from public.test_attempts
      where test_id = p_test_id
        and student_id = any(p_student_ids)
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

  with attempts as materialized (
    select id, student_id, responses
    from public.test_attempts
    where test_id = p_test_id
      and student_id = any(p_student_ids)
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
    where question_type = 'open_response'
      or (
        question_type = 'multiple_choice'
        and jsonb_typeof(response) = 'object'
        and response ? 'selected_option'
        and (response ->> 'selected_option') ~ '^[0-9]+$'
        and (response ->> 'selected_option')::integer < jsonb_array_length(options)
      )
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
    returning update_attempts.id
  )
  select
    (select count(*) from inserted_responses),
    (select count(*) from locked_attempts)
  into v_inserted_responses, v_locked_count;

  return jsonb_build_object(
    'locked_count', v_locked_count,
    'unlocked_count', 0,
    'inserted_responses', v_inserted_responses
  );
end;
$$;

revoke all on function public.update_test_student_access_atomic(uuid, uuid[], text, uuid) from public;
grant execute on function public.update_test_student_access_atomic(uuid, uuid[], text, uuid) to service_role;
