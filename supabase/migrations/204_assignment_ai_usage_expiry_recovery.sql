-- Preserve expiration audit evidence while allowing fenced Assignment cleanup,
-- and renew live reservations immediately before provider work. Still default-off.
begin;

alter table public.feature_usage_reservations
  drop constraint feature_usage_reservations_release_reason_check;
alter table public.feature_usage_reservations
  add constraint feature_usage_reservations_release_reason_check check (
    release_reason is null or release_reason in (
      'cancelled', 'expired', 'provider_failed', 'stale', 'superseded'
    )
    or (operation_kind = 'assignment_ai_grading' and release_reason = 'internal_failure')
  );

alter table public.assignment_ai_grading_runs
  add column gradex_idempotency_key text check (
    gradex_idempotency_key is null
    or (
      char_length(gradex_idempotency_key) between 16 and 200
      and gradex_idempotency_key ~ '^[A-Za-z0-9:_-]+$'
    )
  );

alter table public.assignment_ai_grading_run_items
  add column assignment_source_fingerprint text check (
    assignment_source_fingerprint is null
    or assignment_source_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  add column gradex_submission_id text check (
    gradex_submission_id is null
    or (
      char_length(gradex_submission_id) between 8 and 200
      and gradex_submission_id ~ '^[A-Za-z0-9:_-]+$'
    )
  );

create function public.get_assignment_ai_grading_usage_contract_v2()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object(
    'contract', 'assignment-ai-grading-usage',
    'version', 2,
    'source_fingerprint_version', 1,
    'gradex_correlation_version', 1
  );
$function$;

revoke all on function public.get_assignment_ai_grading_usage_contract_v2()
  from public, anon, authenticated, service_role;
grant execute on function public.get_assignment_ai_grading_usage_contract_v2()
  to service_role;

create function private.assignment_ai_grading_source_fingerprint_v1(
  p_assignment_id uuid,
  p_assignment_doc_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', assignment.id,
      'title', assignment.title,
      'description', assignment.description,
      'instructions_markdown', assignment.instructions_markdown,
      'rich_instructions', assignment.rich_instructions,
      'due_at', assignment.due_at,
      'updated_at', assignment.updated_at
    ),
    'document', jsonb_build_object(
      'id', document.id,
      'content', document.content,
      'updated_at', document.updated_at,
      'is_submitted', document.is_submitted,
      'submitted_at', document.submitted_at,
      'repo_url', document.repo_url,
      'github_username', document.github_username,
      'authenticity_score', document.authenticity_score,
      'authenticity_flags', document.authenticity_flags
    ),
    'artifacts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', artifact.id,
        'requirement_id', artifact.requirement_id,
        'student_id', artifact.student_id,
        'type', artifact.type,
        'url', artifact.url,
        'storage_path', artifact.storage_path,
        'metadata_json', artifact.metadata_json,
        'validation_status', artifact.validation_status,
        'validation_message', artifact.validation_message,
        'validated_at', artifact.validated_at,
        'managed_object_id', artifact.managed_object_id,
        'created_at', artifact.created_at,
        'updated_at', artifact.updated_at
      ) order by artifact.requirement_id, artifact.id)
      from public.assignment_submission_artifacts artifact
      where artifact.assignment_doc_id = document.id
    ), '[]'::jsonb),
    'workflow_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', history.id,
        'word_count', history.word_count,
        'paste_word_count', history.paste_word_count,
        'trigger', history.trigger,
        'created_at', history.created_at
      ) order by history.created_at, history.id)
      from public.assignment_doc_history history
      where history.assignment_doc_id = document.id
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex')
  from public.assignments assignment
  join public.assignment_docs document
    on document.assignment_id = assignment.id
  where assignment.id = p_assignment_id
    and document.id = p_assignment_doc_id;
$function$;

revoke all on function private.assignment_ai_grading_source_fingerprint_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.release_feature_usage_v1(
  p_operation_id uuid,
  p_subject_user_id uuid,
  p_feature_key text,
  p_expected_units integer,
  p_release_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_reservation public.feature_usage_reservations%rowtype;
begin
  if p_operation_id is null
    or p_subject_user_id is null
    or p_feature_key is null
    or p_feature_key <> 'grading.ai'
    or p_expected_units is null
    or p_expected_units not between 1 and 100000
    or p_release_reason is null
    or p_release_reason not in (
      'cancelled', 'expired', 'provider_failed', 'stale', 'superseded', 'internal_failure'
    )
  then
    raise exception using errcode = '22023', message = 'feature_usage_release_request_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('feature-usage-operation:' || p_operation_id::text, 20120260921)
  );
  perform public.lock_effective_feature_entitlement_v1(p_subject_user_id, p_feature_key);
  v_now := clock_timestamp();

  select * into v_reservation
  from public.feature_usage_reservations
  where operation_id = p_operation_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'feature_usage_reservation_not_found';
  end if;
  if v_reservation.subject_user_id is distinct from p_subject_user_id
    or v_reservation.feature_key is distinct from p_feature_key
    or v_reservation.units is distinct from p_expected_units
  then
    raise exception using errcode = '42501', message = 'feature_usage_reservation_binding_mismatch';
  end if;
  if p_release_reason = 'internal_failure'
    and v_reservation.operation_kind <> 'assignment_ai_grading'
  then
    raise exception using errcode = '22023', message = 'feature_usage_release_request_invalid';
  end if;
  if v_reservation.status = 'released' then
    if v_reservation.release_reason is distinct from p_release_reason
      and not (
        v_reservation.release_reason = 'expired'
        and v_reservation.operation_kind = 'assignment_ai_grading'
      )
    then
      raise exception using errcode = '23505', message = 'feature_usage_release_conflict';
    end if;
    -- An expiry is already a terminal release. Do not overwrite its evidence.
    return jsonb_build_object('reservation', to_jsonb(v_reservation), 'duplicate', true);
  end if;
  if v_reservation.status = 'settled' then
    raise exception using errcode = '55000', message = 'feature_usage_reservation_settled';
  end if;

  update public.feature_usage_reservations
  set status = 'released',
      released_at = v_now,
      release_reason = p_release_reason,
      updated_at = v_now
  where id = v_reservation.id
  returning * into v_reservation;

  return jsonb_build_object('reservation', to_jsonb(v_reservation), 'duplicate', false);
end;
$function$;

create or replace function private.lock_metered_assignment_ai_grading_item_v1(
  p_item_id uuid,
  p_lease_token uuid,
  p_require_pending boolean,
  p_require_exact_document boolean
)
returns table (
  run_id uuid,
  assignment_id uuid,
  classroom_id uuid,
  student_id uuid,
  assignment_doc_id uuid,
  triggered_by uuid,
  item_status text,
  usage_ref text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_initial_assignment_id uuid;
  v_initial_classroom_id uuid;
  v_initial_run_id uuid;
  v_initial_student_id uuid;
  v_run public.assignment_ai_grading_runs%rowtype;
  v_item public.assignment_ai_grading_run_items%rowtype;
  v_doc public.assignment_docs%rowtype;
  v_owner_id uuid;
  v_archived_at timestamptz;
  v_blueprint_archived_at timestamptz;
  v_source_fingerprint text;
begin
  if p_item_id is null or p_lease_token is null then
    raise exception using errcode = '22023', message = 'metered_assignment_item_request_invalid';
  end if;

  select item.assignment_id, item.run_id, item.student_id
  into v_initial_assignment_id, v_initial_run_id, v_initial_student_id
  from public.assignment_ai_grading_run_items item
  where item.id = p_item_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'metered_assignment_item_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_initial_assignment_id::text, 0));

  select assignment.classroom_id
  into v_initial_classroom_id
  from public.assignments assignment
  where assignment.id = v_initial_assignment_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'metered_assignment_not_found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_initial_classroom_id::text, 0)
  );
  perform private.try_lock_classroom_membership_change(
    v_initial_classroom_id,
    v_initial_student_id
  );

  select assignment.classroom_id, assignment.blueprint_archived_at,
         classroom.teacher_id, classroom.archived_at
  into classroom_id, v_blueprint_archived_at, v_owner_id, v_archived_at
  from public.assignments assignment
  join public.classrooms classroom on classroom.id = assignment.classroom_id
  where assignment.id = v_initial_assignment_id
  for update of assignment, classroom;

  if not found or classroom_id is distinct from v_initial_classroom_id then
    raise exception using errcode = '40001', message = 'metered_assignment_binding_changed';
  end if;
  if v_archived_at is not null or v_blueprint_archived_at is not null then
    raise exception using errcode = '55000', message = 'metered_assignment_archived';
  end if;

  select run.* into v_run
  from public.assignment_ai_grading_runs run
  where run.id = v_initial_run_id
    and run.assignment_id = v_initial_assignment_id
  for update;
  if not found
    or v_run.worker_contract_version <> 1
    or v_run.triggered_by is distinct from v_owner_id
    or v_run.lease_token is distinct from p_lease_token
    or v_run.lease_expires_at is null
    or v_run.lease_expires_at <= clock_timestamp()
  then
    raise exception using errcode = '40001', message = 'Assignment AI grading lease was lost';
  end if;

  select item.* into v_item
  from public.assignment_ai_grading_run_items item
  where item.id = p_item_id
    and item.run_id = v_run.id
    and item.assignment_id = v_initial_assignment_id
    and item.student_id = v_initial_student_id
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'Assignment AI grading lease was lost';
  end if;
  if p_require_pending and v_item.status not in ('queued', 'processing') then
    raise exception using errcode = '55000', message = 'metered_assignment_item_terminal';
  end if;

  if v_item.status in ('queued', 'processing') then
    select doc.* into v_doc
    from public.assignment_docs doc
    where doc.assignment_id = v_item.assignment_id
      and doc.student_id = v_item.student_id
    for update;
    if p_require_exact_document and (
      not found
      or v_item.assignment_doc_id is null
      or v_item.assignment_doc_updated_at is null
      or v_item.assignment_source_fingerprint is null
      or v_doc.id is distinct from v_item.assignment_doc_id
      or v_doc.updated_at is distinct from v_item.assignment_doc_updated_at
    ) then
      raise exception using errcode = '40001', message = 'metered_assignment_source_changed';
    end if;

    if p_require_exact_document then
      perform 1
      from public.assignment_submission_artifacts artifact
      where artifact.assignment_doc_id = v_doc.id
      order by artifact.requirement_id, artifact.id
      for share;
      perform 1
      from public.assignment_doc_history history
      where history.assignment_doc_id = v_doc.id
      order by history.created_at, history.id
      for share;

      v_source_fingerprint := private.assignment_ai_grading_source_fingerprint_v1(
        v_item.assignment_id,
        v_doc.id
      );
      if v_source_fingerprint is distinct from v_item.assignment_source_fingerprint then
        raise exception using errcode = '40001', message = 'metered_assignment_source_changed';
      end if;
    end if;

    if not exists (
      select 1 from public.classroom_enrollments enrollment
      where enrollment.classroom_id = v_initial_classroom_id
        and enrollment.student_id = v_item.student_id
    ) then
      raise exception using errcode = '40001', message = 'metered_assignment_enrollment_changed';
    end if;
  end if;

  run_id := v_run.id;
  assignment_id := v_item.assignment_id;
  student_id := v_item.student_id;
  assignment_doc_id := v_item.assignment_doc_id;
  triggered_by := v_run.triggered_by;
  item_status := v_item.status;
  usage_ref := 'assignment-ai-item-v1:' || v_item.id::text;
  return next;
end;
$function$;

create function public.create_metered_assignment_ai_grading_run_v2(
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
set search_path = ''
as $function$
declare
  v_run public.assignment_ai_grading_runs%rowtype;
  v_missing_fingerprint_count integer;
begin
  v_run := public.create_metered_assignment_ai_grading_run_v1(
    p_assignment_id,
    p_teacher_id,
    p_model,
    p_requested_student_ids,
    p_selection_hash,
    p_gradable_count,
    p_skipped_missing_count,
    p_skipped_empty_count,
    p_item_rows,
    p_now
  );

  update public.assignment_ai_grading_run_items item
  set assignment_source_fingerprint = private.assignment_ai_grading_source_fingerprint_v1(
    item.assignment_id,
    item.assignment_doc_id
  )
  where item.run_id = v_run.id
    and item.status = 'queued';

  select count(*) into v_missing_fingerprint_count
  from public.assignment_ai_grading_run_items item
  where item.run_id = v_run.id
    and item.status = 'queued'
    and item.assignment_source_fingerprint is null;

  if v_missing_fingerprint_count <> 0 then
    raise exception using errcode = '40001', message = 'metered_assignment_source_changed';
  end if;

  return v_run;
end;
$function$;

create or replace function public.fail_assignment_ai_grading_item_and_release_usage_with_lease_v1(
  p_item_id uuid,
  p_lease_token uuid,
  p_attempt_count integer,
  p_error_code text,
  p_error_message text,
  p_release_reason text
)
returns public.assignment_ai_grading_run_items
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_locked record;
  v_item public.assignment_ai_grading_run_items%rowtype;
begin
  if p_attempt_count is null or p_attempt_count < 0
    or p_error_code is null or char_length(p_error_code) not between 1 and 80
    or p_error_message is null or char_length(p_error_message) not between 1 and 500
  then
    raise exception using errcode = '22023', message = 'metered_assignment_failure_invalid';
  end if;

  -- Cleanup must remain possible after the source changed. Admission and
  -- settlement use the exact-source branch; this path still fences the live
  -- run lease, resource binding, ownership and enrollment.
  select * into v_locked
  from private.lock_metered_assignment_ai_grading_item_v1(p_item_id, p_lease_token, true, false);

  perform public.release_feature_usage_v1(
    p_item_id,
    v_locked.triggered_by,
    'grading.ai',
    1,
    p_release_reason
  );

  update public.assignment_ai_grading_run_items item
  set status = 'failed',
      skip_reason = null,
      attempt_count = greatest(item.attempt_count, p_attempt_count),
      next_retry_at = null,
      last_error_code = p_error_code,
      last_error_message = p_error_message,
      completed_at = clock_timestamp()
  where item.id = p_item_id
  returning item.* into v_item;

  return v_item;
end;
$function$;

create function public.prepare_assignment_ai_gradex_submission_v1(
  p_run_id uuid,
  p_lease_token uuid,
  p_idempotency_key text,
  p_item_refs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_run public.assignment_ai_grading_runs%rowtype;
  v_ref record;
  v_locked record;
  v_ref_count integer;
  v_bound_count integer;
  v_unique_ref_count integer;
begin
  if p_run_id is null or p_lease_token is null
    or p_idempotency_key is null
    or char_length(p_idempotency_key) not between 16 and 200
    or p_idempotency_key !~ '^[A-Za-z0-9:_-]+$'
    or p_item_refs is null
    or jsonb_typeof(p_item_refs) <> 'array'
    or jsonb_array_length(p_item_refs) = 0
  then
    raise exception using errcode = '22023', message = 'metered_assignment_gradex_prepare_invalid';
  end if;

  select count(*), count(distinct ref.item_id), count(distinct ref.external_submission_id)
  into v_ref_count, v_bound_count, v_unique_ref_count
  from jsonb_to_recordset(p_item_refs) as ref(item_id uuid, external_submission_id text)
  where ref.item_id is not null
    and ref.external_submission_id is not null
    and char_length(ref.external_submission_id) between 8 and 200
    and ref.external_submission_id ~ '^[A-Za-z0-9:_-]+$';

  if v_ref_count <> jsonb_array_length(p_item_refs)
    or v_bound_count <> v_ref_count
    or v_unique_ref_count <> v_ref_count
  then
    raise exception using errcode = '22023', message = 'metered_assignment_gradex_prepare_invalid';
  end if;

  -- Re-take the complete item/source fence while binding the provider
  -- correlation. This closes the local source-read/admission window before
  -- the application is allowed to make the Gradex request.
  for v_ref in
    select ref.item_id, ref.external_submission_id
    from jsonb_to_recordset(p_item_refs) as ref(item_id uuid, external_submission_id text)
    order by ref.item_id
  loop
    select * into v_locked
    from private.lock_metered_assignment_ai_grading_item_v1(
      v_ref.item_id,
      p_lease_token,
      true,
      true
    );
    if v_locked.run_id is distinct from p_run_id then
      raise exception using errcode = '40001', message = 'metered_assignment_gradex_binding_changed';
    end if;
  end loop;

  select run.* into v_run
  from public.assignment_ai_grading_runs run
  where run.id = p_run_id
  for update;
  if not found
    or v_run.worker_contract_version <> 1
    or v_run.lease_token is distinct from p_lease_token
    or v_run.lease_expires_at is null
    or v_run.lease_expires_at <= clock_timestamp()
  then
    raise exception using errcode = '40001', message = 'Assignment AI grading lease was lost';
  end if;
  if v_run.gradex_run_id is not null
    or (v_run.gradex_idempotency_key is not null
      and v_run.gradex_idempotency_key is distinct from p_idempotency_key)
  then
    raise exception using errcode = '23505', message = 'metered_assignment_gradex_prepare_conflict';
  end if;

  select count(*) into v_bound_count
  from public.assignment_ai_grading_run_items item
  join jsonb_to_recordset(p_item_refs) as ref(item_id uuid, external_submission_id text)
    on ref.item_id = item.id
  where item.run_id = p_run_id
    and item.status in ('queued', 'processing')
    and item.assignment_source_fingerprint is not null
    and (item.gradex_submission_id is null
      or item.gradex_submission_id = ref.external_submission_id);
  if v_bound_count <> v_ref_count then
    raise exception using errcode = '40001', message = 'metered_assignment_gradex_binding_changed';
  end if;

  update public.assignment_ai_grading_runs run
  set gradex_idempotency_key = p_idempotency_key
  where run.id = p_run_id;

  update public.assignment_ai_grading_run_items item
  set gradex_submission_id = ref.external_submission_id
  from jsonb_to_recordset(p_item_refs) as ref(item_id uuid, external_submission_id text)
  where item.id = ref.item_id
    and item.run_id = p_run_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'idempotency_key', p_idempotency_key,
    'prepared_count', v_ref_count
  );
end;
$function$;

create function public.record_assignment_ai_gradex_submission_v1(
  p_run_id uuid,
  p_lease_token uuid,
  p_idempotency_key text,
  p_gradex_run_id text,
  p_gradex_status text,
  p_submitted_at timestamptz,
  p_last_polled_at timestamptz
)
returns public.assignment_ai_grading_runs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_run public.assignment_ai_grading_runs%rowtype;
begin
  if p_run_id is null or p_lease_token is null
    or p_idempotency_key is null
    or p_gradex_run_id is null or char_length(p_gradex_run_id) not between 1 and 200
    or p_gradex_status not in ('queued', 'running', 'completed', 'completed_with_errors', 'failed')
    or p_submitted_at is null or p_last_polled_at is null
  then
    raise exception using errcode = '22023', message = 'metered_assignment_gradex_record_invalid';
  end if;

  select run.* into v_run
  from public.assignment_ai_grading_runs run
  where run.id = p_run_id
  for update;
  if not found
    or v_run.worker_contract_version <> 1
    or v_run.lease_token is distinct from p_lease_token
    or v_run.lease_expires_at is null
    or v_run.lease_expires_at <= clock_timestamp()
  then
    raise exception using errcode = '40001', message = 'Assignment AI grading lease was lost';
  end if;
  if v_run.gradex_idempotency_key is distinct from p_idempotency_key
    or (v_run.gradex_run_id is not null and v_run.gradex_run_id is distinct from p_gradex_run_id)
    or not exists (
      select 1 from public.assignment_ai_grading_run_items item
      where item.run_id = p_run_id
        and item.gradex_submission_id is not null
    )
  then
    raise exception using errcode = '23505', message = 'metered_assignment_gradex_record_conflict';
  end if;

  update public.assignment_ai_grading_runs run
  set gradex_run_id = p_gradex_run_id,
      gradex_status = p_gradex_status,
      gradex_submitted_at = coalesce(run.gradex_submitted_at, p_submitted_at),
      gradex_last_polled_at = p_last_polled_at
  where run.id = p_run_id
  returning run.* into v_run;

  return v_run;
end;
$function$;

create or replace function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(
  p_item_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_locked record;
  v_result jsonb;
  v_now timestamptz;
  v_reservation public.feature_usage_reservations%rowtype;
begin
  select * into v_locked
  from private.lock_metered_assignment_ai_grading_item_v1(p_item_id, p_lease_token, true, true);

  v_result := public.reserve_feature_usage_v1(
    p_operation_id => p_item_id,
    p_subject_user_id => v_locked.triggered_by,
    p_feature_key => 'grading.ai',
    p_operation_kind => 'assignment_ai_grading',
    p_usage_ref => v_locked.usage_ref,
    p_units => 1,
    p_ttl_seconds => 86400
  );

  -- The generic reserve holds operation -> entitlement -> reservation locks and
  -- expires stale rows first. Renew only a still-live row under those same locks.
  v_now := clock_timestamp();
  update public.feature_usage_reservations
  set expires_at = v_now + interval '24 hours', updated_at = v_now
  where operation_id = p_item_id
    and status = 'reserved'
    and expires_at > v_now
  returning * into v_reservation;

  if found then
    v_result := jsonb_set(v_result, '{reservation}', to_jsonb(v_reservation));
  end if;
  return v_result;
end;
$function$;

revoke all on function public.release_feature_usage_v1(uuid, uuid, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_metered_assignment_ai_grading_run_v2(
  uuid, uuid, text, uuid[], text, integer, integer, integer, jsonb, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.prepare_assignment_ai_gradex_submission_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.record_assignment_ai_gradex_submission_v1(
  uuid, uuid, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.release_feature_usage_v1(uuid, uuid, text, integer, text)
  to service_role;
grant execute on function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(uuid, uuid)
  to service_role;
grant execute on function public.create_metered_assignment_ai_grading_run_v2(
  uuid, uuid, text, uuid[], text, integer, integer, integer, jsonb, timestamptz
) to service_role;
grant execute on function public.prepare_assignment_ai_gradex_submission_v1(uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.record_assignment_ai_gradex_submission_v1(
  uuid, uuid, text, text, text, timestamptz, timestamptz
) to service_role;

comment on function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(uuid, uuid) is
  'Lease/resource-fenced admission and bounded 24-hour renewal of live Assignment usage; never resurrects released reservations.';
comment on function public.get_assignment_ai_grading_usage_contract_v2() is
  'Service-only runtime capability sentinel for the complete migration204 Assignment usage contract.';
comment on function public.create_metered_assignment_ai_grading_run_v2(
  uuid, uuid, text, uuid[], text, integer, integer, integer, jsonb, timestamptz
) is 'Creates the metered run and freezes a complete Assignment/provider source fingerprint for each queued item.';
comment on function public.prepare_assignment_ai_gradex_submission_v1(uuid, uuid, text, jsonb) is
  'Persists lease-fenced Gradex idempotency and per-item correlation before provider egress.';
comment on function public.record_assignment_ai_gradex_submission_v1(
  uuid, uuid, text, text, text, timestamptz, timestamptz
) is 'Records the remote Gradex run only when it matches the durable prepared correlation contract.';
commit;
