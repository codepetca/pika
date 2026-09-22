-- Add the dormant Assignment-specific accounting boundary. Application code does
-- not call these contracts until a separately reviewed server gate is enabled.

begin;

-- Refresh authoritative time after blocking locks and count quota usage across
-- entitlement revisions. A metadata revision must not mint fresh capacity.
create or replace function public.reserve_feature_usage_v1(
  p_operation_id uuid,
  p_subject_user_id uuid,
  p_feature_key text,
  p_operation_kind text,
  p_usage_ref text,
  p_units integer,
  p_ttl_seconds integer default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz;
  v_entitlement public.effective_feature_entitlements%rowtype;
  v_existing public.feature_usage_reservations%rowtype;
  v_reservation public.feature_usage_reservations%rowtype;
  v_fingerprint text;
  v_used bigint;
begin
  if p_operation_id is null
    or p_subject_user_id is null
    or p_feature_key is null
    or p_feature_key <> 'grading.ai'
    or p_operation_kind is null
    or p_operation_kind not in (
      'assignment_ai_grading', 'test_ai_grading', 'repository_review'
    )
    or p_usage_ref is null
    or p_usage_ref !~ '^[A-Za-z0-9._~:@-]{1,180}$'
    or p_units is null
    or p_units not between 1 and 100000
    or p_ttl_seconds is null
    or p_ttl_seconds not between 60 and 86400
  then
    raise exception using errcode = '22023', message = 'feature_usage_reservation_request_invalid';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'subject_user_id', p_subject_user_id,
    'feature_key', p_feature_key,
    'operation_kind', p_operation_kind,
    'usage_ref', p_usage_ref,
    'units', p_units,
    'ttl_seconds', p_ttl_seconds
  )::text);

  perform pg_advisory_xact_lock(
    hashtextextended('feature-usage-operation:' || p_operation_id::text, 20120260921)
  );
  perform public.lock_effective_feature_entitlement_v1(
    p_subject_user_id,
    p_feature_key
  );
  v_now := clock_timestamp();

  select * into v_existing
  from public.feature_usage_reservations
  where operation_id = p_operation_id
  for update;

  if v_existing.id is not null then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'feature_usage_operation_conflict';
    end if;
    if v_existing.status = 'settled' or v_existing.status = 'released' then
      return jsonb_build_object('reservation', to_jsonb(v_existing), 'duplicate', true);
    end if;
    if v_existing.expires_at <= v_now then
      update public.feature_usage_reservations
      set status = 'released',
          released_at = v_now,
          release_reason = 'expired',
          updated_at = v_now
      where id = v_existing.id
      returning * into v_existing;
      return jsonb_build_object('reservation', to_jsonb(v_existing), 'duplicate', true);
    end if;
  end if;

  select * into v_entitlement
  from public.effective_feature_entitlements
  where subject_user_id = p_subject_user_id
    and feature_key = p_feature_key;

  if v_entitlement.subject_user_id is null then
    raise exception using errcode = '55000', message = 'feature_usage_entitlement_unavailable';
  end if;
  if not v_entitlement.enabled then
    raise exception using errcode = '42501', message = 'feature_usage_entitlement_disabled';
  end if;
  if v_now < v_entitlement.starts_at then
    raise exception using errcode = '42501', message = 'feature_usage_entitlement_not_started';
  end if;
  if v_entitlement.expires_at is not null and v_now >= v_entitlement.expires_at then
    raise exception using errcode = '42501', message = 'feature_usage_entitlement_expired';
  end if;

  if v_existing.id is not null then
    return jsonb_build_object('reservation', to_jsonb(v_existing), 'duplicate', true);
  end if;

  update public.feature_usage_reservations
  set status = 'released',
      released_at = v_now,
      release_reason = 'expired',
      updated_at = v_now
  where subject_user_id = p_subject_user_id
    and feature_key = p_feature_key
    and status = 'reserved'
    and expires_at <= v_now;

  select coalesce(sum(reservation.units), 0)
  into v_used
  from public.feature_usage_reservations as reservation
  where reservation.subject_user_id = p_subject_user_id
    and reservation.feature_key = p_feature_key
    and reservation.status in ('reserved', 'settled');

  if v_entitlement.quota_limit is not null
    and p_units::bigint > v_entitlement.quota_limit::bigint - v_used
  then
    raise exception using errcode = '23514', message = 'feature_usage_quota_exhausted';
  end if;

  if exists (
    select 1
    from public.feature_usage_reservations as reservation
    where reservation.subject_user_id = p_subject_user_id
      and reservation.feature_key = p_feature_key
      and reservation.usage_ref = p_usage_ref
  ) then
    raise exception using errcode = '23505', message = 'feature_usage_reference_conflict';
  end if;

  insert into public.feature_usage_reservations (
    operation_id,
    subject_user_id,
    feature_key,
    operation_kind,
    usage_ref,
    entitlement_revision,
    units,
    status,
    request_fingerprint,
    reserved_at,
    expires_at
  ) values (
    p_operation_id,
    p_subject_user_id,
    p_feature_key,
    p_operation_kind,
    p_usage_ref,
    v_entitlement.revision,
    p_units,
    'reserved',
    v_fingerprint,
    v_now,
    v_now + make_interval(secs => p_ttl_seconds)
  )
  returning * into v_reservation;

  return jsonb_build_object(
    'reservation', to_jsonb(v_reservation),
    'duplicate', false,
    'quota_limit', v_entitlement.quota_limit,
    'used_before', v_used,
    'used_after', v_used + p_units
  );
end;
$function$;

create or replace function public.settle_feature_usage_v1(
  p_operation_id uuid,
  p_subject_user_id uuid,
  p_feature_key text,
  p_expected_units integer
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
    or p_feature_key <> 'grading.ai'
    or p_expected_units is null
    or p_expected_units not between 1 and 100000
  then
    raise exception using errcode = '22023', message = 'feature_usage_settlement_request_invalid';
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
  if v_reservation.status = 'settled' then
    return jsonb_build_object('reservation', to_jsonb(v_reservation), 'duplicate', true);
  end if;
  if v_reservation.status = 'released' then
    raise exception using errcode = '55000', message = 'feature_usage_reservation_released';
  end if;
  if v_reservation.expires_at <= v_now then
    raise exception using errcode = '55000', message = 'feature_usage_reservation_expired';
  end if;

  update public.feature_usage_reservations
  set status = 'settled', settled_at = v_now, updated_at = v_now
  where id = v_reservation.id
  returning * into v_reservation;

  return jsonb_build_object('reservation', to_jsonb(v_reservation), 'duplicate', false);
end;
$function$;

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
    or p_feature_key <> 'grading.ai'
    or p_expected_units is null
    or p_expected_units not between 1 and 100000
    or p_release_reason not in ('cancelled', 'expired', 'provider_failed', 'stale', 'superseded')
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
  if v_reservation.status = 'released' then
    if v_reservation.release_reason is distinct from p_release_reason then
      raise exception using errcode = '23505', message = 'feature_usage_release_conflict';
    end if;
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

create function private.lock_metered_assignment_ai_grading_item_v1(
  p_item_id uuid,
  p_lease_token uuid,
  p_require_pending boolean default true
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
    if v_item.assignment_doc_id is null or v_item.assignment_doc_updated_at is null then
      raise exception using errcode = '40001', message = 'metered_assignment_source_changed';
    end if;
    select doc.* into v_doc
    from public.assignment_docs doc
    where doc.id = v_item.assignment_doc_id
      and doc.assignment_id = v_item.assignment_id
      and doc.student_id = v_item.student_id
    for update;
    if not found or v_doc.updated_at is distinct from v_item.assignment_doc_updated_at then
      raise exception using errcode = '40001', message = 'metered_assignment_source_changed';
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

revoke all on function private.lock_metered_assignment_ai_grading_item_v1(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

create function public.create_metered_assignment_ai_grading_run_v1(
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
  v_item_id uuid;
begin
  v_run := public.create_assignment_ai_grading_run_atomic(
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

  update public.assignment_ai_grading_runs run
  set worker_contract_version = 1
  where run.id = v_run.id
  returning run.* into v_run;

  -- Pre-acquire every operation fence before the shared entitlement bucket.
  for v_item_id in
    select item.id
    from public.assignment_ai_grading_run_items item
    where item.run_id = v_run.id and item.status = 'queued'
    order by item.id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('feature-usage-operation:' || v_item_id::text, 20120260921)
    );
  end loop;

  for v_item_id in
    select item.id
    from public.assignment_ai_grading_run_items item
    where item.run_id = v_run.id and item.status = 'queued'
    order by item.id
  loop
    perform public.reserve_feature_usage_v1(
      p_operation_id => v_item_id,
      p_subject_user_id => p_teacher_id,
      p_feature_key => 'grading.ai',
      p_operation_kind => 'assignment_ai_grading',
      p_usage_ref => 'assignment-ai-item-v1:' || v_item_id::text,
      p_units => 1,
      p_ttl_seconds => 86400
    );
  end loop;

  return v_run;
end;
$function$;

create function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(
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
begin
  select * into v_locked
  from private.lock_metered_assignment_ai_grading_item_v1(p_item_id, p_lease_token, true);

  return public.reserve_feature_usage_v1(
    p_operation_id => p_item_id,
    p_subject_user_id => v_locked.triggered_by,
    p_feature_key => 'grading.ai',
    p_operation_kind => 'assignment_ai_grading',
    p_usage_ref => v_locked.usage_ref,
    p_units => 1,
    p_ttl_seconds => 86400
  );
end;
$function$;

create function public.finalize_assignment_ai_grading_item_and_settle_usage_v1(
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
  v_locked record;
  v_result jsonb;
  v_reservation public.feature_usage_reservations%rowtype;
begin
  select * into v_locked
  from private.lock_metered_assignment_ai_grading_item_v1(p_item_id, p_lease_token, false);
  if v_locked.triggered_by is distinct from p_teacher_id then
    raise exception using errcode = '42501', message = 'metered_assignment_teacher_mismatch';
  end if;

  select reservation.* into v_reservation
  from public.feature_usage_reservations reservation
  where reservation.operation_id = p_item_id;
  if not found
    or v_reservation.operation_kind <> 'assignment_ai_grading'
    or v_reservation.usage_ref <> v_locked.usage_ref
    or v_reservation.subject_user_id <> v_locked.triggered_by
    or v_reservation.units <> 1
  then
    raise exception using errcode = '42501', message = 'feature_usage_reservation_binding_mismatch';
  end if;

  v_result := public.finalize_assignment_ai_grading_item_with_provenance_lease_v1(
    p_item_id,
    p_lease_token,
    p_teacher_id,
    p_score_completion,
    p_score_thinking,
    p_score_workflow,
    p_feedback,
    p_apply_teacher_feedback_draft,
    p_mark_graded,
    p_ai_feedback_suggestion,
    p_ai_feedback_model,
    p_ai_grading_provenance,
    p_graded_by,
    p_attempt_count,
    p_item_status,
    p_skip_reason,
    p_now
  );

  perform public.settle_feature_usage_v1(p_item_id, v_locked.triggered_by, 'grading.ai', 1);
  return v_result;
end;
$function$;

create function public.fail_assignment_ai_grading_item_and_release_usage_with_lease_v1(
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

  select * into v_locked
  from private.lock_metered_assignment_ai_grading_item_v1(p_item_id, p_lease_token, true);

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

create function public.fail_assignment_ai_grading_run_and_release_usage_with_lease_v1(
  p_run_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_release_reason text
)
returns public.assignment_ai_grading_runs
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment_id uuid;
  v_classroom_id uuid;
  v_owner_id uuid;
  v_run public.assignment_ai_grading_runs%rowtype;
  v_item record;
  v_pending_count integer;
begin
  if p_run_id is null or p_lease_token is null
    or p_error_code is null or char_length(p_error_code) not between 1 and 80
    or p_error_message is null or char_length(p_error_message) not between 1 and 500
  then
    raise exception using errcode = '22023', message = 'metered_assignment_run_failure_invalid';
  end if;

  select run.assignment_id into v_assignment_id
  from public.assignment_ai_grading_runs run
  where run.id = p_run_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'metered_assignment_run_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_assignment_id::text, 0));
  select assignment.classroom_id into v_classroom_id
  from public.assignments assignment where assignment.id = v_assignment_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'metered_assignment_not_found';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:' || v_classroom_id::text, 0)
  );

  for v_item in
    select distinct item.student_id
    from public.assignment_ai_grading_run_items item
    where item.run_id = p_run_id and item.status in ('queued', 'processing')
    order by item.student_id
  loop
    perform private.try_lock_classroom_membership_change(v_classroom_id, v_item.student_id);
  end loop;

  select classroom.teacher_id
  into v_owner_id
  from public.assignments assignment
  join public.classrooms classroom on classroom.id = assignment.classroom_id
  where assignment.id = v_assignment_id and assignment.classroom_id = v_classroom_id
  for update of assignment, classroom;

  select run.* into v_run
  from public.assignment_ai_grading_runs run
  where run.id = p_run_id and run.assignment_id = v_assignment_id
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

  perform 1
  from public.assignment_ai_grading_run_items item
  where item.run_id = p_run_id
  order by item.id
  for update;

  -- Avoid operation-A -> bucket -> operation-B deadlocks.
  for v_item in
    select item.id, item.student_id
    from public.assignment_ai_grading_run_items item
    where item.run_id = p_run_id and item.status in ('queued', 'processing')
    order by item.id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('feature-usage-operation:' || v_item.id::text, 20120260921)
    );
  end loop;

  v_pending_count := 0;
  for v_item in
    select item.id
    from public.assignment_ai_grading_run_items item
    where item.run_id = p_run_id and item.status in ('queued', 'processing')
    order by item.id
  loop
    perform public.release_feature_usage_v1(
      v_item.id,
      v_run.triggered_by,
      'grading.ai',
      1,
      p_release_reason
    );
    v_pending_count := v_pending_count + 1;
  end loop;

  update public.assignment_ai_grading_run_items item
  set status = 'failed',
      next_retry_at = null,
      last_error_code = p_error_code,
      last_error_message = p_error_message,
      completed_at = clock_timestamp()
  where item.run_id = p_run_id and item.status in ('queued', 'processing');

  update public.assignment_ai_grading_runs run
  set status = 'failed',
      processed_count = least(run.requested_count, run.processed_count + v_pending_count),
      failed_count = run.failed_count + v_pending_count,
      error_samples_json = jsonb_build_array(jsonb_build_object(
        'student_id', null,
        'code', p_error_code,
        'message', p_error_message
      )),
      lease_token = null,
      lease_expires_at = null,
      completed_at = clock_timestamp()
  where run.id = p_run_id
  returning run.* into v_run;

  return v_run;
end;
$function$;

revoke all on function public.create_metered_assignment_ai_grading_run_v1(
  uuid, uuid, text, uuid[], text, integer, integer, integer, jsonb, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_assignment_ai_grading_item_and_settle_usage_v1(
  uuid, uuid, uuid, integer, integer, integer, text, boolean, boolean, text, text,
  jsonb, text, integer, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.fail_assignment_ai_grading_item_and_release_usage_with_lease_v1(
  uuid, uuid, integer, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.fail_assignment_ai_grading_run_and_release_usage_with_lease_v1(
  uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.create_metered_assignment_ai_grading_run_v1(
  uuid, uuid, text, uuid[], text, integer, integer, integer, jsonb, timestamptz
) to service_role;
grant execute on function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(uuid, uuid)
  to service_role;
grant execute on function public.finalize_assignment_ai_grading_item_and_settle_usage_v1(
  uuid, uuid, uuid, integer, integer, integer, text, boolean, boolean, text, text,
  jsonb, text, integer, text, text, timestamptz
) to service_role;
grant execute on function public.fail_assignment_ai_grading_item_and_release_usage_with_lease_v1(
  uuid, uuid, integer, text, text, text
) to service_role;
grant execute on function public.fail_assignment_ai_grading_run_and_release_usage_with_lease_v1(
  uuid, uuid, text, text, text
) to service_role;

comment on function public.create_metered_assignment_ai_grading_run_v1(
  uuid, uuid, text, uuid[], text, integer, integer, integer, jsonb, timestamptz
) is 'Creates one lease-fenced Assignment grading run and atomically reserves one unit per queued item.';
comment on function public.reserve_assignment_ai_grading_item_usage_with_lease_v1(uuid, uuid)
  is 'Revalidates one current Assignment worker item and returns its idempotent usage reservation.';
comment on function public.finalize_assignment_ai_grading_item_and_settle_usage_v1(
  uuid, uuid, uuid, integer, integer, integer, text, boolean, boolean, text, text,
  jsonb, text, integer, text, text, timestamptz
) is 'Atomically saves one Assignment AI grade and settles its exact one-unit reservation.';

commit;
