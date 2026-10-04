-- Migration 244. Source only; apply only with approval naming this file and target.
-- CORE01-03: fenced snapshots, explicit closure zeros, transactional disclosure.
set lock_timeout = '5s';
set statement_timeout = '30s';

-- Recreated/restored attempts must not reuse an old client's revision (ABA).
create sequence private.test_attempt_draft_revision_seq as bigint minvalue 1 maxvalue 9007199254740991;
revoke all on sequence private.test_attempt_draft_revision_seq from public, anon, authenticated;
grant usage on sequence private.test_attempt_draft_revision_seq to service_role;
alter table public.test_attempts add column draft_revision bigint not null default nextval('private.test_attempt_draft_revision_seq')
  check (draft_revision between 1 and 9007199254740991);

create function private.advance_test_attempt_draft_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Ignore explicit archived/caller revisions; allocation gaps are harmless.
    new.draft_revision := nextval('private.test_attempt_draft_revision_seq');
    return new;
  end if;
  -- Never allow a caller to reset the revision. Resume of identical work is a no-op.
  new.draft_revision := old.draft_revision;
  if row(new.responses, new.is_submitted, new.submitted_at, new.closed_for_grading_at, new.returned_at)
    is distinct from row(old.responses, old.is_submitted, old.submitted_at, old.closed_for_grading_at, old.returned_at)
  then new.draft_revision := nextval('private.test_attempt_draft_revision_seq');
  end if;
  return new;
end;
$$;
create trigger advance_test_attempt_draft_revision before insert or update on public.test_attempts
for each row execute function private.advance_test_attempt_draft_revision();
revoke all on function private.advance_test_attempt_draft_revision() from public, anon, authenticated, service_role;

-- Same advisory key as grading 094; serialize grade clear with lifecycle changes.
-- Parent order matches student Start and structural Test writes: Classroom -> Test.
create function private.lock_test_lifecycle(p_test_id uuid)
returns public.tests language plpgsql security definer set search_path = '' as $$
declare v_classroom_id uuid; v_test public.tests%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_test_id::text, 0));
  select classroom_id into v_classroom_id from public.tests where id = p_test_id;
  if not found then raise exception 'Test not found' using errcode = 'P0002'; end if;
  perform 1 from public.classrooms where id = v_classroom_id for update;
  if not found then raise exception 'Classroom not found' using errcode = 'P0002'; end if;
  select * into v_test from public.tests where id = p_test_id and classroom_id = v_classroom_id for update;
  if not found then raise exception 'Test not found' using errcode = 'P0002'; end if;
  return v_test;
end;
$$;
revoke all on function private.lock_test_lifecycle(uuid) from public, anon, authenticated, service_role;


-- 039 allowed exactly one answer representation. A teacher-closed unanswered MC
-- now has neither representation, an explicit zero, and a grading timestamp.
alter table public.test_responses drop constraint test_responses_check;
alter table public.test_responses add constraint test_responses_content_shape_check check (
  (selected_option is not null and response_text is null)
  or (selected_option is null and response_text is not null)
  or (selected_option is null and response_text is null and score is not null and score = 0 and graded_at is not null)
);

create or replace function public.validate_test_response_shape()
returns trigger
set search_path = ''
as $$
declare
  question_type_value text;
  question_options jsonb;
  max_chars integer;
begin
  select question_type, options, response_max_chars
    into question_type_value, question_options, max_chars
  from public.test_questions
  where id = new.question_id
    and test_id = new.test_id;

  if question_type_value is null then
    raise exception 'Test question not found for response';
  end if;

  if question_type_value = 'multiple_choice' then
    if new.selected_option is null and new.response_text is null and new.score = 0 and new.graded_at is not null then
      -- Ordinary draft/submit code cannot manufacture unanswered zeros. Only
      -- the closure RPC's transaction-local context or verified maintenance can
      -- create them; subsequent updates may preserve an existing closure zero.
      if (tg_op = 'UPDATE' and old.selected_option is null and old.response_text is null and old.score = 0 and old.graded_at is not null)
        or public.is_classroom_archive_maintenance_mode('restore')
        or public.is_classroom_archive_maintenance_mode('compaction')
        or (current_user = 'postgres' and current_setting('pika.test_teacher_closure', true) = new.test_id::text
          and exists (
            select 1 from public.test_attempts attempt
            join public.tests test on test.id = attempt.test_id
            left join public.test_student_availability access on access.test_id = test.id and access.student_id = attempt.student_id
            where attempt.test_id = new.test_id and attempt.student_id = new.student_id and not attempt.is_submitted
              and coalesce(access.state, case when test.status = 'active' then 'open' else 'closed' end) = 'closed'
              and test.status <> 'draft'
          ))
      then return new;
      end if;
      raise exception 'Unanswered multiple-choice scores require teacher closure';
    end if;
    if new.selected_option is null or new.response_text is not null then
      raise exception 'Multiple-choice responses must provide selected_option only';
    end if;
    if new.selected_option < 0 or new.selected_option >= jsonb_array_length(question_options) then
      raise exception 'Selected option is out of range';
    end if;
    if new.score is null then
      new.score = 0;
    end if;
  elsif question_type_value = 'open_response' then
    if new.selected_option is not null or new.response_text is null then
      raise exception 'Open-response answers must provide response_text only';
    end if;
    if char_length(new.response_text) > coalesce(max_chars, 5000) then
      raise exception 'Open-response answer exceeds max characters';
    end if;
  else
    raise exception 'Unsupported question type %', question_type_value;
  end if;

  return new;
end;
$$ language plpgsql;

-- Preserve the 143 Start/question-lock behavior behind a private implementation.
alter function public.save_test_attempt_atomic(uuid, uuid, jsonb) rename to save_test_attempt_v143;
alter function public.save_test_attempt_v143(uuid, uuid, jsonb) set schema private;
alter function public.submit_test_attempt_atomic(uuid, uuid, jsonb, timestamptz) rename to submit_test_attempt_v143;
alter function public.submit_test_attempt_v143(uuid, uuid, jsonb, timestamptz) set schema private;
revoke all on function private.save_test_attempt_v143(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.submit_test_attempt_v143(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;

create function public.start_test_attempt_revision_atomic(p_test_id uuid, p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_revision bigint;
begin
  perform private.lock_test_lifecycle(p_test_id);
  v_result := private.save_test_attempt_v143(p_test_id, p_student_id, null);
  select draft_revision into v_revision from public.test_attempts where test_id = p_test_id and student_id = p_student_id;
  return jsonb_set(v_result, '{attempt,draft_revision}', to_jsonb(v_revision));
end;
$$;

create function public.save_test_attempt_revision_atomic(
  p_test_id uuid, p_student_id uuid, p_responses jsonb, p_expected_revision bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.test_attempts%rowtype; v_result jsonb;
begin
  if p_expected_revision is null or p_expected_revision < 1 or p_expected_revision > 9007199254740991 or p_responses is null then
    raise exception 'A valid expected_revision and responses are required' using errcode = '22023';
  end if;
  perform private.lock_test_lifecycle(p_test_id);
  select * into v_attempt from public.test_attempts where test_id = p_test_id and student_id = p_student_id for update;
  if not found then raise exception 'Start the test before saving' using errcode = '22023'; end if;
  if v_attempt.draft_revision <> p_expected_revision then
    return jsonb_build_object('conflict', true, 'attempt', to_jsonb(v_attempt));
  end if;
  v_result := private.save_test_attempt_v143(p_test_id, p_student_id, p_responses);
  select * into v_attempt from public.test_attempts where id = v_attempt.id;
  return jsonb_set(v_result, '{attempt,draft_revision}', to_jsonb(v_attempt.draft_revision));
end;
$$;

create function public.submit_test_attempt_revision_atomic(
  p_test_id uuid, p_student_id uuid, p_responses jsonb, p_expected_revision bigint,
  p_submitted_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.test_attempts%rowtype; v_result jsonb;
begin
  if p_expected_revision is null or p_expected_revision < 1 or p_expected_revision > 9007199254740991 or p_responses is null then
    raise exception 'A valid expected_revision and responses are required' using errcode = '22023';
  end if;
  perform private.lock_test_lifecycle(p_test_id);
  select * into v_attempt from public.test_attempts where test_id = p_test_id and student_id = p_student_id for update;
  if not found then raise exception 'Start the test before submitting' using errcode = '22023'; end if;
  if v_attempt.draft_revision <> p_expected_revision then
    return jsonb_build_object('conflict', true, 'attempt', to_jsonb(v_attempt));
  end if;
  v_result := private.submit_test_attempt_v143(p_test_id, p_student_id, p_responses, p_submitted_at);
  select * into v_attempt from public.test_attempts where id = v_attempt.id;
  return v_result || jsonb_build_object('draft_revision', v_attempt.draft_revision);
end;
$$;

-- Old callers cannot send an unfenced snapshot during rollout. NULL Start remains safe.
create function public.save_test_attempt_atomic(p_test_id uuid, p_student_id uuid, p_responses jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_responses is not null then raise exception 'Test revision client is required' using errcode = '22023'; end if;
  return public.start_test_attempt_revision_atomic(p_test_id, p_student_id);
end;
$$;
create function public.submit_test_attempt_atomic(p_test_id uuid, p_student_id uuid, p_responses jsonb, p_submitted_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
begin raise exception 'Test revision client is required' using errcode = '22023'; end;
$$;

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
    raise exception 'Selected students changed; reload and retry' using errcode = '40001';
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

create or replace function public.finalize_test_attempts_for_grading_atomic(
  p_test_id uuid,
  p_student_ids uuid[],
  p_closed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_closure_context text := current_setting('pika.test_teacher_closure', true);
  v_now timestamptz := now();
  v_locked_count integer := 0;
  v_inserted_responses integer := 0;
begin
  perform private.lock_test_lifecycle(p_test_id);
  perform set_config('pika.test_teacher_closure', p_test_id::text, true);
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
        closed_for_grading_by = p_closed_by,
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
    'finalized_attempts', v_locked_count,
    'inserted_responses', v_inserted_responses
  );
end;
$$;

create or replace function public.close_test_for_grading_atomic(
  p_test_id uuid,
  p_closed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finalize_result jsonb;
  v_closed_count integer := 0;
begin
  perform private.lock_test_lifecycle(p_test_id);
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

create or replace function public.unsubmit_test_attempts_atomic(
  p_test_id uuid,
  p_student_ids uuid[],
  p_updated_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts jsonb := '[]'::jsonb;
  v_deleted_responses integer := 0;
  v_test public.tests%rowtype;
  v_classroom_teacher_id uuid;
  v_archived_at timestamptz;
begin
  if coalesce(array_length(p_student_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'unsubmitted_count', 0,
      'attempts', '[]'::jsonb
    );
  end if;

  -- Preserve migration149's actor/active-Classroom authority after taking the
  -- shared advisory -> Classroom -> Test locks. Its empty-selection no-op and
  -- missing-parent 42501 contract also remain unchanged.
  begin
    v_test := private.lock_test_lifecycle(p_test_id);
  exception
    when no_data_found then
      raise exception 'Test unsubmission is not allowed' using errcode = '42501';
  end;
  select classroom.teacher_id, classroom.archived_at
  into v_classroom_teacher_id, v_archived_at
  from public.classrooms classroom
  where classroom.id = v_test.classroom_id;
  if not found
    or p_updated_by is null
    or v_classroom_teacher_id is distinct from p_updated_by
    or v_archived_at is not null
  then
    raise exception 'Test unsubmission is not allowed' using errcode = '42501';
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

create or replace function public.delete_student_test_attempt_atomic(
  p_test_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_ai_items integer := 0;
  v_deleted_responses integer := 0;
  v_deleted_focus_events integer := 0;
  v_deleted_attempts integer := 0;
begin
  perform private.lock_test_lifecycle(p_test_id);
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

create or replace function public.delete_student_test_attempts_atomic(
  p_test_id uuid,
  p_student_ids uuid[]
)
returns jsonb
language plpgsql
security definer
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

  perform private.lock_test_lifecycle(p_test_id);
  perform 1
  from public.test_attempts
  where test_id = p_test_id
    and student_id = any(v_student_ids)
  order by student_id
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


-- Revoke disclosure inside the existing grading transactions, never from a row
-- trigger that could invert Return's attempt -> response lock order. Both 094
-- writers acquire the Test advisory lock before locking any responses.
create function private.revoke_incomplete_test_returns(p_test_id uuid, p_student_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.test_attempts attempt set returned_at = null, returned_by = null
  where attempt.test_id = p_test_id and attempt.student_id = any(p_student_ids) and attempt.returned_at is not null
    and exists (
      select 1 from public.test_questions question left join public.test_responses response
        on response.question_id = question.id and response.student_id = attempt.student_id and response.test_id = p_test_id
      where question.test_id = p_test_id and (response.id is null or response.score is null)
    );
end;
$$;
revoke all on function private.revoke_incomplete_test_returns(uuid, uuid[]) from public, anon, authenticated, service_role;

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

create function public.return_test_attempts_checked_atomic(p_test_id uuid, p_student_ids uuid[], p_returned_by uuid)
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
    raise exception 'Close selected students before returning their test work.' using errcode = '40001';
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
-- Retain the old signature only as a checked delegate; the caller's stale timestamps have no authority.
create or replace function public.return_test_attempts_atomic(p_test_id uuid, p_student_ids uuid[], p_returned_by uuid, p_submitted_at_by_student jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if coalesce(array_length(p_student_ids, 1), 0) = 0 then
    return jsonb_build_object('returned_count', 0, 'updated_count', 0, 'inserted_count', 0);
  end if;
  v_result := public.return_test_attempts_checked_atomic(p_test_id, p_student_ids, p_returned_by);
  -- Legacy callers retain their count keys. Only current eligible attempts can
  -- be returned: no synthetic submitted row or caller-provided timestamp can
  -- bypass the checked lifecycle/score guards. Replays update zero rows.
  return v_result || jsonb_build_object('updated_count', (v_result->>'returned_count')::integer, 'inserted_count', 0);
end;
$$;

-- Cold archives predating 244 must still restore an exact current-schema attempt row.
alter function public.normalize_classroom_archive_restore_row(uuid, text, jsonb) rename to normalize_classroom_archive_restore_row_v243;
revoke all on function public.normalize_classroom_archive_restore_row_v243(uuid, text, jsonb) from public, anon, authenticated, service_role;
create function public.normalize_classroom_archive_restore_row(p_operation_id uuid, p_table_name text, p_row jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  p_row := public.normalize_classroom_archive_restore_row_v243(p_operation_id, p_table_name, p_row);
  if p_table_name = 'test_attempts' then
    -- Restored work starts a fresh concurrency epoch even if the archive has a revision.
    p_row := p_row || jsonb_build_object('draft_revision', nextval('private.test_attempt_draft_revision_seq'));
  end if;
  return p_row;
end;
$$;

revoke all on function public.start_test_attempt_revision_atomic(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_test_attempt_revision_atomic(uuid, uuid) to service_role;

revoke all on function public.save_test_attempt_revision_atomic(uuid, uuid, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.save_test_attempt_revision_atomic(uuid, uuid, jsonb, bigint) to service_role;

revoke all on function public.submit_test_attempt_revision_atomic(uuid, uuid, jsonb, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_test_attempt_revision_atomic(uuid, uuid, jsonb, bigint, timestamptz) to service_role;

revoke all on function public.save_test_attempt_atomic(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_test_attempt_atomic(uuid, uuid, jsonb) to service_role;

revoke all on function public.submit_test_attempt_atomic(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_test_attempt_atomic(uuid, uuid, jsonb, timestamptz) to service_role;

revoke all on function public.return_test_attempts_checked_atomic(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.return_test_attempts_checked_atomic(uuid, uuid[], uuid) to service_role;

revoke all on function public.return_test_attempts_atomic(uuid, uuid[], uuid, jsonb) from public, anon, authenticated;
grant execute on function public.return_test_attempts_atomic(uuid, uuid[], uuid, jsonb) to service_role;

revoke all on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb) to service_role;

revoke all on function public.update_test_student_access_atomic(uuid, uuid[], text, uuid) from public, anon, authenticated;
grant execute on function public.update_test_student_access_atomic(uuid, uuid[], text, uuid) to service_role;

revoke all on function public.finalize_test_attempts_for_grading_atomic(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.finalize_test_attempts_for_grading_atomic(uuid, uuid[], uuid) to service_role;

revoke all on function public.close_test_for_grading_atomic(uuid, uuid) from public, anon, authenticated;
grant execute on function public.close_test_for_grading_atomic(uuid, uuid) to service_role;

revoke all on function public.unsubmit_test_attempts_atomic(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.unsubmit_test_attempts_atomic(uuid, uuid[], uuid) to service_role;

revoke all on function public.delete_student_test_attempt_atomic(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_student_test_attempt_atomic(uuid, uuid) to service_role;

revoke all on function public.delete_student_test_attempts_atomic(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.delete_student_test_attempts_atomic(uuid, uuid[]) to service_role;

reset lock_timeout;
reset statement_timeout;
