#!/usr/bin/env bash
set -euo pipefail

# Local-only, rollback-only behavioral fixture. It never applies migrations and
# leaves no durable rows. Run only after separately authorized migration 157.
JOIN_DB_CONTAINER="$(docker ps --filter 'name=^supabase_db_pika$' --format '{{.Names}}')"
if [[ "$JOIN_DB_CONTAINER" != 'supabase_db_pika' ]]; then
  echo 'The exact local Supabase container supabase_db_pika must be running.' >&2
  exit 1
fi

docker exec -i "$JOIN_DB_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $check$
declare
  v_signature text := 'public.join_classroom_by_code_atomic_v1(uuid,uuid,text,text,text,text,text,text,jsonb)';
begin
  if to_regclass('public.classroom_join_rate_limits') is null
    or to_regprocedure(v_signature) is null then
    raise exception 'Migration 157 is required; this harness never applies it';
  end if;
  if has_table_privilege('anon', 'public.classroom_join_rate_limits', 'select')
    or has_table_privilege('authenticated', 'public.classroom_join_rate_limits', 'select')
    or has_table_privilege('service_role', 'public.classroom_join_rate_limits', 'select')
    or has_function_privilege('anon', v_signature, 'execute')
    or has_function_privilege('authenticated', v_signature, 'execute')
    or not has_function_privilege('service_role', v_signature, 'execute') then
    raise exception 'Contextual enrollment privileges are incorrect';
  end if;
end;
$check$;

insert into public.users (id, email, role) values
  ('c1550000-0000-4000-8000-000000000001', 'mixed-actor@example.invalid', 'teacher'),
  ('c1550000-0000-4000-8000-000000000002', 'class-owner@example.invalid', 'teacher'),
  ('c1550000-0000-4000-8000-000000000003', 'other-actor@example.invalid', 'student');

insert into public.classrooms (
  id, teacher_id, title, class_code, allow_enrollment, join_policy, archived_at
) values
  ('c1550000-0000-4000-8000-000000000010', 'c1550000-0000-4000-8000-000000000002', 'Open join', 'C155OPEN', true, 'open_join', null),
  ('c1550000-0000-4000-8000-000000000011', 'c1550000-0000-4000-8000-000000000002', 'Roster join', 'C155ROSTER', true, 'roster', null),
  ('c1550000-0000-4000-8000-000000000012', 'c1550000-0000-4000-8000-000000000002', 'Closed join', 'C155CLOSED', false, 'open_join', null),
  ('c1550000-0000-4000-8000-000000000013', 'c1550000-0000-4000-8000-000000000002', 'Archived join', 'C155ARCH', true, 'open_join', clock_timestamp()),
  ('c1550000-0000-4000-8000-000000000014', 'c1550000-0000-4000-8000-000000000001', 'Owned join', 'C155OWN', true, 'open_join', null),
  ('c1550000-0000-4000-8000-000000000015', 'c1550000-0000-4000-8000-000000000002', 'Rollback join', 'C155ROLL', true, 'open_join', null);

insert into public.classroom_roster (
  classroom_id, email, student_number, first_name, last_name, join_source
) values (
  'c1550000-0000-4000-8000-000000000011',
  'mixed-actor@example.invalid',
  'S155',
  'Mixed',
  'Actor',
  'manual'
);

set local role service_role;
do $behavior$
declare
  v_actor constant uuid := 'c1550000-0000-4000-8000-000000000001';
  v_open constant uuid := 'c1550000-0000-4000-8000-000000000010';
  v_roster_class constant uuid := 'c1550000-0000-4000-8000-000000000011';
  v_result jsonb;
  v_roster_id uuid;
  v_enrollment_id uuid;
  v_event jsonb := jsonb_build_object(
    'schema_version', '1',
    'idempotency_key', 'c155-classroom-joined',
    'event_type', 'classroom.joined',
    'learner_id', 'learner-c155',
    'occurred_at', clock_timestamp()::text,
    'metadata', jsonb_build_object('classroom_id', 'classroom-c155')
  );
begin
  v_result := public.join_classroom_by_code_atomic_v1(
    v_actor, v_open, ' c155open ', repeat('a', 64), repeat('b', 64),
    ' Mixed ', ' Actor ', ' S-155 ', v_event
  );
  if not (v_result->>'ok')::boolean or not (v_result->>'created')::boolean
    or (v_result->>'status')::integer <> 201
    or v_result->'classroom' ? 'class_code'
    or v_result->'classroom' ? 'teacher_id' then
    raise exception 'Open join did not return the expected least-data creation result: %', v_result;
  end if;

  select id into v_roster_id from public.classroom_roster
  where classroom_id = v_open and email = 'mixed-actor@example.invalid';
  select id into v_enrollment_id from public.classroom_enrollments
  where classroom_id = v_open and student_id = v_actor;
  if v_roster_id is null or v_enrollment_id is null
    or not exists (
      select 1 from public.classroom_roster_student_bindings
      where roster_id = v_roster_id and classroom_id = v_open and student_id = v_actor
    )
    or not exists (
      select 1 from public.student_profiles
      where user_id = v_actor and first_name = 'Mixed' and last_name = 'Actor' and student_number = 'S-155'
    )
    or not exists (
      select 1 from public.pal_event_outbox
      where student_id = v_actor and source_kind = 'classroom_enrollment'
        and source_id = v_open::text and payload = v_event
    ) then
    raise exception 'Open join did not commit all membership effects';
  end if;

  v_result := public.join_classroom_by_code_atomic_v1(
    v_actor, v_open, 'C155OPEN', repeat('a', 64), repeat('b', 64),
    null, null, null, v_event
  );
  if not (v_result->>'ok')::boolean or (v_result->>'created')::boolean
    or (select count(*) from public.classroom_enrollments where classroom_id = v_open and student_id = v_actor) <> 1
    or (select count(*) from public.pal_event_outbox where idempotency_key = 'c155-classroom-joined') <> 1 then
    raise exception 'Duplicate join was not idempotent: %', v_result;
  end if;

  -- A teacher-valued account can join a different classroom through roster evidence.
  v_result := public.join_classroom_by_code_atomic_v1(
    v_actor, v_roster_class, 'C155ROSTER', repeat('a', 64), repeat('c', 64),
    null, null, null, null
  );
  if not (v_result->>'ok')::boolean or not (v_result->>'created')::boolean
    or not exists (
      select 1 from public.classroom_roster_student_bindings binding
      join public.classroom_roster roster on roster.id = binding.roster_id
      where roster.classroom_id = v_roster_class and binding.student_id = v_actor
    ) then
    raise exception 'Contextual teacher-valued roster join failed: %', v_result;
  end if;

  v_result := public.join_classroom_by_code_atomic_v1(
    v_actor, 'c1550000-0000-4000-8000-000000000012', 'C155CLOSED',
    repeat('a', 64), repeat('d', 64), 'Mixed', 'Actor', null, null
  );
  if v_result->>'error_code' <> 'enrollment_closed' then raise exception 'Closed enrollment was admitted'; end if;

  v_result := public.join_classroom_by_code_atomic_v1(
    v_actor, 'c1550000-0000-4000-8000-000000000013', 'C155ARCH',
    repeat('a', 64), repeat('e', 64), 'Mixed', 'Actor', null, null
  );
  if v_result->>'error_code' <> 'classroom_not_found' then raise exception 'Archived classroom was revealed'; end if;

  v_result := public.join_classroom_by_code_atomic_v1(
    v_actor, v_open, 'WRONG', repeat('a', 64), repeat('f', 64), null, null, null, null
  );
  if v_result->>'error_code' <> 'classroom_not_found' then raise exception 'Wrong code was distinguishable'; end if;

  v_result := public.join_classroom_by_code_atomic_v1(
    v_actor, 'c1550000-0000-4000-8000-000000000014', 'C155OWN',
    repeat('a', 64), repeat('1', 64), 'Mixed', 'Actor', null, null
  );
  if v_result->>'error_code' <> 'owner_self_join' then raise exception 'Owner self-join was admitted'; end if;
end;
$behavior$;
reset role;

-- Fail after roster and enrollment writes; the caught subtransaction must roll
-- every membership effect back together.
create function pg_temp.fail_c155_profile() returns trigger language plpgsql as $trigger$
begin
  if new.user_id = 'c1550000-0000-4000-8000-000000000003'::uuid then
    raise exception using errcode = '23514', message = 'forced contextual join profile failure';
  end if;
  return new;
end;
$trigger$;
create trigger c155_profile_failure before insert or update on public.student_profiles
for each row execute function pg_temp.fail_c155_profile();

set local role service_role;
do $rollback_test$
begin
  begin
    perform public.join_classroom_by_code_atomic_v1(
      'c1550000-0000-4000-8000-000000000003',
      'c1550000-0000-4000-8000-000000000015',
      'C155ROLL', repeat('2', 64), repeat('3', 64),
      'Other', 'Actor', null, null
    );
    raise exception 'Expected forced contextual join failure';
  exception when check_violation then null;
  end;

  if exists (
      select 1 from public.classroom_enrollments
      where classroom_id = 'c1550000-0000-4000-8000-000000000015'
    ) or exists (
      select 1 from public.classroom_roster
      where classroom_id = 'c1550000-0000-4000-8000-000000000015'
    ) or exists (
      select 1 from public.classroom_roster_student_bindings
      where classroom_id = 'c1550000-0000-4000-8000-000000000015'
    ) or exists (
      select 1 from public.student_profiles
      where user_id = 'c1550000-0000-4000-8000-000000000003'
    ) then
    raise exception 'Failed contextual join left a partial write';
  end if;
end;
$rollback_test$;
reset role;

rollback;
SQL

echo 'Contextual enrollment authorization, atomicity, idempotency, privacy, and privilege contracts passed.'
