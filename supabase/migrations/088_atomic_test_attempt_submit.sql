-- Submit final test responses and the owning attempt as one transaction.

create or replace function public.lock_test_parent_for_child_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_test_id uuid;
begin
  if tg_op = 'DELETE' then
    v_test_id := old.test_id;
  else
    v_test_id := new.test_id;
  end if;

  -- Parent cascades already own the test row and must not be treated as direct child edits.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'UPDATE' and old.test_id is distinct from new.test_id then
    perform 1
    from public.tests
    where id = any(array[old.test_id, new.test_id])
    order by id
    for update;
  else
    perform 1
    from public.tests
    where id = v_test_id
    for update;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lock_test_student_availability_parent
  on public.test_student_availability;
create trigger lock_test_student_availability_parent
  before insert or update or delete on public.test_student_availability
  for each row
  execute function public.lock_test_parent_for_child_mutation();

drop trigger if exists lock_test_question_parent
  on public.test_questions;
create trigger lock_test_question_parent
  before insert or update or delete on public.test_questions
  for each row
  execute function public.lock_test_parent_for_child_mutation();

create or replace function public.save_test_attempt_atomic(
  p_test_id uuid,
  p_student_id uuid,
  p_responses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_classroom_id uuid;
  v_test_status text;
  v_archived_at timestamptz;
  v_access_state text;
  v_created boolean := false;
  v_previous_responses jsonb := '{}'::jsonb;
  v_invalid_question_id text;
  v_question record;
  v_response jsonb;
  v_selected_option integer;
  v_response_text text;
begin
  select tests.classroom_id, tests.status, classrooms.archived_at
  into v_classroom_id, v_test_status, v_archived_at
  from public.tests
  join public.classrooms on classrooms.id = tests.classroom_id
  where tests.id = p_test_id
  for share of tests, classrooms;

  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;
  if v_archived_at is not null then
    raise exception 'Classroom is archived' using errcode = '42501';
  end if;

  perform 1
  from public.classroom_enrollments
  where classroom_id = v_classroom_id
    and student_id = p_student_id
  for share;
  if not found then
    raise exception 'Student is not enrolled in this classroom' using errcode = '42501';
  end if;

  select state
  into v_access_state
  from public.test_student_availability
  where test_id = p_test_id
    and student_id = p_student_id;
  if v_test_status = 'draft'
    or coalesce(v_access_state, case when v_test_status = 'active' then 'open' else 'closed' end) <> 'open'
  then
    raise exception 'This test is closed for you. Your saved draft is preserved.'
      using errcode = '42501';
  end if;

  if p_responses is null or jsonb_typeof(p_responses) <> 'object' then
    raise exception 'Responses are required' using errcode = '22023';
  end if;

  perform 1
  from public.test_questions
  where test_id = p_test_id
  for share;

  select response_keys.question_id
  into v_invalid_question_id
  from jsonb_object_keys(p_responses) as response_keys(question_id)
  where not exists (
    select 1
    from public.test_questions
    where test_questions.test_id = p_test_id
      and test_questions.id::text = response_keys.question_id
  )
  order by response_keys.question_id
  limit 1;
  if v_invalid_question_id is not null then
    raise exception 'Invalid question ID: %', v_invalid_question_id using errcode = '22023';
  end if;

  for v_question in
    select id, question_type, options, response_max_chars
    from public.test_questions
    where test_id = p_test_id
    order by position, id
  loop
    if not p_responses ? v_question.id::text then
      continue;
    end if;

    v_response := p_responses -> v_question.id::text;
    if v_question.question_type = 'multiple_choice' then
      if jsonb_typeof(v_response) is distinct from 'object'
        or v_response ->> 'question_type' is distinct from 'multiple_choice'
        or jsonb_typeof(v_response -> 'selected_option') is distinct from 'number'
        or coalesce((v_response ->> 'selected_option') !~ '^[0-9]+$', true)
      then
        raise exception 'Invalid response type for question %', v_question.id using errcode = '22023';
      end if;
      begin
        v_selected_option := (v_response ->> 'selected_option')::integer;
      exception when numeric_value_out_of_range then
        raise exception 'Invalid option for question %', v_question.id using errcode = '22023';
      end;
      if v_selected_option < 0 or v_selected_option >= jsonb_array_length(v_question.options) then
        raise exception 'Invalid option for question %', v_question.id using errcode = '22023';
      end if;
    else
      if jsonb_typeof(v_response) is distinct from 'object'
        or v_response ->> 'question_type' is distinct from 'open_response'
        or jsonb_typeof(v_response -> 'response_text') is distinct from 'string'
      then
        raise exception 'Invalid response type for question %', v_question.id using errcode = '22023';
      end if;
      v_response_text := v_response ->> 'response_text';
      if char_length(v_response_text) > coalesce(v_question.response_max_chars, 5000) then
        raise exception 'Response is too long for question %', v_question.id using errcode = '22023';
      end if;
    end if;
  end loop;

  insert into public.test_attempts (
    test_id, student_id, responses, is_submitted, submitted_at
  ) values (
    p_test_id, p_student_id, '{}'::jsonb, false, null
  )
  on conflict (test_id, student_id) do nothing;
  v_created := found;

  select *
  into strict v_attempt
  from public.test_attempts
  where test_id = p_test_id
    and student_id = p_student_id
  for update;

  if v_attempt.is_submitted or v_attempt.returned_at is not null then
    raise exception 'Cannot edit a submitted test' using errcode = '42501';
  end if;
  if v_attempt.closed_for_grading_at is not null then
    raise exception 'This test is closed for grading. Your saved draft is preserved.'
      using errcode = '42501';
  end if;

  perform 1
  from public.test_responses
  where test_id = p_test_id
    and student_id = p_student_id
  for update;
  if exists (
    select 1
    from public.test_responses
    where test_id = p_test_id
      and student_id = p_student_id
      and (
        selected_option is not null
        or char_length(trim(coalesce(response_text, ''))) > 0
      )
  ) then
    raise exception 'Cannot edit a submitted test' using errcode = '42501';
  end if;

  v_previous_responses := v_attempt.responses;
  update public.test_attempts
  set responses = p_responses
  where id = v_attempt.id
  returning * into strict v_attempt;

  return jsonb_build_object(
    'created', v_created,
    'previous_responses', v_previous_responses,
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'test_id', v_attempt.test_id,
      'student_id', v_attempt.student_id,
      'responses', v_attempt.responses,
      'is_submitted', v_attempt.is_submitted,
      'submitted_at', v_attempt.submitted_at,
      'created_at', v_attempt.created_at,
      'updated_at', v_attempt.updated_at
    )
  );
end;
$$;

revoke all on function public.save_test_attempt_atomic(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_test_attempt_atomic(uuid, uuid, jsonb)
  to service_role;

create or replace function public.submit_test_attempt_atomic(
  p_test_id uuid,
  p_student_id uuid,
  p_responses jsonb,
  p_submitted_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_classroom_id uuid;
  v_test_status text;
  v_archived_at timestamptz;
  v_access_state text;
  v_is_submitted boolean;
  v_closed_for_grading_at timestamptz;
  v_returned_at timestamptz;
  v_submitted_at timestamptz := coalesce(p_submitted_at, now());
  v_inserted_responses integer := 0;
  v_question_count integer := 0;
  v_invalid_question_id text;
  v_question record;
  v_response jsonb;
  v_selected_option integer;
  v_response_text text;
begin
  select tests.classroom_id, tests.status, classrooms.archived_at
  into v_classroom_id, v_test_status, v_archived_at
  from public.tests
  join public.classrooms on classrooms.id = tests.classroom_id
  where tests.id = p_test_id
  for share of tests, classrooms;

  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;

  if v_archived_at is not null then
    raise exception 'Classroom is archived' using errcode = '42501';
  end if;

  perform 1
  from public.classroom_enrollments
  where classroom_id = v_classroom_id
    and student_id = p_student_id
  for share;

  if not found then
    raise exception 'Student is not enrolled in this classroom' using errcode = '42501';
  end if;

  select state
  into v_access_state
  from public.test_student_availability
  where test_id = p_test_id
    and student_id = p_student_id;

  if v_test_status = 'draft'
    or coalesce(v_access_state, case when v_test_status = 'active' then 'open' else 'closed' end) <> 'open'
  then
    raise exception 'Test is not active' using errcode = '22023';
  end if;

  if p_responses is null or jsonb_typeof(p_responses) <> 'object' then
    raise exception 'Responses are required' using errcode = '22023';
  end if;

  perform 1
  from public.test_questions
  where test_id = p_test_id
  for share;

  select count(*)
  into v_question_count
  from public.test_questions
  where test_id = p_test_id;

  select response_keys.question_id
  into v_invalid_question_id
  from jsonb_object_keys(p_responses) as response_keys(question_id)
  where not exists (
    select 1
    from public.test_questions
    where test_questions.test_id = p_test_id
      and test_questions.id::text = response_keys.question_id
  )
  order by response_keys.question_id
  limit 1;

  if v_invalid_question_id is not null then
    raise exception 'Invalid question ID: %', v_invalid_question_id using errcode = '22023';
  end if;

  for v_question in
    select id, question_type, options, correct_option, points, response_max_chars
    from public.test_questions
    where test_id = p_test_id
    order by position, id
  loop
    if not p_responses ? v_question.id::text then
      raise exception 'All questions must be answered' using errcode = '22023';
    end if;

    v_response := p_responses -> v_question.id::text;
    if v_question.question_type = 'multiple_choice' then
      if jsonb_typeof(v_response) is distinct from 'object'
        or v_response ->> 'question_type' is distinct from 'multiple_choice'
      then
        raise exception 'Invalid response type for question %', v_question.id using errcode = '22023';
      end if;

      if jsonb_typeof(v_response -> 'selected_option') is distinct from 'number'
        or coalesce((v_response ->> 'selected_option') !~ '^[0-9]+$', true)
      then
        raise exception 'Invalid option for question %', v_question.id using errcode = '22023';
      end if;

      begin
        v_selected_option := (v_response ->> 'selected_option')::integer;
      exception when numeric_value_out_of_range then
        raise exception 'Invalid option for question %', v_question.id using errcode = '22023';
      end;
      if v_selected_option < 0 or v_selected_option >= jsonb_array_length(v_question.options) then
        raise exception 'Invalid option for question %', v_question.id using errcode = '22023';
      end if;
    else
      if jsonb_typeof(v_response) is distinct from 'object'
        or v_response ->> 'question_type' is distinct from 'open_response'
        or jsonb_typeof(v_response -> 'response_text') is distinct from 'string'
      then
        raise exception 'Invalid response type for question %', v_question.id using errcode = '22023';
      end if;

      v_response_text := v_response ->> 'response_text';
      if char_length(v_response_text) > coalesce(v_question.response_max_chars, 5000) then
        raise exception 'Response is too long for question %', v_question.id using errcode = '22023';
      end if;
      if char_length(trim(v_response_text)) = 0 then
        raise exception 'All questions must be answered' using errcode = '22023';
      end if;
    end if;
  end loop;

  insert into public.test_attempts (
    test_id,
    student_id,
    responses,
    is_submitted,
    submitted_at
  ) values (
    p_test_id,
    p_student_id,
    '{}'::jsonb,
    false,
    null
  )
  on conflict (test_id, student_id) do nothing;

  select id, is_submitted, closed_for_grading_at, returned_at
  into v_attempt_id, v_is_submitted, v_closed_for_grading_at, v_returned_at
  from public.test_attempts
  where test_id = p_test_id
    and student_id = p_student_id
  for update;

  if v_is_submitted or v_returned_at is not null then
    raise exception 'You have already responded to this test' using errcode = '22023';
  end if;
  if v_closed_for_grading_at is not null then
    raise exception 'This test is closed for grading' using errcode = '22023';
  end if;

  perform 1
  from public.test_responses
  where test_id = p_test_id
    and student_id = p_student_id
  for update;

  if exists (
    select 1
    from public.test_responses
    where test_id = p_test_id
      and student_id = p_student_id
      and (
        selected_option is not null
        or char_length(trim(coalesce(response_text, ''))) > 0
      )
  ) then
    raise exception 'You have already responded to this test' using errcode = '22023';
  end if;

  delete from public.test_responses
  where test_id = p_test_id
    and student_id = p_student_id;

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
    submitted_at,
    ai_grading_basis,
    ai_reference_answers,
    ai_model
  )
  select
    p_test_id,
    questions.id,
    p_student_id,
    case
      when questions.question_type = 'multiple_choice'
        then (p_responses -> questions.id::text ->> 'selected_option')::integer
      else null
    end,
    case
      when questions.question_type = 'open_response'
        then p_responses -> questions.id::text ->> 'response_text'
      else null
    end,
    case
      when questions.question_type = 'multiple_choice'
        and (p_responses -> questions.id::text ->> 'selected_option')::integer = questions.correct_option
        then questions.points
      when questions.question_type = 'multiple_choice' then 0
      else null
    end,
    null,
    case when questions.question_type = 'multiple_choice' then v_submitted_at else null end,
    null,
    v_submitted_at,
    null,
    null,
    null
  from public.test_questions as questions
  where questions.test_id = p_test_id;

  get diagnostics v_inserted_responses = row_count;
  if v_inserted_responses <> v_question_count then
    raise exception 'Failed to persist all test responses';
  end if;

  update public.test_attempts
  set responses = p_responses,
      is_submitted = true,
      submitted_at = v_submitted_at
  where id = v_attempt_id;

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'submitted_at', v_submitted_at,
    'inserted_responses', v_inserted_responses
  );
end;
$$;

revoke all on function public.submit_test_attempt_atomic(uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.submit_test_attempt_atomic(uuid, uuid, jsonb, timestamptz)
  to service_role;

revoke all on function public.lock_test_parent_for_child_mutation()
  from public, anon, authenticated;

create or replace function public.delete_student_test_attempt_atomic(
  p_test_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_deleted_ai_items integer := 0;
  v_deleted_responses integer := 0;
  v_deleted_focus_events integer := 0;
  v_deleted_attempts integer := 0;
begin
  perform 1
  from public.tests
  where id = p_test_id
  for update;

  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.test_attempts
  where test_id = p_test_id
    and student_id = p_student_id
  for update;

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

revoke all on function public.delete_student_test_attempt_atomic(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_student_test_attempt_atomic(uuid, uuid)
  to service_role;

create or replace function public.delete_student_test_attempts_atomic(
  p_test_id uuid,
  p_student_ids uuid[]
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_requested_count integer := 0;
  v_student_ids uuid[] := array[]::uuid[];
  v_deleted_student_ids uuid[] := array[]::uuid[];
  v_deleted_student_count integer := 0;
  v_deleted_ai_items integer := 0;
  v_deleted_responses integer := 0;
  v_deleted_focus_events integer := 0;
  v_deleted_attempts integer := 0;
  v_deleted_ids uuid[] := array[]::uuid[];
begin
  with requested as (
    select distinct student_id
    from unnest(coalesce(p_student_ids, array[]::uuid[])) as requested(student_id)
  )
  select
    count(*),
    coalesce(array_agg(student_id), array[]::uuid[])
  into v_requested_count, v_student_ids
  from requested;

  if v_requested_count = 0 then
    return jsonb_build_object(
      'requested_count', 0,
      'deleted_student_count', 0,
      'deleted_attempts', 0,
      'deleted_responses', 0,
      'deleted_focus_events', 0,
      'deleted_ai_grading_items', 0
    );
  end if;

  perform 1
  from public.tests
  where id = p_test_id
  for update;

  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.test_attempts
  where test_id = p_test_id
    and student_id = any(v_student_ids)
  for update;

  with deleted_ai_items as (
    delete from public.test_ai_grading_run_items
    where test_id = p_test_id
      and student_id = any(v_student_ids)
    returning student_id
  )
  select
    count(*),
    coalesce(array_agg(distinct student_id), array[]::uuid[])
  into v_deleted_ai_items, v_deleted_ids
  from deleted_ai_items;
  v_deleted_student_ids := v_deleted_student_ids || v_deleted_ids;

  with deleted_responses as (
    delete from public.test_responses
    where test_id = p_test_id
      and student_id = any(v_student_ids)
    returning student_id
  )
  select
    count(*),
    coalesce(array_agg(distinct student_id), array[]::uuid[])
  into v_deleted_responses, v_deleted_ids
  from deleted_responses;
  v_deleted_student_ids := v_deleted_student_ids || v_deleted_ids;

  with deleted_focus_events as (
    delete from public.test_focus_events
    where test_id = p_test_id
      and student_id = any(v_student_ids)
    returning student_id
  )
  select
    count(*),
    coalesce(array_agg(distinct student_id), array[]::uuid[])
  into v_deleted_focus_events, v_deleted_ids
  from deleted_focus_events;
  v_deleted_student_ids := v_deleted_student_ids || v_deleted_ids;

  with deleted_attempts as (
    delete from public.test_attempts
    where test_id = p_test_id
      and student_id = any(v_student_ids)
    returning student_id
  )
  select
    count(*),
    coalesce(array_agg(distinct student_id), array[]::uuid[])
  into v_deleted_attempts, v_deleted_ids
  from deleted_attempts;
  v_deleted_student_ids := v_deleted_student_ids || v_deleted_ids;

  select count(distinct student_id)
  into v_deleted_student_count
  from unnest(v_deleted_student_ids) as deleted(student_id);

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'deleted_student_count', v_deleted_student_count,
    'deleted_attempts', v_deleted_attempts,
    'deleted_responses', v_deleted_responses,
    'deleted_focus_events', v_deleted_focus_events,
    'deleted_ai_grading_items', v_deleted_ai_items
  );
end;
$$;

revoke all on function public.delete_student_test_attempts_atomic(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.delete_student_test_attempts_atomic(uuid, uuid[])
  to service_role;
