-- Add per-result repository-review provenance and atomically copy it to the
-- assignment document while preserving the migration-087 completion RPC for
-- rolling application deploys.

alter table public.assignment_docs
  drop constraint if exists assignment_docs_ai_grading_provenance_contract;

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
      and ai_feedback_model is not null
      and ai_feedback_model = ai_grading_provenance->>'model'
      and jsonb_typeof(ai_grading_provenance->'policyVersion') = 'string'
      and length(ai_grading_provenance->>'policyVersion') between 1 and 120
      and jsonb_typeof(ai_grading_provenance->'promptVersion') = 'string'
      and length(ai_grading_provenance->>'promptVersion') between 1 and 120
      and jsonb_typeof(ai_grading_provenance->'gradingProfileVersion') = 'string'
      and length(ai_grading_provenance->>'gradingProfileVersion') between 1 and 120
      and jsonb_typeof(ai_grading_provenance->'rubricVersion') = 'string'
      and length(ai_grading_provenance->>'rubricVersion') between 1 and 120
      and jsonb_typeof(ai_grading_provenance->'providerRequestCount') = 'number'
      and (ai_grading_provenance->>'providerRequestCount')::integer between 0 and 10
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

alter table public.assignment_repo_review_results
  add column if not exists grading_model text,
  add column if not exists grading_provenance jsonb;

alter table public.assignment_repo_review_results
  add constraint assignment_repo_review_results_grading_provenance_contract
  check (
    (grading_model is null and grading_provenance is null)
    or (
      grading_model is not null
      and length(grading_model) between 1 and 200
      and grading_provenance is not null
      and jsonb_typeof(grading_provenance) = 'object'
      and grading_provenance ?& array[
        'schemaVersion', 'provider', 'model', 'policyVersion', 'promptVersion',
        'gradingProfileVersion', 'rubricVersion', 'providerRequestCount', 'tokenUsage'
      ]
      and grading_provenance - array[
        'schemaVersion', 'provider', 'model', 'policyVersion', 'promptVersion',
        'gradingProfileVersion', 'rubricVersion', 'providerRequestCount', 'tokenUsage'
      ]::text[] = '{}'::jsonb
      and grading_provenance->>'schemaVersion' = 'assignment-grading-provenance-v1'
      and jsonb_typeof(grading_provenance->'provider') = 'string'
      and length(grading_provenance->>'provider') between 1 and 120
      and jsonb_typeof(grading_provenance->'model') = 'string'
      and length(grading_provenance->>'model') between 1 and 200
      and grading_model = grading_provenance->>'model'
      and jsonb_typeof(grading_provenance->'policyVersion') = 'string'
      and length(grading_provenance->>'policyVersion') between 1 and 120
      and jsonb_typeof(grading_provenance->'promptVersion') = 'string'
      and length(grading_provenance->>'promptVersion') between 1 and 120
      and jsonb_typeof(grading_provenance->'gradingProfileVersion') = 'string'
      and length(grading_provenance->>'gradingProfileVersion') between 1 and 120
      and jsonb_typeof(grading_provenance->'rubricVersion') = 'string'
      and length(grading_provenance->>'rubricVersion') between 1 and 120
      and jsonb_typeof(grading_provenance->'providerRequestCount') = 'number'
      and (grading_provenance->>'providerRequestCount')::integer between 0 and 10
      and (grading_provenance->>'providerRequestCount')::numeric
        = trunc((grading_provenance->>'providerRequestCount')::numeric)
      and jsonb_typeof(grading_provenance->'tokenUsage') = 'object'
      and grading_provenance->'tokenUsage' ?& array[
        'inputTokens', 'outputTokens', 'totalTokens'
      ]
      and (grading_provenance->'tokenUsage') - array[
        'inputTokens', 'outputTokens', 'totalTokens'
      ]::text[] = '{}'::jsonb
      and jsonb_typeof(grading_provenance->'tokenUsage'->'inputTokens') in ('number', 'null')
      and jsonb_typeof(grading_provenance->'tokenUsage'->'outputTokens') in ('number', 'null')
      and jsonb_typeof(grading_provenance->'tokenUsage'->'totalTokens') in ('number', 'null')
      and (
        jsonb_typeof(grading_provenance->'tokenUsage'->'inputTokens') = 'null'
        or (
          (grading_provenance->'tokenUsage'->>'inputTokens')::numeric >= 0
          and (grading_provenance->'tokenUsage'->>'inputTokens')::numeric
            = trunc((grading_provenance->'tokenUsage'->>'inputTokens')::numeric)
        )
      )
      and (
        jsonb_typeof(grading_provenance->'tokenUsage'->'outputTokens') = 'null'
        or (
          (grading_provenance->'tokenUsage'->>'outputTokens')::numeric >= 0
          and (grading_provenance->'tokenUsage'->>'outputTokens')::numeric
            = trunc((grading_provenance->'tokenUsage'->>'outputTokens')::numeric)
        )
      )
      and (
        jsonb_typeof(grading_provenance->'tokenUsage'->'totalTokens') = 'null'
        or (
          (grading_provenance->'tokenUsage'->>'totalTokens')::numeric >= 0
          and (grading_provenance->'tokenUsage'->>'totalTokens')::numeric
            = trunc((grading_provenance->'tokenUsage'->>'totalTokens')::numeric)
        )
      )
      and octet_length(grading_provenance::text) <= 4096
    )
  ) not valid;

alter table public.assignment_repo_review_results
  validate constraint assignment_repo_review_results_grading_provenance_contract;

comment on column public.assignment_repo_review_results.grading_provenance is
  'Bounded, pseudonymous repository-review grading provenance; never contains student or roster identifiers.';

create or replace function public.complete_assignment_repo_review_run_with_provenance_atomic(
  p_run_id uuid,
  p_teacher_id uuid,
  p_result_rows jsonb,
  p_grade_rows jsonb,
  p_source_ref text,
  p_model text,
  p_warnings jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_triggered_by uuid;
  v_status text;
  v_result_count integer;
  v_matched_count integer;
  v_updated_count integer;
  v_grade_result jsonb;
begin
  select run.assignment_id
  into v_assignment_id
  from public.assignment_repo_review_runs run
  where run.id = p_run_id;

  if not found then
    raise exception 'Assignment repo review run not found' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_assignment_id::text, 0));

  select run.triggered_by, run.status
  into v_triggered_by, v_status
  from public.assignment_repo_review_runs run
  where run.id = p_run_id
    and run.assignment_id = v_assignment_id
  for update;

  if not found or v_triggered_by <> p_teacher_id then
    raise exception 'Assignment repo review mutation is not allowed' using errcode = '42501';
  end if;

  if v_status <> 'completed' then
    if jsonb_typeof(p_result_rows) <> 'array'
      or jsonb_typeof(p_grade_rows) <> 'array'
      or jsonb_array_length(p_result_rows) = 0
      or jsonb_array_length(p_result_rows) <> jsonb_array_length(p_grade_rows)
      or jsonb_array_length(p_result_rows) > 100
    then
      raise exception 'Assignment repo review provenance payload is invalid' using errcode = '22023';
    end if;

    v_result_count := jsonb_array_length(p_result_rows);

    select count(*)
    into v_matched_count
    from jsonb_to_recordset(p_result_rows) as result_payload(
      student_id uuid,
      grading_model text,
      grading_provenance jsonb
    )
    join jsonb_to_recordset(p_grade_rows) as grade_payload(
      student_id uuid,
      ai_feedback_model text,
      ai_grading_provenance jsonb
    ) using (student_id)
    where result_payload.grading_model is not null
      and result_payload.grading_provenance is not null
      and result_payload.grading_model = grade_payload.ai_feedback_model
      and result_payload.grading_provenance = grade_payload.ai_grading_provenance;

    if v_matched_count <> v_result_count
      or (
        select count(distinct result_payload.student_id)
        from jsonb_to_recordset(p_result_rows) as result_payload(student_id uuid)
      ) <> v_result_count
      or (
        select count(distinct grade_payload.student_id)
        from jsonb_to_recordset(p_grade_rows) as grade_payload(student_id uuid)
      ) <> v_result_count
    then
      raise exception 'Assignment repo review provenance rows do not match' using errcode = '22023';
    end if;
  end if;

  v_grade_result := public.complete_assignment_repo_review_run_atomic(
    p_run_id,
    p_teacher_id,
    p_result_rows,
    p_grade_rows,
    p_source_ref,
    p_model,
    p_warnings,
    p_now
  );

  if v_status <> 'completed' then
    update public.assignment_repo_review_results result
    set
      grading_model = payload.grading_model,
      grading_provenance = payload.grading_provenance
    from jsonb_to_recordset(p_result_rows) as payload(
      student_id uuid,
      grading_model text,
      grading_provenance jsonb
    )
    where result.run_id = p_run_id
      and result.assignment_id = v_assignment_id
      and result.student_id = payload.student_id;

    get diagnostics v_updated_count = row_count;
    if v_updated_count <> v_result_count then
      raise exception 'Assignment repo review provenance result count mismatch' using errcode = '22023';
    end if;

    update public.assignment_docs doc
    set ai_grading_provenance = payload.ai_grading_provenance
    from jsonb_to_recordset(p_grade_rows) as payload(
      student_id uuid,
      ai_grading_provenance jsonb
    )
    where doc.assignment_id = v_assignment_id
      and doc.student_id = payload.student_id;

    get diagnostics v_updated_count = row_count;
    if v_updated_count <> v_result_count then
      raise exception 'Assignment repo review provenance grade count mismatch' using errcode = '22023';
    end if;

    select jsonb_build_object(
      'docs', coalesce(jsonb_agg(to_jsonb(doc) order by doc.student_id), '[]'::jsonb)
    )
    into v_grade_result
    from public.assignment_docs doc
    join public.assignment_repo_review_results result
      on result.assignment_id = doc.assignment_id
     and result.student_id = doc.student_id
    where result.run_id = p_run_id;
  end if;

  return v_grade_result;
end;
$$;

revoke all on function public.complete_assignment_repo_review_run_with_provenance_atomic(
  uuid, uuid, jsonb, jsonb, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_assignment_repo_review_run_with_provenance_atomic(
  uuid, uuid, jsonb, jsonb, text, text, jsonb, timestamptz
) to service_role;
