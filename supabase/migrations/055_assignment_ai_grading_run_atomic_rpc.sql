create or replace function public.create_assignment_ai_grading_run_atomic(
  p_assignment_id uuid,
  p_teacher_id uuid,
  p_model text,
  p_requested_student_ids uuid[],
  p_selection_hash text,
  p_gradable_count integer,
  p_skipped_missing_count integer,
  p_skipped_empty_count integer,
  p_item_rows jsonb,
  p_now timestamptz default now()
)
returns public.assignment_ai_grading_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer := coalesce(cardinality(p_requested_student_ids), 0);
  v_processed_count integer := greatest(coalesce(p_skipped_missing_count, 0), 0)
    + greatest(coalesce(p_skipped_empty_count, 0), 0);
  v_item_count integer := coalesce(jsonb_array_length(coalesce(p_item_rows, '[]'::jsonb)), 0);
  v_run public.assignment_ai_grading_runs;
begin
  if v_item_count <> v_requested_count then
    raise exception 'Assignment AI grading run item payload count mismatch';
  end if;

  insert into public.assignment_ai_grading_runs (
    assignment_id,
    status,
    triggered_by,
    model,
    requested_student_ids_json,
    selection_hash,
    requested_count,
    gradable_count,
    processed_count,
    completed_count,
    skipped_missing_count,
    skipped_empty_count,
    failed_count,
    error_samples_json,
    started_at,
    completed_at
  )
  values (
    p_assignment_id,
    case when greatest(coalesce(p_gradable_count, 0), 0) = 0 then 'completed' else 'queued' end,
    p_teacher_id,
    p_model,
    to_jsonb(coalesce(p_requested_student_ids, array[]::uuid[])),
    p_selection_hash,
    v_requested_count,
    greatest(coalesce(p_gradable_count, 0), 0),
    v_processed_count,
    0,
    greatest(coalesce(p_skipped_missing_count, 0), 0),
    greatest(coalesce(p_skipped_empty_count, 0), 0),
    0,
    '[]'::jsonb,
    case when greatest(coalesce(p_gradable_count, 0), 0) = 0 then p_now else null end,
    case when greatest(coalesce(p_gradable_count, 0), 0) = 0 then p_now else null end
  )
  returning * into v_run;

  insert into public.assignment_ai_grading_run_items (
    run_id,
    assignment_id,
    student_id,
    assignment_doc_id,
    queue_position,
    status,
    skip_reason,
    attempt_count,
    next_retry_at,
    last_error_code,
    last_error_message,
    started_at,
    completed_at
  )
  select
    v_run.id,
    p_assignment_id,
    item.student_id,
    item.assignment_doc_id,
    coalesce(item.queue_position, 0),
    item.status,
    item.skip_reason,
    coalesce(item.attempt_count, 0),
    item.next_retry_at,
    item.last_error_code,
    item.last_error_message,
    item.started_at,
    item.completed_at
  from jsonb_to_recordset(coalesce(p_item_rows, '[]'::jsonb)) as item(
    student_id uuid,
    assignment_doc_id uuid,
    queue_position integer,
    status text,
    skip_reason text,
    attempt_count integer,
    next_retry_at timestamptz,
    last_error_code text,
    last_error_message text,
    started_at timestamptz,
    completed_at timestamptz
  );

  insert into public.assignment_docs (
    assignment_id,
    student_id,
    score_completion,
    score_thinking,
    score_workflow,
    teacher_feedback_draft,
    teacher_feedback_draft_updated_at,
    ai_feedback_suggestion,
    ai_feedback_suggested_at,
    ai_feedback_model,
    graded_at,
    graded_by
  )
  select
    p_assignment_id,
    item.student_id,
    0,
    0,
    0,
    'Missing',
    p_now,
    null,
    null,
    null,
    p_now,
    p_teacher_id::text
  from jsonb_to_recordset(coalesce(p_item_rows, '[]'::jsonb)) as item(
    student_id uuid,
    assignment_doc_id uuid,
    queue_position integer,
    status text,
    skip_reason text,
    attempt_count integer,
    next_retry_at timestamptz,
    last_error_code text,
    last_error_message text,
    started_at timestamptz,
    completed_at timestamptz
  )
  where item.skip_reason in ('missing_doc', 'empty_doc')
  on conflict (assignment_id, student_id) do update
  set
    score_completion = excluded.score_completion,
    score_thinking = excluded.score_thinking,
    score_workflow = excluded.score_workflow,
    teacher_feedback_draft = excluded.teacher_feedback_draft,
    teacher_feedback_draft_updated_at = excluded.teacher_feedback_draft_updated_at,
    ai_feedback_suggestion = excluded.ai_feedback_suggestion,
    ai_feedback_suggested_at = excluded.ai_feedback_suggested_at,
    ai_feedback_model = excluded.ai_feedback_model,
    graded_at = excluded.graded_at,
    graded_by = excluded.graded_by;

  return v_run;
end;
$$;

revoke all on function public.create_assignment_ai_grading_run_atomic(
  uuid,
  uuid,
  text,
  uuid[],
  text,
  integer,
  integer,
  integer,
  jsonb,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.create_assignment_ai_grading_run_atomic(
  uuid,
  uuid,
  text,
  uuid[],
  text,
  integer,
  integer,
  integer,
  jsonb,
  timestamptz
) to service_role;
