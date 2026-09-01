-- Migration 143. Apply only with approval naming this file and target.
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
  select min(response.submitted_at) from public.test_responses response where response.test_id = test.id
))
where exists (select 1 from public.test_attempts a where a.test_id = test.id)
   or exists (select 1 from public.test_responses r where r.test_id = test.id);

-- Cold archives created before this migration do not contain the new lock
-- column. Restore requires an exact current-schema row, so retain every
-- existing adapter and add the missing Test field. A legacy Test stays
-- structurally editable only when its archive contains no attempt or response;
-- the maintenance trigger below reconstructs the boundary as student work is
-- restored, before the Classroom is exposed.
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
  if p_table_name = 'classrooms' then
    if not (p_row ? 'feature_visibility') then
      p_row := p_row || jsonb_build_object(
        'feature_visibility',
        '{
          "attendance": true,
          "classwork": true,
          "tests": true,
          "gradebook": true,
          "calendar": true,
          "syllabus": true,
          "announcements": true,
          "achievements": true
        }'::jsonb
      );
    end if;
    return p_row;
  end if;

  if p_table_name = 'assignment_docs' then
    if not (p_row ? 'save_session_id') then
      p_row := p_row || jsonb_build_object('save_session_id', null);
    end if;
    if not (p_row ? 'save_sequence') then
      p_row := p_row || jsonb_build_object('save_sequence', null);
    end if;
    return p_row;
  end if;

  if p_table_name = 'tests' then
    if not (p_row ? 'questions_locked_at') then
      p_row := p_row || jsonb_build_object('questions_locked_at', null);
    end if;
    return p_row;
  end if;

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

  -- Archive restore and compaction run only inside owner-scoped maintenance
  -- transactions. They must be able to recreate an archived locked Test's
  -- question identities without opening the same path to API callers.
  if public.is_classroom_archive_maintenance_mode('restore')
    or public.is_classroom_archive_maintenance_mode('compaction')
  then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
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

-- Pre-143 archives store student work but no explicit Test boundary. Both
-- restore contract versions insert attempts/responses before questions while
-- the owner-scoped maintenance flag is active, so rebuild the irreversible
-- boundary in the same transaction before any question rows are restored.
create function private.restore_test_question_lock_from_work()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_classroom_archive_maintenance_mode('restore') then
    update public.tests test
    set questions_locked_at = coalesce(
      test.questions_locked_at,
      (to_jsonb(new)->>'created_at')::timestamptz,
      (to_jsonb(new)->>'submitted_at')::timestamptz
    )
    where test.id = new.test_id
      and test.questions_locked_at is null;
  end if;
  return new;
end;
$$;

create trigger restore_test_question_lock_from_attempt
after insert on public.test_attempts
for each row execute function private.restore_test_question_lock_from_work();

create trigger restore_test_question_lock_from_response
after insert on public.test_responses
for each row execute function private.restore_test_question_lock_from_work();

revoke all on function private.restore_test_question_lock_from_work()
from public, anon, authenticated, service_role;


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
