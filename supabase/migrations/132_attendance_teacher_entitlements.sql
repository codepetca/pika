-- Pika-owned admission and revocation for the Bara attendance integration.
--
-- This migration is additive: deployed code remains in exact-canary mode until
-- PIKA_BARA_ATTENDANCE_SCOPE_MODE=teacher_entitlements is explicitly selected.
-- Entitlement, billing, and Pika identifiers never cross the service boundary.

create table public.attendance_teacher_entitlements (
  teacher_id uuid primary key references public.users (id) on delete cascade,
  status text not null check (status in ('active', 'revoked')),
  valid_from timestamptz not null,
  valid_until timestamptz,
  revision bigint not null check (revision > 0),
  source text not null check (source ~ '^[a-z][a-z0-9._-]{0,49}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (valid_until is null or valid_until > valid_from)
);

create table public.attendance_teacher_entitlement_audit (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  -- Immutable subject snapshot: deleting a user removes live entitlement state
  -- but must not erase who was granted or revoked historically.
  teacher_id uuid not null,
  previous_status text check (previous_status in ('active', 'revoked')),
  new_status text not null check (new_status in ('active', 'revoked')),
  entitlement_revision bigint not null check (entitlement_revision > 0),
  valid_from timestamptz not null,
  valid_until timestamptz,
  source text not null check (source ~ '^[a-z][a-z0-9._-]{0,49}$'),
  actor_ref text not null check (actor_ref ~ '^[A-Za-z0-9._~:@-]{1,100}$'),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9._-]{0,99}$'),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{32}$'),
  created_at timestamptz not null default clock_timestamp(),
  check (valid_until is null or valid_until > valid_from)
);

alter table public.attendance_teacher_entitlements enable row level security;
alter table public.attendance_teacher_entitlement_audit enable row level security;
revoke all on table public.attendance_teacher_entitlements
  from public, anon, authenticated, service_role;
revoke all on table public.attendance_teacher_entitlement_audit
  from public, anon, authenticated, service_role;
grant select on table public.attendance_teacher_entitlements to service_role;
grant select on table public.attendance_teacher_entitlement_audit to service_role;

alter table public.attendance_roster_mappings
  add column integration_state text not null default 'active'
    check (integration_state in ('active', 'deactivating', 'inactive')),
  add column deactivation_requested_at timestamptz,
  add column inactive_at timestamptz,
  add column remote_schedule_window_end date,
  add column deactivation_window_start date,
  add column deactivation_window_end date,
  add column deactivation_target_end date,
  add constraint attendance_roster_mappings_deactivation_window_check check (
    (
      deactivation_window_start is null
      and deactivation_window_end is null
      and deactivation_target_end is null
    )
    or (
      deactivation_window_start is not null
      and deactivation_window_end is not null
      and deactivation_target_end is not null
      and deactivation_window_end >= deactivation_window_start
      and deactivation_window_end - deactivation_window_start <= 400
      and deactivation_target_end >= deactivation_window_end
    )
  );

alter table public.attendance_integration_outbox
  add column entitlement_revision bigint,
  drop constraint attendance_integration_outbox_status_check;
alter table public.attendance_integration_outbox
  add constraint attendance_integration_outbox_status_check
  check (status in ('pending', 'processing', 'delivered', 'non_retryable', 'superseded'));

-- Preserve the furthest window Bara may already know about before entitlement
-- mode is enabled. This metadata backfill does not enqueue or deliver work.
update public.attendance_roster_mappings roster
set remote_schedule_window_end = delivered.window_end
from (
  select outbox.classroom_id,
    max((outbox.payload->>'window_end')::date) as window_end
  from public.attendance_integration_outbox outbox
  where outbox.message_type = 'schedule.snapshot'
    and outbox.status = 'delivered'
    and outbox.payload->>'window_end' ~ '^\d{4}-\d{2}-\d{2}$'
  group by outbox.classroom_id
) delivered
where roster.classroom_id = delivered.classroom_id;

create function public.attendance_teacher_entitled_v1(
  p_teacher_id uuid,
  p_at timestamptz default clock_timestamp()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attendance_teacher_entitlements entitlement
    where entitlement.teacher_id = p_teacher_id
      and entitlement.status = 'active'
      and entitlement.valid_from <= p_at
      and (entitlement.valid_until is null or entitlement.valid_until > p_at)
  );
$$;

create function public.stamp_attendance_outbox_entitlement_revision_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entitlement_revision is null then
    select entitlement.revision into new.entitlement_revision
    from public.classrooms classroom
    join public.attendance_teacher_entitlements entitlement
      on entitlement.teacher_id = classroom.teacher_id
    where classroom.id = new.classroom_id
      and entitlement.status = 'active'
      and entitlement.valid_from <= clock_timestamp()
      and (entitlement.valid_until is null
        or entitlement.valid_until > clock_timestamp());
  end if;
  return new;
end;
$$;

create trigger attendance_outbox_entitlement_revision_insert
before insert on public.attendance_integration_outbox
for each row execute function public.stamp_attendance_outbox_entitlement_revision_v1();

create function public.enqueue_attendance_outbound_message_v2(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_message jsonb,
  p_at timestamptz default clock_timestamp()
)
returns public.attendance_integration_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entitlement_revision bigint;
  v_row public.attendance_integration_outbox%rowtype;
begin
  if p_teacher_id is null or p_classroom_id is null or p_at is null then
    raise exception using errcode = '22023', message = 'attendance_outbox_enqueue_invalid';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_teacher_id::text, 13220260823)
  );
  select entitlement.revision into v_entitlement_revision
  from public.attendance_teacher_entitlements entitlement
  join public.classrooms classroom
    on classroom.teacher_id = entitlement.teacher_id
  left join public.attendance_roster_mappings roster
    on roster.classroom_id = classroom.id
  where entitlement.teacher_id = p_teacher_id
    and classroom.id = p_classroom_id
    and classroom.archived_at is null
    and entitlement.status = 'active'
    and entitlement.valid_from <= p_at
    and (entitlement.valid_until is null or entitlement.valid_until > p_at)
    and coalesce(roster.integration_state, 'active') = 'active';
  if v_entitlement_revision is null then
    raise exception using errcode = '42501', message = 'attendance_classroom_not_entitled';
  end if;

  select * into v_row from public.enqueue_attendance_outbound_message_v1(
    p_classroom_id, p_message
  );
  if v_row.entitlement_revision is not null
    and v_row.entitlement_revision <> v_entitlement_revision
    and v_row.status in ('pending', 'processing', 'non_retryable') then
    update public.attendance_integration_outbox
    set status = 'superseded', lease_token = null, lease_expires_at = null,
        updated_at = clock_timestamp()
    where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;
  if v_row.status = 'superseded' then
    return v_row;
  end if;
  update public.attendance_integration_outbox
  set entitlement_revision = coalesce(entitlement_revision, v_entitlement_revision),
      updated_at = clock_timestamp()
  where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

create function public.set_attendance_teacher_entitlement_v1(
  p_operation_id uuid,
  p_teacher_id uuid,
  p_status text,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_source text,
  p_actor_ref text,
  p_reason_code text,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.attendance_teacher_entitlements%rowtype;
  v_audit public.attendance_teacher_entitlement_audit%rowtype;
  v_revision bigint;
  v_fingerprint text;
begin
  if p_operation_id is null or p_teacher_id is null
    or p_status not in ('active', 'revoked')
    or p_valid_from is null
    or (p_valid_until is not null and p_valid_until <= p_valid_from)
    or p_source !~ '^[a-z][a-z0-9._-]{0,49}$'
    or p_actor_ref !~ '^[A-Za-z0-9._~:@-]{1,100}$'
    or p_reason_code !~ '^[a-z][a-z0-9._-]{0,99}$'
    or (p_expected_revision is not null and p_expected_revision < 0) then
    raise exception using errcode = '22023', message = 'attendance_entitlement_request_invalid';
  end if;

  if not exists (
    select 1 from public.users where id = p_teacher_id and role = 'teacher'
  ) then
    raise exception using errcode = 'P0002', message = 'attendance_entitlement_teacher_not_found';
  end if;

  -- A missing entitlement row cannot be protected by FOR UPDATE. Serialize the
  -- first grant/revoke and every later revision on the stable teacher ID.
  perform pg_advisory_xact_lock(
    hashtextextended(p_teacher_id::text, 13220260823)
  );

  v_fingerprint := md5(jsonb_build_object(
    'teacher_id', p_teacher_id,
    'status', p_status,
    'valid_from', p_valid_from,
    'valid_until', p_valid_until,
    'source', p_source,
    'actor_ref', p_actor_ref,
    'reason_code', p_reason_code,
    'expected_revision', p_expected_revision
  )::text);

  select * into v_audit
  from public.attendance_teacher_entitlement_audit
  where operation_id = p_operation_id;
  if v_audit.id is not null then
    if v_audit.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'attendance_entitlement_operation_conflict';
    end if;
    return jsonb_build_object(
      'teacher_id', v_audit.teacher_id,
      'status', v_audit.new_status,
      'revision', v_audit.entitlement_revision,
      'duplicate', true
    );
  end if;

  select * into v_existing
  from public.attendance_teacher_entitlements
  where teacher_id = p_teacher_id
  for update;

  if coalesce(v_existing.revision, 0) <> coalesce(p_expected_revision, 0) then
    raise exception using errcode = '40001', message = 'attendance_entitlement_revision_conflict';
  end if;
  v_revision := coalesce(v_existing.revision, 0) + 1;

  insert into public.attendance_teacher_entitlements (
    teacher_id, status, valid_from, valid_until, revision, source
  ) values (
    p_teacher_id, p_status, p_valid_from, p_valid_until, v_revision, p_source
  )
  on conflict (teacher_id) do update
    set status = excluded.status,
        valid_from = excluded.valid_from,
        valid_until = excluded.valid_until,
        revision = excluded.revision,
        source = excluded.source,
        updated_at = clock_timestamp();

  insert into public.attendance_teacher_entitlement_audit (
    operation_id, teacher_id, previous_status, new_status,
    entitlement_revision, valid_from, valid_until, source,
    actor_ref, reason_code, request_fingerprint
  ) values (
    p_operation_id, p_teacher_id, v_existing.status, p_status,
    v_revision, p_valid_from, p_valid_until, p_source,
    p_actor_ref, p_reason_code, v_fingerprint
  );

  return jsonb_build_object(
    'teacher_id', p_teacher_id,
    'status', p_status,
    'revision', v_revision,
    'duplicate', false
  );
end;
$$;

create function public.get_attendance_classroom_access_v1(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'state', case
      when classroom.id is null or classroom.archived_at is not null then 'disabled'
      when not public.attendance_teacher_entitled_v1(p_teacher_id, p_at) then 'disabled'
      when coalesce(roster.integration_state, 'active') <> 'active' then 'disabled'
      else 'ready'
    end,
    'schedule_through', case
      when entitlement.valid_until is null then null
      else ((entitlement.valid_until at time zone 'America/Toronto')::date - 1)::text
    end
  )
  from (select 1) seed
  left join public.classrooms classroom
    on classroom.id = p_classroom_id and classroom.teacher_id = p_teacher_id
  left join public.attendance_roster_mappings roster
    on roster.classroom_id = classroom.id
  left join public.attendance_teacher_entitlements entitlement
    on entitlement.teacher_id = p_teacher_id;
$$;

create function public.get_attendance_classroom_id_access_v1(
  p_classroom_id uuid,
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.get_attendance_classroom_access_v1(
      classroom.teacher_id, classroom.id, p_at
    )
    from public.classrooms classroom
    where classroom.id = p_classroom_id
  ), jsonb_build_object('state', 'disabled', 'schedule_through', null));
$$;

create function public.get_attendance_entitlement_transition_health_v1(
  p_teacher_id uuid,
  p_classroom_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope_valid boolean;
  v_unversioned_unresolved_count bigint;
  v_stale_epoch_unresolved_count bigint;
begin
  select exists (
    select 1 from public.classrooms classroom
    where classroom.id = p_classroom_id
      and classroom.teacher_id = p_teacher_id
      and classroom.archived_at is null
  ) into v_scope_valid;
  if not v_scope_valid then
    return jsonb_build_object(
      'ready', false,
      'unversioned_unresolved_count', 0,
      'stale_epoch_unresolved_count', 0
    );
  end if;
  select count(*) into v_unversioned_unresolved_count
  from public.attendance_integration_outbox outbox
  where outbox.classroom_id = p_classroom_id
    and outbox.entitlement_revision is null
    and outbox.status in ('pending', 'processing', 'non_retryable');
  select count(*) into v_stale_epoch_unresolved_count
  from public.attendance_integration_outbox outbox
  join public.attendance_teacher_entitlements entitlement
    on entitlement.teacher_id = p_teacher_id
  where outbox.classroom_id = p_classroom_id
    and outbox.entitlement_revision is not null
    and outbox.entitlement_revision <> entitlement.revision
    and outbox.status in ('pending', 'processing', 'non_retryable');
  return jsonb_build_object(
    'ready', v_unversioned_unresolved_count = 0
      and v_stale_epoch_unresolved_count = 0,
    'unversioned_unresolved_count', v_unversioned_unresolved_count,
    'stale_epoch_unresolved_count', v_stale_epoch_unresolved_count
  );
end;
$$;

create function public.list_attendance_sync_targets_v3(
  p_at timestamptz,
  p_limit integer default 51
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'classroom_id', target.classroom_id,
    'teacher_id', target.teacher_id,
    'integration_mode', target.integration_mode,
    'schedule_through', target.schedule_through
  ) order by target.priority, target.classroom_id), '[]'::jsonb)
  from (
    select candidate.*
    from (
    select classroom.id as classroom_id,
      classroom.teacher_id,
      'active'::text as integration_mode,
      case when entitlement.valid_until is null then null
        else ((entitlement.valid_until at time zone 'America/Toronto')::date - 1)::text
      end as schedule_through,
      1 as priority
    from public.attendance_window_policies policy
    join public.classrooms classroom on classroom.id = policy.classroom_id
    join public.attendance_teacher_entitlements entitlement
      on entitlement.teacher_id = classroom.teacher_id
    left join public.attendance_roster_mappings roster
      on roster.classroom_id = classroom.id
    where p_at is not null and p_limit between 1 and 51
      and classroom.archived_at is null
      and public.attendance_teacher_entitled_v1(classroom.teacher_id, p_at)
      and coalesce(roster.integration_state, 'active') in (
        'active', 'deactivating', 'inactive'
      )
      and (
        entitlement.valid_until is null
        or (entitlement.valid_until at time zone 'America/Toronto')::date - 1
          >= (p_at at time zone 'America/Toronto')::date
      )

    union all

    select classroom.id, classroom.teacher_id, 'deactivating'::text, null, 0
    from public.attendance_roster_mappings roster
    join public.classrooms classroom on classroom.id = roster.classroom_id
    where p_at is not null and p_limit between 1 and 51
      and classroom.archived_at is null
      and roster.integration_state in ('active', 'deactivating')
      and not public.attendance_teacher_entitled_v1(classroom.teacher_id, p_at)
    ) candidate
    order by candidate.priority, candidate.classroom_id
    limit p_limit
  ) target;
$$;

create function public.prepare_attendance_snapshot_v2(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_window_start date,
  p_window_end date,
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_roster public.attendance_roster_mappings%rowtype;
  v_entitlement public.attendance_teacher_entitlements%rowtype;
  v_prepared jsonb;
  v_token text;
  v_revision bigint;
  v_has_remote_intent boolean;
  v_deactivation_window_start date;
  v_deactivation_window_end date;
  v_deactivation_target_end date;
begin
  if p_teacher_id is null or p_classroom_id is null or p_at is null
    or p_window_start is null or p_window_end is null
    or p_window_end < p_window_start or p_window_end - p_window_start > 400 then
    raise exception using errcode = '22023', message = 'attendance_snapshot_window_invalid';
  end if;

  select * into v_classroom from public.classrooms
  where id = p_classroom_id for update;
  if v_classroom.id is null then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;
  if v_classroom.teacher_id <> p_teacher_id or v_classroom.archived_at is not null then
    raise exception using errcode = '42501', message = 'attendance_classroom_forbidden';
  end if;

  select * into v_entitlement from public.attendance_teacher_entitlements
  where teacher_id = p_teacher_id for share;
  select * into v_roster from public.attendance_roster_mappings
  where classroom_id = p_classroom_id for update;

  if public.attendance_teacher_entitled_v1(p_teacher_id, p_at) then
    if v_entitlement.valid_until is not null and p_window_end >=
      (v_entitlement.valid_until at time zone 'America/Toronto')::date then
      raise exception using errcode = '22023', message = 'attendance_snapshot_exceeds_entitlement';
    end if;
    if v_roster.classroom_id is not null and v_roster.integration_state <> 'active' then
      update public.attendance_integration_outbox
      set status = 'superseded', lease_token = null, lease_expires_at = null,
          updated_at = clock_timestamp()
      where classroom_id = p_classroom_id
        and status in ('pending', 'processing', 'non_retryable');
      update public.attendance_roster_mappings
      set integration_state = 'active', deactivation_requested_at = null,
          inactive_at = null, deactivation_window_start = null,
          deactivation_window_end = null, deactivation_target_end = null,
          source_token = null, schedule_source_token = null,
          updated_at = clock_timestamp()
      where classroom_id = p_classroom_id;
    end if;
    v_prepared := public.prepare_attendance_snapshot_v1(
      p_teacher_id, p_classroom_id, p_window_start, p_window_end
    );
    return v_prepared || jsonb_build_object('integration_mode', 'active');
  end if;

  if v_roster.classroom_id is null or v_roster.integration_state = 'inactive' then
    raise exception using errcode = '55000', message = 'attendance_classroom_inactive';
  end if;

  v_has_remote_intent := v_roster.remote_schedule_window_end is not null
    and v_roster.remote_schedule_window_end >= p_window_start;

  if not v_has_remote_intent then
    update public.attendance_integration_outbox
    set status = 'superseded', lease_token = null, lease_expires_at = null,
        updated_at = clock_timestamp()
    where classroom_id = p_classroom_id
      and status in ('pending', 'processing', 'non_retryable');
    update public.attendance_roster_mappings
    set integration_state = 'inactive', inactive_at = clock_timestamp(),
        deactivation_requested_at = coalesce(deactivation_requested_at, clock_timestamp()),
        updated_at = clock_timestamp()
    where classroom_id = p_classroom_id;
    return jsonb_build_object(
      'integration_mode', 'inactive',
      'classroom_id', p_classroom_id,
      'roster_ref', v_roster.roster_ref,
      'title', v_classroom.title
    );
  end if;

  v_deactivation_target_end := coalesce(
    v_roster.deactivation_target_end,
    greatest(p_window_end, v_roster.remote_schedule_window_end)
  );
  v_deactivation_window_start := coalesce(
    v_roster.deactivation_window_start, p_window_start
  );
  v_deactivation_window_end := coalesce(
    v_roster.deactivation_window_end,
    least(v_deactivation_window_start + 400, v_deactivation_target_end)
  );
  v_token := md5(jsonb_build_object(
    'mode', 'deactivation',
    'roster_ref', v_roster.roster_ref,
    'window_start', v_deactivation_window_start,
    'window_end', v_deactivation_window_end,
    'entitlement_revision', coalesce(v_entitlement.revision, 0)
  )::text);
  v_revision := case when v_roster.schedule_source_token = v_token
    then greatest(v_roster.schedule_source_revision, 1)
    else v_roster.schedule_source_revision + 1 end;

  update public.attendance_roster_mappings
  set integration_state = 'deactivating',
      deactivation_requested_at = coalesce(deactivation_requested_at, clock_timestamp()),
      deactivation_window_start = v_deactivation_window_start,
      deactivation_window_end = v_deactivation_window_end,
      deactivation_target_end = v_deactivation_target_end,
      schedule_source_token = v_token,
      schedule_source_revision = v_revision,
      updated_at = clock_timestamp()
  where classroom_id = p_classroom_id;

  return jsonb_build_object(
    'integration_mode', 'deactivating',
    'classroom_id', p_classroom_id,
    'roster_ref', v_roster.roster_ref,
    'title', v_classroom.title,
    'schedule_source_token', v_token,
    'schedule_revision', v_revision,
    'window_start', v_deactivation_window_start,
    'window_end', v_deactivation_window_end,
    'policy', jsonb_build_object(
      'timezone', 'America/Toronto',
      'opens_local', '00:00',
      'closes_local', '00:01',
      'close_day_offset', 0,
      'enabled', false,
      'policy_revision', 1
    ),
    'class_days', '[]'::jsonb
  );
end;
$$;

create function public.stage_attendance_roster_snapshot_v2(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_source_token text,
  p_message jsonb,
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.attendance_teacher_entitled_v1(p_teacher_id, p_at)
    or not exists (
      select 1 from public.classrooms classroom
      left join public.attendance_roster_mappings roster
        on roster.classroom_id = classroom.id
      where classroom.id = p_classroom_id
        and classroom.teacher_id = p_teacher_id
        and classroom.archived_at is null
        and coalesce(roster.integration_state, 'active') = 'active'
    ) then
    raise exception using errcode = '42501', message = 'attendance_classroom_not_entitled';
  end if;
  v_result := public.stage_attendance_roster_snapshot_v1(
    p_teacher_id, p_classroom_id, p_source_token, p_message
  );
  perform public.enqueue_attendance_outbound_message_v2(
    p_teacher_id, p_classroom_id, p_message, p_at
  );
  return v_result;
end;
$$;

create function public.upsert_attendance_window_policy_v2(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_opens_local time without time zone,
  p_closes_local time without time zone,
  p_close_day_offset smallint,
  p_enabled boolean,
  p_expected_revision bigint default null,
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.attendance_teacher_entitled_v1(p_teacher_id, p_at) then
    raise exception using errcode = '42501', message = 'attendance_classroom_not_entitled';
  end if;
  return public.upsert_attendance_window_policy_v1(
    p_teacher_id, p_classroom_id, p_opens_local, p_closes_local,
    p_close_day_offset, p_enabled, p_expected_revision
  );
end;
$$;

create function public.stage_attendance_schedule_snapshot_v2(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_source_token text,
  p_message jsonb,
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_roster public.attendance_roster_mappings%rowtype;
  v_outbox public.attendance_integration_outbox%rowtype;
  v_active_result jsonb;
  v_window_start date;
  v_window_end date;
begin
  select * into v_classroom from public.classrooms
  where id = p_classroom_id for update;
  select * into v_roster from public.attendance_roster_mappings
  where classroom_id = p_classroom_id for update;

  if public.attendance_teacher_entitled_v1(p_teacher_id, p_at)
    and v_classroom.teacher_id = p_teacher_id
    and v_classroom.archived_at is null
    and v_roster.integration_state = 'active' then
    v_active_result := public.stage_attendance_schedule_snapshot_v1(
      p_teacher_id, p_classroom_id, p_source_token, p_message
    );
    perform public.enqueue_attendance_outbound_message_v2(
      p_teacher_id, p_classroom_id, p_message, p_at
    );
    return v_active_result;
  end if;

  if v_classroom.id is null or v_classroom.teacher_id <> p_teacher_id
    or v_classroom.archived_at is not null
    or v_roster.classroom_id is null
    or v_roster.integration_state <> 'deactivating'
    or p_source_token <> v_roster.schedule_source_token
    or jsonb_typeof(p_message) <> 'object'
    or p_message->>'message_type' <> 'schedule.snapshot'
    or p_message->>'roster_ref' <> v_roster.roster_ref
    or p_message->>'revision' !~ '^[1-9][0-9]*$'
    or (p_message->>'revision')::bigint <> v_roster.schedule_source_revision
    or p_message->>'window_start' !~ '^\d{4}-\d{2}-\d{2}$'
    or p_message->>'window_end' !~ '^\d{4}-\d{2}-\d{2}$'
    or (case when jsonb_typeof(p_message->'occurrences') = 'array'
      then jsonb_array_length(p_message->'occurrences') <> 0
      else true
    end) then
    raise exception using errcode = '42501', message = 'attendance_deactivation_schedule_invalid';
  end if;
  v_window_start := (p_message->>'window_start')::date;
  v_window_end := (p_message->>'window_end')::date;
  if v_window_start is null or v_window_end is null
    or v_window_end < v_window_start or v_window_end - v_window_start > 400
    or v_window_start <> v_roster.deactivation_window_start
    or v_window_end <> v_roster.deactivation_window_end then
    raise exception using errcode = '22023', message = 'attendance_snapshot_window_invalid';
  end if;

  update public.attendance_integration_outbox
  set status = 'superseded', lease_token = null, lease_expires_at = null,
      updated_at = clock_timestamp()
  where classroom_id = p_classroom_id
    and status in ('pending', 'processing', 'non_retryable')
    and idempotency_key <> p_message->>'idempotency_key';

  update public.attendance_occurrence_mappings
  set desired_state = 'cancelled', source_revision = v_roster.schedule_source_revision,
      updated_at = clock_timestamp()
  where classroom_id = p_classroom_id
    and class_date between v_window_start and v_window_end;

  select * into v_outbox from public.enqueue_attendance_outbound_message_v1(
    p_classroom_id, p_message
  );
  update public.attendance_roster_mappings
  set schedule_staged_revision = schedule_source_revision,
      updated_at = clock_timestamp()
  where classroom_id = p_classroom_id;

  return jsonb_build_object(
    'outbox_id', v_outbox.id,
    'idempotency_key', v_outbox.idempotency_key,
    'revision', v_roster.schedule_source_revision,
    'status', v_outbox.status
  );
end;
$$;

create function public.attendance_outbox_claim_allowed_v1(
  p_row public.attendance_integration_outbox,
  p_teacher_id uuid,
  p_at timestamptz default clock_timestamp()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.classrooms classroom
    join public.attendance_roster_mappings roster
      on roster.classroom_id = classroom.id
    where classroom.id = p_row.classroom_id
      and classroom.teacher_id = p_teacher_id
      and classroom.archived_at is null
      and (
        (
          roster.integration_state = 'active'
          and public.attendance_teacher_entitled_v1(p_teacher_id, p_at)
          and p_row.entitlement_revision = (
            select entitlement.revision
            from public.attendance_teacher_entitlements entitlement
            where entitlement.teacher_id = p_teacher_id
          )
          and public.attendance_outbox_dependencies_ready_v1(p_row)
        )
        or (
          roster.integration_state = 'deactivating'
          and p_row.message_type = 'schedule.snapshot'
          and case when jsonb_typeof(p_row.payload->'occurrences') = 'array'
            then jsonb_array_length(p_row.payload->'occurrences') = 0
            else false
          end
          and (p_row.payload->>'revision')::bigint = roster.schedule_staged_revision
        )
      )
  );
$$;

create function public.claim_attendance_outbound_message_v2(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_idempotency_key text,
  p_lease_seconds integer default 60
)
returns public.attendance_integration_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_integration_outbox%rowtype;
begin
  if p_teacher_id is null or p_classroom_id is null
    or p_idempotency_key !~ '^[A-Za-z0-9._~:-]{1,200}$'
    or p_lease_seconds not between 10 and 600 then
    raise exception using errcode = '22023', message = 'attendance_outbox_claim_invalid';
  end if;
  update public.attendance_integration_outbox outbox
  set status = 'processing', attempts = outbox.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      last_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
  where outbox.classroom_id = p_classroom_id
    and outbox.idempotency_key = p_idempotency_key
    and public.attendance_outbox_claim_allowed_v1(outbox, p_teacher_id)
    and ((outbox.status = 'pending' and outbox.next_attempt_at <= clock_timestamp())
      or (outbox.status = 'processing' and outbox.lease_expires_at <= clock_timestamp()))
  returning outbox.* into v_row;
  return v_row;
end;
$$;

create function public.claim_attendance_outbox_batch_v3(
  p_limit integer default 20,
  p_lease_seconds integer default 60
)
returns setof public.attendance_integration_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit not between 1 and 100 or p_lease_seconds not between 10 and 600 then
    raise exception using errcode = '22023', message = 'attendance_outbox_claim_invalid';
  end if;
  return query
  with candidates as (
    select candidate.id
    from public.attendance_integration_outbox candidate
    join public.classrooms classroom on classroom.id = candidate.classroom_id
    where public.attendance_outbox_claim_allowed_v1(candidate, classroom.teacher_id)
      and ((candidate.status = 'pending' and candidate.next_attempt_at <= clock_timestamp())
        or (candidate.status = 'processing' and candidate.lease_expires_at <= clock_timestamp()))
    order by candidate.next_attempt_at, candidate.created_at
    limit p_limit for update of candidate skip locked
  )
  update public.attendance_integration_outbox outbox
  set status = 'processing', attempts = outbox.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      last_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
  from candidates where outbox.id = candidates.id
  returning outbox.*;
end;
$$;

-- Schedule delivery can still use the v1 completion path while rollout scope
-- remains exact_canary. Track Bara's acknowledged horizon at the completion
-- boundary so a later entitlement revocation always cancels every delivered
-- future window, independent of the scope mode that staged the snapshot.
create or replace function public.complete_attendance_outbox_v1(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_response_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_integration_outbox%rowtype;
begin
  if jsonb_typeof(p_response_payload) <> 'object'
    or pg_column_size(p_response_payload) > 32768 then
    raise exception using errcode = '22023', message = 'attendance_outbox_response_invalid';
  end if;

  update public.attendance_integration_outbox
  set status = 'delivered',
      response_payload = p_response_payload,
      delivered_at = clock_timestamp(),
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null,
      last_error_detail = null,
      updated_at = clock_timestamp()
  where id = p_outbox_id and status = 'processing' and lease_token = p_lease_token
  returning * into v_row;
  if v_row.id is null then return false; end if;

  if v_row.message_type = 'roster.snapshot' then
    update public.attendance_roster_mappings
    set synced_revision = greatest(
          coalesce(synced_revision, 0),
          (v_row.payload->>'revision')::bigint
        ),
        updated_at = clock_timestamp()
    where classroom_id = v_row.classroom_id;
  elsif v_row.message_type = 'schedule.snapshot' then
    update public.attendance_roster_mappings
    set schedule_synced_revision = greatest(
          coalesce(schedule_synced_revision, 0),
          (v_row.payload->>'revision')::bigint
        ),
        remote_schedule_window_end = case
          when integration_state = 'active'
            and jsonb_typeof(v_row.payload) = 'object'
            and v_row.payload->>'window_end' ~ '^\d{4}-\d{2}-\d{2}$'
          then greatest(
            coalesce(remote_schedule_window_end, (v_row.payload->>'window_end')::date),
            (v_row.payload->>'window_end')::date
          )
          else remote_schedule_window_end
        end,
        updated_at = clock_timestamp()
    where classroom_id = v_row.classroom_id;
  end if;
  return true;
end;
$$;

create function public.complete_attendance_outbox_v2(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_response_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_integration_outbox%rowtype;
  v_completed boolean;
begin
  select * into v_row from public.attendance_integration_outbox
  where id = p_outbox_id and status = 'processing' and lease_token = p_lease_token
  for update;
  if v_row.id is null then return false; end if;
  v_completed := public.complete_attendance_outbox_v1(
    p_outbox_id, p_lease_token, p_response_payload
  );
  if v_completed and v_row.message_type = 'schedule.snapshot'
    and (case when jsonb_typeof(v_row.payload->'occurrences') = 'array'
      then jsonb_array_length(v_row.payload->'occurrences') = 0
      else false
    end) then
    update public.attendance_roster_mappings
    set integration_state = case
          when deactivation_window_end < deactivation_target_end
            then 'deactivating'
          else 'inactive'
        end,
        inactive_at = case
          when deactivation_window_end < deactivation_target_end
            then null
          else clock_timestamp()
        end,
        deactivation_window_start = case
          when deactivation_window_end < deactivation_target_end
            then deactivation_window_end + 1
          else deactivation_window_start
        end,
        deactivation_window_end = case
          when deactivation_window_end < deactivation_target_end
            then least(deactivation_window_end + 401, deactivation_target_end)
          else deactivation_window_end
        end,
        updated_at = clock_timestamp()
    where classroom_id = v_row.classroom_id
      and integration_state = 'deactivating'
      and schedule_staged_revision = (v_row.payload->>'revision')::bigint;
  end if;
  return v_completed;
end;
$$;

create function public.list_attendance_reconciliation_targets_v3(
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
    where p_now is not null and classroom.archived_at is null
      and mapping.opens_at is not null and mapping.closes_at is not null
      and mapping.opens_at <= p_now
      and mapping.closes_at >= p_now - make_interval(
        hours => least(greatest(coalesce(p_lookback_hours, 48), 1), 168)
      )
      and roster.schedule_synced_revision >= mapping.source_revision
      and (
        (roster.integration_state = 'active'
          and public.attendance_teacher_entitled_v1(classroom.teacher_id, p_now)
          and mapping.desired_state = 'scheduled')
        or roster.integration_state in ('deactivating', 'inactive')
      )
    order by mapping.last_reconciled_at nulls first, mapping.closes_at desc,
      mapping.occurrence_ref
    limit least(greatest(coalesce(p_limit, 51), 1), 51)
  ) target;
$$;

create function public.apply_attendance_event_for_entitled_mapping_v1(
  p_event jsonb,
  p_transport_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom_id uuid;
begin
  select occurrence.classroom_id into v_classroom_id
  from public.attendance_occurrence_mappings occurrence
  join public.attendance_roster_mappings roster
    on roster.classroom_id = occurrence.classroom_id
  join public.classrooms classroom on classroom.id = occurrence.classroom_id
  where occurrence.occurrence_ref = p_event->>'occurrence_ref'
    and roster.roster_ref = p_event->>'roster_ref'
    and classroom.archived_at is null
  for share of classroom;
  if v_classroom_id is null then
    raise exception using errcode = '23514', message = 'attendance_event_mapping_mismatch';
  end if;
  return public.apply_attendance_event_v1(p_event, p_transport_nonce);
end;
$$;

create function public.apply_attendance_session_snapshot_for_entitled_mapping_v1(
  p_installation_ref text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mapping public.attendance_occurrence_mappings%rowtype;
  v_roster public.attendance_roster_mappings%rowtype;
  v_restore_cancelled boolean := false;
  v_result jsonb;
begin
  select occurrence.* into v_mapping
  from public.attendance_occurrence_mappings occurrence
  join public.attendance_roster_mappings roster
    on roster.classroom_id = occurrence.classroom_id
  join public.classrooms classroom on classroom.id = occurrence.classroom_id
  where occurrence.occurrence_ref = p_snapshot->>'occurrence_ref'
    and roster.roster_ref = p_snapshot->>'roster_ref'
    and classroom.archived_at is null
  for update of occurrence;
  if v_mapping.classroom_id is null then
    raise exception using errcode = '23514', message = 'attendance_snapshot_mapping_mismatch';
  end if;
  select * into v_roster from public.attendance_roster_mappings
  where classroom_id = v_mapping.classroom_id;
  if v_mapping.desired_state = 'cancelled'
    and v_roster.integration_state in ('deactivating', 'inactive') then
    update public.attendance_occurrence_mappings
    set desired_state = 'scheduled'
    where classroom_id = v_mapping.classroom_id and class_date = v_mapping.class_date;
    v_restore_cancelled := true;
  end if;
  v_result := public.apply_attendance_session_snapshot_v1(
    p_installation_ref, p_snapshot
  );
  if v_restore_cancelled then
    update public.attendance_occurrence_mappings
    set desired_state = 'cancelled'
    where classroom_id = v_mapping.classroom_id and class_date = v_mapping.class_date;
  end if;
  return v_result;
end;
$$;

create function public.attendance_outbox_health_v3()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'processing', count(*) filter (where status = 'processing'),
    'non_retryable', count(*) filter (where status = 'non_retryable'),
    'due', count(*) filter (where
      (status = 'pending' and next_attempt_at <= clock_timestamp())
      or (status = 'processing' and lease_expires_at <= clock_timestamp())
    ),
    'oldest_unresolved_at', min(created_at) filter (
      where status in ('pending', 'processing', 'non_retryable')
    )
  ) from public.attendance_integration_outbox;
$$;

revoke all on function public.attendance_teacher_entitled_v1(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.stamp_attendance_outbox_entitlement_revision_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.enqueue_attendance_outbound_message_v2(
  uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;
revoke all on function public.set_attendance_teacher_entitlement_v1(
  uuid, uuid, text, timestamptz, timestamptz, text, text, text, bigint
) from public, anon, authenticated;
revoke all on function public.get_attendance_classroom_access_v1(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_attendance_classroom_id_access_v1(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_attendance_entitlement_transition_health_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.list_attendance_sync_targets_v3(timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.prepare_attendance_snapshot_v2(uuid, uuid, date, date, timestamptz)
  from public, anon, authenticated;
revoke all on function public.stage_attendance_roster_snapshot_v2(
  uuid, uuid, text, jsonb, timestamptz
) from public, anon, authenticated;
revoke all on function public.upsert_attendance_window_policy_v2(
  uuid, uuid, time without time zone, time without time zone,
  smallint, boolean, bigint, timestamptz
) from public, anon, authenticated;
revoke all on function public.stage_attendance_schedule_snapshot_v2(
  uuid, uuid, text, jsonb, timestamptz
) from public, anon, authenticated;
revoke all on function public.attendance_outbox_claim_allowed_v1(
  public.attendance_integration_outbox, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.claim_attendance_outbound_message_v2(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.claim_attendance_outbox_batch_v3(integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_attendance_outbox_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.list_attendance_reconciliation_targets_v3(
  timestamptz, integer, integer
) from public, anon, authenticated;
revoke all on function public.apply_attendance_event_for_entitled_mapping_v1(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.apply_attendance_session_snapshot_for_entitled_mapping_v1(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.attendance_outbox_health_v3()
  from public, anon, authenticated;

grant execute on function public.attendance_teacher_entitled_v1(uuid, timestamptz)
  to service_role;
grant execute on function public.enqueue_attendance_outbound_message_v2(
  uuid, uuid, jsonb, timestamptz
) to service_role;
grant execute on function public.set_attendance_teacher_entitlement_v1(
  uuid, uuid, text, timestamptz, timestamptz, text, text, text, bigint
) to service_role;
grant execute on function public.get_attendance_classroom_access_v1(uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.get_attendance_classroom_id_access_v1(uuid, timestamptz)
  to service_role;
grant execute on function public.get_attendance_entitlement_transition_health_v1(uuid, uuid)
  to service_role;
grant execute on function public.list_attendance_sync_targets_v3(timestamptz, integer)
  to service_role;
grant execute on function public.prepare_attendance_snapshot_v2(uuid, uuid, date, date, timestamptz)
  to service_role;
grant execute on function public.stage_attendance_roster_snapshot_v2(
  uuid, uuid, text, jsonb, timestamptz
) to service_role;
grant execute on function public.upsert_attendance_window_policy_v2(
  uuid, uuid, time without time zone, time without time zone,
  smallint, boolean, bigint, timestamptz
) to service_role;
grant execute on function public.stage_attendance_schedule_snapshot_v2(
  uuid, uuid, text, jsonb, timestamptz
) to service_role;
grant execute on function public.claim_attendance_outbound_message_v2(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.claim_attendance_outbox_batch_v3(integer, integer)
  to service_role;
grant execute on function public.complete_attendance_outbox_v2(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.list_attendance_reconciliation_targets_v3(
  timestamptz, integer, integer
) to service_role;
grant execute on function public.apply_attendance_event_for_entitled_mapping_v1(jsonb, text)
  to service_role;
grant execute on function public.apply_attendance_session_snapshot_for_entitled_mapping_v1(text, jsonb)
  to service_role;
grant execute on function public.attendance_outbox_health_v3() to service_role;
