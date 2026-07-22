-- Persist bounded, versioned assignment-grading provenance without changing
-- the signatures used by older application instances.

alter table public.assignment_docs
  add column if not exists ai_grading_provenance jsonb;

alter table public.assignment_docs
  add constraint assignment_docs_ai_grading_provenance_contract
  check (
    ai_grading_provenance is null
    or (
      jsonb_typeof(ai_grading_provenance) = 'object'
      and ai_grading_provenance ?& array[
        'schemaVersion', 'provider', 'model', 'policyVersion', 'promptVersion',
        'gradingProfileVersion', 'rubricVersion', 'providerRequestCount', 'tokenUsage'
      ]
      and ai_grading_provenance - array[
        'schemaVersion', 'provider', 'model', 'policyVersion', 'promptVersion',
        'gradingProfileVersion', 'rubricVersion', 'providerRequestCount', 'tokenUsage'
      ]::text[] = '{}'::jsonb
      and ai_grading_provenance->>'schemaVersion' = 'assignment-grading-provenance-v1'
      and jsonb_typeof(ai_grading_provenance->'provider') = 'string'
      and length(ai_grading_provenance->>'provider') between 1 and 120
      and jsonb_typeof(ai_grading_provenance->'model') = 'string'
      and length(ai_grading_provenance->>'model') between 1 and 200
      and jsonb_typeof(ai_grading_provenance->'policyVersion') = 'string'
      and length(ai_grading_provenance->>'policyVersion') between 1 and 120
      and jsonb_typeof(ai_grading_provenance->'promptVersion') = 'string'
      and length(ai_grading_provenance->>'promptVersion') between 1 and 120
      and jsonb_typeof(ai_grading_provenance->'gradingProfileVersion') = 'string'
      and length(ai_grading_provenance->>'gradingProfileVersion') between 1 and 120
      and jsonb_typeof(ai_grading_provenance->'rubricVersion') = 'string'
      and length(ai_grading_provenance->>'rubricVersion') between 1 and 120
      and jsonb_typeof(ai_grading_provenance->'providerRequestCount') = 'number'
      and (ai_grading_provenance->>'providerRequestCount')::integer between 1 and 10
      and (ai_grading_provenance->>'providerRequestCount')::numeric
        = trunc((ai_grading_provenance->>'providerRequestCount')::numeric)
      and jsonb_typeof(ai_grading_provenance->'tokenUsage') = 'object'
      and ai_grading_provenance->'tokenUsage' ?& array[
        'inputTokens', 'outputTokens', 'totalTokens'
      ]
      and (ai_grading_provenance->'tokenUsage') - array[
        'inputTokens', 'outputTokens', 'totalTokens'
      ]::text[] = '{}'::jsonb
      and jsonb_typeof(ai_grading_provenance->'tokenUsage'->'inputTokens') in ('number', 'null')
      and jsonb_typeof(ai_grading_provenance->'tokenUsage'->'outputTokens') in ('number', 'null')
      and jsonb_typeof(ai_grading_provenance->'tokenUsage'->'totalTokens') in ('number', 'null')
      and (
        jsonb_typeof(ai_grading_provenance->'tokenUsage'->'inputTokens') = 'null'
        or (
          (ai_grading_provenance->'tokenUsage'->>'inputTokens')::numeric >= 0
          and (ai_grading_provenance->'tokenUsage'->>'inputTokens')::numeric
            = trunc((ai_grading_provenance->'tokenUsage'->>'inputTokens')::numeric)
        )
      )
      and (
        jsonb_typeof(ai_grading_provenance->'tokenUsage'->'outputTokens') = 'null'
        or (
          (ai_grading_provenance->'tokenUsage'->>'outputTokens')::numeric >= 0
          and (ai_grading_provenance->'tokenUsage'->>'outputTokens')::numeric
            = trunc((ai_grading_provenance->'tokenUsage'->>'outputTokens')::numeric)
        )
      )
      and (
        jsonb_typeof(ai_grading_provenance->'tokenUsage'->'totalTokens') = 'null'
        or (
          (ai_grading_provenance->'tokenUsage'->>'totalTokens')::numeric >= 0
          and (ai_grading_provenance->'tokenUsage'->>'totalTokens')::numeric
            = trunc((ai_grading_provenance->'tokenUsage'->>'totalTokens')::numeric)
        )
      )
      and octet_length(ai_grading_provenance::text) <= 4096
    )
  ) not valid;

alter table public.assignment_docs
  validate constraint assignment_docs_ai_grading_provenance_contract;

comment on column public.assignment_docs.ai_grading_provenance is
  'Bounded, pseudonymous assignment-grading provenance; never contains student or roster identifiers.';

create or replace function public.clear_stale_assignment_ai_grading_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ai_grading_provenance is not distinct from old.ai_grading_provenance
    and (
      new.score_completion is distinct from old.score_completion
      or new.score_thinking is distinct from old.score_thinking
      or new.score_workflow is distinct from old.score_workflow
      or new.ai_feedback_suggestion is distinct from old.ai_feedback_suggestion
      or new.ai_feedback_suggested_at is distinct from old.ai_feedback_suggested_at
      or new.ai_feedback_model is distinct from old.ai_feedback_model
      or new.graded_at is distinct from old.graded_at
      or new.graded_by is distinct from old.graded_by
    )
  then
    new.ai_grading_provenance := null;
  end if;

  return new;
end;
$$;

drop trigger if exists clear_stale_assignment_ai_grading_provenance
  on public.assignment_docs;
create trigger clear_stale_assignment_ai_grading_provenance
before update of
  score_completion,
  score_thinking,
  score_workflow,
  ai_feedback_suggestion,
  ai_feedback_suggested_at,
  ai_feedback_model,
  graded_at,
  graded_by
on public.assignment_docs
for each row
execute function public.clear_stale_assignment_ai_grading_provenance();

create or replace function public.save_assignment_ai_grade_with_provenance_atomic(
  p_assignment_id uuid,
  p_student_id uuid,
  p_teacher_id uuid,
  p_expected_doc_updated_at timestamptz,
  p_score_completion integer,
  p_score_thinking integer,
  p_score_workflow integer,
  p_feedback text,
  p_apply_teacher_feedback_draft boolean,
  p_mark_graded boolean,
  p_ai_feedback_suggestion text,
  p_ai_feedback_model text,
  p_ai_grading_provenance jsonb,
  p_graded_by text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_doc_id uuid;
begin
  v_result := public.save_assignment_ai_grade_atomic(
    p_assignment_id,
    p_student_id,
    p_teacher_id,
    p_expected_doc_updated_at,
    p_score_completion,
    p_score_thinking,
    p_score_workflow,
    p_feedback,
    p_apply_teacher_feedback_draft,
    p_mark_graded,
    p_ai_feedback_suggestion,
    p_ai_feedback_model,
    p_graded_by,
    p_now
  );

  v_doc_id := (v_result->'docs'->0->>'id')::uuid;

  update public.assignment_docs d
  set ai_grading_provenance = p_ai_grading_provenance
  where d.id = v_doc_id;

  select jsonb_build_object('docs', jsonb_build_array(to_jsonb(d)))
  into v_result
  from public.assignment_docs d
  where d.id = v_doc_id;

  return v_result;
end;
$$;

create or replace function public.finalize_assignment_ai_grading_item_with_provenance_atomic(
  p_item_id uuid,
  p_teacher_id uuid,
  p_score_completion integer,
  p_score_thinking integer,
  p_score_workflow integer,
  p_feedback text,
  p_apply_teacher_feedback_draft boolean,
  p_mark_graded boolean,
  p_ai_feedback_suggestion text,
  p_ai_feedback_model text,
  p_ai_grading_provenance jsonb,
  p_graded_by text,
  p_attempt_count integer,
  p_item_status text,
  p_skip_reason text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_item_status text;
  v_result jsonb;
  v_doc_id uuid;
begin
  select item.assignment_id
  into v_assignment_id
  from public.assignment_ai_grading_run_items item
  where item.id = p_item_id;

  if not found then
    raise exception 'Assignment AI grading item not found' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_assignment_id::text, 0));

  select item.status
  into v_item_status
  from public.assignment_ai_grading_run_items item
  where item.id = p_item_id
    and item.assignment_id = v_assignment_id
  for update;

  v_result := public.finalize_assignment_ai_grading_item_atomic(
    p_item_id,
    p_teacher_id,
    p_score_completion,
    p_score_thinking,
    p_score_workflow,
    p_feedback,
    p_apply_teacher_feedback_draft,
    p_mark_graded,
    p_ai_feedback_suggestion,
    p_ai_feedback_model,
    p_graded_by,
    p_attempt_count,
    p_item_status,
    p_skip_reason,
    p_now
  );

  v_doc_id := (v_result->'docs'->0->>'id')::uuid;

  if v_item_status not in ('completed', 'skipped') then
    update public.assignment_docs d
    set ai_grading_provenance = p_ai_grading_provenance
    where d.id = v_doc_id;
  end if;

  select jsonb_build_object('docs', jsonb_build_array(to_jsonb(d)))
  into v_result
  from public.assignment_docs d
  where d.id = v_doc_id;

  return v_result;
end;
$$;

revoke all on function public.save_assignment_ai_grade_with_provenance_atomic(
  uuid, uuid, uuid, timestamptz, integer, integer, integer, text, boolean, boolean, text, text, jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.save_assignment_ai_grade_with_provenance_atomic(
  uuid, uuid, uuid, timestamptz, integer, integer, integer, text, boolean, boolean, text, text, jsonb, text, timestamptz
) to service_role;

revoke all on function public.finalize_assignment_ai_grading_item_with_provenance_atomic(
  uuid, uuid, integer, integer, integer, text, boolean, boolean, text, text, jsonb, text, integer, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.finalize_assignment_ai_grading_item_with_provenance_atomic(
  uuid, uuid, integer, integer, integer, text, boolean, boolean, text, text, jsonb, text, integer, text, text, timestamptz
) to service_role;
