#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="${BARA_ATTENDANCE_DB_CONTAINER:-supabase_db_pika}"
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  DB_CONTAINER="$(docker ps --filter 'name=supabase_db_' --format '{{.Names}}' | head -n 1)"
fi
if [[ -z "$DB_CONTAINER" ]]; then
  echo "Local Pika Supabase database container is not running." >&2
  exit 2
fi

PROJECT_LABEL="$(docker inspect "$DB_CONTAINER" \
  --format '{{ index .Config.Labels "com.supabase.cli.project" }}')"
DB_BINDING="$(docker port "$DB_CONTAINER" 5432/tcp 2>/dev/null || true)"
if [[ "$PROJECT_LABEL" != "pika" ]] || ! grep -q ':54322$' <<<"$DB_BINDING"; then
  echo "Refusing non-local or unexpected Supabase database target." >&2
  exit 2
fi

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
do $migration$
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations where version = '126'
  ) or to_regprocedure(
    'public.claim_attendance_outbox_batch_v1(integer,integer)'
  ) is null then
    raise exception 'Migration 126 is not applied to the local database';
  end if;
end;
$migration$;

begin;

do $privileges$
declare v_table text;
begin
  foreach v_table in array array[
    'attendance_roster_mappings',
    'attendance_participant_mappings',
    'attendance_principal_mappings',
    'attendance_occurrence_mappings',
    'attendance_window_policies',
    'attendance_integration_outbox',
    'attendance_integration_inbox',
    'attendance_session_projection',
    'attendance_record_projection'
  ] loop
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT')
      or has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
      or has_table_privilege('service_role', 'public.' || v_table, 'DELETE')
    then
      raise exception 'Unsafe attendance table privilege on %', v_table;
    end if;
  end loop;
  if has_function_privilege(
      'service_role',
      'public.attendance_outbox_dependencies_ready_v1(public.attendance_integration_outbox)',
      'execute'
    ) or has_function_privilege(
      'authenticated',
      'public.claim_attendance_outbox_batch_v1(integer,integer)',
      'execute'
    )
  then
    raise exception 'Attendance internal delivery functions are exposed';
  end if;
end;
$privileges$;

insert into public.users (id, email, role, workos_user_id) values
  ('a1260000-0000-4000-8000-000000000001', 'attendance-teacher@example.test', 'teacher', 'user_attendance_teacher'),
  ('a1260000-0000-4000-8000-000000000002', 'attendance-student@example.test', 'student', 'user_attendance_student');

insert into public.classrooms (id, teacher_id, title, class_code)
select
  ('a1260000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
  'a1260000-0000-4000-8000-000000000001',
  'Attendance guard ' || value,
  'A126' || lpad(value::text, 2, '0')
from generate_series(10, 20) value;

insert into public.attendance_roster_mappings (classroom_id) values
  ('a1260000-0000-4000-8000-000000000010');
insert into public.attendance_participant_mappings (
  classroom_id, student_id, participant_ref
) values (
  'a1260000-0000-4000-8000-000000000011',
  'a1260000-0000-4000-8000-000000000002',
  'participant_12600000000000000000000000000011'
);
insert into public.attendance_occurrence_mappings (
  classroom_id, class_date, occurrence_ref
) values (
  'a1260000-0000-4000-8000-000000000012', '2026-09-12',
  'occurrence_12600000000000000000000000000012'
);
insert into public.attendance_window_policies (
  classroom_id, opens_local, closes_local
) values (
  'a1260000-0000-4000-8000-000000000013', '08:45', '09:30'
);
insert into public.attendance_integration_outbox (
  classroom_id, idempotency_key, message_type, payload, status
) values (
  'a1260000-0000-4000-8000-000000000014',
  'roster:guard:14', 'roster.snapshot',
  jsonb_build_object(
    'schema_version', 1, 'message_type', 'roster.snapshot',
    'idempotency_key', 'roster:guard:14', 'correlation_ref', 'guard_14',
    'installation_ref', 'installation_guard', 'roster_ref', 'roster_guard_14',
    'revision', 1
  ), 'non_retryable'
);
insert into public.attendance_integration_inbox (
  classroom_id, installation_ref, transport_nonce, event_id, idempotency_key,
  correlation_ref, event_type, occurred_at, roster_ref, occurrence_ref,
  session_revision, payload
) values (
  'a1260000-0000-4000-8000-000000000015', 'installation_guard',
  'nonce_guard_00015', 'event_guard_15', 'event:guard:15', 'guard_15',
  'attendance.session.opened', '2026-09-15T13:00:00Z', 'roster_guard_15',
  'occurrence_guard_15', 1,
  jsonb_build_object(
    'schema_version', 1, 'event_id', 'event_guard_15',
    'idempotency_key', 'event:guard:15', 'correlation_ref', 'guard_15',
    'event_type', 'attendance.session.opened',
    'occurred_at', '2026-09-15T13:00:00Z',
    'installation_ref', 'installation_guard', 'roster_ref', 'roster_guard_15',
    'occurrence_ref', 'occurrence_guard_15', 'session_revision', 1,
    'metadata', jsonb_build_object(
      'opened_at', '2026-09-15T13:00:00Z', 'trigger', 'staff'
    )
  )
);
insert into public.attendance_session_projection (
  classroom_id, installation_ref, roster_ref, occurrence_ref,
  session_revision, status, last_event_id, last_event_at
) values (
  'a1260000-0000-4000-8000-000000000016', 'installation_guard',
  'roster_guard_16', 'occurrence_guard_16', 1, 'open', 'event_guard_16',
  '2026-09-16T13:00:00Z'
);
insert into public.attendance_record_projection (
  classroom_id, student_id, installation_ref, roster_ref, occurrence_ref,
  participant_ref, record_revision, status, source, actor_type,
  last_event_id, last_event_at
) values (
  'a1260000-0000-4000-8000-000000000017',
  'a1260000-0000-4000-8000-000000000002', 'installation_guard',
  'roster_guard_17', 'occurrence_guard_17', 'participant_guard_17',
  1, 'present', 'student_qr', 'student', 'event_guard_17',
  '2026-09-17T13:00:00Z'
);

do $delete_guards$
declare v_classroom_id uuid;
begin
  foreach v_classroom_id in array array[
    'a1260000-0000-4000-8000-000000000010'::uuid,
    'a1260000-0000-4000-8000-000000000011'::uuid,
    'a1260000-0000-4000-8000-000000000012'::uuid,
    'a1260000-0000-4000-8000-000000000013'::uuid,
    'a1260000-0000-4000-8000-000000000014'::uuid,
    'a1260000-0000-4000-8000-000000000015'::uuid,
    'a1260000-0000-4000-8000-000000000016'::uuid,
    'a1260000-0000-4000-8000-000000000017'::uuid
  ] loop
    begin
      delete from public.classrooms where id = v_classroom_id;
      raise exception 'Attendance classroom delete unexpectedly succeeded for %', v_classroom_id;
    exception when sqlstate '55000' then
      if sqlerrm <> 'attendance_classroom_decommission_required' then raise; end if;
    end;
  end loop;

  delete from public.classrooms where id = 'a1260000-0000-4000-8000-000000000018';
  if found is false then raise exception 'No-state classroom delete did not execute'; end if;
end;
$delete_guards$;

do $operation_guards$
begin
  begin
    insert into public.classroom_archive_operations (
      id, teacher_id, classroom_id, operation_type, request_sha256, status,
      source_revision, source_schema_migration, source_app_commit, retention,
      snapshot_created_at, snapshot_expires_at
    ) values (
      'a1260000-0000-4000-8000-000000000101',
      'a1260000-0000-4000-8000-000000000001',
      'a1260000-0000-4000-8000-000000000010', 'compact', repeat('a', 64),
      'snapshot_ready', 1, '126', repeat('b', 40), '{}'::jsonb,
      clock_timestamp(), clock_timestamp() + interval '1 hour'
    );
    raise exception 'Attendance archive compaction unexpectedly started';
  exception when sqlstate '55000' then
    if sqlerrm <> 'attendance_classroom_decommission_required' then raise; end if;
  end;

  begin
    insert into public.classroom_purge_operations (
      id, teacher_id, classroom_id, classroom_title, request_sha256,
      source_revision, impact_summary
    ) values (
      'a1260000-0000-4000-8000-000000000102',
      'a1260000-0000-4000-8000-000000000001',
      'a1260000-0000-4000-8000-000000000010', 'Attendance guard 10',
      repeat('c', 64), 1, '{}'::jsonb
    );
    raise exception 'Attendance classroom purge unexpectedly started';
  exception when sqlstate '55000' then
    if sqlerrm <> 'attendance_classroom_decommission_required' then raise; end if;
  end;
end;
$operation_guards$;

insert into public.attendance_roster_mappings (
  classroom_id, roster_ref, source_revision, staged_revision,
  schedule_source_revision, schedule_staged_revision
) values (
  'a1260000-0000-4000-8000-000000000020',
  'roster_12600000000000000000000000000020', 1, 1, 1, 1
);
insert into public.attendance_integration_outbox (
  classroom_id, idempotency_key, message_type, payload, created_at
) values
  (
    'a1260000-0000-4000-8000-000000000020', 'schedule:dependency:1',
    'schedule.snapshot', jsonb_build_object(
      'schema_version', 1, 'message_type', 'schedule.snapshot',
      'idempotency_key', 'schedule:dependency:1',
      'correlation_ref', 'dependency_schedule',
      'installation_ref', 'installation_dependency',
      'roster_ref', 'roster_12600000000000000000000000000020',
      'revision', 1
    ), clock_timestamp() - interval '2 minutes'
  ),
  (
    'a1260000-0000-4000-8000-000000000020', 'roster:dependency:1',
    'roster.snapshot', jsonb_build_object(
      'schema_version', 1, 'message_type', 'roster.snapshot',
      'idempotency_key', 'roster:dependency:1',
      'correlation_ref', 'dependency_roster',
      'installation_ref', 'installation_dependency',
      'roster_ref', 'roster_12600000000000000000000000000020',
      'revision', 1
    ), clock_timestamp() - interval '1 minute'
  );

do $dependency_order$
declare
  v_claim public.attendance_integration_outbox;
begin
  select * into v_claim
  from public.claim_attendance_outbound_message_v1('schedule:dependency:1', 60);
  if v_claim.id is not null then raise exception 'Schedule bypassed roster dependency'; end if;

  select * into v_claim from public.claim_attendance_outbox_batch_v1(10, 60);
  if v_claim.message_type <> 'roster.snapshot' then
    raise exception 'Reversed outbox order did not claim roster first';
  end if;
  if not public.complete_attendance_outbox_v1(v_claim.id, v_claim.lease_token, '{}'::jsonb)
  then raise exception 'Roster completion failed'; end if;

  select * into v_claim from public.claim_attendance_outbox_batch_v1(10, 60);
  if v_claim.message_type <> 'schedule.snapshot' then
    raise exception 'Schedule was not released after roster completion';
  end if;
  if not public.complete_attendance_outbox_v1(v_claim.id, v_claim.lease_token, '{}'::jsonb)
  then raise exception 'Schedule completion failed'; end if;
end;
$dependency_order$;

rollback;
SQL

echo "Bara attendance database checks passed."
