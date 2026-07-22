-- Persist bounded, versioned test-grading provenance without changing the
-- signatures used by older application instances.

alter table public.test_responses
  add column if not exists ai_grading_provenance jsonb;

-- Provenance is part of the same logical grade mutation. The compatibility
-- wrappers set it after invoking the old RPC, so that metadata-only update must
-- not advance the optimistic response revision a second time.
create or replace function public.stamp_test_response_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('pika.classroom_archive_restore', true) = 'on'
    and current_user in ('postgres', 'service_role', 'supabase_admin')
  then
    new.revision := coalesce(new.revision, 1);
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.revision := 1;
  elsif to_jsonb(new) - 'ai_grading_provenance'
    = to_jsonb(old) - 'ai_grading_provenance'
  then
    new.revision := old.revision;
    return new;
  else
    new.revision := coalesce(old.revision, 0) + 1;
  end if;
  if new.ai_grading_basis is null then
    new.ai_suggested_score := null;
    new.ai_suggested_feedback := null;
  end if;
  return new;
end;
$$;

alter table public.test_responses
  add constraint test_responses_ai_grading_provenance_contract
  check (
    ai_grading_provenance is null
    or (
      jsonb_typeof(ai_grading_provenance) = 'object'
      and ai_grading_provenance ?& array[
        'schemaVersion', 'gradingRequestId', 'provider', 'model', 'policyVersion',
        'promptVersion', 'gradingProfileVersion', 'rubricVersion', 'operation',
        'batchSize', 'providerRequestCount', 'tokenUsage'
      ]
      and ai_grading_provenance - array[
        'schemaVersion', 'gradingRequestId', 'provider', 'model', 'policyVersion',
        'promptVersion', 'gradingProfileVersion', 'rubricVersion', 'operation',
        'batchSize', 'providerRequestCount', 'tokenUsage'
      ]::text[] = '{}'::jsonb
      and jsonb_typeof(ai_grading_provenance->'schemaVersion') = 'string'
      and ai_grading_provenance->>'schemaVersion' = 'test-grading-provenance-v1'
      and ai_grading_basis is not null
      and ai_grading_basis in ('teacher_key', 'generated_reference')
      and ai_model is not null
      and ai_model = ai_grading_provenance->>'model'
      and ai_suggested_score is not null
      and ai_suggested_feedback is not null
      and jsonb_typeof(ai_grading_provenance->'gradingRequestId') = 'string'
      and ai_grading_provenance->>'gradingRequestId'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
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
      and jsonb_typeof(ai_grading_provenance->'operation') = 'string'
      and ai_grading_provenance->>'operation' in ('single', 'batch')
      and jsonb_typeof(ai_grading_provenance->'batchSize') = 'number'
      and (ai_grading_provenance->>'batchSize')::integer between 1 and 20
      and (ai_grading_provenance->>'batchSize')::numeric
        = trunc((ai_grading_provenance->>'batchSize')::numeric)
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

alter table public.test_responses
  validate constraint test_responses_ai_grading_provenance_contract;

comment on column public.test_responses.ai_grading_provenance is
  'Bounded, pseudonymous test-grading provenance; never contains student or roster identifiers.';

create or replace function public.clear_stale_test_ai_grading_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ai_grading_provenance is not distinct from old.ai_grading_provenance
    and (
      new.ai_grading_basis is distinct from old.ai_grading_basis
      or new.ai_reference_answers is distinct from old.ai_reference_answers
      or new.ai_model is distinct from old.ai_model
      or new.ai_suggested_score is distinct from old.ai_suggested_score
      or new.ai_suggested_feedback is distinct from old.ai_suggested_feedback
    )
  then
    new.ai_grading_provenance := null;
  end if;

  return new;
end;
$$;

drop trigger if exists clear_stale_test_ai_grading_provenance
  on public.test_responses;
create trigger clear_stale_test_ai_grading_provenance
before update of
  ai_grading_basis,
  ai_reference_answers,
  ai_model,
  ai_suggested_score,
  ai_suggested_feedback
on public.test_responses
for each row
execute function public.clear_stale_test_ai_grading_provenance();

create or replace function public.save_test_response_grades_with_provenance_atomic(
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
  v_result jsonb;
  v_grade jsonb;
  v_response_id uuid;
begin
  v_result := public.save_test_response_grades_atomic(
    p_test_id,
    p_student_id,
    p_teacher_id,
    p_grade_rows,
    p_now
  );

  for v_grade in select value from jsonb_array_elements(p_grade_rows)
  loop
    if v_grade ? 'ai_grading_provenance' then
      v_response_id := (v_grade->>'response_id')::uuid;
      update public.test_responses response
      set ai_grading_provenance = case
        when jsonb_typeof(v_grade->'ai_grading_provenance') = 'null' then null
        else v_grade->'ai_grading_provenance'
      end
      where response.id = v_response_id
        and response.test_id = p_test_id;

      if not found then
        raise exception 'Test response not found' using errcode = 'P0002';
      end if;
    end if;
  end loop;

  return v_result;
end;
$$;

create or replace function public.finalize_test_ai_grading_item_with_provenance_atomic(
  p_item_id uuid,
  p_teacher_id uuid,
  p_lease_token uuid,
  p_score numeric,
  p_feedback text,
  p_ai_grading_basis text,
  p_ai_reference_answers jsonb,
  p_ai_model text,
  p_ai_grading_provenance jsonb,
  p_attempt_count integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test_id uuid;
  v_item_status text;
  v_result jsonb;
  v_response_id uuid;
begin
  select item.test_id
  into v_test_id
  from public.test_ai_grading_run_items item
  where item.id = p_item_id;

  if not found then
    raise exception 'Test AI grading item not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_test_id::text, 0));

  select item.status
  into v_item_status
  from public.test_ai_grading_run_items item
  where item.id = p_item_id
    and item.test_id = v_test_id
  for update;

  v_result := public.finalize_test_ai_grading_item_atomic(
    p_item_id,
    p_teacher_id,
    p_lease_token,
    p_score,
    p_feedback,
    p_ai_grading_basis,
    p_ai_reference_answers,
    p_ai_model,
    p_attempt_count,
    p_now
  );

  if v_item_status <> 'completed' and v_result->>'outcome' = 'saved' then
    v_response_id := (v_result->'response'->>'id')::uuid;
    update public.test_responses response
    set ai_grading_provenance = p_ai_grading_provenance
    where response.id = v_response_id
      and response.test_id = v_test_id;

    if not found then
      raise exception 'Test response not found' using errcode = 'P0002';
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function public.save_test_response_grades_with_provenance_atomic(
  uuid, uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.save_test_response_grades_with_provenance_atomic(
  uuid, uuid, uuid, jsonb, timestamptz
) to service_role;

revoke all on function public.finalize_test_ai_grading_item_with_provenance_atomic(
  uuid, uuid, uuid, numeric, text, text, jsonb, text, jsonb, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.finalize_test_ai_grading_item_with_provenance_atomic(
  uuid, uuid, uuid, numeric, text, text, jsonb, text, jsonb, integer, timestamptz
) to service_role;
