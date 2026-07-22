-- Preserve bounded, deidentified AI suggestions and teacher outcomes on the
-- grading records that already own the corresponding submission lifecycle.

create or replace function public.is_valid_grading_review(p_review jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_criterion jsonb;
  v_criterion_ids text[] := array[]::text[];
  v_provenance jsonb;
  v_token_usage jsonb;
  v_status text;
  v_feedback_disposition text;
  v_suggested numeric;
  v_final numeric;
  v_max numeric;
begin
  if p_review is null
    or jsonb_typeof(p_review) <> 'object'
    or not (p_review ?& array[
      'schemaVersion', 'assessmentKind', 'reviewStatus', 'criteria',
      'feedbackDisposition', 'reviewedAt', 'provenance'
    ])
    or p_review - array[
      'schemaVersion', 'assessmentKind', 'reviewStatus', 'criteria',
      'feedbackDisposition', 'reviewedAt', 'provenance'
    ]::text[] <> '{}'::jsonb
    or p_review->>'schemaVersion' <> 'grading-review-v1'
    or jsonb_typeof(p_review->'assessmentKind') <> 'string'
    or p_review->>'assessmentKind' not in ('assignment', 'test')
    or jsonb_typeof(p_review->'reviewStatus') <> 'string'
    or p_review->>'reviewStatus' not in ('pending', 'reviewed', 'dismissed')
    or jsonb_typeof(p_review->'feedbackDisposition') <> 'string'
    or p_review->>'feedbackDisposition' not in ('pending', 'unchanged', 'edited', 'removed')
    or jsonb_typeof(p_review->'criteria') <> 'array'
    or jsonb_array_length(p_review->'criteria') not between 1 and 20
    or octet_length(p_review::text) > 8192
  then
    return false;
  end if;

  v_status := p_review->>'reviewStatus';
  v_feedback_disposition := p_review->>'feedbackDisposition';
  if v_status = 'pending' then
    if jsonb_typeof(p_review->'reviewedAt') <> 'null' then
      return false;
    end if;
  elsif jsonb_typeof(p_review->'reviewedAt') <> 'string'
    or length(p_review->>'reviewedAt') > 64
    or p_review->>'reviewedAt'
      !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[tT ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?([zZ]|[+-][0-9]{2}:[0-9]{2})$'
  then
    return false;
  end if;
  if v_status <> 'pending' and v_feedback_disposition = 'pending' then
    return false;
  end if;

  for v_criterion in select value from jsonb_array_elements(p_review->'criteria')
  loop
    if jsonb_typeof(v_criterion) <> 'object'
      or not (v_criterion ?& array['criterionId', 'suggestedScore', 'finalScore', 'maxScore'])
      or v_criterion - array['criterionId', 'suggestedScore', 'finalScore', 'maxScore']::text[]
        <> '{}'::jsonb
      or jsonb_typeof(v_criterion->'criterionId') <> 'string'
      or v_criterion->>'criterionId' !~ '^[a-zA-Z0-9_-]{1,64}$'
      or (v_criterion->>'criterionId') = any(v_criterion_ids)
      or jsonb_typeof(v_criterion->'suggestedScore') <> 'number'
      or jsonb_typeof(v_criterion->'finalScore') not in ('number', 'null')
      or jsonb_typeof(v_criterion->'maxScore') <> 'number'
    then
      return false;
    end if;

    v_criterion_ids := array_append(v_criterion_ids, v_criterion->>'criterionId');
    v_suggested := (v_criterion->>'suggestedScore')::numeric;
    v_max := (v_criterion->>'maxScore')::numeric;
    v_final := case
      when jsonb_typeof(v_criterion->'finalScore') = 'number'
        then (v_criterion->>'finalScore')::numeric
      else null
    end;
    if v_max <= 0 or v_max > 100000
      or v_suggested < 0 or v_suggested > v_max
      or (v_final is not null and (v_final < 0 or v_final > v_max))
      or (v_status = 'reviewed' and v_final is null)
      or (v_status = 'dismissed' and v_final is not null)
    then
      return false;
    end if;
  end loop;

  v_provenance := p_review->'provenance';
  if jsonb_typeof(v_provenance) <> 'object'
    or not (v_provenance ?& array[
      'provider', 'model', 'policyVersion', 'promptVersion',
      'gradingProfileVersion', 'rubricVersion', 'providerRequestCount', 'tokenUsage'
    ])
    or v_provenance - array[
      'provider', 'model', 'policyVersion', 'promptVersion',
      'gradingProfileVersion', 'rubricVersion', 'providerRequestCount', 'tokenUsage'
    ]::text[] <> '{}'::jsonb
    or jsonb_typeof(v_provenance->'provider') <> 'string'
    or length(v_provenance->>'provider') not between 1 and 120
    or jsonb_typeof(v_provenance->'model') <> 'string'
    or length(v_provenance->>'model') not between 1 and 200
    or jsonb_typeof(v_provenance->'policyVersion') <> 'string'
    or length(v_provenance->>'policyVersion') not between 1 and 120
    or jsonb_typeof(v_provenance->'promptVersion') <> 'string'
    or length(v_provenance->>'promptVersion') not between 1 and 120
    or jsonb_typeof(v_provenance->'gradingProfileVersion') <> 'string'
    or length(v_provenance->>'gradingProfileVersion') not between 1 and 120
    or jsonb_typeof(v_provenance->'rubricVersion') <> 'string'
    or length(v_provenance->>'rubricVersion') not between 1 and 120
    or jsonb_typeof(v_provenance->'providerRequestCount') <> 'number'
    or (v_provenance->>'providerRequestCount')::numeric not between 0 and 10
    or (v_provenance->>'providerRequestCount')::numeric
      <> trunc((v_provenance->>'providerRequestCount')::numeric)
  then
    return false;
  end if;

  v_token_usage := v_provenance->'tokenUsage';
  if jsonb_typeof(v_token_usage) <> 'object'
    or not (v_token_usage ?& array['inputTokens', 'outputTokens', 'totalTokens'])
    or v_token_usage - array['inputTokens', 'outputTokens', 'totalTokens']::text[]
      <> '{}'::jsonb
  then
    return false;
  end if;
  for v_criterion in
    select value
    from jsonb_each(v_token_usage)
  loop
    if jsonb_typeof(v_criterion) not in ('number', 'null')
      or (
        jsonb_typeof(v_criterion) = 'number'
        and (
          (v_criterion #>> '{}')::numeric < 0
          or (v_criterion #>> '{}')::numeric <> trunc((v_criterion #>> '{}')::numeric)
        )
      )
    then
      return false;
    end if;
  end loop;

  return true;
exception
  when others then
    return false;
end;
$$;

alter table public.assignment_docs
  add column if not exists ai_grading_review jsonb;

alter table public.assignment_docs
  add constraint assignment_docs_ai_grading_review_contract
  check (
    ai_grading_review is null
    or (
      public.is_valid_grading_review(ai_grading_review)
      and ai_grading_review->>'assessmentKind' = 'assignment'
    )
  ) not valid;

alter table public.assignment_docs
  validate constraint assignment_docs_ai_grading_review_contract;

alter table public.test_responses
  add column if not exists ai_grading_review jsonb;

alter table public.test_responses
  add constraint test_responses_ai_grading_review_contract
  check (
    ai_grading_review is null
    or (
      public.is_valid_grading_review(ai_grading_review)
      and ai_grading_review->>'assessmentKind' = 'test'
    )
  ) not valid;

alter table public.test_responses
  validate constraint test_responses_ai_grading_review_contract;

comment on column public.assignment_docs.ai_grading_review is
  'Bounded, identity-free AI suggestion and teacher outcome metadata for offline grading evaluation.';
comment on column public.test_responses.ai_grading_review is
  'Bounded, identity-free AI suggestion and teacher outcome metadata for offline grading evaluation.';

create or replace function public.sync_assignment_ai_grading_review()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_review jsonb;
  v_criteria jsonb;
  v_suggested_feedback text;
  v_final_feedback text;
  v_feedback_disposition text;
begin
  if new.content is distinct from old.content
    or new.submitted_at is distinct from old.submitted_at
  then
    new.ai_grading_review := null;
    new.ai_grading_provenance := null;
    return new;
  end if;

  if new.ai_grading_provenance is distinct from old.ai_grading_provenance
    and new.ai_grading_provenance is not null
  then
    new.ai_grading_review := jsonb_build_object(
      'schemaVersion', 'grading-review-v1',
      'assessmentKind', 'assignment',
      'reviewStatus', 'pending',
      'criteria', jsonb_build_array(
        jsonb_build_object('criterionId', 'completion', 'suggestedScore', new.score_completion, 'finalScore', new.score_completion, 'maxScore', 10),
        jsonb_build_object('criterionId', 'thinking', 'suggestedScore', new.score_thinking, 'finalScore', new.score_thinking, 'maxScore', 10),
        jsonb_build_object('criterionId', 'workflow', 'suggestedScore', new.score_workflow, 'finalScore', new.score_workflow, 'maxScore', 10)
      ),
      'feedbackDisposition', 'pending',
      'reviewedAt', null,
      'provenance', jsonb_build_object(
        'provider', new.ai_grading_provenance->'provider',
        'model', new.ai_grading_provenance->'model',
        'policyVersion', new.ai_grading_provenance->'policyVersion',
        'promptVersion', new.ai_grading_provenance->'promptVersion',
        'gradingProfileVersion', new.ai_grading_provenance->'gradingProfileVersion',
        'rubricVersion', new.ai_grading_provenance->'rubricVersion',
        'providerRequestCount', new.ai_grading_provenance->'providerRequestCount',
        'tokenUsage', new.ai_grading_provenance->'tokenUsage'
      )
    );
    return new;
  end if;

  if new.ai_grading_provenance is null
    and new.ai_feedback_suggestion is not null
    and (
      new.ai_feedback_suggestion is distinct from old.ai_feedback_suggestion
      or new.ai_feedback_model is distinct from old.ai_feedback_model
    )
  then
    new.ai_grading_review := null;
    return new;
  end if;

  if old.ai_grading_review is null then
    return new;
  end if;

  v_review := old.ai_grading_review;
  select jsonb_agg(
    jsonb_set(
      criterion.value,
      '{finalScore}',
      coalesce(to_jsonb(case criterion.value->>'criterionId'
        when 'completion' then new.score_completion
        when 'thinking' then new.score_thinking
        when 'workflow' then new.score_workflow
        else null
      end), 'null'::jsonb)
    )
    order by criterion.ordinality
  )
  into v_criteria
  from jsonb_array_elements(v_review->'criteria') with ordinality as criterion(value, ordinality);
  v_review := jsonb_set(v_review, '{criteria}', v_criteria);

  if old.ai_feedback_suggestion is not null
    and (
      new.teacher_feedback_draft is distinct from old.teacher_feedback_draft
      or new.feedback is distinct from old.feedback
      or new.ai_feedback_suggestion is null
    )
  then
    v_suggested_feedback := btrim(old.ai_feedback_suggestion);
    v_final_feedback := btrim(coalesce(new.teacher_feedback_draft, new.feedback, ''));
    v_feedback_disposition := case
      when v_final_feedback = '' then 'removed'
      when v_final_feedback = v_suggested_feedback then 'unchanged'
      else 'edited'
    end;
    v_review := jsonb_set(v_review, '{feedbackDisposition}', to_jsonb(v_feedback_disposition));
  end if;

  if new.returned_at is distinct from old.returned_at
    and new.returned_at is not null
    and new.score_completion is not null
    and new.score_thinking is not null
    and new.score_workflow is not null
  then
    v_review := jsonb_set(v_review, '{reviewStatus}', '"reviewed"'::jsonb);
    v_review := jsonb_set(v_review, '{reviewedAt}', to_jsonb(new.returned_at));
  end if;

  new.ai_grading_review := v_review;
  return new;
end;
$$;

drop trigger if exists sync_assignment_ai_grading_review on public.assignment_docs;
create trigger sync_assignment_ai_grading_review
before update of
  content,
  submitted_at,
  score_completion,
  score_thinking,
  score_workflow,
  teacher_feedback_draft,
  feedback,
  ai_feedback_suggestion,
  ai_feedback_model,
  ai_grading_provenance,
  returned_at
on public.assignment_docs
for each row
execute function public.sync_assignment_ai_grading_review();

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
  elsif to_jsonb(new) - array['ai_grading_provenance', 'ai_grading_review']::text[]
    = to_jsonb(old) - array['ai_grading_provenance', 'ai_grading_review']::text[]
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

create or replace function public.sync_test_ai_grading_review()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_review jsonb;
  v_max_score numeric;
  v_feedback_disposition text;
begin
  if new.response_text is distinct from old.response_text
    or new.selected_option is distinct from old.selected_option
  then
    new.ai_grading_review := null;
    new.ai_grading_provenance := null;
    return new;
  end if;

  if new.ai_grading_provenance is distinct from old.ai_grading_provenance
    and new.ai_grading_provenance is not null
  then
    select question.points
    into v_max_score
    from public.test_questions question
    where question.id = new.question_id;
    if v_max_score is null or v_max_score <= 0 then
      raise exception 'Test grading review requires a positive question score'
        using errcode = '22023';
    end if;

    v_feedback_disposition := case
      when btrim(coalesce(new.feedback, '')) = '' then 'removed'
      when btrim(new.feedback) = btrim(new.ai_suggested_feedback) then 'unchanged'
      else 'edited'
    end;
    new.ai_grading_review := jsonb_build_object(
      'schemaVersion', 'grading-review-v1',
      'assessmentKind', 'test',
      'reviewStatus', 'pending',
      'criteria', jsonb_build_array(
        jsonb_build_object('criterionId', 'response', 'suggestedScore', new.ai_suggested_score, 'finalScore', new.score, 'maxScore', v_max_score)
      ),
      'feedbackDisposition', v_feedback_disposition,
      'reviewedAt', null,
      'provenance', jsonb_build_object(
        'provider', new.ai_grading_provenance->'provider',
        'model', new.ai_grading_provenance->'model',
        'policyVersion', new.ai_grading_provenance->'policyVersion',
        'promptVersion', new.ai_grading_provenance->'promptVersion',
        'gradingProfileVersion', new.ai_grading_provenance->'gradingProfileVersion',
        'rubricVersion', new.ai_grading_provenance->'rubricVersion',
        'providerRequestCount', new.ai_grading_provenance->'providerRequestCount',
        'tokenUsage', new.ai_grading_provenance->'tokenUsage'
      )
    );
    return new;
  end if;

  if new.ai_grading_provenance is null
    and new.ai_grading_basis is not null
    and (
      new.ai_grading_basis is distinct from old.ai_grading_basis
      or new.ai_model is distinct from old.ai_model
      or new.ai_suggested_score is distinct from old.ai_suggested_score
      or new.ai_suggested_feedback is distinct from old.ai_suggested_feedback
    )
  then
    new.ai_grading_review := null;
    return new;
  end if;

  if old.ai_grading_review is null
    or old.ai_grading_review->>'reviewStatus' = 'dismissed'
  then
    return new;
  end if;

  v_review := old.ai_grading_review;
  if new.score is null
    and new.graded_at is null
    and new.ai_grading_basis is null
  then
    v_review := jsonb_set(v_review, '{reviewStatus}', '"dismissed"'::jsonb);
    v_review := jsonb_set(v_review, '{reviewedAt}', to_jsonb(statement_timestamp()));
    v_review := jsonb_set(v_review, '{feedbackDisposition}', '"removed"'::jsonb);
    v_review := jsonb_set(v_review, '{criteria,0,finalScore}', 'null'::jsonb);
    new.ai_grading_review := v_review;
    return new;
  end if;

  if new.score is not null then
    v_review := jsonb_set(v_review, '{criteria,0,finalScore}', to_jsonb(new.score));
  end if;
  if new.feedback is distinct from old.feedback then
    v_feedback_disposition := case
      when btrim(coalesce(new.feedback, '')) = '' then 'removed'
      when btrim(new.feedback) = btrim(old.ai_suggested_feedback) then 'unchanged'
      else 'edited'
    end;
    v_review := jsonb_set(v_review, '{feedbackDisposition}', to_jsonb(v_feedback_disposition));
  end if;
  new.ai_grading_review := v_review;
  return new;
end;
$$;

drop trigger if exists sync_test_ai_grading_review on public.test_responses;
create trigger sync_test_ai_grading_review
before update of
  response_text,
  selected_option,
  score,
  feedback,
  graded_at,
  ai_grading_basis,
  ai_model,
  ai_suggested_score,
  ai_suggested_feedback,
  ai_grading_provenance
on public.test_responses
for each row
execute function public.sync_test_ai_grading_review();

create or replace function public.mark_test_grading_reviews_returned()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.returned_at is distinct from old.returned_at
    and new.returned_at is not null
  then
    update public.test_responses response
    set ai_grading_review = jsonb_set(
      jsonb_set(response.ai_grading_review, '{reviewStatus}', '"reviewed"'::jsonb),
      '{reviewedAt}',
      to_jsonb(new.returned_at)
    )
    where response.test_id = new.test_id
      and response.student_id = new.student_id
      and response.ai_grading_review->>'reviewStatus' = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists mark_test_grading_reviews_returned on public.test_attempts;
create trigger mark_test_grading_reviews_returned
after update of returned_at on public.test_attempts
for each row
execute function public.mark_test_grading_reviews_returned();

revoke all on function public.sync_assignment_ai_grading_review() from public, anon, authenticated;
revoke all on function public.sync_test_ai_grading_review() from public, anon, authenticated;
revoke all on function public.mark_test_grading_reviews_returned() from public, anon, authenticated;
