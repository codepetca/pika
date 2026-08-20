-- Durable, privacy-minimized Bara attendance event inbox and Pika projections.
-- Server-only; the browser receives projections through existing teacher routes.

-- Pika-owned mappings keep local IDs out of the cross-service contract. They
-- are deliberately separate from the projections so Bara/Convex can be
-- replaced without changing classroom, enrollment, or class-day identifiers.
create table public.attendance_roster_mappings (
  classroom_id uuid primary key references public.classrooms (id) on delete cascade,
  roster_ref text not null unique
    default ('roster_' || replace(gen_random_uuid()::text, '-', '')),
  source_token text,
  source_revision bigint not null default 0 check (source_revision >= 0),
  staged_revision bigint check (
    staged_revision is null or (staged_revision > 0 and staged_revision <= source_revision)
  ),
  synced_revision bigint check (
    synced_revision is null or (synced_revision > 0 and synced_revision <= source_revision)
  ),
  schedule_source_token text,
  schedule_source_revision bigint not null default 0
    check (schedule_source_revision >= 0),
  schedule_staged_revision bigint check (
    schedule_staged_revision is null
    or (schedule_staged_revision > 0 and schedule_staged_revision <= schedule_source_revision)
  ),
  schedule_synced_revision bigint check (
    schedule_synced_revision is null
    or (schedule_synced_revision > 0 and schedule_synced_revision <= schedule_source_revision)
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (roster_ref ~ '^roster_[a-f0-9]{32}$')
);

create table public.attendance_participant_mappings (
  classroom_id uuid not null,
  student_id uuid not null,
  participant_ref text not null unique
    default ('participant_' || replace(gen_random_uuid()::text, '-', '')),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (classroom_id, student_id),
  foreign key (classroom_id) references public.classrooms (id) on delete cascade,
  foreign key (student_id) references public.users (id) on delete cascade,
  check (participant_ref ~ '^participant_[a-f0-9]{32}$')
);

-- Occurrences intentionally survive a class-day row being toggled or removed:
-- their cancellation and historical attendance remain reviewable until the
-- classroom itself is deleted.
create table public.attendance_occurrence_mappings (
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  class_date date not null,
  occurrence_ref text not null unique
    default ('occurrence_' || replace(gen_random_uuid()::text, '-', '')),
  opens_at timestamptz,
  closes_at timestamptz,
  desired_state text not null default 'scheduled'
    check (desired_state in ('scheduled', 'cancelled')),
  source_revision bigint not null default 1 check (source_revision > 0),
  synced_revision bigint check (
    synced_revision is null or (synced_revision > 0 and synced_revision <= source_revision)
  ),
  last_reconciled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (classroom_id, class_date),
  check (occurrence_ref ~ '^occurrence_[a-f0-9]{32}$'),
  check (
    (opens_at is null and closes_at is null)
    or (opens_at is not null and closes_at is not null and opens_at < closes_at)
  )
);

create index attendance_occurrence_mappings_due
  on public.attendance_occurrence_mappings (desired_state, opens_at, closes_at);
create index attendance_occurrence_mappings_reconciliation
  on public.attendance_occurrence_mappings (last_reconciled_at, closes_at)
  where desired_state = 'scheduled';

-- Pika combines this teacher-local policy with its own class-day dates. Bara
-- receives only concrete UTC instants and never reads or infers Pika schedule
-- tables. A next-day close supports evening classes without ambiguous dates.
create table public.attendance_window_policies (
  classroom_id uuid primary key references public.classrooms (id) on delete cascade,
  timezone text not null default 'America/Toronto'
    check (timezone = 'America/Toronto'),
  opens_local time without time zone not null,
  closes_local time without time zone not null,
  close_day_offset smallint not null default 0
    check (close_day_offset in (0, 1)),
  enabled boolean not null default true,
  policy_revision bigint not null default 1 check (policy_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (close_day_offset = 1 or opens_local < closes_local)
);

alter table public.attendance_roster_mappings enable row level security;
alter table public.attendance_participant_mappings enable row level security;
alter table public.attendance_occurrence_mappings enable row level security;
alter table public.attendance_window_policies enable row level security;

revoke all on table public.attendance_roster_mappings
  from public, anon, authenticated, service_role;
revoke all on table public.attendance_participant_mappings
  from public, anon, authenticated, service_role;
revoke all on table public.attendance_occurrence_mappings
  from public, anon, authenticated, service_role;
revoke all on table public.attendance_window_policies
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.attendance_roster_mappings
  to service_role;
grant select, insert, update, delete on table public.attendance_participant_mappings
  to service_role;
grant select, insert, update, delete on table public.attendance_occurrence_mappings
  to service_role;
grant select, insert, update, delete on table public.attendance_window_policies
  to service_role;

create function public.upsert_attendance_window_policy_v1(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_opens_local time without time zone,
  p_closes_local time without time zone,
  p_close_day_offset smallint,
  p_enabled boolean,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_policy public.attendance_window_policies%rowtype;
begin
  if p_teacher_id is null or p_classroom_id is null
    or p_opens_local is null or p_closes_local is null
    or p_close_day_offset not in (0, 1) or p_enabled is null
    or (p_close_day_offset = 0 and p_opens_local >= p_closes_local)
    or p_expected_revision is not null and p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'attendance_policy_invalid';
  end if;

  select * into v_classroom
  from public.classrooms
  where id = p_classroom_id
  for update;

  if v_classroom.id is null then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;
  if v_classroom.teacher_id <> p_teacher_id then
    raise exception using errcode = '42501', message = 'attendance_classroom_forbidden';
  end if;
  if v_classroom.archived_at is not null then
    raise exception using errcode = '42501', message = 'attendance_classroom_archived';
  end if;

  select * into v_policy
  from public.attendance_window_policies
  where classroom_id = p_classroom_id
  for update;

  if v_policy.classroom_id is null then
    if p_expected_revision is not null then
      raise exception using errcode = '40001', message = 'attendance_policy_revision_conflict';
    end if;
    insert into public.attendance_window_policies (
      classroom_id, opens_local, closes_local, close_day_offset, enabled
    ) values (
      p_classroom_id, p_opens_local, p_closes_local, p_close_day_offset, p_enabled
    ) returning * into v_policy;
  else
    if p_expected_revision is null or v_policy.policy_revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'attendance_policy_revision_conflict';
    end if;
    update public.attendance_window_policies
    set opens_local = p_opens_local,
        closes_local = p_closes_local,
        close_day_offset = p_close_day_offset,
        enabled = p_enabled,
        policy_revision = policy_revision + 1,
        updated_at = clock_timestamp()
    where classroom_id = p_classroom_id
    returning * into v_policy;
  end if;

  return jsonb_build_object(
    'classroom_id', v_policy.classroom_id,
    'timezone', v_policy.timezone,
    'opens_local', to_char(v_policy.opens_local, 'HH24:MI'),
    'closes_local', to_char(v_policy.closes_local, 'HH24:MI'),
    'close_day_offset', v_policy.close_day_offset,
    'enabled', v_policy.enabled,
    'revision', v_policy.policy_revision,
    'updated_at', v_policy.updated_at
  );
end;
$$;

revoke all on function public.upsert_attendance_window_policy_v1(
  uuid, uuid, time without time zone, time without time zone, smallint, boolean, bigint
) from public, anon, authenticated;
grant execute on function public.upsert_attendance_window_policy_v1(
  uuid, uuid, time without time zone, time without time zone, smallint, boolean, bigint
) to service_role;

-- The daily Pika worker walks the least-recently staged classrooms first. This
-- keeps the rolling class-day horizon current without giving the worker direct
-- table access or allowing one stable prefix of classrooms to starve the rest.
create function public.list_attendance_sync_targets_v1(p_limit integer default 51)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'classroom_id', target.classroom_id,
    'teacher_id', target.teacher_id
  ) order by target.last_staged_at nulls first, target.classroom_id), '[]'::jsonb)
  from (
    select classroom.id as classroom_id,
           classroom.teacher_id,
           roster.updated_at as last_staged_at
    from public.attendance_window_policies policy
    join public.classrooms classroom on classroom.id = policy.classroom_id
    left join public.attendance_roster_mappings roster
      on roster.classroom_id = classroom.id
    where classroom.archived_at is null
    order by roster.updated_at nulls first, classroom.id
    limit least(greatest(coalesce(p_limit, 51), 1), 51)
  ) target;
$$;

revoke all on function public.list_attendance_sync_targets_v1(integer)
  from public, anon, authenticated;
grant execute on function public.list_attendance_sync_targets_v1(integer)
  to service_role;

-- Active and recently closed sessions are reconciled least-recently first so
-- a dropped event cannot leave Pika's read projection stale indefinitely.
create function public.list_attendance_reconciliation_targets_v1(
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
    where p_now is not null
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

revoke all on function public.list_attendance_reconciliation_targets_v1(
  timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.list_attendance_reconciliation_targets_v1(
  timestamptz, integer, integer
) to service_role;

create function public.attendance_roster_source_document_v1(p_classroom_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', classroom.title,
    'owner_workos_subject', owner_user.workos_user_id,
    'enrolled_student_ids', coalesce((
      select jsonb_agg(enrollment.student_id order by enrollment.student_id)
      from public.classroom_enrollments enrollment
      where enrollment.classroom_id = classroom.id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', mapping.student_id,
        'participant_ref', mapping.participant_ref,
        'active', exists (
          select 1 from public.classroom_enrollments enrollment
          where enrollment.classroom_id = mapping.classroom_id
            and enrollment.student_id = mapping.student_id
        ),
        'first_name', profile.first_name,
        'last_name', profile.last_name,
        'workos_subject', student_user.workos_user_id
      ) order by mapping.student_id)
      from public.attendance_participant_mappings mapping
      join public.student_profiles profile on profile.user_id = mapping.student_id
      join public.users student_user on student_user.id = mapping.student_id
      where mapping.classroom_id = classroom.id
    ), '[]'::jsonb)
  )
  from public.classrooms classroom
  join public.users owner_user on owner_user.id = classroom.teacher_id
  where classroom.id = p_classroom_id;
$$;

create function public.attendance_schedule_source_document_v1(
  p_classroom_id uuid,
  p_window_start date,
  p_window_end date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', classroom.title,
    'window_start', p_window_start,
    'window_end', p_window_end,
    'policy', jsonb_build_object(
      'timezone', policy.timezone,
      'opens_local', to_char(policy.opens_local, 'HH24:MI'),
      'closes_local', to_char(policy.closes_local, 'HH24:MI'),
      'close_day_offset', policy.close_day_offset,
      'enabled', policy.enabled,
      'policy_revision', policy.policy_revision
    ),
    'class_days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', class_day.date,
        'is_class_day', class_day.is_class_day
      ) order by class_day.date)
      from public.class_days class_day
      where class_day.classroom_id = classroom.id
        and class_day.date between p_window_start and p_window_end
    ), '[]'::jsonb)
  )
  from public.classrooms classroom
  join public.attendance_window_policies policy on policy.classroom_id = classroom.id
  where classroom.id = p_classroom_id;
$$;

create function public.prepare_attendance_snapshot_v1(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_window_start date,
  p_window_end date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_roster public.attendance_roster_mappings%rowtype;
  v_owner_workos_subject text;
  v_roster_document jsonb;
  v_schedule_document jsonb;
  v_roster_token text;
  v_schedule_token text;
  v_missing_profiles bigint;
begin
  if p_teacher_id is null or p_classroom_id is null
    or p_window_start is null or p_window_end is null
    or p_window_end < p_window_start
    or p_window_end - p_window_start > 400 then
    raise exception using errcode = '22023', message = 'attendance_snapshot_window_invalid';
  end if;

  select * into v_classroom
  from public.classrooms
  where id = p_classroom_id
  for update;
  if v_classroom.id is null then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;
  if v_classroom.teacher_id <> p_teacher_id then
    raise exception using errcode = '42501', message = 'attendance_classroom_forbidden';
  end if;
  if v_classroom.archived_at is not null then
    raise exception using errcode = '42501', message = 'attendance_classroom_archived';
  end if;

  select workos_user_id into v_owner_workos_subject
  from public.users where id = v_classroom.teacher_id;
  if v_owner_workos_subject is null then
    raise exception using errcode = '23514', message = 'attendance_owner_identity_not_linked';
  end if;

  select count(*) into v_missing_profiles
  from public.classroom_enrollments enrollment
  left join public.student_profiles profile on profile.user_id = enrollment.student_id
  where enrollment.classroom_id = p_classroom_id and profile.user_id is null;
  if v_missing_profiles > 0 then
    raise exception using errcode = '23514', message = 'attendance_student_profile_missing';
  end if;

  insert into public.attendance_roster_mappings (classroom_id)
  values (p_classroom_id)
  on conflict (classroom_id) do nothing;

  update public.attendance_participant_mappings mapping
  set active = exists (
        select 1 from public.classroom_enrollments enrollment
        where enrollment.classroom_id = mapping.classroom_id
          and enrollment.student_id = mapping.student_id
      ),
      updated_at = clock_timestamp()
  where mapping.classroom_id = p_classroom_id
    and mapping.active is distinct from exists (
      select 1 from public.classroom_enrollments enrollment
      where enrollment.classroom_id = mapping.classroom_id
        and enrollment.student_id = mapping.student_id
    );

  insert into public.attendance_participant_mappings (
    classroom_id, student_id, active
  )
  select enrollment.classroom_id, enrollment.student_id, true
  from public.classroom_enrollments enrollment
  where enrollment.classroom_id = p_classroom_id
  on conflict (classroom_id, student_id) do update
    set active = true, updated_at = clock_timestamp();

  insert into public.attendance_occurrence_mappings (
    classroom_id, class_date, opens_at, closes_at
  )
  select class_day.classroom_id, class_day.date, null, null
  from public.class_days class_day
  where class_day.classroom_id = p_classroom_id
    and class_day.date between p_window_start and p_window_end
    and class_day.is_class_day
  on conflict (classroom_id, class_date) do nothing;

  select * into v_roster
  from public.attendance_roster_mappings
  where classroom_id = p_classroom_id
  for update;

  v_roster_document := public.attendance_roster_source_document_v1(p_classroom_id);
  v_schedule_document := public.attendance_schedule_source_document_v1(
    p_classroom_id, p_window_start, p_window_end
  );
  if v_schedule_document is null then
    raise exception using errcode = '23514', message = 'attendance_window_policy_missing';
  end if;
  v_roster_token := md5(v_roster_document::text);
  v_schedule_token := md5(v_schedule_document::text);

  return jsonb_build_object(
    'classroom_id', p_classroom_id,
    'roster_ref', v_roster.roster_ref,
    'title', v_classroom.title,
    'owner_workos_subject', v_owner_workos_subject,
    'roster_source_token', v_roster_token,
    'roster_revision', case
      when v_roster.source_token = v_roster_token then greatest(v_roster.source_revision, 1)
      else v_roster.source_revision + 1
    end,
    'schedule_source_token', v_schedule_token,
    'schedule_revision', case
      when v_roster.schedule_source_token = v_schedule_token
        then greatest(v_roster.schedule_source_revision, 1)
      else v_roster.schedule_source_revision + 1
    end,
    'policy', v_schedule_document->'policy',
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', mapping.student_id,
        'participant_ref', mapping.participant_ref,
        'display_name', btrim(profile.first_name || ' ' || profile.last_name),
        'active', mapping.active,
        'workos_subject', student_user.workos_user_id
      ) order by profile.last_name, profile.first_name, mapping.student_id)
      from public.attendance_participant_mappings mapping
      join public.student_profiles profile on profile.user_id = mapping.student_id
      join public.users student_user on student_user.id = mapping.student_id
      where mapping.classroom_id = p_classroom_id
    ), '[]'::jsonb),
    'class_days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', class_day.date,
        'is_class_day', class_day.is_class_day,
        'occurrence_ref', occurrence.occurrence_ref
      ) order by class_day.date)
      from public.class_days class_day
      left join public.attendance_occurrence_mappings occurrence
        on occurrence.classroom_id = class_day.classroom_id
       and occurrence.class_date = class_day.date
      where class_day.classroom_id = p_classroom_id
        and class_day.date between p_window_start and p_window_end
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.attendance_roster_source_document_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.attendance_schedule_source_document_v1(uuid, date, date)
  from public, anon, authenticated;
revoke all on function public.prepare_attendance_snapshot_v1(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.prepare_attendance_snapshot_v1(uuid, uuid, date, date)
  to service_role;

-- Every Pika -> Bara write is staged before network delivery. The payload is
-- exactly the pinned contract message: the outbox knows nothing about Convex
-- and contains no Pika student IDs. Roster snapshots intentionally contain the
-- names Bara needs to operate as a standalone attendance service; the table is
-- therefore service-role-only and covered by the same privacy controls as the
-- source roster.
create table public.attendance_integration_outbox (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  idempotency_key text not null unique,
  message_type text not null,
  payload jsonb not null,
  response_payload jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (message_type in (
    'roster.snapshot', 'schedule.snapshot', 'session.command', 'attendance.marks'
  )),
  check (status in ('pending', 'processing', 'delivered', 'non_retryable')),
  check (attempts >= 0),
  check (
    jsonb_typeof(payload) = 'object'
    and pg_column_size(payload) <= 524288
    and payload->>'schema_version' = '1'
    and payload->>'message_type' = message_type
    and payload->>'idempotency_key' = idempotency_key
    and idempotency_key ~ '^[A-Za-z0-9._~:-]{1,200}$'
    and payload->>'correlation_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
    and payload->>'installation_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
    and payload->>'roster_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
  ),
  check (response_payload is null or jsonb_typeof(response_payload) = 'object')
);

create index attendance_integration_outbox_delivery
  on public.attendance_integration_outbox (next_attempt_at, created_at)
  where status in ('pending', 'processing');

alter table public.attendance_integration_outbox enable row level security;
revoke all on table public.attendance_integration_outbox
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.attendance_integration_outbox
  to service_role;

create function public.enqueue_attendance_outbound_message_v1(
  p_classroom_id uuid,
  p_message jsonb
)
returns public.attendance_integration_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.attendance_integration_outbox%rowtype;
  v_idempotency_key text := p_message->>'idempotency_key';
  v_message_type text := p_message->>'message_type';
begin
  if p_classroom_id is null or p_message is null
    or jsonb_typeof(p_message) <> 'object'
    or pg_column_size(p_message) > 524288
    or p_message->>'schema_version' <> '1'
    or v_message_type not in (
      'roster.snapshot', 'schedule.snapshot', 'session.command', 'attendance.marks'
    )
    or v_idempotency_key !~ '^[A-Za-z0-9._~:-]{1,200}$'
    or p_message->>'correlation_ref' !~ '^[A-Za-z0-9._~-]{1,128}$'
    or p_message->>'installation_ref' !~ '^[A-Za-z0-9._~-]{1,128}$'
    or p_message->>'roster_ref' !~ '^[A-Za-z0-9._~-]{1,128}$' then
    raise exception using errcode = '22023', message = 'attendance_outbox_message_invalid';
  end if;

  if not exists (
    select 1 from public.classrooms where id = p_classroom_id
  ) then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;

  insert into public.attendance_integration_outbox (
    classroom_id, idempotency_key, message_type, payload
  ) values (
    p_classroom_id, v_idempotency_key, v_message_type, p_message
  )
  on conflict (idempotency_key) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.attendance_integration_outbox
    where idempotency_key = v_idempotency_key;

    if v_row.classroom_id <> p_classroom_id
      or v_row.message_type <> v_message_type
      or v_row.payload <> p_message then
      raise exception using errcode = '23505', message = 'attendance_outbox_idempotency_conflict';
    end if;
  end if;

  return v_row;
end;
$$;

create function public.stage_attendance_roster_snapshot_v1(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_source_token text,
  p_message jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_roster public.attendance_roster_mappings%rowtype;
  v_current_token text;
  v_revision bigint;
  v_outbox public.attendance_integration_outbox%rowtype;
begin
  if p_teacher_id is null or p_classroom_id is null
    or p_source_token !~ '^[a-f0-9]{32}$'
    or jsonb_typeof(p_message) <> 'object'
    or p_message->>'message_type' <> 'roster.snapshot'
    or jsonb_typeof(p_message->'revision') <> 'number'
    or p_message->>'revision' !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_message->'participants') <> 'array' then
    raise exception using errcode = '22023', message = 'attendance_roster_stage_invalid';
  end if;

  select * into v_classroom from public.classrooms
  where id = p_classroom_id for update;
  if v_classroom.id is null then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;
  if v_classroom.teacher_id <> p_teacher_id or v_classroom.archived_at is not null then
    raise exception using errcode = '42501', message = 'attendance_classroom_forbidden';
  end if;

  select * into v_roster from public.attendance_roster_mappings
  where classroom_id = p_classroom_id for update;
  if v_roster.classroom_id is null then
    raise exception using errcode = '23514', message = 'attendance_snapshot_not_prepared';
  end if;

  v_current_token := md5(public.attendance_roster_source_document_v1(p_classroom_id)::text);
  if v_current_token <> p_source_token then
    raise exception using errcode = '40001', message = 'attendance_roster_source_changed';
  end if;
  v_revision := case when v_roster.source_token = p_source_token
    then greatest(v_roster.source_revision, 1) else v_roster.source_revision + 1 end;

  if p_message->>'roster_ref' <> v_roster.roster_ref
    or (p_message->>'revision')::bigint <> v_revision
    or p_message->>'owner_workos_subject' <> (
      select workos_user_id from public.users where id = v_classroom.teacher_id
    )
    or p_message->>'display_name' <> v_classroom.title
    or jsonb_array_length(p_message->'participants') <> (
      select count(*) from public.attendance_participant_mappings
      where classroom_id = p_classroom_id
    )
    or exists (
      select 1
      from public.attendance_participant_mappings mapping
      join public.student_profiles profile on profile.user_id = mapping.student_id
      join public.users student_user on student_user.id = mapping.student_id
      where mapping.classroom_id = p_classroom_id
        and not exists (
          select 1 from jsonb_array_elements(p_message->'participants') participant
          where participant->>'participant_ref' = mapping.participant_ref
            and participant->>'display_name' = btrim(profile.first_name || ' ' || profile.last_name)
            and jsonb_typeof(participant->'active') = 'boolean'
            and (participant->>'active')::boolean = mapping.active
            and coalesce(participant->>'workos_subject', '') = coalesce(student_user.workos_user_id, '')
        )
    ) then
    raise exception using errcode = '22023', message = 'attendance_roster_message_mismatch';
  end if;

  select * into v_outbox from public.enqueue_attendance_outbound_message_v1(
    p_classroom_id, p_message
  );
  update public.attendance_roster_mappings
  set source_token = p_source_token,
      source_revision = v_revision,
      staged_revision = v_revision,
      updated_at = clock_timestamp()
  where classroom_id = p_classroom_id;

  return jsonb_build_object(
    'outbox_id', v_outbox.id,
    'idempotency_key', v_outbox.idempotency_key,
    'revision', v_revision,
    'status', v_outbox.status
  );
end;
$$;

create function public.stage_attendance_schedule_snapshot_v1(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_source_token text,
  p_message jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_roster public.attendance_roster_mappings%rowtype;
  v_window_start date;
  v_window_end date;
  v_current_token text;
  v_revision bigint;
  v_expected_count bigint;
  v_outbox public.attendance_integration_outbox%rowtype;
begin
  if p_teacher_id is null or p_classroom_id is null
    or p_source_token !~ '^[a-f0-9]{32}$'
    or jsonb_typeof(p_message) <> 'object'
    or p_message->>'message_type' <> 'schedule.snapshot'
    or jsonb_typeof(p_message->'revision') <> 'number'
    or p_message->>'revision' !~ '^[1-9][0-9]*$'
    or p_message->>'window_start' !~ '^\d{4}-\d{2}-\d{2}$'
    or p_message->>'window_end' !~ '^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(p_message->'occurrences') <> 'array' then
    raise exception using errcode = '22023', message = 'attendance_schedule_stage_invalid';
  end if;
  v_window_start := (p_message->>'window_start')::date;
  v_window_end := (p_message->>'window_end')::date;
  if v_window_end < v_window_start or v_window_end - v_window_start > 400 then
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
  select * into v_roster from public.attendance_roster_mappings
  where classroom_id = p_classroom_id for update;
  if v_roster.classroom_id is null then
    raise exception using errcode = '23514', message = 'attendance_snapshot_not_prepared';
  end if;

  v_current_token := md5(public.attendance_schedule_source_document_v1(
    p_classroom_id, v_window_start, v_window_end
  )::text);
  if v_current_token <> p_source_token then
    raise exception using errcode = '40001', message = 'attendance_schedule_source_changed';
  end if;
  v_revision := case when v_roster.schedule_source_token = p_source_token
    then greatest(v_roster.schedule_source_revision, 1)
    else v_roster.schedule_source_revision + 1 end;

  select case when policy.enabled then count(*) else 0 end into v_expected_count
  from public.attendance_window_policies policy
  left join public.class_days class_day
    on class_day.classroom_id = policy.classroom_id
   and class_day.date between v_window_start and v_window_end
   and class_day.is_class_day
  where policy.classroom_id = p_classroom_id
  group by policy.enabled;

  if p_message->>'roster_ref' <> v_roster.roster_ref
    or (p_message->>'revision')::bigint <> v_revision
    or p_message->>'timezone' <> 'America/Toronto'
    or jsonb_array_length(p_message->'occurrences') <> coalesce(v_expected_count, 0)
    or exists (
      select 1 from jsonb_array_elements(p_message->'occurrences') occurrence
      where not exists (
        select 1
        from public.attendance_occurrence_mappings mapping
        join public.class_days class_day
          on class_day.classroom_id = mapping.classroom_id
         and class_day.date = mapping.class_date
        where mapping.classroom_id = p_classroom_id
          and class_day.is_class_day
          and mapping.occurrence_ref = occurrence->>'occurrence_ref'
          and mapping.class_date::text = occurrence->>'date'
      )
    ) then
    raise exception using errcode = '22023', message = 'attendance_schedule_message_mismatch';
  end if;

  update public.attendance_occurrence_mappings
  set desired_state = 'cancelled', updated_at = clock_timestamp()
  where classroom_id = p_classroom_id
    and class_date between v_window_start and v_window_end;

  update public.attendance_occurrence_mappings mapping
  set opens_at = occurrence.opens_at,
      closes_at = occurrence.closes_at,
      desired_state = 'scheduled',
      source_revision = v_revision,
      updated_at = clock_timestamp()
  from jsonb_to_recordset(p_message->'occurrences') as occurrence(
    occurrence_ref text, date date, opens_at timestamptz, closes_at timestamptz
  )
  where mapping.classroom_id = p_classroom_id
    and mapping.class_date = occurrence.date
    and mapping.occurrence_ref = occurrence.occurrence_ref;

  select * into v_outbox from public.enqueue_attendance_outbound_message_v1(
    p_classroom_id, p_message
  );
  update public.attendance_roster_mappings
  set schedule_source_token = p_source_token,
      schedule_source_revision = v_revision,
      schedule_staged_revision = v_revision,
      updated_at = clock_timestamp()
  where classroom_id = p_classroom_id;

  return jsonb_build_object(
    'outbox_id', v_outbox.id,
    'idempotency_key', v_outbox.idempotency_key,
    'revision', v_revision,
    'status', v_outbox.status
  );
end;
$$;

create function public.claim_attendance_outbound_message_v1(
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
  if p_idempotency_key !~ '^[A-Za-z0-9._~:-]{1,200}$'
    or p_lease_seconds not between 10 and 600 then
    raise exception using errcode = '22023', message = 'attendance_outbox_claim_invalid';
  end if;

  update public.attendance_integration_outbox
  set status = 'processing',
      attempts = attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      last_attempt_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where idempotency_key = p_idempotency_key
    and (
      (status = 'pending' and next_attempt_at <= clock_timestamp())
      or (status = 'processing' and lease_expires_at <= clock_timestamp())
    )
  returning * into v_row;

  return v_row;
end;
$$;

create function public.claim_attendance_outbox_batch_v1(
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
    select id
    from public.attendance_integration_outbox
    where (status = 'pending' and next_attempt_at <= clock_timestamp())
       or (status = 'processing' and lease_expires_at <= clock_timestamp())
    order by next_attempt_at, created_at
    limit p_limit
    for update skip locked
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

create function public.complete_attendance_outbox_v1(
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
        updated_at = clock_timestamp()
    where classroom_id = v_row.classroom_id;
  end if;
  return true;
end;
$$;

create function public.retry_attendance_outbox_v1(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_next_attempt_at timestamptz,
  p_error_code text,
  p_error_detail text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.attendance_integration_outbox
  set status = 'pending',
      next_attempt_at = greatest(p_next_attempt_at, clock_timestamp()),
      lease_token = null,
      lease_expires_at = null,
      last_error_code = left(nullif(p_error_code, ''), 100),
      last_error_detail = left(nullif(p_error_detail, ''), 500),
      updated_at = clock_timestamp()
  where id = p_outbox_id and status = 'processing' and lease_token = p_lease_token;
  return found;
end;
$$;

create function public.fail_attendance_outbox_v1(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_detail text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.attendance_integration_outbox
  set status = 'non_retryable',
      lease_token = null,
      lease_expires_at = null,
      last_error_code = left(nullif(p_error_code, ''), 100),
      last_error_detail = left(nullif(p_error_detail, ''), 500),
      updated_at = clock_timestamp()
  where id = p_outbox_id and status = 'processing' and lease_token = p_lease_token;
  return found;
end;
$$;

-- Aggregate-only operator health. No classroom, user, contract, payload, or
-- provider details cross this boundary.
create function public.attendance_outbox_health_v1()
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
  )
  from public.attendance_integration_outbox;
$$;

revoke all on function public.enqueue_attendance_outbound_message_v1(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.stage_attendance_roster_snapshot_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.stage_attendance_schedule_snapshot_v1(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_attendance_outbound_message_v1(text, integer)
  from public, anon, authenticated;
revoke all on function public.claim_attendance_outbox_batch_v1(integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_attendance_outbox_v1(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.retry_attendance_outbox_v1(uuid, uuid, timestamptz, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_attendance_outbox_v1(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.attendance_outbox_health_v1()
  from public, anon, authenticated;

grant execute on function public.enqueue_attendance_outbound_message_v1(uuid, jsonb)
  to service_role;
grant execute on function public.stage_attendance_roster_snapshot_v1(uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.stage_attendance_schedule_snapshot_v1(uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.claim_attendance_outbound_message_v1(text, integer)
  to service_role;
grant execute on function public.claim_attendance_outbox_batch_v1(integer, integer)
  to service_role;
grant execute on function public.complete_attendance_outbox_v1(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.retry_attendance_outbox_v1(uuid, uuid, timestamptz, text, text)
  to service_role;
grant execute on function public.fail_attendance_outbox_v1(uuid, uuid, text, text)
  to service_role;
grant execute on function public.attendance_outbox_health_v1()
  to service_role;

create function public.attendance_event_v1_valid(p_event jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_event) = 'object'
    and pg_column_size(p_event) <= 32768
    and p_event ?& array[
      'schema_version', 'event_id', 'idempotency_key', 'correlation_ref',
      'event_type', 'occurred_at', 'installation_ref', 'roster_ref',
      'occurrence_ref', 'session_revision', 'metadata'
    ]
    and not exists (
      select 1
      from jsonb_object_keys(p_event) key
      where key not in (
        'schema_version', 'event_id', 'idempotency_key', 'correlation_ref',
        'event_type', 'occurred_at', 'installation_ref', 'roster_ref',
        'occurrence_ref', 'session_revision', 'metadata'
      )
    )
    and p_event->>'schema_version' = '1'
    and p_event->>'event_id' ~ '^[A-Za-z0-9._~-]{1,128}$'
    and p_event->>'idempotency_key' ~ '^[A-Za-z0-9._~:-]{1,200}$'
    and p_event->>'correlation_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
    and p_event->>'installation_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
    and p_event->>'roster_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
    and p_event->>'occurrence_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
    and p_event->>'occurred_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
    and jsonb_typeof(p_event->'session_revision') = 'number'
    and case when (p_event->>'session_revision') ~ '^[1-9][0-9]*$'
      then (p_event->>'session_revision')::numeric <= 9007199254740991
      else false
    end
    and p_event->>'event_type' in (
      'attendance.session.scheduled',
      'attendance.session.opened',
      'attendance.session.closed',
      'attendance.session.cancelled',
      'attendance.record.changed'
    )
    and jsonb_typeof(p_event->'metadata') = 'object'
    and case p_event->>'event_type'
      when 'attendance.session.scheduled' then
        (p_event->'metadata') ?& array['opens_at', 'closes_at']
        and p_event->'metadata'->>'opens_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
        and p_event->'metadata'->>'closes_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
        and not exists (
          select 1 from jsonb_object_keys(p_event->'metadata') key
          where key not in ('opens_at', 'closes_at')
        )
      when 'attendance.session.opened' then
        (p_event->'metadata') ?& array['opened_at', 'trigger']
        and p_event->'metadata'->>'opened_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
        and p_event->'metadata'->>'trigger' in ('schedule', 'staff')
        and not exists (
          select 1 from jsonb_object_keys(p_event->'metadata') key
          where key not in ('opened_at', 'trigger')
        )
      when 'attendance.session.closed' then
        (p_event->'metadata') ?& array['closed_at', 'trigger']
        and p_event->'metadata'->>'closed_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
        and p_event->'metadata'->>'trigger' in ('schedule', 'staff')
        and not exists (
          select 1 from jsonb_object_keys(p_event->'metadata') key
          where key not in ('closed_at', 'trigger')
        )
      when 'attendance.session.cancelled' then
        (p_event->'metadata') ?& array['cancelled_at', 'reason_code']
        and p_event->'metadata'->>'cancelled_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
        and p_event->'metadata'->>'reason_code' in (
          'schedule_removed', 'staff_cancelled', 'missed_window', 'automation_failed'
        )
        and not exists (
          select 1 from jsonb_object_keys(p_event->'metadata') key
          where key not in ('cancelled_at', 'reason_code')
        )
      when 'attendance.record.changed' then
        (p_event->'metadata') ?& array[
          'participant_ref', 'record_revision', 'from_status', 'to_status',
          'source', 'actor_type'
        ]
        and p_event->'metadata'->>'participant_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
        and jsonb_typeof(p_event->'metadata'->'record_revision') = 'number'
        and case when p_event->'metadata'->>'record_revision' ~ '^[1-9][0-9]*$'
          then (p_event->'metadata'->>'record_revision')::numeric <= 9007199254740991
          else false
        end
        and p_event->'metadata'->>'from_status' in ('unmarked', 'present', 'late', 'absent')
        and p_event->'metadata'->>'to_status' in ('unmarked', 'present', 'late', 'absent')
        and p_event->'metadata'->>'source' in ('student_qr', 'staff_manual', 'system_finalize')
        and p_event->'metadata'->>'actor_type' in ('student', 'staff', 'system')
        and (
          not (p_event->'metadata' ? 'reason_code')
          or p_event->'metadata'->>'reason_code' ~ '^[A-Za-z0-9._~-]{1,128}$'
        )
        and not exists (
          select 1 from jsonb_object_keys(p_event->'metadata') key
          where key not in (
            'participant_ref', 'record_revision', 'from_status', 'to_status',
            'source', 'actor_type', 'reason_code'
          )
        )
      else false
    end,
    false
  )
$$;

create table public.attendance_integration_inbox (
  id uuid primary key default gen_random_uuid(),
  installation_ref text not null,
  transport_nonce text not null,
  event_id text not null,
  idempotency_key text not null,
  correlation_ref text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  roster_ref text not null,
  occurrence_ref text not null,
  session_revision bigint not null,
  payload jsonb not null,
  projection_applied boolean not null default false,
  received_at timestamptz not null default clock_timestamp(),
  unique (installation_ref, event_id),
  unique (installation_ref, transport_nonce),
  check (public.attendance_event_v1_valid(payload))
);

create table public.attendance_session_projection (
  id uuid primary key default gen_random_uuid(),
  installation_ref text not null,
  roster_ref text not null,
  occurrence_ref text not null,
  session_revision bigint not null,
  status text not null check (status in ('scheduled', 'open', 'closed', 'cancelled')),
  opens_at timestamptz,
  closes_at timestamptz,
  last_event_id text not null,
  last_event_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  unique (installation_ref, occurrence_ref)
);

create table public.attendance_record_projection (
  id uuid primary key default gen_random_uuid(),
  installation_ref text not null,
  roster_ref text not null,
  occurrence_ref text not null,
  participant_ref text not null,
  record_revision bigint not null,
  status text not null check (status in ('unmarked', 'present', 'late', 'absent')),
  source text not null check (source in ('student_qr', 'staff_manual', 'system_finalize')),
  actor_type text not null check (actor_type in ('student', 'staff', 'system')),
  reason_code text,
  last_event_id text not null,
  last_event_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  unique (installation_ref, occurrence_ref, participant_ref)
);

create index attendance_integration_inbox_received
  on public.attendance_integration_inbox (received_at desc);
create index attendance_session_projection_roster
  on public.attendance_session_projection (installation_ref, roster_ref, updated_at desc);
create index attendance_record_projection_occurrence
  on public.attendance_record_projection (installation_ref, occurrence_ref, updated_at desc);

alter table public.attendance_integration_inbox enable row level security;
alter table public.attendance_session_projection enable row level security;
alter table public.attendance_record_projection enable row level security;

revoke all on function public.attendance_event_v1_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on table public.attendance_integration_inbox
  from public, anon, authenticated, service_role;
revoke all on table public.attendance_session_projection
  from public, anon, authenticated, service_role;
revoke all on table public.attendance_record_projection
  from public, anon, authenticated, service_role;
grant select on table public.attendance_integration_inbox to service_role;
grant select on table public.attendance_session_projection to service_role;
grant select on table public.attendance_record_projection to service_role;

create function public.apply_attendance_event_v1(
  p_event jsonb,
  p_transport_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inbox_id uuid;
  v_projection_rows integer := 0;
begin
  if not public.attendance_event_v1_valid(p_event)
    or p_transport_nonce !~ '^[A-Za-z0-9._~-]{16,128}$' then
    raise exception using errcode = '22023', message = 'attendance_event_invalid';
  end if;

  if not exists (
    select 1
    from public.attendance_occurrence_mappings occurrence
    join public.attendance_roster_mappings roster
      on roster.classroom_id = occurrence.classroom_id
    where occurrence.occurrence_ref = p_event->>'occurrence_ref'
      and roster.roster_ref = p_event->>'roster_ref'
  ) then
    raise exception using errcode = '23514', message = 'attendance_event_mapping_mismatch';
  end if;

  if p_event->>'event_type' = 'attendance.record.changed'
    and not exists (
      select 1
      from public.attendance_participant_mappings participant
      join public.attendance_occurrence_mappings occurrence
        on occurrence.classroom_id = participant.classroom_id
      where occurrence.occurrence_ref = p_event->>'occurrence_ref'
        and participant.participant_ref = p_event->'metadata'->>'participant_ref'
    ) then
    raise exception using errcode = '23514', message = 'attendance_event_participant_mismatch';
  end if;

  insert into public.attendance_integration_inbox (
    installation_ref,
    transport_nonce,
    event_id,
    idempotency_key,
    correlation_ref,
    event_type,
    occurred_at,
    roster_ref,
    occurrence_ref,
    session_revision,
    payload
  ) values (
    p_event->>'installation_ref',
    p_transport_nonce,
    p_event->>'event_id',
    p_event->>'idempotency_key',
    p_event->>'correlation_ref',
    p_event->>'event_type',
    (p_event->>'occurred_at')::timestamptz,
    p_event->>'roster_ref',
    p_event->>'occurrence_ref',
    (p_event->>'session_revision')::bigint,
    p_event
  )
  on conflict do nothing
  returning id into v_inbox_id;

  if v_inbox_id is null then
    if exists (
      select 1 from public.attendance_integration_inbox
      where installation_ref = p_event->>'installation_ref'
        and event_id = p_event->>'event_id'
        and payload = p_event
    ) then
      return jsonb_build_object(
        'accepted', true,
        'duplicate', true,
        'projection_applied', false
      );
    end if;
    raise exception using errcode = '23505', message = 'attendance_event_replay_conflict';
  end if;

  if p_event->>'event_type' in (
    'attendance.session.scheduled',
    'attendance.session.opened',
    'attendance.session.closed',
    'attendance.session.cancelled'
  ) then
    insert into public.attendance_session_projection (
      installation_ref,
      roster_ref,
      occurrence_ref,
      session_revision,
      status,
      opens_at,
      closes_at,
      last_event_id,
      last_event_at
    ) values (
      p_event->>'installation_ref',
      p_event->>'roster_ref',
      p_event->>'occurrence_ref',
      (p_event->>'session_revision')::bigint,
      case p_event->>'event_type'
        when 'attendance.session.scheduled' then 'scheduled'
        when 'attendance.session.opened' then 'open'
        when 'attendance.session.closed' then 'closed'
        else 'cancelled'
      end,
      case when p_event->>'event_type' = 'attendance.session.scheduled'
        then (p_event->'metadata'->>'opens_at')::timestamptz end,
      case when p_event->>'event_type' = 'attendance.session.scheduled'
        then (p_event->'metadata'->>'closes_at')::timestamptz end,
      p_event->>'event_id',
      (p_event->>'occurred_at')::timestamptz
    )
    on conflict (installation_ref, occurrence_ref) do update
      set roster_ref = excluded.roster_ref,
          session_revision = excluded.session_revision,
          status = excluded.status,
          opens_at = coalesce(excluded.opens_at, public.attendance_session_projection.opens_at),
          closes_at = coalesce(excluded.closes_at, public.attendance_session_projection.closes_at),
          last_event_id = excluded.last_event_id,
          last_event_at = excluded.last_event_at,
          updated_at = clock_timestamp()
      where excluded.session_revision > public.attendance_session_projection.session_revision;
    get diagnostics v_projection_rows = row_count;
  elsif p_event->>'event_type' = 'attendance.record.changed' then
    insert into public.attendance_record_projection (
      installation_ref,
      roster_ref,
      occurrence_ref,
      participant_ref,
      record_revision,
      status,
      source,
      actor_type,
      reason_code,
      last_event_id,
      last_event_at
    ) values (
      p_event->>'installation_ref',
      p_event->>'roster_ref',
      p_event->>'occurrence_ref',
      p_event->'metadata'->>'participant_ref',
      (p_event->'metadata'->>'record_revision')::bigint,
      p_event->'metadata'->>'to_status',
      p_event->'metadata'->>'source',
      p_event->'metadata'->>'actor_type',
      p_event->'metadata'->>'reason_code',
      p_event->>'event_id',
      (p_event->>'occurred_at')::timestamptz
    )
    on conflict (installation_ref, occurrence_ref, participant_ref) do update
      set roster_ref = excluded.roster_ref,
          record_revision = excluded.record_revision,
          status = excluded.status,
          source = excluded.source,
          actor_type = excluded.actor_type,
          reason_code = excluded.reason_code,
          last_event_id = excluded.last_event_id,
          last_event_at = excluded.last_event_at,
          updated_at = clock_timestamp()
      where excluded.record_revision > public.attendance_record_projection.record_revision;
    get diagnostics v_projection_rows = row_count;
  end if;

  update public.attendance_integration_inbox
  set projection_applied = v_projection_rows > 0
  where id = v_inbox_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'projection_applied', v_projection_rows > 0
  );
end;
$$;

revoke all on function public.apply_attendance_event_v1(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.apply_attendance_event_v1(jsonb, text)
  to service_role;

create function public.attendance_session_snapshot_v1_valid(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p_snapshot) = 'object'
    and pg_column_size(p_snapshot) <= 131072
    and p_snapshot ?& array[
      'schema_version', 'occurrence_ref', 'roster_ref', 'session_revision',
      'status', 'opens_at', 'closes_at', 'records'
    ]
    and not exists (
      select 1 from jsonb_object_keys(p_snapshot) key
      where key not in (
        'schema_version', 'occurrence_ref', 'roster_ref', 'session_revision',
        'status', 'opens_at', 'closes_at', 'records'
      )
    )
    and p_snapshot->>'schema_version' = '1'
    and p_snapshot->>'occurrence_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
    and p_snapshot->>'roster_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
    and jsonb_typeof(p_snapshot->'session_revision') = 'number'
    and case when p_snapshot->>'session_revision' ~ '^[1-9][0-9]*$'
      then (p_snapshot->>'session_revision')::numeric <= 9007199254740991
      else false
    end
    and p_snapshot->>'status' in ('scheduled', 'open', 'closed', 'cancelled')
    and p_snapshot->>'opens_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
    and p_snapshot->>'closes_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
    and case when jsonb_typeof(p_snapshot->'records') = 'array' then
      jsonb_array_length(p_snapshot->'records') <= 1000
      and not exists (
        select 1
        from jsonb_array_elements(p_snapshot->'records') record
        where jsonb_typeof(record) <> 'object'
          or not (record ?& array[
            'participant_ref', 'record_revision', 'status', 'source',
            'actor_type', 'modified_at'
          ])
          or exists (
            select 1 from jsonb_object_keys(record) key
            where key not in (
              'participant_ref', 'record_revision', 'status', 'source',
              'actor_type', 'modified_at'
            )
          )
          or record->>'participant_ref' !~ '^[A-Za-z0-9._~-]{1,128}$'
          or jsonb_typeof(record->'record_revision') <> 'number'
          or case when record->>'record_revision' ~ '^[1-9][0-9]*$'
            then (record->>'record_revision')::numeric > 9007199254740991
            else true
          end
          or record->>'status' not in ('unmarked', 'present', 'late', 'absent')
          or record->>'source' not in ('student_qr', 'staff_manual', 'system_finalize')
          or record->>'actor_type' not in ('student', 'staff', 'system')
          or (record->>'source' = 'student_qr' and record->>'actor_type' <> 'student')
          or (record->>'source' = 'staff_manual' and record->>'actor_type' <> 'staff')
          or (record->>'source' = 'system_finalize' and record->>'actor_type' <> 'system')
          or record->>'modified_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
      )
      and not exists (
        select 1
        from jsonb_array_elements(p_snapshot->'records') record
        group by record->>'participant_ref'
        having count(*) > 1
      )
    else false end,
    false
  )
$$;

create function public.apply_attendance_session_snapshot_v1(
  p_installation_ref text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record jsonb;
  v_session_rows integer := 0;
  v_record_rows integer := 0;
  v_current_rows integer := 0;
begin
  if p_installation_ref !~ '^[A-Za-z0-9._~-]{1,128}$'
    or not public.attendance_session_snapshot_v1_valid(p_snapshot) then
    raise exception using errcode = '22023', message = 'attendance_snapshot_invalid';
  end if;

  if not exists (
    select 1
    from public.attendance_occurrence_mappings occurrence
    join public.attendance_roster_mappings roster
      on roster.classroom_id = occurrence.classroom_id
    where occurrence.occurrence_ref = p_snapshot->>'occurrence_ref'
      and roster.roster_ref = p_snapshot->>'roster_ref'
      and occurrence.desired_state = 'scheduled'
      and occurrence.opens_at = (p_snapshot->>'opens_at')::timestamptz
      and occurrence.closes_at = (p_snapshot->>'closes_at')::timestamptz
  ) then
    raise exception using errcode = '23514', message = 'attendance_snapshot_mapping_mismatch';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_snapshot->'records') record
    where not exists (
      select 1
      from public.attendance_participant_mappings participant
      join public.attendance_occurrence_mappings occurrence
        on occurrence.classroom_id = participant.classroom_id
      where occurrence.occurrence_ref = p_snapshot->>'occurrence_ref'
        and participant.participant_ref = record->>'participant_ref'
    )
  ) then
    raise exception using errcode = '23514', message = 'attendance_snapshot_participant_mismatch';
  end if;

  insert into public.attendance_session_projection (
    installation_ref,
    roster_ref,
    occurrence_ref,
    session_revision,
    status,
    opens_at,
    closes_at,
    last_event_id,
    last_event_at
  ) values (
    p_installation_ref,
    p_snapshot->>'roster_ref',
    p_snapshot->>'occurrence_ref',
    (p_snapshot->>'session_revision')::bigint,
    p_snapshot->>'status',
    (p_snapshot->>'opens_at')::timestamptz,
    (p_snapshot->>'closes_at')::timestamptz,
    'reconcile:' || (p_snapshot->>'occurrence_ref') || ':' ||
      (p_snapshot->>'session_revision'),
    clock_timestamp()
  )
  on conflict (installation_ref, occurrence_ref) do update
    set roster_ref = excluded.roster_ref,
        session_revision = excluded.session_revision,
        status = excluded.status,
        opens_at = excluded.opens_at,
        closes_at = excluded.closes_at,
        last_event_id = excluded.last_event_id,
        last_event_at = excluded.last_event_at,
        updated_at = clock_timestamp()
    where excluded.session_revision > public.attendance_session_projection.session_revision;
  get diagnostics v_session_rows = row_count;

  for v_record in select value from jsonb_array_elements(p_snapshot->'records') loop
    insert into public.attendance_record_projection (
      installation_ref,
      roster_ref,
      occurrence_ref,
      participant_ref,
      record_revision,
      status,
      source,
      actor_type,
      reason_code,
      last_event_id,
      last_event_at
    ) values (
      p_installation_ref,
      p_snapshot->>'roster_ref',
      p_snapshot->>'occurrence_ref',
      v_record->>'participant_ref',
      (v_record->>'record_revision')::bigint,
      v_record->>'status',
      v_record->>'source',
      v_record->>'actor_type',
      null,
      'reconcile:' || (p_snapshot->>'occurrence_ref') || ':' ||
        (v_record->>'participant_ref') || ':' || (v_record->>'record_revision'),
      (v_record->>'modified_at')::timestamptz
    )
    on conflict (installation_ref, occurrence_ref, participant_ref) do update
      set roster_ref = excluded.roster_ref,
          record_revision = excluded.record_revision,
          status = excluded.status,
          source = excluded.source,
          actor_type = excluded.actor_type,
          reason_code = excluded.reason_code,
          last_event_id = excluded.last_event_id,
          last_event_at = excluded.last_event_at,
          updated_at = clock_timestamp()
      where excluded.record_revision > public.attendance_record_projection.record_revision;
    get diagnostics v_current_rows = row_count;
    v_record_rows := v_record_rows + v_current_rows;
  end loop;

  update public.attendance_occurrence_mappings
  set last_reconciled_at = clock_timestamp()
  where occurrence_ref = p_snapshot->>'occurrence_ref';

  return jsonb_build_object(
    'applied', true,
    'session_projection_applied', v_session_rows > 0,
    'record_projection_count', v_record_rows
  );
end;
$$;

revoke all on function public.attendance_session_snapshot_v1_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_attendance_session_snapshot_v1(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_attendance_session_snapshot_v1(text, jsonb)
  to service_role;
