-- Atomically manage test attempt lifecycle transitions that touch multiple tables.

create or replace function public.finalize_test_attempts_for_grading_atomic(
  p_test_id uuid,
  p_student_ids uuid[],
  p_closed_by uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_locked_count integer := 0;
  v_inserted_responses integer := 0;
begin
  with attempts as materialized (
    select id, student_id, responses
    from public.test_attempts
    where test_id = p_test_id
      and is_submitted = false
      and (
        p_student_ids is null
        or student_id = any(p_student_ids)
      )
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
        closed_for_grading_by = p_closed_by,
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
    'finalized_attempts', v_locked_count,
    'inserted_responses', v_inserted_responses
  );
end;
$$;

revoke all on function public.finalize_test_attempts_for_grading_atomic(uuid, uuid[], uuid) from public;
grant execute on function public.finalize_test_attempts_for_grading_atomic(uuid, uuid[], uuid) to service_role;

create or replace function public.close_test_for_grading_atomic(
  p_test_id uuid,
  p_closed_by uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_finalize_result jsonb;
  v_closed_count integer := 0;
begin
  update public.tests
  set status = 'closed'
  where id = p_test_id
    and status = 'active';

  get diagnostics v_closed_count = row_count;

  if v_closed_count = 0 then
    raise exception 'Test is not active' using errcode = '22023';
  end if;

  v_finalize_result := public.finalize_test_attempts_for_grading_atomic(
    p_test_id,
    null::uuid[],
    p_closed_by
  );

  return jsonb_build_object(
    'closed_count', v_closed_count,
    'finalized_attempts', coalesce((v_finalize_result ->> 'finalized_attempts')::integer, 0),
    'inserted_responses', coalesce((v_finalize_result ->> 'inserted_responses')::integer, 0)
  );
end;
$$;

revoke all on function public.close_test_for_grading_atomic(uuid, uuid) from public;
grant execute on function public.close_test_for_grading_atomic(uuid, uuid) to service_role;

create or replace function public.unsubmit_test_attempts_atomic(
  p_test_id uuid,
  p_student_ids uuid[],
  p_updated_by uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_attempts jsonb := '[]'::jsonb;
  v_deleted_responses integer := 0;
begin
  if coalesce(array_length(p_student_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'unsubmitted_count', 0,
      'attempts', '[]'::jsonb
    );
  end if;

  with target_attempts as materialized (
    select id, student_id, responses
    from public.test_attempts
    where test_id = p_test_id
      and student_id = any(p_student_ids)
    for update
  ),
  deleted_responses as (
    delete from public.test_responses responses
    using target_attempts attempts
    where responses.test_id = p_test_id
      and responses.student_id = attempts.student_id
    returning responses.id
  ),
  updated_attempts as (
    update public.test_attempts update_attempts
    set is_submitted = false,
        submitted_at = null,
        returned_at = null,
        returned_by = null,
        closed_for_grading_at = null,
        closed_for_grading_by = null
    from target_attempts target
    where update_attempts.id = target.id
    returning update_attempts.id, update_attempts.student_id, update_attempts.responses
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'student_id', student_id,
          'responses', responses
        )
        order by student_id
      ),
      '[]'::jsonb
    ),
    (select count(*) from deleted_responses)
  into v_attempts, v_deleted_responses
  from updated_attempts;

  return jsonb_build_object(
    'unsubmitted_count', jsonb_array_length(v_attempts),
    'deleted_responses', v_deleted_responses,
    'attempts', v_attempts
  );
end;
$$;

revoke all on function public.unsubmit_test_attempts_atomic(uuid, uuid[], uuid) from public;
grant execute on function public.unsubmit_test_attempts_atomic(uuid, uuid[], uuid) to service_role;

create or replace function public.return_test_attempts_atomic(
  p_test_id uuid,
  p_student_ids uuid[],
  p_returned_by uuid,
  p_submitted_at_by_student jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_updated_count integer := 0;
  v_inserted_count integer := 0;
begin
  if coalesce(array_length(p_student_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'returned_count', 0,
      'updated_count', 0,
      'inserted_count', 0
    );
  end if;

  with selected_students as materialized (
    select distinct student_id
    from unnest(p_student_ids) as selected(student_id)
  ),
  existing_attempts as materialized (
    select attempts.id, attempts.student_id
    from public.test_attempts attempts
    join selected_students selected
      on selected.student_id = attempts.student_id
    where attempts.test_id = p_test_id
    for update
  ),
  updated_attempts as (
    update public.test_attempts update_attempts
    set returned_at = v_now,
        returned_by = p_returned_by
    from existing_attempts existing
    where update_attempts.id = existing.id
    returning update_attempts.id
  ),
  missing_students as (
    select selected.student_id
    from selected_students selected
    where not exists (
      select 1
      from existing_attempts existing
      where existing.student_id = selected.student_id
    )
  ),
  inserted_attempts as (
    insert into public.test_attempts (
      test_id,
      student_id,
      responses,
      is_submitted,
      submitted_at,
      returned_at,
      returned_by
    )
    select
      p_test_id,
      student_id,
      '{}'::jsonb,
      true,
      coalesce(
        nullif(p_submitted_at_by_student ->> student_id::text, '')::timestamptz,
        v_now
      ),
      v_now,
      p_returned_by
    from missing_students
    returning id
  )
  select
    (select count(*) from updated_attempts),
    (select count(*) from inserted_attempts)
  into v_updated_count, v_inserted_count;

  return jsonb_build_object(
    'returned_count', v_updated_count + v_inserted_count,
    'updated_count', v_updated_count,
    'inserted_count', v_inserted_count
  );
end;
$$;

revoke all on function public.return_test_attempts_atomic(uuid, uuid[], uuid, jsonb) from public;
grant execute on function public.return_test_attempts_atomic(uuid, uuid[], uuid, jsonb) to service_role;

create or replace function public.delete_student_test_attempt_atomic(
  p_test_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_deleted_ai_items integer := 0;
  v_deleted_responses integer := 0;
  v_deleted_focus_events integer := 0;
  v_deleted_attempts integer := 0;
begin
  with deleted_ai_items as (
    delete from public.test_ai_grading_run_items
    where test_id = p_test_id
      and student_id = p_student_id
    returning id
  )
  select count(*) into v_deleted_ai_items from deleted_ai_items;

  with deleted_responses as (
    delete from public.test_responses
    where test_id = p_test_id
      and student_id = p_student_id
    returning id
  )
  select count(*) into v_deleted_responses from deleted_responses;

  with deleted_focus_events as (
    delete from public.test_focus_events
    where test_id = p_test_id
      and student_id = p_student_id
    returning id
  )
  select count(*) into v_deleted_focus_events from deleted_focus_events;

  with deleted_attempts as (
    delete from public.test_attempts
    where test_id = p_test_id
      and student_id = p_student_id
    returning id
  )
  select count(*) into v_deleted_attempts from deleted_attempts;

  return jsonb_build_object(
    'deleted_attempts', v_deleted_attempts,
    'deleted_responses', v_deleted_responses,
    'deleted_focus_events', v_deleted_focus_events,
    'deleted_ai_grading_items', v_deleted_ai_items
  );
end;
$$;

revoke all on function public.delete_student_test_attempt_atomic(uuid, uuid) from public;
grant execute on function public.delete_student_test_attempt_atomic(uuid, uuid) to service_role;
