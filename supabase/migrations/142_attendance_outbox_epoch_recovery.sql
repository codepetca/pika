-- Bounded operator recovery for attendance messages from an obsolete
-- entitlement epoch. This is intentionally separate from normal delivery:
-- no worker or teacher request can invoke it, and it never rewrites payloads.

create table public.attendance_outbox_epoch_recovery_audit (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  -- Immutable subject and outbox snapshots survive later user/classroom cleanup.
  teacher_id uuid not null,
  previous_entitlement_revision bigint not null
    check (previous_entitlement_revision > 0),
  new_entitlement_revision bigint not null
    check (new_entitlement_revision = previous_entitlement_revision + 1),
  outbox_ids uuid[] not null
    check (cardinality(outbox_ids) between 1 and 100),
  superseded_count integer not null
    check (superseded_count = cardinality(outbox_ids)),
  actor_ref text not null
    check (actor_ref ~ '^[A-Za-z0-9._~:@-]{1,100}$'),
  reason_code text not null
    check (reason_code ~ '^[a-z][a-z0-9._-]{0,99}$'),
  request_fingerprint text not null
    check (request_fingerprint ~ '^[a-f0-9]{32}$'),
  created_at timestamptz not null default clock_timestamp()
);

alter table public.attendance_outbox_epoch_recovery_audit enable row level security;
revoke all on table public.attendance_outbox_epoch_recovery_audit
  from public, anon, authenticated, service_role;
grant select on table public.attendance_outbox_epoch_recovery_audit to service_role;

create function public.supersede_attendance_outbox_epoch_v1(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_expected_entitlement_revision bigint,
  p_outbox_ids uuid[],
  p_actor_ref text,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_ids uuid[];
  v_actual_ids uuid[];
  v_entitlement public.attendance_teacher_entitlements%rowtype;
  v_existing public.attendance_outbox_epoch_recovery_audit%rowtype;
  v_change jsonb;
  v_fingerprint text;
  v_updated integer;
begin
  select coalesce(array_agg(requested_id order by requested_id), '{}'::uuid[])
    into v_requested_ids
  from unnest(coalesce(p_outbox_ids, '{}'::uuid[])) requested_id;

  if p_operation_id is null or p_teacher_id is null
    or p_expected_entitlement_revision is null
    or p_expected_entitlement_revision < 1
    or cardinality(v_requested_ids) not between 1 and 100
    or cardinality(v_requested_ids) <> cardinality(p_outbox_ids)
    or (select count(distinct requested_id)
        from unnest(v_requested_ids) requested_id) <> cardinality(v_requested_ids)
    or p_actor_ref !~ '^[A-Za-z0-9._~:@-]{1,100}$'
    or p_reason_code !~ '^[a-z][a-z0-9._-]{0,99}$' then
    raise exception using
      errcode = '22023', message = 'attendance_outbox_recovery_request_invalid';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'teacher_id', p_teacher_id,
    'expected_entitlement_revision', p_expected_entitlement_revision,
    'outbox_ids', to_jsonb(v_requested_ids),
    'actor_ref', p_actor_ref,
    'reason_code', p_reason_code
  )::text);

  -- Serialize against entitlement changes and both scoped and legacy outbox
  -- inserts. New messages cannot enter this teacher scope between inspection
  -- and the epoch rotation.
  perform pg_advisory_xact_lock(
    hashtextextended(p_teacher_id::text, 13220260823)
  );

  select * into v_existing
  from public.attendance_outbox_epoch_recovery_audit
  where operation_id = p_operation_id;
  if v_existing.id is not null then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using
        errcode = '23505', message = 'attendance_outbox_recovery_operation_conflict';
    end if;
    return jsonb_build_object(
      'teacher_id', v_existing.teacher_id,
      'previous_entitlement_revision', v_existing.previous_entitlement_revision,
      'new_entitlement_revision', v_existing.new_entitlement_revision,
      'superseded_count', v_existing.superseded_count,
      'duplicate', true
    );
  end if;

  select * into v_entitlement
  from public.attendance_teacher_entitlements
  where teacher_id = p_teacher_id
  for update;
  if v_entitlement.teacher_id is null
    or v_entitlement.status <> 'active'
    or v_entitlement.revision <> p_expected_entitlement_revision then
    raise exception using
      errcode = '40001', message = 'attendance_outbox_recovery_entitlement_conflict';
  end if;

  -- Lock every unresolved row in the teacher scope before comparing the exact
  -- caller-approved set. This fails closed if a delivery completed, a new row
  -- appeared, or an unrelated classroom was omitted from the approval.
  perform 1
  from public.attendance_integration_outbox outbox
  join public.classrooms classroom on classroom.id = outbox.classroom_id
  where classroom.teacher_id = p_teacher_id
    and outbox.status in ('pending', 'processing', 'non_retryable')
  order by outbox.id
  for update of outbox;

  select coalesce(array_agg(outbox.id order by outbox.id), '{}'::uuid[])
    into v_actual_ids
  from public.attendance_integration_outbox outbox
  join public.classrooms classroom on classroom.id = outbox.classroom_id
  where classroom.teacher_id = p_teacher_id
    and outbox.status in ('pending', 'processing', 'non_retryable');

  if v_actual_ids <> v_requested_ids then
    raise exception using
      errcode = '40001', message = 'attendance_outbox_recovery_scope_changed';
  end if;
  if exists (
    select 1
    from public.attendance_integration_outbox outbox
    where outbox.id = any(v_requested_ids)
      and (
        outbox.entitlement_revision is distinct from p_expected_entitlement_revision
        or outbox.message_type not in ('roster.snapshot', 'schedule.snapshot')
      )
  ) then
    raise exception using
      errcode = '22023', message = 'attendance_outbox_recovery_row_invalid';
  end if;
  if exists (
    select 1
    from public.attendance_integration_outbox outbox
    where outbox.id = any(v_requested_ids)
      and outbox.status = 'processing'
      and (
        outbox.lease_expires_at is null
        or outbox.lease_expires_at > clock_timestamp()
      )
  ) then
    raise exception using
      errcode = '55000', message = 'attendance_outbox_recovery_delivery_active';
  end if;

  -- Rotate the epoch through the existing idempotent audited setter while
  -- preserving the active entitlement's dates and source. The encompassing
  -- transaction makes the rotation and supersession atomic.
  select public.set_attendance_teacher_entitlement_v1(
    p_operation_id,
    p_teacher_id,
    'active',
    v_entitlement.valid_from,
    v_entitlement.valid_until,
    v_entitlement.source,
    p_actor_ref,
    p_reason_code,
    p_expected_entitlement_revision
  ) into v_change;

  update public.attendance_integration_outbox
  set status = 'superseded',
      lease_token = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = any(v_requested_ids)
    and status in ('pending', 'processing', 'non_retryable');
  get diagnostics v_updated = row_count;
  if v_updated <> cardinality(v_requested_ids) then
    raise exception using
      errcode = '40001', message = 'attendance_outbox_recovery_scope_changed';
  end if;

  insert into public.attendance_outbox_epoch_recovery_audit (
    operation_id,
    teacher_id,
    previous_entitlement_revision,
    new_entitlement_revision,
    outbox_ids,
    superseded_count,
    actor_ref,
    reason_code,
    request_fingerprint
  ) values (
    p_operation_id,
    p_teacher_id,
    p_expected_entitlement_revision,
    (v_change->>'revision')::bigint,
    v_requested_ids,
    v_updated,
    p_actor_ref,
    p_reason_code,
    v_fingerprint
  );

  return jsonb_build_object(
    'teacher_id', p_teacher_id,
    'previous_entitlement_revision', p_expected_entitlement_revision,
    'new_entitlement_revision', (v_change->>'revision')::bigint,
    'superseded_count', v_updated,
    'duplicate', false
  );
end;
$$;

revoke all on function public.supersede_attendance_outbox_epoch_v1(
  uuid, uuid, bigint, uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.supersede_attendance_outbox_epoch_v1(
  uuid, uuid, bigint, uuid[], text, text
) to service_role;
