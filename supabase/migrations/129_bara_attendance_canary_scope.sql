-- Scope every unattended attendance worker and event ingress transaction to
-- one verified Pika teacher/classroom pair. Application-side filtering is not
-- sufficient for leasing RPCs because a filtered-out row would already have
-- been claimed.

create function public.list_attendance_sync_targets_v2(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_limit integer default 2
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'classroom_id', target.classroom_id,
    'teacher_id', target.teacher_id
  )), '[]'::jsonb)
  from (
    select classroom.id as classroom_id, classroom.teacher_id
    from public.attendance_window_policies policy
    join public.classrooms classroom on classroom.id = policy.classroom_id
    where p_teacher_id is not null
      and p_classroom_id is not null
      and p_limit between 1 and 51
      and classroom.id = p_classroom_id
      and classroom.teacher_id = p_teacher_id
      and classroom.archived_at is null
    limit p_limit
  ) target;
$$;

create function public.list_attendance_reconciliation_targets_v2(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_now timestamptz,
  p_lookback_hours integer default 48,
  p_limit integer default 51
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'occurrence_ref', target.occurrence_ref
  ) order by target.last_reconciled_at nulls first, target.closes_at desc,
    target.occurrence_ref), '[]'::jsonb)
  from (
    select mapping.occurrence_ref, mapping.last_reconciled_at, mapping.closes_at
    from public.attendance_occurrence_mappings mapping
    join public.attendance_roster_mappings roster
      on roster.classroom_id = mapping.classroom_id
    join public.classrooms classroom on classroom.id = mapping.classroom_id
    where p_teacher_id is not null
      and p_classroom_id is not null
      and p_now is not null
      and classroom.id = p_classroom_id
      and classroom.teacher_id = p_teacher_id
      and classroom.archived_at is null
      and mapping.desired_state = 'scheduled'
      and mapping.opens_at is not null
      and mapping.closes_at is not null
      and mapping.opens_at <= p_now
      and mapping.closes_at >= p_now - make_interval(
        hours => least(greatest(coalesce(p_lookback_hours, 48), 1), 168)
      )
      and roster.schedule_synced_revision >= mapping.source_revision
    order by mapping.last_reconciled_at nulls first, mapping.closes_at desc,
      mapping.occurrence_ref
    limit least(greatest(coalesce(p_limit, 51), 1), 51)
  ) target;
$$;

create function public.claim_attendance_outbox_batch_v2(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_limit integer default 20,
  p_lease_seconds integer default 60
)
returns setof public.attendance_integration_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_teacher_id is null or p_classroom_id is null
    or p_limit not between 1 and 100
    or p_lease_seconds not between 10 and 600 then
    raise exception using errcode = '22023', message = 'attendance_outbox_claim_invalid';
  end if;

  -- Hold the active classroom row through the claim so a concurrent archive
  -- cannot revoke the canary between the application preflight and leasing.
  perform 1
  from public.classrooms classroom
  where classroom.id = p_classroom_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null
  for share;
  if not found then return; end if;

  return query
  with candidates as (
    select candidate.id
    from public.attendance_integration_outbox candidate
    join public.classrooms classroom on classroom.id = candidate.classroom_id
    where candidate.classroom_id = p_classroom_id
      and classroom.teacher_id = p_teacher_id
      and classroom.archived_at is null
      and public.attendance_outbox_dependencies_ready_v1(candidate)
      and (
        (candidate.status = 'pending' and candidate.next_attempt_at <= clock_timestamp())
        or (candidate.status = 'processing' and candidate.lease_expires_at <= clock_timestamp())
      )
    order by candidate.next_attempt_at, candidate.created_at
    limit p_limit
    for update of candidate skip locked
  )
  update public.attendance_integration_outbox outbox
  set status = 'processing',
      attempts = outbox.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      last_attempt_at = clock_timestamp(),
      updated_at = clock_timestamp()
  from candidates
  where outbox.id = candidates.id
  returning outbox.*;
end;
$$;

create function public.attendance_outbox_health_v2(
  p_teacher_id uuid,
  p_classroom_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pending', count(*) filter (where outbox.status = 'pending'),
    'processing', count(*) filter (where outbox.status = 'processing'),
    'non_retryable', count(*) filter (where outbox.status = 'non_retryable'),
    'due', count(*) filter (where
      (outbox.status = 'pending' and outbox.next_attempt_at <= clock_timestamp())
      or (outbox.status = 'processing' and outbox.lease_expires_at <= clock_timestamp())
    ),
    'oldest_unresolved_at', min(outbox.created_at) filter (
      where outbox.status in ('pending', 'processing', 'non_retryable')
    )
  )
  from public.attendance_integration_outbox outbox
  join public.classrooms classroom on classroom.id = outbox.classroom_id
  where p_teacher_id is not null
    and p_classroom_id is not null
    and outbox.classroom_id = p_classroom_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null;
$$;

create function public.apply_attendance_event_for_classroom_v1(
  p_event jsonb,
  p_transport_nonce text,
  p_teacher_id uuid,
  p_classroom_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_active boolean;
  v_matches boolean;
begin
  -- Serialize against archive/ownership changes for the entire atomic apply.
  select true into v_scope_active
  from public.classrooms classroom
  where classroom.id = p_classroom_id
    and classroom.teacher_id = p_teacher_id
    and classroom.archived_at is null
  for share;
  if not coalesce(v_scope_active, false) then
    raise exception using errcode = '55000', message = 'attendance_canary_not_active';
  end if;

  select exists (
    select 1
    from public.attendance_occurrence_mappings occurrence
    join public.attendance_roster_mappings roster
      on roster.classroom_id = occurrence.classroom_id
    join public.classrooms classroom on classroom.id = occurrence.classroom_id
    where occurrence.occurrence_ref = p_event->>'occurrence_ref'
      and roster.roster_ref = p_event->>'roster_ref'
      and occurrence.classroom_id = p_classroom_id
      and classroom.teacher_id = p_teacher_id
      and classroom.archived_at is null
  ) into v_matches;

  if not coalesce(v_matches, false) then
    raise exception using errcode = '23514', message = 'attendance_event_mapping_mismatch';
  end if;

  return public.apply_attendance_event_v1(p_event, p_transport_nonce);
end;
$$;

revoke all on function public.list_attendance_sync_targets_v2(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.list_attendance_reconciliation_targets_v2(
  uuid, uuid, timestamptz, integer, integer
) from public, anon, authenticated;
revoke all on function public.claim_attendance_outbox_batch_v2(uuid, uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.attendance_outbox_health_v2(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.apply_attendance_event_for_classroom_v1(
  jsonb, text, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.list_attendance_sync_targets_v2(uuid, uuid, integer)
  to service_role;
grant execute on function public.list_attendance_reconciliation_targets_v2(
  uuid, uuid, timestamptz, integer, integer
) to service_role;
grant execute on function public.claim_attendance_outbox_batch_v2(uuid, uuid, integer, integer)
  to service_role;
grant execute on function public.attendance_outbox_health_v2(uuid, uuid)
  to service_role;
grant execute on function public.apply_attendance_event_for_classroom_v1(
  jsonb, text, uuid, uuid
) to service_role;
