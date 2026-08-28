-- Pika owns attendance timing policy and status. Bara owns only QR acceptance
-- gating plus immutable accepted/invalidated check-in timestamps.

-- This integration is pre-release. Obsolete provider-owned status commands
-- cannot be replayed against the timestamp-only contract.
do $$
begin
  if exists (
    select 1 from public.attendance_record_projection
    where source = 'student_qr'
  ) then
    raise exception using
      errcode = '55000',
      message = 'attendance_timing_cutover_requires_empty_legacy_qr_projection';
  end if;
end;
$$;

delete from public.attendance_integration_outbox
where message_type = 'attendance.marks';
alter table public.attendance_integration_outbox
  drop constraint attendance_integration_outbox_message_type_check;
alter table public.attendance_integration_outbox
  add constraint attendance_integration_outbox_message_type_check check (
    message_type in (
      'roster.snapshot', 'schedule.snapshot', 'session.command', 'check_in.invalidate'
    )
  );

alter table public.attendance_window_policies
  add column entry_opens_minutes_before integer not null default 10
    check (entry_opens_minutes_before between 0 and 720),
  add column present_grace_minutes integer not null default 5
    check (present_grace_minutes between 0 and 720),
  add column entry_closes_minutes_before_end integer not null default 10
    check (entry_closes_minutes_before_end between 0 and 720),
  add column absent_minutes_before_end integer not null default 0
    check (absent_minutes_before_end between 0 and 720);

-- Legacy windows could be shorter than the new 15-minute default split. Keep
-- every previously valid positive window migratable by shrinking the close
-- lead first and then the Present grace, while retaining the proposed defaults
-- for normal-length and newly-created sessions.
with durations as (
  select classroom_id, greatest(
    1,
    floor(extract(epoch from (closes_local - opens_local)) / 60
      + close_day_offset * 1440)::integer
  ) as duration_minutes
  from public.attendance_window_policies
)
update public.attendance_window_policies policy
set entry_closes_minutes_before_end = least(10, durations.duration_minutes - 1),
    present_grace_minutes = least(
      5,
      durations.duration_minutes
        - least(10, durations.duration_minutes - 1)
        - 1
    )
from durations
where durations.classroom_id = policy.classroom_id;

alter table public.attendance_window_policies
  add constraint attendance_window_policy_timing_order check (
    present_grace_minutes <
      extract(epoch from (closes_local - opens_local)) / 60
      + close_day_offset * 1440
      - entry_closes_minutes_before_end
    and entry_closes_minutes_before_end >= absent_minutes_before_end
  );

alter table public.attendance_occurrence_mappings
  add column session_starts_at timestamptz,
  add column session_ends_at timestamptz,
  add column present_through_at timestamptz,
  add column absent_at timestamptz,
  add column policy_revision bigint check (policy_revision is null or policy_revision > 0),
  add column policy_frozen_at timestamptz;

-- Preserve the currently scheduled acceptance interval while giving any
-- pre-release occurrence the agreed default policy snapshot.
update public.attendance_occurrence_mappings
set session_starts_at = greatest(
      opens_at,
      least(opens_at + interval '10 minutes', closes_at - interval '1 minute')
    ),
    session_ends_at = closes_at + interval '10 minutes',
    present_through_at = greatest(
      opens_at,
      least(opens_at + interval '15 minutes', closes_at - interval '1 minute')
    ),
    absent_at = closes_at + interval '10 minutes',
    policy_revision = 1
where opens_at is not null and closes_at is not null;

alter table public.attendance_occurrence_mappings
  add constraint attendance_occurrence_cutoff_order check (
    (session_starts_at is null and session_ends_at is null
      and present_through_at is null and absent_at is null and policy_revision is null)
    or (
      opens_at is not null and closes_at is not null
      and session_starts_at is not null and session_ends_at is not null
      and present_through_at is not null and absent_at is not null
      and policy_revision is not null
      and opens_at <= session_starts_at
      and session_starts_at <= present_through_at
      and present_through_at < closes_at
      and closes_at <= absent_at
      and absent_at <= session_ends_at
    )
  );

create table public.attendance_check_in_facts (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  installation_ref text not null,
  roster_ref text not null,
  occurrence_ref text not null,
  participant_ref text not null,
  check_in_ref text not null,
  check_in_revision bigint not null check (check_in_revision > 0),
  accepted_at timestamptz not null,
  invalidated_at timestamptz,
  reason_code text,
  last_event_id text,
  last_event_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (installation_ref, check_in_ref),
  check (invalidated_at is null or invalidated_at >= accepted_at),
  check (check_in_ref ~ '^[A-Za-z0-9._~-]{1,128}$'),
  check (participant_ref ~ '^[A-Za-z0-9._~-]{1,128}$')
);

create index attendance_check_in_facts_active_participant
  on public.attendance_check_in_facts (installation_ref, occurrence_ref, participant_ref)
  where invalidated_at is null;
create index attendance_check_in_facts_occurrence
  on public.attendance_check_in_facts (installation_ref, occurrence_ref, accepted_at);
create index attendance_check_in_facts_classroom_student
  on public.attendance_check_in_facts (classroom_id, student_id, accepted_at desc);

create table public.attendance_status_overrides (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  occurrence_ref text not null,
  status text check (status in ('present', 'late', 'absent')),
  active boolean not null,
  revision bigint not null default 1 check (revision > 0),
  reason_code text,
  updated_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (classroom_id, occurrence_ref, student_id),
  check ((active and status is not null) or (not active and status is null))
);

create table public.attendance_status_override_events (
  id uuid primary key default gen_random_uuid(),
  override_id uuid not null references public.attendance_status_overrides (id) on delete cascade,
  request_id uuid not null,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.users (id) on delete cascade,
  occurrence_ref text not null,
  revision bigint not null check (revision > 0),
  action text not null check (action in ('set', 'undo')),
  status text check (status in ('present', 'late', 'absent')),
  reason_code text,
  actor_user_id uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (request_id, student_id),
  check ((action = 'set' and status is not null) or (action = 'undo' and status is null))
);

create table public.attendance_override_requests (
  request_id uuid primary key,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  request_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

create or replace function public.attendance_classroom_has_state_v1(p_classroom_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    exists (select 1 from public.attendance_roster_mappings where classroom_id = p_classroom_id)
    or exists (select 1 from public.attendance_participant_mappings where classroom_id = p_classroom_id)
    or exists (select 1 from public.attendance_occurrence_mappings where classroom_id = p_classroom_id)
    or exists (select 1 from public.attendance_window_policies where classroom_id = p_classroom_id)
    or exists (select 1 from public.attendance_integration_outbox where classroom_id = p_classroom_id)
    or exists (select 1 from public.attendance_integration_inbox where classroom_id = p_classroom_id)
    or exists (select 1 from public.attendance_session_projection where classroom_id = p_classroom_id)
    or exists (select 1 from public.attendance_record_projection where classroom_id = p_classroom_id)
    or exists (select 1 from public.attendance_check_in_facts where classroom_id = p_classroom_id)
    or exists (select 1 from public.attendance_status_overrides where classroom_id = p_classroom_id)
    or exists (select 1 from public.attendance_status_override_events where classroom_id = p_classroom_id)
    or exists (select 1 from public.attendance_override_requests where classroom_id = p_classroom_id)
$$;

create or replace function public.attendance_student_has_state_v1(
  p_classroom_id uuid,
  p_student_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    exists (select 1 from public.attendance_participant_mappings
      where classroom_id = p_classroom_id and student_id = p_student_id)
    or exists (select 1 from public.attendance_record_projection
      where classroom_id = p_classroom_id and student_id = p_student_id)
    or exists (select 1 from public.attendance_check_in_facts
      where classroom_id = p_classroom_id and student_id = p_student_id)
    or exists (select 1 from public.attendance_status_overrides
      where classroom_id = p_classroom_id and student_id = p_student_id)
    or exists (select 1 from public.attendance_status_override_events
      where classroom_id = p_classroom_id and student_id = p_student_id)
$$;

alter table public.attendance_check_in_facts enable row level security;
alter table public.attendance_status_overrides enable row level security;
alter table public.attendance_status_override_events enable row level security;
alter table public.attendance_override_requests enable row level security;

revoke all on table public.attendance_check_in_facts,
  public.attendance_status_overrides,
  public.attendance_status_override_events,
  public.attendance_override_requests
  from public, anon, authenticated, service_role;
grant select on table public.attendance_check_in_facts to service_role;
grant select, insert, update on table public.attendance_status_overrides to service_role;
grant select, insert on table public.attendance_status_override_events to service_role;
grant select, insert on table public.attendance_override_requests to service_role;

create function public.upsert_attendance_timing_policy_v1(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_session_starts_local time without time zone,
  p_session_ends_local time without time zone,
  p_session_end_day_offset smallint,
  p_entry_opens_minutes_before integer,
  p_present_grace_minutes integer,
  p_entry_closes_minutes_before_end integer,
  p_absent_minutes_before_end integer,
  p_enabled boolean,
  p_expected_revision bigint default null,
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_policy public.attendance_window_policies%rowtype;
  v_duration_minutes numeric;
begin
  v_duration_minutes := extract(epoch from (p_session_ends_local - p_session_starts_local)) / 60
    + p_session_end_day_offset * 1440;
  if p_teacher_id is null or p_classroom_id is null
    or p_session_starts_local is null or p_session_ends_local is null
    or p_session_end_day_offset not in (0, 1)
    or p_entry_opens_minutes_before is null
    or p_present_grace_minutes is null
    or p_entry_closes_minutes_before_end is null
    or p_absent_minutes_before_end is null
    or p_enabled is null or p_at is null
    or p_entry_opens_minutes_before not between 0 and 720
    or p_present_grace_minutes not between 0 and 720
    or p_entry_closes_minutes_before_end not between 0 and 720
    or p_absent_minutes_before_end not between 0 and 720
    or p_present_grace_minutes >= v_duration_minutes - p_entry_closes_minutes_before_end
    or p_entry_closes_minutes_before_end < p_absent_minutes_before_end then
    raise exception using errcode = '22023', message = 'attendance_policy_timing_invalid';
  end if;
  if not public.attendance_teacher_entitled_v1(p_teacher_id, p_at) then
    raise exception using errcode = '42501', message = 'attendance_classroom_not_entitled';
  end if;

  v_result := public.upsert_attendance_window_policy_v1(
    p_teacher_id, p_classroom_id, p_session_starts_local, p_session_ends_local,
    p_session_end_day_offset, p_enabled, p_expected_revision
  );

  update public.attendance_window_policies
  set entry_opens_minutes_before = p_entry_opens_minutes_before,
      present_grace_minutes = p_present_grace_minutes,
      entry_closes_minutes_before_end = p_entry_closes_minutes_before_end,
      absent_minutes_before_end = p_absent_minutes_before_end
  where classroom_id = p_classroom_id
  returning * into v_policy;

  return jsonb_build_object(
    'classroom_id', v_policy.classroom_id,
    'timezone', v_policy.timezone,
    'session_starts_local', to_char(v_policy.opens_local, 'HH24:MI'),
    'session_ends_local', to_char(v_policy.closes_local, 'HH24:MI'),
    'session_end_day_offset', v_policy.close_day_offset,
    'entry_opens_minutes_before', v_policy.entry_opens_minutes_before,
    'present_grace_minutes', v_policy.present_grace_minutes,
    'entry_closes_minutes_before_end', v_policy.entry_closes_minutes_before_end,
    'absent_minutes_before_end', v_policy.absent_minutes_before_end,
    'enabled', v_policy.enabled,
    'revision', v_policy.policy_revision,
    'updated_at', v_policy.updated_at
  );
end;
$$;

create or replace function public.attendance_session_snapshot_v1_valid(p_snapshot jsonb)
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
      'status', 'accepts_at', 'stops_accepting_at', 'check_ins'
    ]
    and not exists (
      select 1 from jsonb_object_keys(p_snapshot) key
      where key not in (
        'schema_version', 'occurrence_ref', 'roster_ref', 'session_revision',
        'status', 'accepts_at', 'stops_accepting_at', 'check_ins'
      )
    )
    and p_snapshot->>'schema_version' = '1'
    and p_snapshot->>'occurrence_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
    and p_snapshot->>'roster_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
    and p_snapshot->>'session_revision' ~ '^[1-9][0-9]*$'
    and p_snapshot->>'status' in ('scheduled', 'open', 'closed', 'cancelled')
    and p_snapshot->>'accepts_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
    and p_snapshot->>'stops_accepting_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
    and (p_snapshot->>'accepts_at')::timestamptz
      < (p_snapshot->>'stops_accepting_at')::timestamptz
    and case when jsonb_typeof(p_snapshot->'check_ins') = 'array' then
      jsonb_array_length(p_snapshot->'check_ins') <= 1000
      and not exists (
        select 1 from jsonb_array_elements(p_snapshot->'check_ins') check_in
        where jsonb_typeof(check_in) <> 'object'
          or not (check_in ?& array[
            'check_in_ref', 'participant_ref', 'check_in_revision', 'accepted_at'
          ])
          or exists (
            select 1 from jsonb_object_keys(check_in) key
            where key not in (
              'check_in_ref', 'participant_ref', 'check_in_revision',
              'accepted_at', 'invalidated_at', 'reason_code'
            )
          )
          or check_in->>'check_in_ref' !~ '^[A-Za-z0-9._~-]{1,128}$'
          or check_in->>'participant_ref' !~ '^[A-Za-z0-9._~-]{1,128}$'
          or check_in->>'check_in_revision' !~ '^[1-9][0-9]*$'
          or check_in->>'accepted_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
          or (check_in ? 'invalidated_at' and check_in->>'invalidated_at'
            !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$')
          or (check_in ? 'invalidated_at'
            and (check_in->>'invalidated_at')::timestamptz
              < (check_in->>'accepted_at')::timestamptz)
          or (check_in ? 'reason_code' and check_in->>'reason_code'
            !~ '^[A-Za-z0-9._~-]{1,128}$')
      )
      and not exists (
        select 1 from jsonb_array_elements(p_snapshot->'check_ins') check_in
        group by check_in->>'check_in_ref' having count(*) > 1
      )
    else false end,
    false
  );
$$;

create or replace function public.apply_attendance_session_snapshot_v1(
  p_installation_ref text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check_in jsonb;
  v_classroom_id uuid;
  v_student_id uuid;
  v_existing_check_in public.attendance_check_in_facts%rowtype;
  v_incoming_revision bigint;
  v_incoming_invalidated_at timestamptz;
  v_session_rows integer := 0;
  v_check_in_rows integer := 0;
  v_current_rows integer := 0;
begin
  if p_installation_ref !~ '^[A-Za-z0-9._~-]{1,128}$'
    or not public.attendance_session_snapshot_v1_valid(p_snapshot) then
    raise exception using errcode = '22023', message = 'attendance_snapshot_invalid';
  end if;

  select occurrence.classroom_id into v_classroom_id
  from public.attendance_occurrence_mappings occurrence
  join public.attendance_roster_mappings roster
    on roster.classroom_id = occurrence.classroom_id
  where occurrence.occurrence_ref = p_snapshot->>'occurrence_ref'
    and roster.roster_ref = p_snapshot->>'roster_ref'
    and occurrence.desired_state = 'scheduled'
    and occurrence.opens_at = (p_snapshot->>'accepts_at')::timestamptz
    and occurrence.closes_at = (p_snapshot->>'stops_accepting_at')::timestamptz;
  if v_classroom_id is null then
    raise exception using errcode = '23514', message = 'attendance_snapshot_mapping_mismatch';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_snapshot->'check_ins') check_in
    where not exists (
      select 1 from public.attendance_participant_mappings participant
      where participant.classroom_id = v_classroom_id
        and participant.participant_ref = check_in->>'participant_ref'
    )
  ) then
    raise exception using errcode = '23514', message = 'attendance_snapshot_participant_mismatch';
  end if;

  insert into public.attendance_session_projection (
    classroom_id, installation_ref, roster_ref, occurrence_ref,
    session_revision, status, opens_at, closes_at, last_event_id, last_event_at
  ) values (
    v_classroom_id, p_installation_ref, p_snapshot->>'roster_ref',
    p_snapshot->>'occurrence_ref', (p_snapshot->>'session_revision')::bigint,
    p_snapshot->>'status', (p_snapshot->>'accepts_at')::timestamptz,
    (p_snapshot->>'stops_accepting_at')::timestamptz,
    'reconcile:' || (p_snapshot->>'occurrence_ref') || ':' ||
      (p_snapshot->>'session_revision'), clock_timestamp()
  ) on conflict (installation_ref, occurrence_ref) do update
    set roster_ref = excluded.roster_ref,
        classroom_id = excluded.classroom_id,
        session_revision = excluded.session_revision,
        status = excluded.status,
        opens_at = excluded.opens_at,
        closes_at = excluded.closes_at,
        last_event_id = excluded.last_event_id,
        last_event_at = excluded.last_event_at,
        updated_at = clock_timestamp()
    where excluded.session_revision > public.attendance_session_projection.session_revision;
  get diagnostics v_session_rows = row_count;

  for v_check_in in select value from jsonb_array_elements(p_snapshot->'check_ins') loop
    select student_id into v_student_id
    from public.attendance_participant_mappings
    where classroom_id = v_classroom_id
      and participant_ref = v_check_in->>'participant_ref';
    v_incoming_revision := (v_check_in->>'check_in_revision')::bigint;
    v_incoming_invalidated_at := case when v_check_in ? 'invalidated_at'
      then (v_check_in->>'invalidated_at')::timestamptz end;
    perform pg_advisory_xact_lock(hashtextextended(
      p_installation_ref || ':' || (v_check_in->>'check_in_ref'), 0
    ));
    select * into v_existing_check_in
    from public.attendance_check_in_facts
    where installation_ref = p_installation_ref
      and check_in_ref = v_check_in->>'check_in_ref'
    for update;

    if v_existing_check_in.id is null then
      insert into public.attendance_check_in_facts (
        classroom_id, student_id, installation_ref, roster_ref, occurrence_ref,
        participant_ref, check_in_ref, check_in_revision, accepted_at,
        invalidated_at, reason_code, last_event_id, last_event_at
      ) values (
        v_classroom_id, v_student_id, p_installation_ref, p_snapshot->>'roster_ref',
        p_snapshot->>'occurrence_ref', v_check_in->>'participant_ref',
        v_check_in->>'check_in_ref', v_incoming_revision,
        (v_check_in->>'accepted_at')::timestamptz, v_incoming_invalidated_at,
        v_check_in->>'reason_code',
        'reconcile:' || (v_check_in->>'check_in_ref') || ':' || v_incoming_revision,
        clock_timestamp()
      );
      v_current_rows := 1;
    elsif v_existing_check_in.classroom_id <> v_classroom_id
      or v_existing_check_in.student_id <> v_student_id
      or v_existing_check_in.roster_ref <> p_snapshot->>'roster_ref'
      or v_existing_check_in.occurrence_ref <> p_snapshot->>'occurrence_ref'
      or v_existing_check_in.participant_ref <> v_check_in->>'participant_ref'
      or v_existing_check_in.accepted_at <>
        (v_check_in->>'accepted_at')::timestamptz then
      raise exception using errcode = '23514', message = 'attendance_check_in_identity_conflict';
    elsif v_incoming_revision < v_existing_check_in.check_in_revision then
      v_current_rows := 0;
    elsif v_incoming_revision = v_existing_check_in.check_in_revision then
      if v_existing_check_in.invalidated_at is distinct from v_incoming_invalidated_at
        or v_existing_check_in.reason_code is distinct from v_check_in->>'reason_code' then
        raise exception using errcode = '23514', message = 'attendance_check_in_revision_conflict';
      end if;
      v_current_rows := 0;
    elsif v_existing_check_in.invalidated_at is not null
      or v_incoming_invalidated_at is null
      or v_incoming_revision <> v_existing_check_in.check_in_revision + 1 then
      raise exception using errcode = '23514', message = 'attendance_check_in_transition_invalid';
    else
      update public.attendance_check_in_facts
      set check_in_revision = v_incoming_revision,
          invalidated_at = v_incoming_invalidated_at,
          reason_code = v_check_in->>'reason_code',
          last_event_id = 'reconcile:' || (v_check_in->>'check_in_ref') || ':' ||
            v_incoming_revision,
          last_event_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where id = v_existing_check_in.id;
      v_current_rows := 1;
    end if;
    v_check_in_rows := v_check_in_rows + v_current_rows;
  end loop;

  update public.attendance_occurrence_mappings
  set last_reconciled_at = clock_timestamp(),
      policy_frozen_at = case
        when p_snapshot->>'status' in ('open', 'closed', 'cancelled')
          or jsonb_array_length(p_snapshot->'check_ins') > 0
        then coalesce(policy_frozen_at, clock_timestamp())
        else policy_frozen_at end
  where occurrence_ref = p_snapshot->>'occurrence_ref';

  return jsonb_build_object(
    'applied', true,
    'session_projection_applied', v_session_rows > 0,
    'check_in_projection_count', v_check_in_rows
  );
end;
$$;

revoke all on function public.attendance_session_snapshot_v1_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_attendance_session_snapshot_v1(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_attendance_session_snapshot_v1(text, jsonb)
  to service_role;

create or replace function public.attendance_schedule_source_document_v1(
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
      'session_starts_local', to_char(policy.opens_local, 'HH24:MI'),
      'session_ends_local', to_char(policy.closes_local, 'HH24:MI'),
      'session_end_day_offset', policy.close_day_offset,
      'entry_opens_minutes_before', policy.entry_opens_minutes_before,
      'present_grace_minutes', policy.present_grace_minutes,
      'entry_closes_minutes_before_end', policy.entry_closes_minutes_before_end,
      'absent_minutes_before_end', policy.absent_minutes_before_end,
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

revoke all on function public.upsert_attendance_timing_policy_v1(
  uuid, uuid, time without time zone, time without time zone, smallint,
  integer, integer, integer, integer, boolean, bigint, timestamptz
) from public, anon, authenticated;
grant execute on function public.upsert_attendance_timing_policy_v1(
  uuid, uuid, time without time zone, time without time zone, smallint,
  integer, integer, integer, integer, boolean, bigint, timestamptz
) to service_role;

create function public.stage_attendance_timing_schedule_v1(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_source_token text,
  p_message jsonb,
  p_cutoffs jsonb,
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
  v_policy public.attendance_window_policies%rowtype;
  v_window_start date;
  v_window_end date;
  v_current_token text;
  v_revision bigint;
  v_expected_count bigint;
  v_outbox public.attendance_integration_outbox%rowtype;
begin
  if p_teacher_id is null or p_classroom_id is null or p_at is null
    or p_source_token !~ '^[a-f0-9]{32}$'
    or jsonb_typeof(p_message) <> 'object'
    or p_message->>'message_type' <> 'schedule.snapshot'
    or jsonb_typeof(p_message->'revision') <> 'number'
    or p_message->>'revision' !~ '^[1-9][0-9]*$'
    or p_message->>'window_start' !~ '^\d{4}-\d{2}-\d{2}$'
    or p_message->>'window_end' !~ '^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(p_message->'occurrences') <> 'array'
    or jsonb_typeof(p_cutoffs) <> 'array' then
    raise exception using errcode = '22023', message = 'attendance_schedule_stage_invalid';
  end if;
  v_window_start := (p_message->>'window_start')::date;
  v_window_end := (p_message->>'window_end')::date;
  if v_window_end < v_window_start or v_window_end - v_window_start > 400 then
    raise exception using errcode = '22023', message = 'attendance_snapshot_window_invalid';
  end if;

  select * into v_classroom from public.classrooms
  where id = p_classroom_id for update;
  select * into v_roster from public.attendance_roster_mappings
  where classroom_id = p_classroom_id for update;
  select * into v_policy from public.attendance_window_policies
  where classroom_id = p_classroom_id for share;
  if v_classroom.id is null then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;
  if v_classroom.teacher_id <> p_teacher_id or v_classroom.archived_at is not null
    or not public.attendance_teacher_entitled_v1(p_teacher_id, p_at)
    or v_roster.integration_state <> 'active' then
    raise exception using errcode = '42501', message = 'attendance_classroom_not_entitled';
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

  -- Freeze a due or remotely-started occurrence before comparing its stored
  -- policy revision with the newly saved policy. This keeps the current class
  -- immutable even when its opening event has not reached Pika yet.
  update public.attendance_occurrence_mappings mapping
  set policy_frozen_at = coalesce(mapping.policy_frozen_at, p_at)
  where mapping.classroom_id = p_classroom_id
    and mapping.policy_frozen_at is null
    and (
      mapping.opens_at <= p_at
      or exists (
        select 1 from public.attendance_session_projection projection
        where projection.occurrence_ref = mapping.occurrence_ref
          and projection.status in ('open', 'closed', 'cancelled')
      )
    );

  select case when v_policy.enabled then count(*) else 0 end into v_expected_count
  from public.class_days class_day
  where class_day.classroom_id = p_classroom_id
    and class_day.date between v_window_start and v_window_end
    and class_day.is_class_day;

  if p_message->>'roster_ref' <> v_roster.roster_ref
    or (p_message->>'revision')::bigint <> v_revision
    or p_message->>'timezone' <> 'America/Toronto'
    or jsonb_array_length(p_message->'occurrences') <> coalesce(v_expected_count, 0)
    or jsonb_array_length(p_cutoffs) <> coalesce(v_expected_count, 0)
    or exists (
      select 1
      from jsonb_to_recordset(p_cutoffs) as cutoff(
        occurrence_ref text, date date, accepts_at timestamptz,
        stops_accepting_at timestamptz, session_starts_at timestamptz,
        session_ends_at timestamptz, present_through_at timestamptz,
        absent_at timestamptz, policy_revision bigint
      )
      where (cutoff.policy_revision <> v_policy.policy_revision and not exists (
          select 1 from public.attendance_occurrence_mappings frozen
          where frozen.classroom_id = p_classroom_id
            and frozen.occurrence_ref = cutoff.occurrence_ref
            and frozen.policy_frozen_at is not null
            and frozen.policy_revision = cutoff.policy_revision
        ))
        or cutoff.accepts_at > cutoff.session_starts_at
        or cutoff.session_starts_at > cutoff.present_through_at
        or cutoff.present_through_at >= cutoff.stops_accepting_at
        or cutoff.stops_accepting_at > cutoff.absent_at
        or cutoff.absent_at > cutoff.session_ends_at
        or not exists (
          select 1
          from public.attendance_occurrence_mappings mapping
          join public.class_days class_day
            on class_day.classroom_id = mapping.classroom_id
           and class_day.date = mapping.class_date
          where mapping.classroom_id = p_classroom_id
            and class_day.is_class_day
            and mapping.occurrence_ref = cutoff.occurrence_ref
            and mapping.class_date = cutoff.date
        )
        or not exists (
          select 1 from jsonb_to_recordset(p_message->'occurrences') as occurrence(
            occurrence_ref text, date date, accepts_at timestamptz, stops_accepting_at timestamptz
          )
          where occurrence.occurrence_ref = cutoff.occurrence_ref
            and occurrence.date = cutoff.date
            and occurrence.accepts_at = cutoff.accepts_at
            and occurrence.stops_accepting_at = cutoff.stops_accepting_at
        )
    ) then
    raise exception using errcode = '22023', message = 'attendance_schedule_message_mismatch';
  end if;

  update public.attendance_occurrence_mappings
  set desired_state = 'cancelled', updated_at = clock_timestamp()
  where classroom_id = p_classroom_id
    and class_date between v_window_start and v_window_end
    and policy_frozen_at is null
    and not exists (
      select 1 from jsonb_to_recordset(p_cutoffs) cutoff(occurrence_ref text)
      where cutoff.occurrence_ref = attendance_occurrence_mappings.occurrence_ref
    );

  update public.attendance_occurrence_mappings mapping
  set opens_at = cutoff.accepts_at,
      closes_at = cutoff.stops_accepting_at,
      session_starts_at = cutoff.session_starts_at,
      session_ends_at = cutoff.session_ends_at,
      present_through_at = cutoff.present_through_at,
      absent_at = cutoff.absent_at,
      policy_revision = cutoff.policy_revision,
      desired_state = 'scheduled',
      source_revision = v_revision,
      updated_at = clock_timestamp()
  from jsonb_to_recordset(p_cutoffs) as cutoff(
    occurrence_ref text, date date, accepts_at timestamptz,
    stops_accepting_at timestamptz, session_starts_at timestamptz,
    session_ends_at timestamptz, present_through_at timestamptz,
    absent_at timestamptz, policy_revision bigint
  )
  where mapping.classroom_id = p_classroom_id
    and mapping.class_date = cutoff.date
    and mapping.occurrence_ref = cutoff.occurrence_ref
    and mapping.policy_frozen_at is null;

  -- Frozen rows must be sent back with their original concrete gate. The
  -- application builds p_message from those stored rows; reject drift here.
  if exists (
    select 1
    from public.attendance_occurrence_mappings mapping
    join jsonb_to_recordset(p_message->'occurrences') as occurrence(
      occurrence_ref text, date date, accepts_at timestamptz, stops_accepting_at timestamptz
    ) on occurrence.occurrence_ref = mapping.occurrence_ref
    where mapping.classroom_id = p_classroom_id
      and mapping.policy_frozen_at is not null
      and (mapping.opens_at <> occurrence.accepts_at
        or mapping.closes_at <> occurrence.stops_accepting_at)
  ) then
    raise exception using errcode = '40001', message = 'attendance_occurrence_policy_frozen';
  end if;

  select * into v_outbox from public.enqueue_attendance_outbound_message_v2(
    p_teacher_id, p_classroom_id, p_message, p_at
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

revoke all on function public.stage_attendance_timing_schedule_v1(
  uuid, uuid, text, jsonb, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.stage_attendance_timing_schedule_v1(
  uuid, uuid, text, jsonb, jsonb, timestamptz
) to service_role;

create function public.apply_attendance_status_overrides_v1(
  p_teacher_id uuid,
  p_classroom_id uuid,
  p_class_date date,
  p_request_id uuid,
  p_marks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_occurrence public.attendance_occurrence_mappings%rowtype;
  v_existing_request public.attendance_override_requests%rowtype;
  v_override public.attendance_status_overrides%rowtype;
  v_mark record;
  v_fingerprint text;
  v_result jsonb;
  v_applied integer := 0;
  v_unchanged integer := 0;
  v_revision bigint;
begin
  if p_teacher_id is null or p_classroom_id is null or p_class_date is null
    or p_request_id is null or jsonb_typeof(p_marks) <> 'array'
    or jsonb_array_length(p_marks) < 1 or jsonb_array_length(p_marks) > 200
    or exists (
      select 1 from jsonb_to_recordset(p_marks) mark(
        student_id uuid, status text, reason_code text
      )
      where mark.student_id is null
        or mark.status not in ('automatic', 'present', 'late', 'absent')
        or mark.reason_code is not null
          and mark.reason_code !~ '^[a-z][a-z0-9._-]{0,99}$'
    )
    or (select count(*) from jsonb_to_recordset(p_marks) mark(student_id uuid))
      <> (select count(distinct mark.student_id)
          from jsonb_to_recordset(p_marks) mark(student_id uuid)) then
    raise exception using errcode = '22023', message = 'attendance_override_request_invalid';
  end if;

  select * into v_classroom from public.classrooms
  where id = p_classroom_id for update;
  if v_classroom.id is null then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;
  if v_classroom.teacher_id <> p_teacher_id or v_classroom.archived_at is not null then
    raise exception using errcode = '42501', message = 'attendance_classroom_forbidden';
  end if;
  select * into v_occurrence from public.attendance_occurrence_mappings
  where classroom_id = p_classroom_id and class_date = p_class_date;
  if v_occurrence.occurrence_ref is null then
    raise exception using errcode = '23514', message = 'attendance_occurrence_missing';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_marks) mark(student_id uuid)
    where not exists (
      select 1 from public.classroom_enrollments enrollment
      where enrollment.classroom_id = p_classroom_id
        and enrollment.student_id = mark.student_id
    )
  ) then
    raise exception using errcode = '23514', message = 'attendance_roster_changed';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'teacher_id', p_teacher_id,
    'classroom_id', p_classroom_id,
    'class_date', p_class_date,
    'marks', p_marks
  )::text);
  select * into v_existing_request from public.attendance_override_requests
  where request_id = p_request_id;
  if v_existing_request.request_id is not null then
    if v_existing_request.classroom_id <> p_classroom_id
      or v_existing_request.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '23505', message = 'attendance_override_request_conflict';
    end if;
    return v_existing_request.result || jsonb_build_object('outcome', 'duplicate');
  end if;

  for v_mark in
    select * from jsonb_to_recordset(p_marks) mark(
      student_id uuid, status text, reason_code text
    )
  loop
    select * into v_override from public.attendance_status_overrides
    where classroom_id = p_classroom_id
      and occurrence_ref = v_occurrence.occurrence_ref
      and student_id = v_mark.student_id
    for update;

    if (v_mark.status = 'automatic' and v_override.id is null)
      or (v_override.id is not null
      and ((v_mark.status = 'automatic' and not v_override.active)
        or (v_override.active and v_override.status = v_mark.status
          and v_override.reason_code is not distinct from v_mark.reason_code))) then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    if v_override.id is null then
      insert into public.attendance_status_overrides (
        classroom_id, student_id, occurrence_ref, status, active,
        reason_code, updated_by
      ) values (
        p_classroom_id, v_mark.student_id, v_occurrence.occurrence_ref,
        case when v_mark.status = 'automatic' then null else v_mark.status end,
        v_mark.status <> 'automatic', v_mark.reason_code, p_teacher_id
      ) returning * into v_override;
    else
      update public.attendance_status_overrides
      set status = case when v_mark.status = 'automatic' then null else v_mark.status end,
          active = v_mark.status <> 'automatic',
          revision = revision + 1,
          reason_code = v_mark.reason_code,
          updated_by = p_teacher_id,
          updated_at = clock_timestamp()
      where id = v_override.id
      returning * into v_override;
    end if;
    v_revision := v_override.revision;
    insert into public.attendance_status_override_events (
      override_id, request_id, classroom_id, student_id, occurrence_ref,
      revision, action, status, reason_code, actor_user_id
    ) values (
      v_override.id, p_request_id, p_classroom_id, v_mark.student_id,
      v_occurrence.occurrence_ref, v_revision,
      case when v_mark.status = 'automatic' then 'undo' else 'set' end,
      case when v_mark.status = 'automatic' then null else v_mark.status end,
      v_mark.reason_code, p_teacher_id
    );
    v_applied := v_applied + 1;
  end loop;

  v_result := jsonb_build_object(
    'outcome', 'applied',
    'occurrence_ref', v_occurrence.occurrence_ref,
    'applied_count', v_applied,
    'unchanged_count', v_unchanged
  );
  insert into public.attendance_override_requests (
    request_id, classroom_id, request_fingerprint, result
  ) values (p_request_id, p_classroom_id, v_fingerprint, v_result);
  return v_result;
end;
$$;

revoke all on function public.apply_attendance_status_overrides_v1(
  uuid, uuid, date, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_attendance_status_overrides_v1(
  uuid, uuid, date, uuid, jsonb
) to service_role;

create or replace function public.attendance_event_v1_valid(p_event jsonb)
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
      select 1 from jsonb_object_keys(p_event) key
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
    and p_event->>'session_revision' ~ '^[1-9][0-9]*$'
    and jsonb_typeof(p_event->'metadata') = 'object'
    and case p_event->>'event_type'
      when 'attendance.session.scheduled' then
        p_event->'metadata' ?& array['accepts_at', 'stops_accepting_at']
        and not exists (
          select 1 from jsonb_object_keys(p_event->'metadata') key
          where key not in ('accepts_at', 'stops_accepting_at')
        )
        and p_event->'metadata'->>'accepts_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
        and p_event->'metadata'->>'stops_accepting_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
        and (p_event->'metadata'->>'accepts_at')::timestamptz
          < (p_event->'metadata'->>'stops_accepting_at')::timestamptz
      when 'attendance.session.opened' then
        p_event->'metadata' ?& array['opened_at', 'trigger']
        and not exists (
          select 1 from jsonb_object_keys(p_event->'metadata') key
          where key not in ('opened_at', 'trigger')
        )
        and p_event->'metadata'->>'trigger' in ('schedule', 'staff')
      when 'attendance.session.closed' then
        p_event->'metadata' ?& array['closed_at', 'trigger']
        and not exists (
          select 1 from jsonb_object_keys(p_event->'metadata') key
          where key not in ('closed_at', 'trigger')
        )
        and p_event->'metadata'->>'trigger' in ('schedule', 'staff')
      when 'attendance.session.cancelled' then
        p_event->'metadata' ?& array['cancelled_at', 'reason_code']
        and not exists (
          select 1 from jsonb_object_keys(p_event->'metadata') key
          where key not in ('cancelled_at', 'reason_code')
        )
        and p_event->'metadata'->>'reason_code' in (
          'schedule_removed', 'staff_cancelled', 'missed_window', 'automation_failed'
        )
      when 'attendance.check_in.accepted' then
        p_event->'metadata' ?& array[
          'check_in_ref', 'participant_ref', 'check_in_revision', 'accepted_at'
        ]
        and not exists (
          select 1 from jsonb_object_keys(p_event->'metadata') key
          where key not in (
            'check_in_ref', 'participant_ref', 'check_in_revision', 'accepted_at'
          )
        )
        and p_event->'metadata'->>'check_in_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
        and p_event->'metadata'->>'participant_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
        and p_event->'metadata'->>'check_in_revision' ~ '^[1-9][0-9]*$'
        and p_event->'metadata'->>'accepted_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
      when 'attendance.check_in.invalidated' then
        p_event->'metadata' ?& array[
          'check_in_ref', 'participant_ref', 'check_in_revision',
          'accepted_at', 'invalidated_at'
        ]
        and not exists (
          select 1 from jsonb_object_keys(p_event->'metadata') key
          where key not in (
            'check_in_ref', 'participant_ref', 'check_in_revision',
            'accepted_at', 'invalidated_at', 'reason_code'
          )
        )
        and p_event->'metadata'->>'check_in_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
        and p_event->'metadata'->>'participant_ref' ~ '^[A-Za-z0-9._~-]{1,128}$'
        and p_event->'metadata'->>'check_in_revision' ~ '^[1-9][0-9]*$'
        and p_event->'metadata'->>'accepted_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
        and p_event->'metadata'->>'invalidated_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$'
        and (p_event->'metadata'->>'invalidated_at')::timestamptz
          >= (p_event->'metadata'->>'accepted_at')::timestamptz
        and (not p_event->'metadata' ? 'reason_code'
          or p_event->'metadata'->>'reason_code' ~ '^[A-Za-z0-9._~-]{1,128}$')
      else false
    end
  , false);
$$;

create or replace function public.apply_attendance_event_v1(
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
  v_classroom_id uuid;
  v_student_id uuid;
  v_existing_check_in public.attendance_check_in_facts%rowtype;
  v_incoming_revision bigint;
  v_incoming_invalidated_at timestamptz;
  v_projection_rows integer := 0;
begin
  if not public.attendance_event_v1_valid(p_event)
    or p_transport_nonce !~ '^[A-Za-z0-9._~-]{16,128}$' then
    raise exception using errcode = '22023', message = 'attendance_event_invalid';
  end if;

  select occurrence.classroom_id into v_classroom_id
  from public.attendance_occurrence_mappings occurrence
  join public.attendance_roster_mappings roster
    on roster.classroom_id = occurrence.classroom_id
  where occurrence.occurrence_ref = p_event->>'occurrence_ref'
    and roster.roster_ref = p_event->>'roster_ref';
  if v_classroom_id is null then
    raise exception using errcode = '23514', message = 'attendance_event_mapping_mismatch';
  end if;

  if p_event->>'event_type' in (
    'attendance.check_in.accepted', 'attendance.check_in.invalidated'
  ) then
    select participant.student_id into v_student_id
    from public.attendance_participant_mappings participant
    where participant.classroom_id = v_classroom_id
      and participant.participant_ref = p_event->'metadata'->>'participant_ref';
    if v_student_id is null then
      raise exception using errcode = '23514', message = 'attendance_event_participant_mismatch';
    end if;
  end if;

  insert into public.attendance_integration_inbox (
    classroom_id, installation_ref, transport_nonce, event_id,
    idempotency_key, correlation_ref, event_type, occurred_at,
    roster_ref, occurrence_ref, session_revision, payload
  ) values (
    v_classroom_id, p_event->>'installation_ref', p_transport_nonce,
    p_event->>'event_id', p_event->>'idempotency_key',
    p_event->>'correlation_ref', p_event->>'event_type',
    (p_event->>'occurred_at')::timestamptz, p_event->>'roster_ref',
    p_event->>'occurrence_ref', (p_event->>'session_revision')::bigint, p_event
  ) on conflict do nothing returning id into v_inbox_id;

  if v_inbox_id is null then
    if exists (
      select 1 from public.attendance_integration_inbox
      where installation_ref = p_event->>'installation_ref'
        and event_id = p_event->>'event_id' and payload = p_event
    ) then
      return jsonb_build_object(
        'accepted', true, 'duplicate', true, 'projection_applied', false
      );
    end if;
    raise exception using errcode = '23505', message = 'attendance_event_replay_conflict';
  end if;

  if p_event->>'event_type' in (
    'attendance.session.scheduled', 'attendance.session.opened',
    'attendance.session.closed', 'attendance.session.cancelled'
  ) then
    insert into public.attendance_session_projection (
      classroom_id, installation_ref, roster_ref, occurrence_ref,
      session_revision, status, opens_at, closes_at,
      last_event_id, last_event_at
    ) values (
      v_classroom_id, p_event->>'installation_ref', p_event->>'roster_ref',
      p_event->>'occurrence_ref', (p_event->>'session_revision')::bigint,
      case p_event->>'event_type'
        when 'attendance.session.scheduled' then 'scheduled'
        when 'attendance.session.opened' then 'open'
        when 'attendance.session.closed' then 'closed'
        else 'cancelled'
      end,
      case when p_event->>'event_type' = 'attendance.session.scheduled'
        then (p_event->'metadata'->>'accepts_at')::timestamptz end,
      case when p_event->>'event_type' = 'attendance.session.scheduled'
        then (p_event->'metadata'->>'stops_accepting_at')::timestamptz end,
      p_event->>'event_id', (p_event->>'occurred_at')::timestamptz
    ) on conflict (installation_ref, occurrence_ref) do update
      set roster_ref = excluded.roster_ref,
          classroom_id = excluded.classroom_id,
          session_revision = excluded.session_revision,
          status = excluded.status,
          opens_at = coalesce(excluded.opens_at, public.attendance_session_projection.opens_at),
          closes_at = coalesce(excluded.closes_at, public.attendance_session_projection.closes_at),
          last_event_id = excluded.last_event_id,
          last_event_at = excluded.last_event_at,
          updated_at = clock_timestamp()
      where excluded.session_revision > public.attendance_session_projection.session_revision;
    get diagnostics v_projection_rows = row_count;

    if p_event->>'event_type' in (
      'attendance.session.opened', 'attendance.session.closed',
      'attendance.session.cancelled'
    ) then
      update public.attendance_occurrence_mappings
      set policy_frozen_at = coalesce(
        policy_frozen_at, (p_event->>'occurred_at')::timestamptz
      )
      where occurrence_ref = p_event->>'occurrence_ref';
    end if;
  else
    v_incoming_revision := (p_event->'metadata'->>'check_in_revision')::bigint;
    v_incoming_invalidated_at := case
      when p_event->>'event_type' = 'attendance.check_in.invalidated'
      then (p_event->'metadata'->>'invalidated_at')::timestamptz end;
    perform pg_advisory_xact_lock(hashtextextended(
      (p_event->>'installation_ref') || ':' ||
        (p_event->'metadata'->>'check_in_ref'), 0
    ));
    select * into v_existing_check_in
    from public.attendance_check_in_facts
    where installation_ref = p_event->>'installation_ref'
      and check_in_ref = p_event->'metadata'->>'check_in_ref'
    for update;

    if v_existing_check_in.id is null then
      insert into public.attendance_check_in_facts (
        classroom_id, student_id, installation_ref, roster_ref,
        occurrence_ref, participant_ref, check_in_ref, check_in_revision,
        accepted_at, invalidated_at, reason_code, last_event_id, last_event_at
      ) values (
        v_classroom_id, v_student_id, p_event->>'installation_ref',
        p_event->>'roster_ref', p_event->>'occurrence_ref',
        p_event->'metadata'->>'participant_ref',
        p_event->'metadata'->>'check_in_ref', v_incoming_revision,
        (p_event->'metadata'->>'accepted_at')::timestamptz,
        v_incoming_invalidated_at, p_event->'metadata'->>'reason_code',
        p_event->>'event_id', (p_event->>'occurred_at')::timestamptz
      );
      v_projection_rows := 1;
    elsif v_existing_check_in.classroom_id <> v_classroom_id
      or v_existing_check_in.student_id <> v_student_id
      or v_existing_check_in.roster_ref <> p_event->>'roster_ref'
      or v_existing_check_in.occurrence_ref <> p_event->>'occurrence_ref'
      or v_existing_check_in.participant_ref <>
        p_event->'metadata'->>'participant_ref'
      or v_existing_check_in.accepted_at <>
        (p_event->'metadata'->>'accepted_at')::timestamptz then
      raise exception using errcode = '23514', message = 'attendance_check_in_identity_conflict';
    elsif v_incoming_revision < v_existing_check_in.check_in_revision then
      v_projection_rows := 0;
    elsif v_incoming_revision = v_existing_check_in.check_in_revision then
      if v_existing_check_in.invalidated_at is distinct from v_incoming_invalidated_at
        or v_existing_check_in.reason_code is distinct from
          p_event->'metadata'->>'reason_code' then
        raise exception using errcode = '23514', message = 'attendance_check_in_revision_conflict';
      end if;
      v_projection_rows := 0;
    elsif v_existing_check_in.invalidated_at is not null
      or v_incoming_invalidated_at is null
      or v_incoming_revision <> v_existing_check_in.check_in_revision + 1 then
      raise exception using errcode = '23514', message = 'attendance_check_in_transition_invalid';
    else
      update public.attendance_check_in_facts
      set check_in_revision = v_incoming_revision,
          invalidated_at = v_incoming_invalidated_at,
          reason_code = p_event->'metadata'->>'reason_code',
          last_event_id = p_event->>'event_id',
          last_event_at = (p_event->>'occurred_at')::timestamptz,
          updated_at = clock_timestamp()
      where id = v_existing_check_in.id;
      v_projection_rows := 1;
    end if;
    update public.attendance_occurrence_mappings
    set policy_frozen_at = coalesce(
      policy_frozen_at, (p_event->'metadata'->>'accepted_at')::timestamptz
    )
    where occurrence_ref = p_event->>'occurrence_ref';
  end if;

  update public.attendance_integration_inbox
  set projection_applied = v_projection_rows > 0 where id = v_inbox_id;
  return jsonb_build_object(
    'accepted', true, 'duplicate', false,
    'projection_applied', v_projection_rows > 0
  );
end;
$$;

create or replace function public.enqueue_attendance_outbound_message_v1(
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
      'roster.snapshot', 'schedule.snapshot', 'session.command', 'check_in.invalidate'
    )
    or v_idempotency_key !~ '^[A-Za-z0-9._~:-]{1,200}$'
    or p_message->>'correlation_ref' !~ '^[A-Za-z0-9._~-]{1,128}$'
    or p_message->>'installation_ref' !~ '^[A-Za-z0-9._~-]{1,128}$'
    or p_message->>'roster_ref' !~ '^[A-Za-z0-9._~-]{1,128}$' then
    raise exception using errcode = '22023', message = 'attendance_outbox_message_invalid';
  end if;
  if not exists (select 1 from public.classrooms where id = p_classroom_id) then
    raise exception using errcode = 'P0002', message = 'attendance_classroom_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_classroom_id::text, 918273645));
  insert into public.attendance_integration_outbox (
    classroom_id, idempotency_key, message_type, payload
  ) values (p_classroom_id, v_idempotency_key, v_message_type, p_message)
  on conflict (idempotency_key) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.attendance_integration_outbox
    where idempotency_key = v_idempotency_key;
    if v_row.classroom_id <> p_classroom_id
      or v_row.message_type <> v_message_type or v_row.payload <> p_message then
      raise exception using errcode = '23505', message = 'attendance_outbox_idempotency_conflict';
    end if;
  end if;
  return v_row;
end;
$$;

create or replace function public.attendance_outbox_dependencies_ready_v1(
  p_row public.attendance_integration_outbox
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1 from public.attendance_integration_outbox sibling
    where sibling.classroom_id = p_row.classroom_id
      and sibling.status in ('pending', 'processing')
      and (sibling.created_at, sibling.id) < (p_row.created_at, p_row.id)
      and sibling.message_type = p_row.message_type
      and (p_row.message_type in ('roster.snapshot', 'schedule.snapshot')
        or sibling.payload->>'occurrence_ref' = p_row.payload->>'occurrence_ref')
  ) and case p_row.message_type
    when 'roster.snapshot' then true
    when 'schedule.snapshot' then
      exists (select 1 from public.attendance_roster_mappings roster
        where roster.classroom_id = p_row.classroom_id and roster.synced_revision is not null)
      and not exists (select 1 from public.attendance_integration_outbox dependency
        where dependency.classroom_id = p_row.classroom_id
          and dependency.message_type = 'roster.snapshot'
          and dependency.status in ('pending', 'processing', 'non_retryable'))
    when 'session.command' then
      exists (select 1 from public.attendance_roster_mappings roster
        where roster.classroom_id = p_row.classroom_id
          and roster.synced_revision is not null
          and roster.schedule_synced_revision is not null)
      and not exists (select 1 from public.attendance_integration_outbox dependency
        where dependency.classroom_id = p_row.classroom_id
          and dependency.message_type in ('roster.snapshot', 'schedule.snapshot')
          and dependency.status in ('pending', 'processing', 'non_retryable'))
    when 'check_in.invalidate' then
      exists (select 1 from public.attendance_roster_mappings roster
        where roster.classroom_id = p_row.classroom_id
          and roster.synced_revision is not null
          and roster.schedule_synced_revision is not null)
      and not exists (select 1 from public.attendance_integration_outbox dependency
        where dependency.classroom_id = p_row.classroom_id
          and dependency.message_type in ('roster.snapshot', 'schedule.snapshot')
          and dependency.status in ('pending', 'processing', 'non_retryable'))
    else false
  end;
$$;
