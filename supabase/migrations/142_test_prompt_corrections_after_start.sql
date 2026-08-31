-- Migration 142. Apply only with approval naming this file and target.
-- Keep the boundary on the Test: closing, unsubmitting, deleting student work,
-- and roster cleanup must never make an already-started Test structural again.
set lock_timeout = '5s';
alter table public.tests add column questions_locked_at timestamptz;
comment on column public.tests.questions_locked_at is
  'Irreversible first student Start/save/submit boundary for question structure.';

-- Historical attempts cannot reliably distinguish Start from teacher-created
-- blank closure rows. Preserve the old freeze conservatively for all existing
-- work; new teacher-only closure rows do not set this boundary.
update public.tests test
set questions_locked_at = coalesce((
  select min(attempt.created_at) from public.test_attempts attempt where attempt.test_id = test.id
), (
  select min(response.created_at) from public.test_responses response where response.test_id = test.id
))
where exists (select 1 from public.test_attempts a where a.test_id = test.id)
   or exists (select 1 from public.test_responses r where r.test_id = test.id);

create function private.preserve_test_question_lock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.questions_locked_at is not null then
    new.questions_locked_at := old.questions_locked_at;
    if new.status = 'draft' and old.status <> 'draft' then
      raise exception using errcode = '55000', message = 'test_questions_locked: Started tests cannot return to draft';
    end if;
  end if;
  return new;
end;
$$;
create trigger preserve_test_question_lock before update on public.tests
for each row execute function private.preserve_test_question_lock();
revoke all on function private.preserve_test_question_lock() from public, anon, authenticated, service_role;

-- Keep Classroom and Blueprint purge finalization safe and recoverable.
-- Allow the durable hot-Classroom purge to remove Test questions after it has
-- fenced and snapshotted the whole Classroom. Normal Test edits remain frozen
-- once student work exists, and Blueprint deletion may still change provenance
-- only through its existing exact-column exception.

create or replace function public.lock_test_parent_for_child_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_classroom_ids uuid[];
  v_test_id uuid;
  v_test_ids uuid[];
begin
  if tg_op = 'DELETE' then
    v_test_id := old.test_id;
  else
    v_test_id := new.test_id;
  end if;

  -- Parent cascades already own the Test row and must remain recoverable.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  -- The owner-run Classroom finalizer already holds the Classroom lifecycle
  -- lock and verifies the snapshotted deletion membership. Its direct reverse-
  -- graph delete reaches questions before attempts, so permit that exact
  -- operation without weakening the student-work freeze for ordinary callers.
  if tg_op = 'DELETE'
    and current_user = 'postgres'
    and coalesce(
      current_setting('pika.classroom_purge_finalize', true),
      'off'
    ) = 'on'
  then
    return old;
  end if;

  -- Generated AI references are operational cache data, not authored Test
  -- content. They remain reusable after student work exists and do not belong
  -- in Blueprint revisions. Compare the complete records minus that explicit
  -- allowlist (and the automatic timestamp) so every current or future
  -- authored/identity field remains frozen by default.
  if tg_table_name = 'test_questions'
    and tg_op = 'UPDATE'
    and (
      to_jsonb(new) - array[
        'ai_reference_cache_key',
        'ai_reference_cache_answers',
        'ai_reference_cache_model',
        'ai_reference_cache_generated_at',
        'updated_at'
      ]::text[]
    ) is not distinct from (
      to_jsonb(old) - array[
        'ai_reference_cache_key',
        'ai_reference_cache_answers',
        'ai_reference_cache_model',
        'ai_reference_cache_generated_at',
        'updated_at'
      ]::text[]
    )
  then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.test_id is distinct from new.test_id then
    v_test_ids := array[old.test_id, new.test_id];
  else
    v_test_ids := array[v_test_id];
  end if;

  select array_agg(test.classroom_id order by test.classroom_id)
  into v_classroom_ids
  from public.tests test
  where test.id = any(v_test_ids);

  perform 1
  from public.classrooms classroom
  where classroom.id = any(v_classroom_ids)
  order by classroom.id
  for update;

  perform 1
  from public.tests test
  where test.id = any(v_test_ids)
  order by test.id
  for update;

  -- Blueprint capture records immutable Version membership on the source
  -- question; it does not change authored Test content or student work. Permit
  -- that provenance-only write after taking the normal parent locks, but only
  -- inside the owner-run identity-mapping or Blueprint-purge finalization
  -- routines. An API caller can set a custom GUC, so the owner check and the
  -- exact changed-column allowlist are both part of this trust boundary.
  if tg_table_name = 'test_questions'
    and tg_op = 'UPDATE'
    and current_user = 'postgres'
    and (
      coalesce(
        current_setting('pika.identity_mapping', true),
        'off'
      ) = 'on'
      or coalesce(
        current_setting('pika.course_blueprint_purge_finalize', true),
        'off'
      ) = 'on'
    )
    and (
      to_jsonb(new) - array[
        'source_blueprint_version_id',
        'updated_at'
      ]::text[]
    ) is not distinct from (
      to_jsonb(old) - array[
        'source_blueprint_version_id',
        'updated_at'
      ]::text[]
    )
  then
    return new;
  end if;

  if tg_table_name = 'test_questions'
    and exists (
      select 1
      from public.tests test
      where test.id = any(v_test_ids)
        and test.questions_locked_at is not null
    )
    and not (
      tg_op = 'UPDATE'
      and (to_jsonb(new) - array['question_text', 'updated_at',
        'ai_reference_cache_key', 'ai_reference_cache_answers',
        'ai_reference_cache_model', 'ai_reference_cache_generated_at']::text[])
        is not distinct from
        (to_jsonb(old) - array['question_text', 'updated_at',
        'ai_reference_cache_key', 'ai_reference_cache_answers',
        'ai_reference_cache_model', 'ai_reference_cache_generated_at']::text[])
    )
  then
    raise exception using
      errcode = '55000',
      message = 'test_questions_locked: Only question wording can change after a student starts';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


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
  v_classroom_id uuid;
  v_result jsonb;
  v_responses jsonb;
begin
  select test.classroom_id
    into v_classroom_id
  from public.tests test
  where test.id = p_test_id;

  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.classrooms classroom
  where classroom.id = v_classroom_id
  for update;

  if not found then
    raise exception 'Classroom not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.tests test
  where test.id = p_test_id
    and test.classroom_id = v_classroom_id
  for update;

  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;

  -- NULL means explicit Start/Resume, never replace saved work with {}.
  -- Parent locks serialize this read with saves, submissions and teacher edits.
  if p_responses is null then
    select attempt.responses into v_responses
    from public.test_attempts attempt
    where attempt.test_id = p_test_id and attempt.student_id = p_student_id;
    v_responses := coalesce(v_responses, '{}'::jsonb);
  else
    v_responses := p_responses;
  end if;
  v_result := private.save_test_attempt_atomic_pre_parent_lock_order(
    p_test_id,
    p_student_id,
    v_responses
  );
  update public.tests set questions_locked_at = clock_timestamp()
  where id = p_test_id and questions_locked_at is null;
  -- Return the exact post-lock student-visible structure. Answer keys and
  -- solutions never leave this security-definer boundary.
  return v_result || jsonb_build_object(
    'questions', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'test_id', q.test_id, 'question_type', q.question_type,
      'question_text', q.question_text, 'options', q.options, 'points', q.points,
      'response_max_chars', q.response_max_chars,
      'response_monospace', q.response_monospace, 'position', q.position,
      'created_at', q.created_at, 'updated_at', q.updated_at
    ) order by q.position, q.id), '[]'::jsonb) from public.test_questions q where q.test_id = p_test_id)
  );
end;
$$;

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
  v_classroom_id uuid;
  v_result jsonb;
  v_responses jsonb;
begin
  select test.classroom_id
    into v_classroom_id
  from public.tests test
  where test.id = p_test_id;

  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.classrooms classroom
  where classroom.id = v_classroom_id
  for update;

  if not found then
    raise exception 'Classroom not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.tests test
  where test.id = p_test_id
    and test.classroom_id = v_classroom_id
  for update;

  if not found then
    raise exception 'Test not found' using errcode = 'P0002';
  end if;

  v_result := private.submit_test_attempt_atomic_pre_parent_lock_order(
    p_test_id,
    p_student_id,
    p_responses,
    p_submitted_at
  );
  update public.tests set questions_locked_at = clock_timestamp()
  where id = p_test_id and questions_locked_at is null;
  return v_result;
end;
$$;


-- Public RPC signatures and grants are unchanged. NULL responses now mean Start.
reset lock_timeout;
