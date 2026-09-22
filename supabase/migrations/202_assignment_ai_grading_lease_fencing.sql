-- Fence every assignment AI grading worker mutation with the lease that admitted it.
-- This is a prerequisite for attaching metered usage settlement to grading results.

begin;

alter table public.assignment_ai_grading_runs
  add column worker_contract_version smallint not null default 0
  check (worker_contract_version in (0, 1));

create function public.guard_assignment_ai_grading_run_lease_contract_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.worker_contract_version = 1
    and current_user = 'service_role'
  then
    raise exception 'Assignment AI grading lease is required' using errcode = '42501';
  end if;
  return new;
end;
$function$;

create function public.guard_assignment_ai_grading_item_lease_contract_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_contract_version smallint;
begin
  select run.worker_contract_version
  into v_contract_version
  from public.assignment_ai_grading_runs run
  where run.id = old.run_id;

  if v_contract_version = 1
    and current_user = 'service_role'
  then
    raise exception 'Assignment AI grading lease is required' using errcode = '42501';
  end if;
  return new;
end;
$function$;

create trigger guard_assignment_ai_grading_run_lease_contract
  before update on public.assignment_ai_grading_runs
  for each row execute function public.guard_assignment_ai_grading_run_lease_contract_v1();

create trigger guard_assignment_ai_grading_item_lease_contract
  before update on public.assignment_ai_grading_run_items
  for each row execute function public.guard_assignment_ai_grading_item_lease_contract_v1();

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
as $function$
declare
  v_assignment_id uuid;
  v_item_status text;
  v_contract_version smallint;
  v_result jsonb;
  v_doc_id uuid;
begin
  select item.assignment_id, item.status, run.worker_contract_version
  into v_assignment_id, v_item_status, v_contract_version
  from public.assignment_ai_grading_run_items item
  join public.assignment_ai_grading_runs run on run.id = item.run_id
  where item.id = p_item_id;

  if not found then
    raise exception 'Assignment AI grading item not found' using errcode = '22023';
  end if;
  if v_contract_version = 1 then
    raise exception 'Assignment AI grading lease is required' using errcode = '42501';
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
$function$;

create function public.patch_assignment_ai_grading_run_with_lease_v1(
  p_run_id uuid,
  p_lease_token uuid,
  p_patch jsonb
)
returns public.assignment_ai_grading_runs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_run public.assignment_ai_grading_runs%rowtype;
begin
  if p_run_id is null
    or p_lease_token is null
    or p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or exists (
      select 1
      from jsonb_object_keys(p_patch) as key(name)
      where key.name not in (
        'status', 'processed_count', 'completed_count', 'skipped_missing_count',
        'skipped_empty_count', 'failed_count', 'error_samples_json', 'completed_at',
        'lease_token', 'lease_expires_at', 'gradex_run_id', 'gradex_status',
        'gradex_submitted_at', 'gradex_last_polled_at'
      )
    )
  then
    raise exception 'Assignment AI grading run patch is invalid' using errcode = '22023';
  end if;

  select run.* into v_run
  from public.assignment_ai_grading_runs run
  where run.id = p_run_id
  for update;

  if not found then
    raise exception 'Assignment AI grading run not found' using errcode = 'P0002';
  end if;
  if v_run.lease_token is distinct from p_lease_token
    or v_run.lease_expires_at is null
    or v_run.lease_expires_at <= clock_timestamp()
    or v_run.worker_contract_version <> 1
  then
    raise exception 'Assignment AI grading lease was lost' using errcode = '40001';
  end if;

  update public.assignment_ai_grading_runs run
  set
    status = case when p_patch ? 'status' then p_patch->>'status' else run.status end,
    processed_count = case when p_patch ? 'processed_count' then (p_patch->>'processed_count')::integer else run.processed_count end,
    completed_count = case when p_patch ? 'completed_count' then (p_patch->>'completed_count')::integer else run.completed_count end,
    skipped_missing_count = case when p_patch ? 'skipped_missing_count' then (p_patch->>'skipped_missing_count')::integer else run.skipped_missing_count end,
    skipped_empty_count = case when p_patch ? 'skipped_empty_count' then (p_patch->>'skipped_empty_count')::integer else run.skipped_empty_count end,
    failed_count = case when p_patch ? 'failed_count' then (p_patch->>'failed_count')::integer else run.failed_count end,
    error_samples_json = case when p_patch ? 'error_samples_json' then p_patch->'error_samples_json' else run.error_samples_json end,
    completed_at = case when p_patch ? 'completed_at' then (p_patch->>'completed_at')::timestamptz else run.completed_at end,
    lease_token = case when p_patch ? 'lease_token' then (p_patch->>'lease_token')::uuid else run.lease_token end,
    lease_expires_at = case when p_patch ? 'lease_expires_at' then (p_patch->>'lease_expires_at')::timestamptz else run.lease_expires_at end,
    gradex_run_id = case when p_patch ? 'gradex_run_id' then p_patch->>'gradex_run_id' else run.gradex_run_id end,
    gradex_status = case when p_patch ? 'gradex_status' then p_patch->>'gradex_status' else run.gradex_status end,
    gradex_submitted_at = case when p_patch ? 'gradex_submitted_at' then (p_patch->>'gradex_submitted_at')::timestamptz else run.gradex_submitted_at end,
    gradex_last_polled_at = case when p_patch ? 'gradex_last_polled_at' then (p_patch->>'gradex_last_polled_at')::timestamptz else run.gradex_last_polled_at end
  where run.id = p_run_id
  returning run.* into v_run;

  return v_run;
end;
$function$;

create function public.patch_assignment_ai_grading_item_with_lease_v1(
  p_item_id uuid,
  p_lease_token uuid,
  p_patch jsonb
)
returns public.assignment_ai_grading_run_items
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_run public.assignment_ai_grading_runs%rowtype;
  v_item public.assignment_ai_grading_run_items%rowtype;
begin
  if p_item_id is null
    or p_lease_token is null
    or p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or exists (
      select 1
      from jsonb_object_keys(p_patch) as key(name)
      where key.name not in (
        'status', 'skip_reason', 'attempt_count', 'next_retry_at',
        'last_error_code', 'last_error_message', 'started_at', 'completed_at'
      )
    )
  then
    raise exception 'Assignment AI grading item patch is invalid' using errcode = '22023';
  end if;

  select item.* into v_item
  from public.assignment_ai_grading_run_items item
  where item.id = p_item_id;

  if not found then
    raise exception 'Assignment AI grading item not found' using errcode = 'P0002';
  end if;

  select run.* into v_run
  from public.assignment_ai_grading_runs run
  where run.id = v_item.run_id
  for update;

  if v_run.lease_token is distinct from p_lease_token
    or v_run.lease_expires_at is null
    or v_run.lease_expires_at <= clock_timestamp()
    or v_run.worker_contract_version <> 1
  then
    raise exception 'Assignment AI grading lease was lost' using errcode = '40001';
  end if;

  select item.* into v_item
  from public.assignment_ai_grading_run_items item
  where item.id = p_item_id
    and item.run_id = v_run.id
    and item.status in ('queued', 'processing')
  for update;

  if not found then
    raise exception 'Assignment AI grading lease was lost' using errcode = '40001';
  end if;

  if p_patch ? 'status' and p_patch->>'status' not in ('queued', 'processing', 'failed') then
    raise exception 'Assignment AI grading item state is invalid' using errcode = '22023';
  end if;

  update public.assignment_ai_grading_run_items item
  set
    status = case when p_patch ? 'status' then p_patch->>'status' else item.status end,
    skip_reason = case when p_patch ? 'skip_reason' then p_patch->>'skip_reason' else item.skip_reason end,
    attempt_count = case when p_patch ? 'attempt_count' then (p_patch->>'attempt_count')::integer else item.attempt_count end,
    next_retry_at = case when p_patch ? 'next_retry_at' then (p_patch->>'next_retry_at')::timestamptz else item.next_retry_at end,
    last_error_code = case when p_patch ? 'last_error_code' then p_patch->>'last_error_code' else item.last_error_code end,
    last_error_message = case when p_patch ? 'last_error_message' then p_patch->>'last_error_message' else item.last_error_message end,
    started_at = case when p_patch ? 'started_at' then (p_patch->>'started_at')::timestamptz else item.started_at end,
    completed_at = case when p_patch ? 'completed_at' then (p_patch->>'completed_at')::timestamptz else item.completed_at end
  where item.id = p_item_id
  returning item.* into v_item;

  return v_item;
end;
$function$;

create function public.finalize_assignment_ai_grading_item_with_provenance_lease_v1(
  p_item_id uuid,
  p_lease_token uuid,
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
as $function$
declare
  v_run_id uuid;
  v_assignment_id uuid;
  v_run public.assignment_ai_grading_runs%rowtype;
  v_item_status text;
  v_result jsonb;
  v_doc_id uuid;
begin
  select item.run_id, item.assignment_id
  into v_run_id, v_assignment_id
  from public.assignment_ai_grading_run_items item
  where item.id = p_item_id;

  if not found then
    raise exception 'Assignment AI grading item not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_assignment_id::text, 0));

  select run.* into v_run
  from public.assignment_ai_grading_runs run
  where run.id = v_run_id
  for update;

  if v_run.lease_token is distinct from p_lease_token
    or v_run.lease_expires_at is null
    or v_run.lease_expires_at <= clock_timestamp()
    or v_run.worker_contract_version <> 1
  then
    raise exception 'Assignment AI grading lease was lost' using errcode = '40001';
  end if;

  select item.status
  into v_item_status
  from public.assignment_ai_grading_run_items item
  where item.id = p_item_id
    and item.run_id = v_run.id
  for update;

  if not found then
    raise exception 'Assignment AI grading lease was lost' using errcode = '40001';
  end if;

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
$function$;

revoke all on function public.patch_assignment_ai_grading_run_with_lease_v1(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.patch_assignment_ai_grading_item_with_lease_v1(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_assignment_ai_grading_item_with_provenance_lease_v1(
  uuid, uuid, uuid, integer, integer, integer, text, boolean, boolean, text, text,
  jsonb, text, integer, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke execute on function public.finalize_assignment_ai_grading_item_atomic(
  uuid, uuid, integer, integer, integer, text, boolean, boolean, text, text,
  text, integer, text, text, timestamptz
) from service_role;

grant execute on function public.patch_assignment_ai_grading_run_with_lease_v1(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.patch_assignment_ai_grading_item_with_lease_v1(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.finalize_assignment_ai_grading_item_with_provenance_lease_v1(
  uuid, uuid, uuid, integer, integer, integer, text, boolean, boolean, text, text,
  jsonb, text, integer, text, text, timestamptz
) to service_role;

comment on function public.patch_assignment_ai_grading_run_with_lease_v1(uuid, uuid, jsonb) is
  'Service-only assignment AI grading run mutation fenced by the current unexpired worker lease.';
comment on function public.patch_assignment_ai_grading_item_with_lease_v1(uuid, uuid, jsonb) is
  'Service-only assignment AI grading item mutation fenced by the current unexpired worker lease.';
comment on function public.finalize_assignment_ai_grading_item_with_provenance_lease_v1(
  uuid, uuid, uuid, integer, integer, integer, text, boolean, boolean, text, text,
  jsonb, text, integer, text, text, timestamptz
) is 'Atomically finalizes an assignment AI grading item only for the current unexpired worker lease.';

commit;
